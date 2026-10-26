-- =============================================================================
-- 20261042000000_tonight_way.sql
-- What passengers are told now matches what their trip map shows.
--   1. A booking keeps the stop the passenger chose (booked_from / booked_to)
--      when the bus doesn't go there, so the map can show the turn-off for it.
--   2. At the cut-off, passengers of an on-request stop that didn't fill are
--      moved to the main stop just before the turn-off (getting off) or just
--      after it (getting on), not the nearest one by time, and the text says
--      where to get off / on.
--   3. "Your stop is going": when an on-request stop gets enough seats before
--      the cut-off, the passengers booked there get a notification and a text
--      (once per trip and stop).
-- Stops that the variant in use leaves out are handled by the message
-- dispatcher (/api/messages/dispatch), which knows the variants.
-- =============================================================================

alter table public.bookings add column if not exists booked_from text;
alter table public.bookings add column if not exists booked_to text;

-- The stop the bus does go to just before / after a position on the route,
-- within [p_lo, p_hi]: a main stop (not a shaping point), or an on-request
-- stop with enough seats on this trip.
create or replace function public.way_stop_near(p_stops jsonb, p_idx int, p_lo int, p_hi int, p_schedule text, p_date date, p_after boolean) returns text
language sql stable security definer set search_path = public as $$
  with st as (select * from public.optional_stop_status(p_schedule, p_date))
  select e.stop ->> 'name'
  from jsonb_array_elements(p_stops) with ordinality as e(stop, ord)
  where not coalesce((e.stop ->> 'hidden')::boolean, false)
    and (ord - 1) between p_lo and p_hi and (ord - 1) <> p_idx
    and (case when p_after then (ord - 1) > p_idx else (ord - 1) < p_idx end)
    and (not public.stop_is_optional(e.stop)
         or exists (select 1 from st where lower(st.stop) = lower(e.stop ->> 'name') and st.seats >= st.min_seats))
  order by case when p_after then ord else -ord end
  limit 1;
$$;
revoke execute on function public.way_stop_near(jsonb, int, int, int, text, date, boolean) from public, anon, authenticated;

-- Settle every departure whose cut-off has passed. Run by the message dispatcher.
create or replace function public.settle_optional_stops() returns integer
language plpgsql security definer set search_path = public as $$
declare run record; st record; b record; n int := 0; v_from int; v_to int; v_last int;
        v_new_from text; v_new_to text; v_moved text; v_off boolean; v_where text;
begin
  for run in
    select distinct s.id as schedule_id, x.travel_date, r.stops
    from public.schedules s
    join public.routes r on r.id = s.route_id
    cross join lateral (select generate_series(current_date - 1, current_date + 4, interval '1 day')::date as travel_date) x
    where exists (select 1 from jsonb_array_elements(r.stops) e where public.stop_is_optional(e))
      and public.optional_cutoff(s.id, x.travel_date) <= now()
      and public.optional_cutoff(s.id, x.travel_date) > now() - interval '2 days'
  loop
    v_last := jsonb_array_length(run.stops) - 1;
    -- First the stops that filled (so passengers can be moved to them), then the rest.
    insert into public.optional_stop_decisions (schedule_id, travel_date, stop, runs, seats, min_seats)
    select run.schedule_id, run.travel_date, x.stop, true, x.seats, x.min_seats
      from public.optional_stop_status(run.schedule_id, run.travel_date) x where not x.decided and x.seats >= x.min_seats
    on conflict do nothing;
    for st in select * from public.optional_stop_status(run.schedule_id, run.travel_date) where not decided loop
      if st.seats >= st.min_seats then
        continue;
      else
        v_moved := null;
        for b in
          select * from public.bookings
          where schedule_id = run.schedule_id and travel_date = run.travel_date
            and status::text in ('confirmed', 'held', 'boarded')
            and (lower(from_stop) = lower(st.stop) or lower(to_stop) = lower(st.stop))
        loop
          v_from := public.stop_index(run.stops, b.from_stop);
          v_to := public.stop_index(run.stops, b.to_stop);
          v_new_from := b.from_stop; v_new_to := b.to_stop;
          v_off := lower(b.to_stop) = lower(st.stop);
          -- Getting on: the main stop just after the turn-off (the bus comes back to the road there).
          if lower(b.from_stop) = lower(st.stop) then
            v_new_from := coalesce(public.way_stop_near(run.stops, v_from, 0, v_to - 1, run.schedule_id, run.travel_date, true),
                                   public.way_stop_near(run.stops, v_from, 0, v_to - 1, run.schedule_id, run.travel_date, false));
          end if;
          -- Getting off: the main stop just before the turn-off.
          if v_off then
            v_new_to := coalesce(public.way_stop_near(run.stops, v_to, coalesce(public.stop_index(run.stops, v_new_from), v_from) + 1, v_last, run.schedule_id, run.travel_date, false),
                                 public.way_stop_near(run.stops, v_to, coalesce(public.stop_index(run.stops, v_new_from), v_from) + 1, v_last, run.schedule_id, run.travel_date, true));
          end if;
          if v_new_from is null or v_new_to is null then continue; end if;  -- nowhere sensible: leave it for the office
          update public.bookings
             set from_stop = v_new_from, to_stop = v_new_to,
                 booked_from = case when lower(b.from_stop) = lower(st.stop) then coalesce(b.booked_from, b.from_stop) else b.booked_from end,
                 booked_to = case when v_off then coalesce(b.booked_to, b.to_stop) else b.booked_to end
           where id = b.id;
          v_moved := case when v_off then v_new_to else v_new_from end;
          v_where := case when v_off
            then 'You will get off where the road turns off for ' || st.stop || ', after ' || v_new_to || ' (your ticket now says ' || v_new_to || ').'
            else 'Please board at ' || v_new_from || ', or where the road comes back from ' || st.stop || ' just before it.' end;
          if b.user_id is not null then
            insert into public.notifications (user_id, title, body, url, tag)
            values (b.user_id, 'Your stop has changed',
                    'Not enough passengers booked ' || st.stop || ', so the bus is not going there on this trip. ' || v_where
                      || ' Your seat stays the same. The trip map shows the spot.',
                    '/my-bookings?ref=' || b.ref, 'optional-' || b.id || '-' || st.stop);
          end if;
          perform public.enqueue_message(coalesce(nullif(b.contact_phone, ''), b.passenger_phone),
            'Siyan Lanka ' || b.ref || ': not enough passengers booked ' || st.stop || ', so the bus is not going there on '
              || to_char(run.travel_date, 'DD Mon') || '. ' || v_where || ' Same seat, same ticket.',
            'optional_stop', b.id);
          n := n + 1;
        end loop;
        insert into public.optional_stop_decisions (schedule_id, travel_date, stop, runs, seats, min_seats, moved_to)
        values (run.schedule_id, run.travel_date, st.stop, false, st.seats, st.min_seats, v_moved) on conflict do nothing;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.settle_optional_stops() from public, anon, authenticated;

-- "Your stop is going": on-request stops that reached their seats before the cut-off.
create table if not exists public.optional_stop_alerts (
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  stop text not null,
  seats integer not null,
  created_at timestamptz not null default now(),
  primary key (schedule_id, travel_date, stop)
);
alter table public.optional_stop_alerts enable row level security;
drop policy if exists "staff read stop alerts" on public.optional_stop_alerts;
create policy "staff read stop alerts" on public.optional_stop_alerts for select using (public.is_staff());

create or replace function public.alert_filled_optional_stops() returns integer
language plpgsql security definer set search_path = public as $$
declare run record; st record; b record; n int := 0;
begin
  for run in
    select distinct s.id as schedule_id, x.travel_date
    from public.schedules s
    join public.routes r on r.id = s.route_id
    cross join lateral (select generate_series(current_date, current_date + 30, interval '1 day')::date as travel_date) x
    where s.active and exists (select 1 from jsonb_array_elements(r.stops) e where public.stop_is_optional(e))
      and public.optional_cutoff(s.id, x.travel_date) > now()
      and exists (select 1 from public.bookings bk where bk.schedule_id = s.id and bk.travel_date = x.travel_date and bk.status::text in ('confirmed', 'held'))
  loop
    for st in select * from public.optional_stop_status(run.schedule_id, run.travel_date) where not decided and seats >= min_seats loop
      insert into public.optional_stop_alerts (schedule_id, travel_date, stop, seats)
      values (run.schedule_id, run.travel_date, st.stop, st.seats) on conflict do nothing;
      if not found then continue; end if;  -- already told
      for b in
        select * from public.bookings
        where schedule_id = run.schedule_id and travel_date = run.travel_date
          and status::text in ('confirmed', 'held')
          and (lower(from_stop) = lower(st.stop) or lower(to_stop) = lower(st.stop))
      loop
        if b.user_id is not null then
          insert into public.notifications (user_id, title, body, url, tag)
          values (b.user_id, 'Your stop is going',
                  'Enough seats are booked to ' || st.stop || ', so the bus is going there on ' || to_char(run.travel_date, 'DD Mon') || '. It is final at the cut-off.',
                  '/my-bookings?ref=' || b.ref, 'optional-going-' || b.id || '-' || st.stop);
        end if;
        perform public.enqueue_message(coalesce(nullif(b.contact_phone, ''), b.passenger_phone),
          'Siyan Lanka ' || b.ref || ': good news, enough seats are booked to ' || st.stop || ', so the bus is going there on '
            || to_char(run.travel_date, 'DD Mon') || '. It is final at the cut-off; we will text you if that changes.',
          'optional_stop_going', b.id);
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.alert_filled_optional_stops() from public, anon, authenticated;

notify pgrst, 'reload schema';
