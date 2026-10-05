-- =============================================================================
-- Siyan Lanka Travels — migration 29: reminders on or off for each trip
-- A passenger can turn the notifications for one trip on or off from My trips
-- (the bell on the trip). Off means no push reminders (1 day, 3 hours, 1 hour,
-- trip started) and no pushed conductor updates for that booking. Texts are
-- not affected: the booking message and trip updates still go by SMS.
-- Safe to run again.
-- =============================================================================
alter table public.bookings add column if not exists notify boolean not null default true;

create or replace function public.set_trip_notifications(p_booking uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  update public.bookings set notify = coalesce(p_on, true)
  where id = p_booking and (user_id = auth.uid() or public.is_staff());
  if not found then raise exception 'NOT_FOUND: That booking isn''t yours.'; end if;
  return coalesce(p_on, true);
end $$;
revoke execute on function public.set_trip_notifications(uuid, boolean) from public, anon;
grant execute on function public.set_trip_notifications(uuid, boolean) to authenticated;

-- The reminders from migration 24, unchanged except that a trip with its
-- bell turned off is skipped.
create or replace function public.queue_trip_reminders(p_hours integer default 3) returns integer
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; r record; n int := 0; leaves timestamptz; stage text; due_at timestamptz; at_time text; title text; body text;
begin
  select * into cfg from public.app_settings;
  for r in
    select b.id, b.user_id, b.ref, b.from_stop, b.to_stop, b.seats, b.created_at, b.payment_status, b.total, bus.reg_no,
           ((b.travel_date + s.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, b.from_stop) ->> 'offsetMin')::int)) as local_leaves
    from public.bookings b
    join public.schedules s on s.id = b.schedule_id
    join public.routes rt on rt.id = s.route_id
    join public.buses bus on bus.id = s.bus_id
    where (b.status::text = 'confirmed' or (b.status::text = 'held' and b.payment_method = 'bus'))
      and b.user_id is not null
      and b.notify            -- the passenger has not turned this trip's reminders off
      and b.travel_date between current_date - 2 and current_date + 2
  loop
    leaves := r.local_leaves at time zone cfg.timezone;
    if now() >= leaves + interval '20 minutes' or now() < leaves - interval '24 hours' then continue; end if;
    if now() >= leaves then stage := 'start'; due_at := leaves;
    elsif now() >= leaves - interval '1 hour' then stage := '1h'; due_at := leaves - interval '1 hour';
    elsif now() >= leaves - interval '3 hours' then stage := '3h'; due_at := leaves - interval '3 hours';
    else
      stage := '24h'; due_at := leaves - interval '24 hours';
      -- Only close to the day-before mark, so a late run can't send it at an odd hour.
      if now() > due_at + interval '6 hours' then continue; end if;
    end if;
    if r.created_at > due_at then continue; end if;          -- booked after this reminder's moment
    if not public.claim_booking_notice(r.id, stage) then continue; end if;

    at_time := trim(to_char(r.local_leaves, 'HH12:MI AM'));
    body := r.from_stop || ' → ' || r.to_stop || ' · Seat ' || array_to_string(r.seats, ', ') || ' · ' || r.reg_no || '.';
    if stage = '24h' then
      title := 'Your trip is tomorrow at ' || at_time;
      body := body || ' ' || trim(to_char(r.local_leaves, 'Dy DD Mon')) || '. Your ticket is ready in My trips.';
    elsif stage = '3h' then
      title := 'Your bus leaves at ' || at_time;
      body := body || ' 3 hours to go. Be at the boarding point 20 minutes early.';
    elsif stage = '1h' then
      title := 'Your bus leaves in 1 hour';
      body := body || ' Leaves ' || r.from_stop || ' at ' || at_time || '. Time to head to the boarding point.'
        || case when r.payment_status = 'unpaid' then ' Bring LKR ' || r.total || ' in cash.' else '' end;
    else
      title := 'Your trip is starting';
      body := body || ' The bus is due at ' || r.from_stop || ' now (' || at_time || '). Tap to see where it is.';
    end if;
    insert into public.notifications (user_id, title, body, url, tag)
    values (r.user_id, title, body,
            case when stage in ('1h', 'start') then '/track?ref=' || r.ref else '/my-bookings?ref=' || r.ref end,
            'trip-' || r.id || '-' || stage);
    if stage = '3h' then update public.bookings set reminder_sent_at = now() where id = r.id and reminder_sent_at is null; end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_trip_reminders(integer) from public, anon, authenticated;

-- Conductor updates: the text goes out as before; the push only if the bell is on.
create or replace function public.trip_event_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; txt text; head text;
begin
  txt := case new.kind
    when 'departed' then 'Your Siyan Lanka bus has left ' || coalesce(nullif(new.stop, ''), 'its stop') || '.'
    when 'delayed' then 'Your Siyan Lanka bus is running about ' || coalesce(new.minutes, 0) || ' min late.'
    when 'arriving' then 'Your Siyan Lanka bus is about ' || coalesce(new.minutes, 0) || ' min from ' || new.stop || '.'
    when 'arrived' then 'Your Siyan Lanka bus has reached ' || new.stop || '.'
    else 'Siyan Lanka: ' || new.message end;
  if new.message <> '' and new.kind <> 'note' then txt := txt || ' ' || new.message; end if;
  head := case new.kind
    when 'departed' then 'Your bus has started'
    when 'delayed' then 'Your bus is running late'
    when 'arriving' then 'Your bus is nearly there'
    when 'arrived' then 'Your bus has arrived'
    else 'Trip update' end;
  for b in select * from public.bookings where schedule_id = new.schedule_id and travel_date = new.travel_date and status::text in ('confirmed', 'held') loop
    perform public.enqueue_message(coalesce(nullif(b.contact_phone, ''), b.passenger_phone), txt, 'trip_' || new.kind, b.id);
    if b.user_id is not null and b.notify then
      if new.kind = 'departed' and (new.stop = '' or new.stop = b.from_stop) then
        perform public.claim_booking_notice(b.id, 'start');
      end if;
      insert into public.notifications (user_id, title, body, url, tag)
      values (b.user_id, head, txt || ' Tap to track it live.', '/track?ref=' || b.ref, 'trip-' || b.id || '-' || new.kind || '-' || left(new.id::text, 8));
    end if;
  end loop;
  return new;
end $$;
