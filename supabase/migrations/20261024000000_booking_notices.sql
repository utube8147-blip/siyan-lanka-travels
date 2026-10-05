-- =============================================================================
-- Siyan Lanka Travels — migration 24: one full booking message, the ticket by
-- email, and trip reminders at the right times
--  1. When a booking is done the passenger gets ONE text with everything:
--     trip, seats, bus, what was paid, and links to the ticket, live tracking
--     and My trips. It is never sent twice for the same booking.
--  2. If there is an email address (on the booking, or on the account) the
--     ticket also goes there.
--  3. Push notifications 1 day, 3 hours and 1 hour before the passenger's own
--     boarding time, and when the trip starts. Each one is sent once.
--  4. Trip updates from the conductor (left, late, arriving…) are pushed too.
-- Safe to run again.
-- =============================================================================

-- --------------------------------------------- what has already been sent ---
-- One row per thing sent for a booking: 'details', '24h', '3h', '1h', 'start'.
-- The primary key is what makes "once" true even if two runs overlap.
create table if not exists public.booking_notices (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind text not null check (kind in ('details', '24h', '3h', '1h', 'start')),
  sent_at timestamptz not null default now(),
  primary key (booking_id, kind)
);
alter table public.booking_notices enable row level security;
drop policy if exists "staff read booking notices" on public.booking_notices;
create policy "staff read booking notices" on public.booking_notices for select using (public.is_staff());
revoke insert, update, delete on public.booking_notices from anon, authenticated;

-- Bookings reminded under the old single 3-hour reminder: don't remind again.
insert into public.booking_notices (booking_id, kind, sent_at)
select id, '3h', reminder_sent_at from public.bookings where reminder_sent_at is not null
on conflict do nothing;
-- Bookings that already had their confirmation text: no second one.
insert into public.booking_notices (booking_id, kind, sent_at)
select distinct on (booking_id) booking_id, 'details', created_at from public.message_queue
where booking_id is not null and kind in ('booking_confirmed', 'booking_held') and channel <> 'email'
order by booking_id, created_at
on conflict do nothing;

/** True the first time it is called for a booking + kind, false after that. */
create or replace function public.claim_booking_notice(p_booking uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.booking_notices (booking_id, kind) values (p_booking, p_kind) on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.claim_booking_notice(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------- 2. email -----
alter table public.message_queue drop constraint if exists message_queue_channel_check;
alter table public.message_queue add constraint message_queue_channel_check check (channel in ('sms', 'whatsapp', 'email'));
alter table public.message_queue
  alter column to_phone set default '',
  add column if not exists to_email text,
  add column if not exists subject text,
  add column if not exists data jsonb;   -- the details, for the email layout

-- Email is on unless Settings turns it off ({"email": false} in messaging).
create or replace function public.enqueue_email(p_email text, p_subject text, p_body text, p_kind text, p_booking uuid default null, p_data jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare m jsonb := (select messaging from public.app_settings);
begin
  if coalesce(trim(p_email), '') !~ '^\S+@\S+\.\S+$' then return; end if;
  if not coalesce((m ->> 'email')::boolean, true) then return; end if;
  insert into public.message_queue (channel, to_phone, to_email, subject, body, kind, booking_id, data)
  values ('email', '', lower(trim(p_email)), p_subject, p_body, p_kind, p_booking, p_data);
end $$;
revoke execute on function public.enqueue_email(text, text, text, text, uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------- 1. the one booking message -----
-- Sent when the booking is really done: confirmed (paid, or free), or the
-- seat is kept for "pay on the bus". A bank / counter hold first gets the
-- "how to pay" text (as before) and this one when the payment arrives.
create or replace function public.booking_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bank text;
  site text;
  phone text := coalesce(nullif(new.contact_phone, ''), new.passenger_phone);
  email text := nullif(trim(new.contact_email), '');
  departs text := public.booking_departure_text(new);
  seats text := array_to_string(new.seats, ', ');
  trip text := new.from_stop || ' → ' || new.to_stop || ', ' || departs || ', seat ' || array_to_string(new.seats, ',');
  reg text; pay text; l_ticket text; l_track text; l_trips text; done boolean; just_paid boolean;
begin
  if new.channel <> 'online' then return new; end if;
  select * into cfg from public.app_settings;
  site := rtrim(coalesce(cfg.site_url, ''), '/'); bank := cfg.bank_details;

  done := new.status::text in ('confirmed', 'boarded') or (new.status::text = 'held' and new.payment_method = 'bus');
  just_paid := tg_op = 'UPDATE' and old.payment_status = 'unpaid' and new.payment_status = 'paid' and new.status::text in ('confirmed', 'boarded');

  if new.status::text = 'cancelled' then
    if tg_op = 'UPDATE' and old.status::text in ('confirmed', 'held') then
      perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' cancelled'
        || case when coalesce(new.refund_amount, 0) > 0 then '. Refund LKR ' || new.refund_amount || ' on its way.' else '.' end, 'booking_cancelled', new.id);
    end if;

  elsif done and public.claim_booking_notice(new.id, 'details') then
    select b.reg_no into reg from public.schedules s join public.buses b on b.id = s.bus_id where s.id = new.schedule_id;
    if email is null and new.user_id is not null then
      select nullif(u.email, '') into email from auth.users u where u.id = new.user_id;
    end if;
    pay := case when new.payment_status = 'paid' then 'Paid LKR ' || new.total
                when new.payment_method = 'bus' then 'Pay LKR ' || new.total || ' in cash on the bus'
                else 'Total LKR ' || new.total end;
    l_ticket := site || '/my-bookings?ref=' || new.ref;
    l_track := site || '/track?ref=' || new.ref;
    l_trips := site || '/my-bookings';
    -- Plain letters only ("to", not an arrow): special characters make a text
    -- cost more than twice as many parts.
    perform public.enqueue_message(phone,
      'Siyan Lanka: Booking ' || new.ref || ' confirmed.' || E'\n'
      || new.from_stop || ' to ' || new.to_stop || E'\n'
      || departs || E'\n'
      || 'Seat ' || seats || coalesce(', bus ' || reg, '') || E'\n'
      || pay || E'\n'
      || 'Ticket: ' || l_ticket || E'\n'
      || 'Track bus: ' || l_track || E'\n'
      || 'My trips: ' || l_trips || E'\n'
      || 'Be at the boarding point 20 min early.',
      'booking_confirmed', new.id);
    perform public.enqueue_email(email, 'Your ticket ' || new.ref || ': ' || new.from_stop || ' to ' || new.to_stop,
      'Booking ' || new.ref || ' confirmed.' || E'\n' || new.from_stop || ' to ' || new.to_stop || E'\n' || departs || E'\n'
      || 'Seat ' || seats || coalesce(', bus ' || reg, '') || E'\n' || pay || E'\n\n'
      || 'Ticket: ' || l_ticket || E'\n' || 'Track your bus: ' || l_track || E'\n' || 'My trips: ' || l_trips,
      'booking_confirmed', new.id,
      jsonb_build_object('ref', new.ref, 'name', new.passenger_name, 'from', new.from_stop, 'to', new.to_stop, 'departs', departs,
        'seats', seats, 'bus', coalesce(reg, ''), 'pay', pay, 'ticket_url', l_ticket, 'track_url', l_track, 'trips_url', l_trips));
    if new.user_id is not null then
      insert into public.notifications (user_id, title, body, url, tag)
      values (new.user_id, 'Booking confirmed: ' || new.ref,
              new.from_stop || ' → ' || new.to_stop || ' · ' || departs || ' · Seat ' || seats || '. ' || pay || '.',
              '/my-bookings?ref=' || new.ref, 'booking-' || new.id);
    end if;

  elsif just_paid then
    -- The full message went out earlier (pay on the bus): just a short receipt.
    perform public.enqueue_message(phone, 'Siyan Lanka: Payment of LKR ' || new.total || ' received for booking ' || new.ref || '. Thank you.', 'payment_received', new.id);
    if new.user_id is not null then
      insert into public.notifications (user_id, title, body, url)
      values (new.user_id, 'Payment received', 'LKR ' || new.total || ' for ' || new.ref || '. Your seat ' || seats || ' is confirmed.', '/my-bookings?ref=' || new.ref);
    end if;

  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method in ('bank', 'counter') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat held, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' by '
      || to_char(new.hold_expires_at at time zone cfg.timezone, 'Dy DD Mon HH12:MI AM')
      || case when new.payment_method = 'bank' then '. Bank: ' || bank || ' Ref: ' || new.ref else ' at our Bastian Mawatha counter' end || '.', 'booking_held', new.id);
  end if;
  return new;
end $$;
drop trigger if exists bookings_messages on public.bookings;
create trigger bookings_messages after insert or update of status, payment_status on public.bookings
  for each row execute function public.booking_messages();

-- ---------------------------------------------------- 3. trip reminders -----
-- Called every minute by /api/messages/dispatch. For each coming booking it
-- works out which reminder is due right now (1 day, 3 hours or 1 hour before
-- the passenger's own boarding time, or "starting now") and queues it once.
-- A reminder is skipped when the seat was booked after its moment had passed:
-- someone who books 2 hours before gets the 1-hour one, not all three at once.
-- (p_hours is no longer used; kept so older callers still work.)
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

-- ------------------------------------- 4. trip updates are pushed as well ---
-- Text / WhatsApp as before, plus a push to passengers with an account. When
-- the conductor marks the bus as left from the passenger's own stop (or
-- without naming a stop) that is their "trip started" notification, so the
-- timed one above is not sent on top of it.
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
    if b.user_id is not null then
      if new.kind = 'departed' and (new.stop = '' or new.stop = b.from_stop) then
        perform public.claim_booking_notice(b.id, 'start');
      end if;
      insert into public.notifications (user_id, title, body, url, tag)
      values (b.user_id, head, txt || ' Tap to track it live.', '/track?ref=' || b.ref, 'trip-' || b.id || '-' || new.kind || '-' || left(new.id::text, 8));
    end if;
  end loop;
  return new;
end $$;
