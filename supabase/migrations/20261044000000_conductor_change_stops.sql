-- =============================================================================
-- 20261044000000_conductor_change_stops.sql
-- The conductor (or office) changes where a passenger gets on or off, after
-- asking them: "I'll get off at Kurunegala instead of Dambulla".
--  * Only stops on this route, not hidden points, getting on before getting off.
--  * Someone already on the bus keeps their boarding stop.
--  * Seats are booked for the whole trip, so no seat can clash.
--  * Fare: one-price routes don't change. On pay-by-distance routes an unpaid
--    booking gets the new fare; a paid one keeps what was paid and the
--    difference is written in the log for the office.
--  * The stops before the change are kept in the log (booking_stop_changes).
--  * Every change is logged (booking_stop_changes) and the passenger gets a
--    notification and a text.
-- =============================================================================

create table if not exists public.booking_stop_changes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  old_from text not null,
  old_to text not null,
  new_from text not null,
  new_to text not null,
  fare_diff integer not null default 0,
  note text,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists booking_stop_changes_booking_idx on public.booking_stop_changes (booking_id, created_at desc);
alter table public.booking_stop_changes enable row level security;
drop policy if exists "staff read stop changes" on public.booking_stop_changes;
create policy "staff read stop changes" on public.booking_stop_changes for select using (public.is_staff());
revoke insert, update, delete on public.booking_stop_changes from anon, authenticated;

create or replace function public.change_booking_stops(p_id uuid, p_from text, p_to text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  bk public.bookings; sch public.schedules; rt public.routes;
  fi int; ti int; v_from text; v_to text; new_fare int; diff int := 0; money_changed boolean := false;
  msg text;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select * into bk from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status not in ('confirmed', 'held', 'boarded') then raise exception 'NOT_ALLOWED: This booking can no longer be changed.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;

  fi := public.stop_index(rt.stops, p_from);
  ti := public.stop_index(rt.stops, p_to);
  if fi is null then raise exception 'BAD_STOP: % is not a stop on this route.', p_from; end if;
  if ti is null then raise exception 'BAD_STOP: % is not a stop on this route.', p_to; end if;
  if coalesce((rt.stops -> fi ->> 'hidden')::boolean, false) then raise exception 'STOP_HIDDEN: % is not a stop on this route. Choose another stop.', p_from; end if;
  if coalesce((rt.stops -> ti ->> 'hidden')::boolean, false) then raise exception 'STOP_HIDDEN: % is not a stop on this route. Choose another stop.', p_to; end if;
  if fi >= ti then raise exception 'BAD_STOPS: The stop where they get on has to come before the one where they get off.'; end if;
  v_from := rt.stops -> fi ->> 'name';
  v_to := rt.stops -> ti ->> 'name';
  if bk.status = 'boarded' and lower(v_from) <> lower(bk.from_stop) then
    raise exception 'ON_BOARD: They are already on the bus; only the stop where they get off can change.';
  end if;
  if lower(v_from) = lower(bk.from_stop) and lower(v_to) = lower(bk.to_stop) then
    return jsonb_build_object('changed', false, 'fare_diff', 0, 'money_changed', false);
  end if;

  if not rt.flat_fare then
    new_fare := (rt.stops -> ti ->> 'fareFromStart')::int - (rt.stops -> fi ->> 'fareFromStart')::int;
    diff := (new_fare - bk.fare) * cardinality(bk.seats);
  end if;

  -- booked_from / booked_to stay for moves at the on-request cut-off ("the bus
  -- doesn't go to the stop you booked"); a change agreed with the passenger
  -- simply becomes their stop, with the old one in booking_stop_changes.
  update public.bookings set from_stop = v_from, to_stop = v_to where id = bk.id;
  -- Back to the stop first booked: nothing to remember any more.
  update public.bookings
     set booked_from = case when lower(booked_from) = lower(from_stop) then null else booked_from end,
         booked_to = case when lower(booked_to) = lower(to_stop) then null else booked_to end
   where id = bk.id;
  -- Not paid yet: they pay the fare for the new stretch.
  if diff <> 0 and bk.payment_status = 'unpaid' then
    update public.bookings set fare = new_fare, total = greatest(0, new_fare * cardinality(seats) - discount + bike_fee + fee) where id = bk.id;
    money_changed := true;
  end if;

  insert into public.booking_stop_changes (booking_id, old_from, old_to, new_from, new_to, fare_diff, note, changed_by)
  values (bk.id, bk.from_stop, bk.to_stop, v_from, v_to, case when money_changed then 0 else diff end, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  msg := 'Siyan Lanka ' || bk.ref || ': as agreed with the conductor, '
      || case when lower(v_from) <> lower(bk.from_stop) and lower(v_to) <> lower(bk.to_stop) then 'you now get on at ' || v_from || ' and off at ' || v_to
              when lower(v_from) <> lower(bk.from_stop) then 'you now get on at ' || v_from
              else 'you now get off at ' || v_to end
      || '. Same seat, same ticket.';
  if bk.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (bk.user_id, 'Your stop has changed', substring(msg from position(': ' in msg) + 2), '/my-bookings?ref=' || bk.ref);
  end if;
  perform public.enqueue_message(coalesce(nullif(bk.contact_phone, ''), bk.passenger_phone), msg, 'stop_change', bk.id);

  return jsonb_build_object('changed', true, 'from', v_from, 'to', v_to, 'fare_diff', diff, 'money_changed', money_changed);
end $$;
revoke execute on function public.change_booking_stops(uuid, text, text, text) from public, anon;
grant execute on function public.change_booking_stops(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
