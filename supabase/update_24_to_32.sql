-- =============================================================================
-- Siyan Lanka Travels — updates 24 to 32 in one file
--
-- Paste this whole file into Supabase → SQL Editor → Run, in the project your
-- app uses (the code in NEXT_PUBLIC_SUPABASE_URL must match the project).
-- It is SAFE TO RUN AGAIN: anything already there is skipped or updated.
-- It needs the earlier setup (migrations 1 to 23) to be in place already. If
-- you get "relation public.profiles does not exist", this is the wrong
-- project, or a new one: run supabase/setup.sql there instead.
--
--   24. One full booking text, the ticket by email, trip reminders
--   25. Branches: more than one booking place
--   26. Passengers book at most 7 days ahead
--   27. The conductor's trip sheet (fuel and road costs)
--   28. The booking centre closes each trip for the conductor
--   29. Reminders on or off for each trip (the bell)
--   30. A trip's cash is only what was collected on the bus
--   31. Each cash payment records where it was taken: bus or office
--   32. Conductor updates go as push notifications only (no texts)
-- =============================================================================

-- Stop straight away with a clear message if this is not the app's database.
do $$ begin
  if to_regclass('public.profiles') is null or to_regclass('public.bookings') is null or to_regclass('public.cash_counts') is null or to_regclass('public.odometer_logs') is null then
    raise exception 'This database does not have the Siyan Lanka tables (or is missing the earlier updates). Check you are in the right Supabase project; for a new project run supabase/setup.sql instead.';
  end if;
end $$;


-- =============================================================================
-- ▼ 20261024000000_booking_notices.sql
-- =============================================================================
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


-- =============================================================================
-- ▼ 20261025000000_branches.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 25: branches (more than one booking place)
--  1. Branches: each counter / office / agent you sell from.
--  2. Every staff account belongs to a branch (Accounts & roles).
--  3. Every booking remembers the branch that made it and the branch that took
--     the money, as it was on the day (moving a person later changes nothing).
--  4. Sales and cash by branch and by person, for any dates (super admins).
--  5. "Pay at the counter" texts name the counters that take payments.
-- Safe to run again.
-- =============================================================================

-- ------------------------------------------------------------ 1. branches ---
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  address text not null default '',
  phone text not null default '',
  takes_payments boolean not null default true,   -- passengers can pay held seats here
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists branches_name_key on public.branches (lower(trim(name)));
alter table public.branches enable row level security;
-- Names and addresses of counters are public (the payment page lists them).
drop policy if exists "read branches" on public.branches;
create policy "read branches" on public.branches for select using (true);
drop policy if exists "admin branches" on public.branches;
create policy "admin branches" on public.branches for all using (public.is_admin()) with check (public.is_admin());

-- The counter you already have, so nothing changes until you add a second one.
insert into public.branches (name, address)
select 'Bastian Mawatha', 'Bastian Mawatha, Pettah, Colombo 11'
where not exists (select 1 from public.branches);

-- ------------------------------------------------- 2. staff belong to one ---
alter table public.profiles add column if not exists branch_id uuid references public.branches (id) on delete set null;

create or replace function public.set_user_branch(p_user uuid, p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch) then
    raise exception 'NOT_FOUND: That branch doesn''t exist.';
  end if;
  if p_branch is not null and (select role::text from public.profiles where id = p_user) = 'passenger' then
    raise exception 'NOT_ALLOWED: Only staff accounts belong to a branch. Set the role first.';
  end if;
  update public.profiles set branch_id = p_branch where id = p_user;
end $$;
revoke execute on function public.set_user_branch(uuid, uuid) from public, anon;
grant execute on function public.set_user_branch(uuid, uuid) to authenticated;

-- A passenger has no branch: clear it when a staff account is turned back.
create or replace function public.clear_branch_for_passengers() returns trigger
language plpgsql as $$
begin
  if new.role::text = 'passenger' then new.branch_id := null; end if;
  return new;
end $$;
drop trigger if exists profiles_clear_branch on public.profiles;
create trigger profiles_clear_branch before update of role on public.profiles
  for each row execute function public.clear_branch_for_passengers();

-- The accounts list now carries the branch (the return type changed, so drop first).
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, created_at timestamptz, last_sign_in_at timestamptz, branch_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role::text, p.created_at, u.last_sign_in_at, p.branch_id
    from public.profiles p join auth.users u on u.id = p.id
    order by p.role::text desc, p.created_at desc;
end $$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ------------------------------------- 3. bookings remember their branch ----
alter table public.bookings
  add column if not exists branch_id uuid references public.branches (id) on delete set null,       -- who sold it
  add column if not exists paid_branch_id uuid references public.branches (id) on delete set null;  -- who took the money
create index if not exists bookings_branch_idx on public.bookings (branch_id, created_at);
create index if not exists bookings_paid_branch_idx on public.bookings (paid_branch_id, paid_at);

-- Sold at: the branch of the staff member who made the booking. Online
-- bookings are made by the passenger, so they have none ("Online").
create or replace function public.stamp_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null and new.created_by is not null then
    select p.branch_id into new.branch_id from public.profiles p where p.id = new.created_by and p.role::text <> 'passenger';
  end if;
  return new;
end $$;
drop trigger if exists bookings_stamp_branch on public.bookings;
create trigger bookings_stamp_branch before insert on public.bookings
  for each row execute function public.stamp_branch();

-- Paid at: as before this records who took the payment, and now their branch too.
create or replace function public.stamp_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    if new.paid_at is null then new.paid_at := now(); end if;
    if auth.uid() is not null and public.is_staff() then
      new.paid_by := auth.uid();
      new.paid_branch_id := (select p.branch_id from public.profiles p where p.id = auth.uid());
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------ 4. sales by branch --------
-- For the company's local dates p_from..p_to:
--   sold   = bookings a branch MADE in those days (not cancelled)
--   taken  = payments a branch RECORDED in those days, cash and other
--   refunds = cash refunds its people paid out in those days
-- Rows with no branch: "online" (passengers booking themselves, card and
-- bank payments) and staff who have not been given a branch yet.
create or replace function public.branch_sales(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings); out jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'BAD_DATES: Choose up to one year.'; end if;
  with sold as (
    select b.branch_id, b.created_by as person, (b.channel::text = 'online') as online,
           count(*) as bookings, sum(cardinality(b.seats)) as seats, sum(b.total) as value
    from public.bookings b
    where (b.created_at at time zone tz)::date between p_from and p_to and b.status::text <> 'cancelled'
    group by 1, 2, 3
  ), taken as (
    select b.paid_branch_id as branch_id, b.paid_by as person, (b.paid_by is null) as online,
           sum(b.total) filter (where b.payment_method = 'cash') as cash,
           sum(b.total) filter (where b.payment_method <> 'cash') as other
    from public.bookings b
    where b.payment_status in ('paid', 'refunded') and b.paid_at is not null and (b.paid_at at time zone tz)::date between p_from and p_to
    group by 1, 2, 3
  ), refunds as (
    select pr.branch_id, p.paid_by as person, false as online, sum(p.amount) as refunded
    from public.payouts p left join public.profiles pr on pr.id = p.paid_by
    where p.method = 'cash' and p.status = 'paid' and p.paid_at is not null and (p.paid_at at time zone tz)::date between p_from and p_to
    group by 1, 2
  ), keys as (
    select branch_id, person, online from sold union select branch_id, person, online from taken union select branch_id, person, online from refunds
  ), rows as (
    select k.branch_id, k.online,
           case when k.online then null else k.person end as person,
           sum(coalesce(s.bookings, 0)) as bookings, sum(coalesce(s.seats, 0)) as seats, sum(coalesce(s.value, 0)) as value,
           sum(coalesce(t.cash, 0)) as cash, sum(coalesce(t.other, 0)) as other, sum(coalesce(r.refunded, 0)) as refunded
    from keys k
    left join sold s on s.branch_id is not distinct from k.branch_id and s.person is not distinct from k.person and s.online = k.online
    left join taken t on t.branch_id is not distinct from k.branch_id and t.person is not distinct from k.person and t.online = k.online
    left join refunds r on r.branch_id is not distinct from k.branch_id and r.person is not distinct from k.person and r.online = k.online
    group by 1, 2, 3
  ), people as (
    select r.*, coalesce(nullif(p.full_name, ''), 'Staff member') as name, p.role::text as role from rows r left join public.profiles p on p.id = r.person
  ), grouped as (
    select case when online and branch_id is null then 'online' when branch_id is null then 'none' else branch_id::text end as key,
           sum(bookings) as bookings, sum(seats) as seats, sum(value) as value, sum(cash) as cash, sum(other) as other, sum(refunded) as refunded,
           coalesce(jsonb_agg(jsonb_build_object('id', person, 'name', name, 'role', role, 'bookings', bookings, 'seats', seats, 'value', value,
                    'cash', cash, 'other', other, 'refunded', refunded) order by value desc, name) filter (where person is not null), '[]'::jsonb) as people
    from people group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key, 'name', coalesce(br.name, case g.key when 'online' then 'Online' else 'No branch set' end),
           'bookings', g.bookings, 'seats', g.seats, 'value', g.value, 'cash', g.cash, 'other', g.other, 'refunded', g.refunded, 'people', g.people)
           order by (g.key in ('online', 'none')), g.value desc), '[]'::jsonb)
    into out
  from grouped g left join public.branches br on br.id::text = g.key;
  return out;
end $$;
revoke execute on function public.branch_sales(date, date) from public, anon;
grant execute on function public.branch_sales(date, date) to authenticated;

-- --------------------------------------- 5. "pay at the counter" wording ----
-- "at our Bastian Mawatha counter" / "at our Bastian Mawatha or Kalmunai counter".
create or replace function public.counter_text() returns text
language sql stable security definer set search_path = public as $$
  select 'at our ' || coalesce((select string_agg(trim(name), ' or ' order by created_at) || ' ' from public.branches where active and takes_payments), '') || 'counter';
$$;
revoke execute on function public.counter_text() from public, anon, authenticated;

-- The booking texts from migration 24, unchanged except that the counter
-- hold names the counters above.
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
      || case when new.payment_method = 'bank' then '. Bank: ' || bank || ' Ref: ' || new.ref else ' ' || public.counter_text() end || '.', 'booking_held', new.id);
  end if;
  return new;
end $$;
drop trigger if exists bookings_messages on public.bookings;
create trigger bookings_messages after insert or update of status, payment_status on public.bookings
  for each row execute function public.booking_messages();


-- =============================================================================
-- ▼ 20261026000000_booking_window.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 26: how far ahead passengers can book
-- Tickets sold weeks ahead are the ones that go wrong when the timetable
-- changes. Passengers can now book only up to N days before travel (7 unless
-- changed in Settings; 0 = no limit). Staff can still book any date at the
-- counter. Bookings that already exist are not touched. Safe to run again.
-- =============================================================================
alter table public.app_settings add column if not exists booking_window_days integer not null default 7;
alter table public.app_settings drop constraint if exists app_settings_booking_window_check;
alter table public.app_settings add constraint app_settings_booking_window_check check (booking_window_days between 0 and 365);

-- Checked on every new booking and every change of date a passenger makes,
-- whichever function made it, so the limit can't be skipped from outside the app.
create or replace function public.enforce_booking_window() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; last_day date;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if auth.uid() is null or public.is_staff() then return new; end if;   -- staff, and the server itself
  select * into cfg from public.app_settings;
  if coalesce(cfg.booking_window_days, 0) = 0 then return new; end if;
  last_day := (now() at time zone cfg.timezone)::date + cfg.booking_window_days;
  if new.travel_date > last_day then
    raise exception 'TOO_EARLY: Booking opens % days before travel. This bus opens for booking on %.',
      cfg.booking_window_days, trim(to_char(new.travel_date - cfg.booking_window_days, 'Dy DD Mon'));
  end if;
  return new;
end $$;
drop trigger if exists bookings_booking_window on public.bookings;
create trigger bookings_booking_window before insert or update of travel_date on public.bookings
  for each row execute function public.enforce_booking_window();


-- =============================================================================
-- ▼ 20261027000000_trip_sheet.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 27: the conductor's trip sheet
-- When a conductor closes a trip they also enter what they wrote on the paper
-- sheet: fuel put in, tolls, parking and other costs paid on the road. Costs
-- paid out of the cash they collected come off the cash they should hand in,
-- so an honest trip closes "balanced" and not "short".
-- Safe to run again.
-- =============================================================================

-- Paid out of the cash collected on the trip (or, for the office, out of the till).
alter table public.expenses add column if not exists from_takings boolean not null default false;
create index if not exists expenses_trip_idx on public.expenses (schedule_id, travel_date) where schedule_id is not null;

-- Staff on the road could log fuel, tolls, parking and cleaning. On a trip
-- sheet they may also log an "other" cost (a puncture, a bulb, tea for a
-- breakdown crew) against that trip.
drop policy if exists "staff log running costs" on public.expenses;
create policy "staff log running costs" on public.expenses for insert
  with check (public.is_staff() and created_by = auth.uid()
    and (category in ('fuel', 'toll', 'parking', 'cleaning') or (category = 'other' and schedule_id is not null)));
drop policy if exists "staff see running costs" on public.expenses;
create policy "staff see running costs" on public.expenses for select
  using (public.is_staff() and (category in ('fuel', 'toll', 'parking', 'cleaning') or (category = 'other' and schedule_id is not null and created_by = auth.uid())));

-- A cost paid from the takings is cash by definition, and it can't be added
-- to a trip (or day) that person has already closed: the count they signed
-- off would no longer add up. The office can still add it for them.
create or replace function public.check_trip_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.from_takings then return new; end if;
  new.payment_method := 'cash';
  if public.is_admin() then return new; end if;
  if exists (
    select 1 from public.cash_counts c
    where c.created_by = coalesce(new.created_by, auth.uid())
      and case when new.schedule_id is not null then c.schedule_id = new.schedule_id and c.count_date = new.travel_date
               else c.schedule_id is null and c.count_date = new.spent_on end
  ) then
    raise exception 'CLOSED: That trip is already closed. Ask the office to add this cost.';
  end if;
  return new;
end $$;
drop trigger if exists expenses_trip_check on public.expenses;
create trigger expenses_trip_check before insert on public.expenses
  for each row execute function public.check_trip_expense();

-- Cash one person should be holding: cash they took, less cash refunds they
-- paid, and now less the costs they paid out of that cash.
create or replace function public.cash_expected(p_user uuid, p_date date, p_schedule text default null) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date
               else (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p left join public.bookings bk on bk.id = p.booking_id
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(e.amount) from public.expenses e
    where e.created_by = p_user and e.from_takings
      and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date
               else e.schedule_id is null and e.spent_on = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

-- The same summary as before, with the costs paid from the cash listed.
create or replace function public.cash_summary(p_date date, p_schedule text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(auth.uid(), p_date, p_schedule),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = auth.uid() and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date else (b.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = auth.uid() and p.method = 'cash' and p.status = 'paid'
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'paid_out', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
                 'detail', trim(both ' ' from coalesce(nullif(e.vendor, ''), '') || ' ' || coalesce(e.description, ''))) order by e.created_at)
               from public.expenses e
               where e.created_by = auth.uid() and e.from_takings
                 and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date else e.schedule_id is null and e.spent_on = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text) from public, anon;
grant execute on function public.cash_summary(date, text) to authenticated;

-- Everything logged against one trip (by anyone), for the trip sheet on the
-- closing screen: what is already saved is shown, not typed again.
create or replace function public.trip_sheet(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
           'vendor', e.vendor, 'description', e.description, 'from_takings', e.from_takings, 'mine', e.created_by = auth.uid(),
           'by', coalesce((select nullif(full_name, '') from public.profiles where id = e.created_by), '')) order by e.created_at)
         from public.expenses e where e.schedule_id = p_schedule and e.travel_date = p_date), '[]'::jsonb);
end $$;
revoke execute on function public.trip_sheet(text, date) from public, anon;
grant execute on function public.trip_sheet(text, date) to authenticated;


-- =============================================================================
-- ▼ 20261028000000_office_closes_trips.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 28: the booking centre closes the trip
-- The conductor fills in the paper trip sheet and hands it in with the cash.
-- Office staff type it into "Close a trip" for that conductor: odometer, fuel,
-- costs and the cash handed over. The conductor's phone only shows how much
-- cash they should be holding.
-- Safe to run again.
-- =============================================================================

-- Who typed it in, when that is not the person whose cash it is.
-- (Plain ids on purpose: a second link to profiles would make the app's
-- "who closed it" lookup ambiguous.)
alter table public.cash_counts add column if not exists entered_by uuid;
-- Whose trip cash a cost came out of (the conductor), when the office typed it.
alter table public.expenses add column if not exists takings_of uuid;

-- ------------------------------------------------------- closing for someone ---
-- Office staff may close a trip (or day) for another staff member. Everyone
-- else still closes only their own.
create or replace function public.check_cash_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance
  if new.created_by is not null and new.created_by <> auth.uid() and public.is_office_staff() then
    if not exists (select 1 from public.profiles where id = new.created_by and role::text in ('conductor', 'staff', 'admin')) then
      raise exception 'NOT_FOUND: Choose the staff member whose cash this is.';
    end if;
    new.entered_by := auth.uid();
  else
    new.created_by := auth.uid();
    new.entered_by := null;
  end if;
  if new.schedule_id is null and new.count_date > (now() at time zone (select timezone from public.app_settings))::date then
    raise exception 'TOO_EARLY: That day hasn''t happened yet.';
  end if;
  new.expected := public.cash_expected(new.created_by, new.count_date, new.schedule_id);
  if new.counted < 0 then raise exception 'BAD_AMOUNT: Enter the cash that was counted.'; end if;
  if new.counted <> new.expected and length(trim(coalesce(new.notes, ''))) < 3 then
    raise exception 'NOTE_NEEDED: The cash is % by LKR %. Add a note saying what happened.',
      case when new.counted < new.expected then 'short' else 'over' end, abs(new.counted - new.expected);
  end if;
  return new;
end $$;

drop policy if exists "staff count cash" on public.cash_counts;
create policy "staff count cash" on public.cash_counts for insert
  with check (public.is_staff() and (created_by = auth.uid() or public.is_office_staff()));
drop policy if exists "see cash counts" on public.cash_counts;
create policy "see cash counts" on public.cash_counts for select
  using (created_by = auth.uid() or entered_by = auth.uid() or public.is_admin());

-- ------------------------------------------- costs out of someone's trip cash ---
create or replace function public.check_trip_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.from_takings then
    new.takings_of := null;
    return new;
  end if;
  new.payment_method := 'cash';
  -- Only the office can say it came out of someone else's cash.
  if new.takings_of is null or not public.is_office_staff() then new.takings_of := coalesce(auth.uid(), new.created_by); end if;
  if public.is_admin() then return new; end if;
  if exists (
    select 1 from public.cash_counts c
    where c.created_by = new.takings_of
      and case when new.schedule_id is not null then c.schedule_id = new.schedule_id and c.count_date = new.travel_date
               else c.schedule_id is null and c.count_date = new.spent_on end
  ) then
    raise exception 'CLOSED: That trip is already closed. Ask a super admin to add this cost.';
  end if;
  return new;
end $$;
update public.expenses set takings_of = created_by where from_takings and takings_of is null;

-- Office staff log any road cost against a trip, not only their own.
drop policy if exists "staff see running costs" on public.expenses;
create policy "staff see running costs" on public.expenses for select
  using (public.is_staff() and (category in ('fuel', 'toll', 'parking', 'cleaning')
    or (category = 'other' and schedule_id is not null and (created_by = auth.uid() or public.is_office_staff()))));

create or replace function public.cash_expected(p_user uuid, p_date date, p_schedule text default null) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date
               else (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p left join public.bookings bk on bk.id = p.booking_id
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(e.amount) from public.expenses e
    where coalesce(e.takings_of, e.created_by) = p_user and e.from_takings
      and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date
               else e.schedule_id is null and e.spent_on = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

-- The cash summary, for yourself or (office staff) for the person named.
drop function if exists public.cash_summary(date, text);
create or replace function public.cash_summary(p_date date, p_schedule text default null, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings); who uuid := coalesce(p_user, auth.uid());
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if who <> auth.uid() and not public.is_office_staff() then raise exception 'NOT_ALLOWED: You can only see your own cash.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(who, p_date, p_schedule),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = who and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date else (b.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = who and p.method = 'cash' and p.status = 'paid'
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'paid_out', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
                 'detail', trim(both ' ' from coalesce(nullif(e.vendor, ''), '') || ' ' || coalesce(e.description, ''))) order by e.created_at)
               from public.expenses e
               where coalesce(e.takings_of, e.created_by) = who and e.from_takings
                 and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date else e.schedule_id is null and e.spent_on = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text, uuid) from public, anon;
grant execute on function public.cash_summary(date, text, uuid) to authenticated;

-- Who the office can close a trip for: everyone who took cash on it, then the
-- conductors (a trip with no cash still has a sheet to enter), each with what
-- they should hand in and whether it is closed already.
create or replace function public.trip_cash_people(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), 'Staff member'), 'role', p.role::text, 'took_cash', x.took,
             'expected', public.cash_expected(p.id, p_date, p_schedule),
             'closed', exists (select 1 from public.cash_counts c where c.created_by = p.id and c.schedule_id = p_schedule and c.count_date = p_date))
           order by x.took desc, (p.role::text = 'conductor') desc, p.full_name)
    from (
      select pr.id, exists (select 1 from public.bookings b where b.paid_by = pr.id and b.schedule_id = p_schedule and b.travel_date = p_date
                              and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')) as took
      from public.profiles pr where pr.role::text in ('conductor', 'staff', 'admin')
    ) x join public.profiles p on p.id = x.id
    where x.took or p.role::text = 'conductor'), '[]'::jsonb);
end $$;
revoke execute on function public.trip_cash_people(text, date) from public, anon;
grant execute on function public.trip_cash_people(text, date) to authenticated;

-- The sheet for a trip, now saying whose cash each cost came out of.
create or replace function public.trip_sheet(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
           'vendor', e.vendor, 'description', e.description, 'from_takings', e.from_takings, 'mine', e.created_by = auth.uid(),
           'by', coalesce((select nullif(full_name, '') from public.profiles where id = e.created_by), '')) order by e.created_at)
         from public.expenses e where e.schedule_id = p_schedule and e.travel_date = p_date), '[]'::jsonb);
end $$;


-- =============================================================================
-- ▼ 20261029000000_trip_bell.sql
-- =============================================================================
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


-- =============================================================================
-- ▼ 20261030000000_trip_cash_on_bus_only.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 30: a trip's cash is only what was collected on the bus
-- "Cash you should have for this trip" counted every cash payment that person
-- had recorded for the trip, wherever it was taken. Someone who sold seats at
-- the counter and then opened the conductor page saw the counter money as
-- cash to carry on the bus (and it was already in their day's count).
-- Now a trip's cash is:
--   - fares collected for seats booked online (pay on the bus, or a held seat
--     paid to the conductor), by whoever collected them; and
--   - anything a conductor account records, since a conductor only works on the bus.
-- Seats sold for cash at a counter or by phone by office staff stay in the
-- office's day count and are not part of the trip's cash. Card and bank
-- payments were never counted.
-- Safe to run again.
-- =============================================================================
create or replace function public.is_trip_cash(p_channel text, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_channel = 'online' or exists (select 1 from public.profiles where id = p_user and role::text = 'conductor');
$$;
revoke execute on function public.is_trip_cash(text, uuid) from public, anon, authenticated;

create or replace function public.cash_expected(p_user uuid, p_date date, p_schedule text default null) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date and public.is_trip_cash(b.channel::text, p_user)
               else (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p left join public.bookings bk on bk.id = p.booking_id
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(e.amount) from public.expenses e
    where coalesce(e.takings_of, e.created_by) = p_user and e.from_takings
      and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date
               else e.schedule_id is null and e.spent_on = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

create or replace function public.cash_summary(p_date date, p_schedule text default null, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings); who uuid := coalesce(p_user, auth.uid());
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if who <> auth.uid() and not public.is_office_staff() then raise exception 'NOT_ALLOWED: You can only see your own cash.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(who, p_date, p_schedule),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = who and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date and public.is_trip_cash(b.channel::text, who) else (b.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = who and p.method = 'cash' and p.status = 'paid'
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'paid_out', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
                 'detail', trim(both ' ' from coalesce(nullif(e.vendor, ''), '') || ' ' || coalesce(e.description, ''))) order by e.created_at)
               from public.expenses e
               where coalesce(e.takings_of, e.created_by) = who and e.from_takings
                 and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date else e.schedule_id is null and e.spent_on = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text, uuid) from public, anon;
grant execute on function public.cash_summary(date, text, uuid) to authenticated;

create or replace function public.trip_cash_people(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), 'Staff member'), 'role', p.role::text, 'took_cash', x.took,
             'expected', public.cash_expected(p.id, p_date, p_schedule),
             'closed', exists (select 1 from public.cash_counts c where c.created_by = p.id and c.schedule_id = p_schedule and c.count_date = p_date))
           order by x.took desc, (p.role::text = 'conductor') desc, p.full_name)
    from (
      select pr.id, exists (select 1 from public.bookings b where b.paid_by = pr.id and b.schedule_id = p_schedule and b.travel_date = p_date and public.is_trip_cash(b.channel::text, pr.id)
                              and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')) as took
      from public.profiles pr where pr.role::text in ('conductor', 'staff', 'admin')
    ) x join public.profiles p on p.id = x.id
    where x.took or p.role::text = 'conductor'), '[]'::jsonb);
end $$;
revoke execute on function public.trip_cash_people(text, date) from public, anon;
grant execute on function public.trip_cash_people(text, date) to authenticated;


-- =============================================================================
-- ▼ 20261031000000_paid_on_bus.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 31: cash is "on the bus" because of where it was taken
-- Migration 30 guessed from how the seat was booked. That is wrong for a seat
-- booked online and then paid in cash at the office: it looked like a fare
-- collected on the bus. Now each payment records where it was taken:
--   - recorded on the conductor screen (Collect cash, or the ticket scanner
--     there), or by a conductor account            -> on the bus (the trip's cash)
--   - recorded anywhere in the office (Bookings, Departures) -> the office's
--     cash for that day
-- A trip's cash is only the first kind; a day's cash is only the second, so
-- nothing is counted twice even when one person does both jobs.
-- Safe to run again.
-- =============================================================================
alter table public.bookings add column if not exists paid_on_bus boolean not null default false;

-- Payments taken before this update: a conductor account's cash was taken on the bus.
update public.bookings b set paid_on_bus = true
where not b.paid_on_bus and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
  and exists (select 1 from public.profiles p where p.id = b.paid_by and p.role::text = 'conductor');

-- Who recorded the payment, their branch, and now where: on the bus when the
-- conductor screen says so (collect_on_bus below) or the account is a conductor's.
create or replace function public.stamp_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    if new.paid_at is null then new.paid_at := now(); end if;
    if auth.uid() is not null and public.is_staff() then
      new.paid_by := auth.uid();
      new.paid_branch_id := (select p.branch_id from public.profiles p where p.id = auth.uid());
      new.paid_on_bus := new.payment_method = 'cash' and (
        coalesce(current_setting('app.on_bus', true), '') = '1'
        or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'conductor'));
    end if;
  end if;
  return new;
end $$;

-- "Cash received" on the conductor screen: the usual payment, marked as taken on the bus.
create or replace function public.collect_on_bus(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  perform set_config('app.on_bus', '1', true);   -- for this transaction only
  bk := public.confirm_payment(p_id, 'cash', null);
  perform set_config('app.on_bus', '', true);
  return bk;
end $$;
revoke execute on function public.collect_on_bus(uuid) from public, anon;
grant execute on function public.collect_on_bus(uuid) to authenticated;

create or replace function public.cash_expected(p_user uuid, p_date date, p_schedule text default null) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date and b.paid_on_bus
               else (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date and not b.paid_on_bus end), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p left join public.bookings bk on bk.id = p.booking_id
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(e.amount) from public.expenses e
    where coalesce(e.takings_of, e.created_by) = p_user and e.from_takings
      and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date
               else e.schedule_id is null and e.spent_on = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

create or replace function public.cash_summary(p_date date, p_schedule text default null, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings); who uuid := coalesce(p_user, auth.uid());
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if who <> auth.uid() and not public.is_office_staff() then raise exception 'NOT_ALLOWED: You can only see your own cash.'; end if;
  return jsonb_build_object(
    'v', 31,  -- lets the app tell this version from older ones
    'expected', public.cash_expected(who, p_date, p_schedule),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.paid_on_bus then 'bus' when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = who and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date and b.paid_on_bus else (b.paid_at at time zone tz)::date = p_date and not b.paid_on_bus end), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = who and p.method = 'cash' and p.status = 'paid'
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'paid_out', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
                 'detail', trim(both ' ' from coalesce(nullif(e.vendor, ''), '') || ' ' || coalesce(e.description, ''))) order by e.created_at)
               from public.expenses e
               where coalesce(e.takings_of, e.created_by) = who and e.from_takings
                 and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date else e.schedule_id is null and e.spent_on = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text, uuid) from public, anon;
grant execute on function public.cash_summary(date, text, uuid) to authenticated;

create or replace function public.trip_cash_people(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), 'Staff member'), 'role', p.role::text, 'took_cash', x.took,
             'expected', public.cash_expected(p.id, p_date, p_schedule),
             'closed', exists (select 1 from public.cash_counts c where c.created_by = p.id and c.schedule_id = p_schedule and c.count_date = p_date))
           order by x.took desc, (p.role::text = 'conductor') desc, p.full_name)
    from (
      select pr.id, exists (select 1 from public.bookings b where b.paid_by = pr.id and b.schedule_id = p_schedule and b.travel_date = p_date and b.paid_on_bus
                              and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')) as took
      from public.profiles pr where pr.role::text in ('conductor', 'staff', 'admin')
    ) x join public.profiles p on p.id = x.id
    where x.took or p.role::text = 'conductor'), '[]'::jsonb);
end $$;
revoke execute on function public.trip_cash_people(text, date) from public, anon;
grant execute on function public.trip_cash_people(text, date) to authenticated;


-- =============================================================================
-- ▼ 20261032000000_trip_updates_push_only.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 32: conductor updates are push notifications only
-- "Update passengers" (left, running late, arriving, arrived, a note) no longer
-- sends a text or WhatsApp message to every passenger: on a full bus that was
-- about 45 texts each time. It now goes as a push notification to passengers
-- who have an account and that trip's bell on, and it still shows on the
-- tracking page for everyone. The booking text, payment texts and "send bus
-- location to this passenger" are not changed.
-- Safe to run again.
-- =============================================================================
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


-- Tell the API about the new functions and columns straight away (otherwise the app can take a while to see them).
notify pgrst, 'reload schema';
