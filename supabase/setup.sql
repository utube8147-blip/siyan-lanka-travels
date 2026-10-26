-- =============================================================================
-- Siyan Lanka Travels — COMPLETE DATABASE SETUP (all migrations + starting data)
--
-- Paste this whole file into Supabase → SQL Editor → Run.
-- It is SAFE TO RUN AGAIN: anything that already exists is skipped or updated,
-- anything missing is created. Use it for a new project or to bring an
-- existing (partly set-up) project up to date.
--
-- Includes, in order:
--   1. Core: profiles, settings, buses, routes, schedules, bookings, seats,
--      bikes, booking functions, security rules, bike-photo storage
--   2. Super admin role, expenses / income / documents / crew, seat resale
--   3. Payment holds, rewards, waitlist, notifications, message queue,
--      saved passengers, live trips, parcels & charters, cash counts
--   4. Conductor role
--   5. Rewards switch, refund & resale payouts, resale payment orders,
--      bank-transfer slips, push subscriptions & reminders, bus trail
--   6. A one-time code for every online booking
--   7. How passengers pay: card locked, bank slip, counter, pay on the bus
--   8. Send the bus location to one passenger (WhatsApp, else SMS)
--   9. Seat overrides: reserved seats (owner's code) and ladies-only override
--  10. Alternate-day timetable (a departure every N days)
--  11. Bike categories set by the admin
--  12. One price per route (same fare wherever the passenger gets off)
--  13. Flexible seat layouts (any arrangement, any seat numbers)
--  14. Every booking confirmed with a code texted to a mobile number
--  15. Closing the day: expected cash per person, note required, admins told
--  16. Closing a trip (conductor) or any day (office)
--  17. Cash overview by bus and trip (admin); reminders for unfinished closes
--  18. Reminders to renew bus documents and crew licences
--  19. Salary settlement: advances, bonuses, deductions, pay per trip
--  20. The seat beside a woman travelling alone is kept for women
--  21. Seats held during checkout are real holds, visible to staff
--  22. Live updates for staff screens
--  23. Daily odometer readings (the distance each bus really travels)
--  24. One full booking text, the ticket by email, reminders 1 day / 3 hours /
--      1 hour before and when the trip starts
--  25. Branches: more than one booking place, sales and cash by branch
--  26. Passengers book at most N days ahead (7 by default)
--  27. The conductor's trip sheet: fuel and road costs entered when closing a trip
--  28. The booking centre closes each trip from the conductor's paper sheet
--  29. Reminders on or off for each trip (the bell in My trips)
--  30. A trip's cash is only what was collected on the bus
--  31. Each cash payment records where it was taken: on the bus or in the office
--  32. Conductor updates go as push notifications only (no texts)
--  33. Starting data: settings, bus ND-2323, Route 48 both ways, timetable
--  34. Full GPS log for every trip; route plans
--  35. Route share links
--  36. Security fixes: booking changes can't add unpaid seats, staff can only
--      change a booking's status directly, card needs PayHere, real seat
--      holds only, passenger email kept on the profile (phone sign-in)
--  37. Conductor tools: road reports (traffic police, checkpoints, accidents…),
--      route drafts readable by conductors, on-request stops settled before
--      departure, hidden points that only shape the road
--  38. Bus photos (cover + gallery, public)
--  39. Deleting a departure/route with old tickets archives it (hidden, closed)
--  40. Route names chosen by staff
--  41. Route timing settings (bus vs car time, stop time) kept with each route
--  42. Route variants for when on-request stops don't fill
--  43. Tickets keep the stop booked; cut-off moves to the stop before/after the
--      turn-off; "your stop is going" alerts
--  44. Refunds: 90% until 4 hours before, none after; test passengers marked
--  45. The conductor changes a passenger's stops (after asking them), logged
--  46. Fare + card fee + platform fee; online = gateway or bank slip only;
--      first-trip app promo; monthly money breakdown
--  47. Bank details for transfers (BOC A/C 95572680, Siyan Lanka)
--  48. Who sits in each seat (gender per seat; needed only beside a stranger)
--
-- This one file is everything: every migration in supabase/migrations/ plus
-- the starting data. (Checked: a database built from this file has exactly the
-- same tables, functions, rules and starting data as one built from the
-- migrations one by one.)
-- =============================================================================


-- =============================================================================
-- ▼ 20261001000000_init.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — database schema for Supabase (Postgres 15+)
--
-- Design:
-- * Anyone can read the timetable (buses, routes, schedules, settings) and
--   which seats are taken — never who took them.
-- * Passengers can read only their own bookings. They create, change and
--   cancel bookings ONLY through the functions below, which work out prices
--   on the server, so a tampered browser can't change what it pays.
-- * Staff (profiles.role = 'staff') manage the timetable and all bookings.
-- * Double-booking is impossible: a unique index on live seats per departure.
-- =============================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ types ---
do $$ begin create type public.user_role as enum ('passenger', 'staff'); exception when duplicate_object then null; end $$;
do $$ begin create type public.bus_type as enum ('AC', 'Non-AC'); exception when duplicate_object then null; end $$;
do $$ begin create type public.bus_status as enum ('active', 'maintenance', 'retired'); exception when duplicate_object then null; end $$;
do $$ begin create type public.booking_status as enum ('confirmed', 'boarded', 'cancelled', 'no-show'); exception when duplicate_object then null; end $$;
do $$ begin create type public.booking_channel as enum ('online', 'counter', 'phone'); exception when duplicate_object then null; end $$;
do $$ begin create type public.bike_kind as enum ('bicycle', 'scooter', 'motorbike'); exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- profiles ---
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'passenger',
  created_at timestamptz not null default now()
);

-- New sign-ups get a profile automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff');
$$;

-- --------------------------------------------------------------- settings ---
-- One row. Mirrors config/operator.ts so prices are decided server-side.
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  booking_fee integer not null default 50,
  promo_code text,
  promo_percent integer not null default 0 check (promo_percent between 0 and 100),
  max_seats_per_booking integer not null default 6,
  booking_cutoff_minutes integer not null default 30,
  refund_policy jsonb not null default '[{"hoursBefore":24,"percent":90},{"hoursBefore":6,"percent":50},{"hoursBefore":0,"percent":0}]',
  bikes jsonb not null default '{"minFee":300,"maxPerBooking":2,"kinds":{"bicycle":{"spaces":1,"fullRouteFee":600},"scooter":{"spaces":2,"fullRouteFee":1200},"motorbike":{"spaces":2,"fullRouteFee":1500}}}',
  timezone text not null default 'Asia/Colombo'
);

-- ------------------------------------------------------------- timetable ---
create table if not exists public.buses (
  id text primary key default ('bus-' || substr(md5(gen_random_uuid()::text), 1, 8)),
  name text not null,
  reg_no text not null unique,
  type public.bus_type not null default 'AC',
  rows integer not null check (rows between 1 and 16),
  back_row_seats integer not null default 5 check (back_row_seats in (0, 4, 5, 6)),
  ladies_seats text[] not null default '{}',
  amenities text[] not null default '{}',
  status public.bus_status not null default 'active',
  bike_spaces integer not null default 0 check (bike_spaces between 0 and 20),
  created_at timestamptz not null default now()
);

-- stops: [{"name":"Colombo","offsetMin":0,"fareFromStart":0}, ...] in travel order
create table if not exists public.routes (
  id text primary key default ('route-' || substr(md5(gen_random_uuid()::text), 1, 8)),
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) >= 2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.schedules (
  id text primary key default ('sch-' || substr(md5(gen_random_uuid()::text), 1, 8)),
  route_id text not null references public.routes (id) on delete restrict,
  bus_id text not null references public.buses (id) on delete restrict,
  departure text not null check (departure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days smallint[] not null check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(days) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- bookings ---
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  schedule_id text not null references public.schedules (id) on delete restrict,
  travel_date date not null,               -- date the bus leaves its FIRST stop
  from_stop text not null,
  to_stop text not null,
  seats text[] not null check (cardinality(seats) between 1 and 20),
  passenger_name text not null,
  passenger_gender text not null default '' check (passenger_gender in ('Male', 'Female', '')),
  passenger_phone text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  user_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  channel public.booking_channel not null default 'online',
  fare integer not null,                   -- per seat
  fee integer not null default 0,
  discount integer not null default 0,
  bike_fee integer not null default 0,
  total integer not null,
  status public.booking_status not null default 'confirmed',
  refund_amount integer,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bookings_user_idx on public.bookings (user_id, travel_date);
create index if not exists bookings_departure_idx on public.bookings (schedule_id, travel_date);

-- One row per seat of a live booking. The partial unique index is what makes
-- double-booking impossible, even with two payments at the same instant.
create table if not exists public.booking_seats (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  schedule_id text not null,
  travel_date date not null,
  seat text not null,
  gender text not null default '',
  active boolean not null default true,
  primary key (booking_id, seat)
);
create unique index if not exists booking_seats_one_per_departure on public.booking_seats (schedule_id, travel_date, seat) where active;

create table if not exists public.booking_bikes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind public.bike_kind not null,
  description text not null,
  reg_no text not null default '',
  photo_path text,                          -- in storage bucket "bike-photos"
  fee integer not null
);
create index if not exists booking_bikes_booking_idx on public.booking_bikes (booking_id);

-- Keep booking_seats in step with bookings (status, seats, date).
create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status in ('confirmed', 'boarded') then
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender)
    select new.id, new.schedule_id, new.travel_date, s, new.passenger_gender from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;

drop trigger if exists bookings_sync_seats on public.bookings;
create trigger bookings_sync_seats after insert or update of status, seats, travel_date, schedule_id, passenger_gender
  on public.bookings for each row execute function public.sync_booking_seats();

-- ---------------------------------------------------------------- helpers ---
create or replace function public.seat_is_on_bus(p_bus public.buses, p_seat text) returns boolean
language plpgsql immutable as $$
declare r int; c text; m text[];
begin
  m := regexp_match(p_seat, '^([0-9]+)([A-F])$');
  if m is null then return false; end if;
  r := m[1]::int; c := m[2];
  if r between 1 and p_bus.rows then return c in ('A', 'B', 'C', 'D'); end if;
  if r = p_bus.rows + 1 then return position(c in 'ABCDEF') between 1 and p_bus.back_row_seats; end if;
  return false;
end $$;

create or replace function public.stop_index(p_stops jsonb, p_name text) returns int
language sql immutable as $$
  select (ord - 1)::int from jsonb_array_elements(p_stops) with ordinality as e(stop, ord)
  where lower(trim(stop ->> 'name')) = lower(trim(p_name)) limit 1;
$$;

-- Bike spaces already booked on a departure (anyone can read this).
create or replace function public.bike_spaces_used(p_schedule text, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int), 0)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.schedule_id = p_schedule and b.travel_date = p_date and b.status in ('confirmed', 'boarded');
$$;

create or replace function public.get_bike_usage(p_from date, p_to date)
returns table (schedule_id text, travel_date date, spaces int)
language sql stable security definer set search_path = public as $$
  select b.schedule_id, b.travel_date,
         sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.travel_date between p_from and p_to and b.status in ('confirmed', 'boarded')
  group by 1, 2;
$$;

create or replace function public.new_booking_ref() returns text
language plpgsql volatile as $$
declare chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; out text;
begin
  loop
    out := 'SLT-';
    for i in 1..6 loop out := out || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from public.bookings where ref = out);
  end loop;
  return out;
end $$;

-- ----------------------------------------------------------- create_booking ---
-- p = {
--   schedule_id, date ("YYYY-MM-DD", the run date), from, to, seats: [..],
--   passenger: {name, gender, phone}, contact: {email, phone},
--   promo?, channel? ("online" | "counter" | "phone"; the last two staff-only),
--   bikes?: [{kind, description, reg_no, photo_path}]
-- }
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  bk public.bookings;
begin
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;

  -- Prices are always worked out here, never taken from the browser.
  v_fare := (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  -- Bikes: serialize per departure so two bookings can't overfill the compartment.
  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') then raise exception 'BAD_BIKE: Unknown kind of bike.'; end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if bike ->> 'kind' <> 'bicycle' and length(coalesce(bike ->> 'reg_no', '')) < 4 then raise exception 'BAD_BIKE: Add the number plate.'; end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, (b ->> 'kind')::public.bike_kind, left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

-- ----------------------------------------------------------- cancel_booking ---
-- Passengers: refund by the policy tiers. Staff: full fare back (fee kept).
create or replace function public.cancel_booking(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes;
  leaves timestamptz; hrs numeric; pct int := 0; tier jsonb; staff boolean := public.is_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not staff) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status <> 'confirmed' then raise exception 'NOT_ALLOWED: Only confirmed bookings can be cancelled.'; end if;
  if staff and bk.user_id is distinct from auth.uid() then
    pct := 100;
  else
    select * into sch from public.schedules where id = bk.schedule_id;
    select * into rt from public.routes where id = sch.route_id;
    leaves := ((bk.travel_date + sch.departure::time)
      + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
    hrs := extract(epoch from (leaves - now())) / 3600;
    for tier in select * from jsonb_array_elements(cfg.refund_policy) loop
      if hrs >= (tier ->> 'hoursBefore')::numeric then pct := (tier ->> 'percent')::int; exit; end if;
    end loop;
  end if;
  update public.bookings set status = 'cancelled', refund_amount = round((total - fee) * pct / 100.0), refunded_at = now()
  where id = p_id returning * into bk;
  return bk;
end $$;

-- ----------------------------------------------------------- modify_booking ---
-- Change seats and/or move to another date on the same departure.
create or replace function public.modify_booking(p_id uuid, p_seats text[] default null, p_date date default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; bus public.buses;
  v_seats text[]; v_d date; s text; leaves timestamptz; used int; mine int;
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not public.is_staff()) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status <> 'confirmed' then raise exception 'NOT_ALLOWED: This booking can no longer be changed.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  v_seats := coalesce((select array_agg(distinct upper(x)) from unnest(p_seats) x), bk.seats);
  v_d := coalesce(p_date, bk.travel_date);
  if not (extract(dow from v_d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;
  leaves := ((v_d + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then raise exception 'CLOSED: Too close to departure to change this booking.'; end if;
  if cardinality(v_seats) > cfg.max_seats_per_booking then raise exception 'TOO_MANY: Up to % seats per booking.', cfg.max_seats_per_booking; end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and bk.passenger_gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;
  if v_d <> bk.travel_date then
    select count(*) into mine from public.booking_bikes where booking_id = bk.id;
    if mine > 0 then
      perform pg_advisory_xact_lock(hashtext(sch.id || v_d::text));
      used := public.bike_spaces_used(sch.id, v_d);
      if used + (select coalesce(sum((cfg.bikes -> 'kinds' -> kind::text ->> 'spaces')::int), 0) from public.booking_bikes where booking_id = bk.id) > bus.bike_spaces then
        raise exception 'BIKES_FULL: No room for your bike on that date.';
      end if;
    end if;
  end if;
  update public.bookings
     set seats = v_seats, travel_date = v_d,
         total = bk.fare * cardinality(v_seats) - bk.discount + bk.bike_fee + bk.fee
   where id = p_id returning * into bk;
  return bk;
end $$;

-- ------------------------------------------------------------------- RLS ---
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.buses enable row level security;
alter table public.routes enable row level security;
alter table public.schedules enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_seats enable row level security;
alter table public.booking_bikes enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid() or public.is_staff());
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "staff edit profiles" on public.profiles;
create policy "staff edit profiles" on public.profiles for update using (public.is_staff());
-- Passengers may change their name/phone but never their role.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

drop policy if exists "read settings" on public.app_settings;
create policy "read settings" on public.app_settings for select using (true);
drop policy if exists "staff settings" on public.app_settings;
create policy "staff settings" on public.app_settings for update using (public.is_staff());

drop policy if exists "read buses" on public.buses;
create policy "read buses" on public.buses for select using (true);
drop policy if exists "staff buses" on public.buses;
create policy "staff buses" on public.buses for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "read routes" on public.routes;
create policy "read routes" on public.routes for select using (true);
drop policy if exists "staff routes" on public.routes;
create policy "staff routes" on public.routes for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "read schedules" on public.schedules;
create policy "read schedules" on public.schedules for select using (true);
drop policy if exists "staff schedules" on public.schedules;
create policy "staff schedules" on public.schedules for all using (public.is_staff()) with check (public.is_staff());

-- Bookings: read own; staff read/update all. No direct inserts: use create_booking().
drop policy if exists "read own bookings" on public.bookings;
create policy "read own bookings" on public.bookings for select using (user_id = auth.uid() or public.is_staff());
drop policy if exists "staff update bookings" on public.bookings;
create policy "staff update bookings" on public.bookings for update using (public.is_staff()) with check (public.is_staff());
revoke insert, delete on public.bookings from anon, authenticated;

-- Seat map: everyone sees which seats are taken, but not whose booking.
drop policy if exists "read live seats" on public.booking_seats;
create policy "read live seats" on public.booking_seats for select using (active);
revoke all on public.booking_seats from anon, authenticated;
grant select (schedule_id, travel_date, seat, gender, active) on public.booking_seats to anon, authenticated;

drop policy if exists "read own bikes" on public.booking_bikes;
create policy "read own bikes" on public.booking_bikes for select using (
  public.is_staff() or exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = auth.uid()));
revoke insert, update, delete on public.booking_bikes from anon, authenticated;

-- Functions callable from the app.
revoke execute on function public.create_booking(jsonb), public.cancel_booking(uuid), public.modify_booking(uuid, text[], date) from public, anon;
grant execute on function public.create_booking(jsonb), public.cancel_booking(uuid), public.modify_booking(uuid, text[], date) to authenticated;
grant execute on function public.get_bike_usage(date, date), public.bike_spaces_used(text, date), public.is_staff() to anon, authenticated;

-- Live seat map updates.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'booking_seats') then
    alter publication supabase_realtime add table public.booking_seats;
  end if;
end $$;

-- ---------------------------------------------------------------- storage ---
insert into storage.buckets (id, name, public) values ('bike-photos', 'bike-photos', false) on conflict (id) do nothing;

-- Passengers upload into a folder named after their user id; staff see all.
drop policy if exists "upload own bike photos" on storage.objects;
create policy "upload own bike photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'bike-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "read own bike photos" on storage.objects;
create policy "read own bike photos" on storage.objects for select to authenticated
  using (bucket_id = 'bike-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));


-- =============================================================================
-- ▼ 20261002000000_admin_erp_resale.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 2
--  * Super admin role ('admin'): everything staff can do, plus business pages
--    (finance, expenses, crew, documents, user accounts, settings).
--  * ERP tables: expenses (fuel, service, repairs, salaries, …), other income,
--    bus documents (insurance, permits…), crew.
--  * Passenger seat resale on real data, switched off until an admin enables it.
-- Note: role checks compare role::text so this file can add the new enum value
-- and use it in the same run.
-- =============================================================================

alter type public.user_role add value if not exists 'admin';

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Settings are now edited by super admins only; add the resale switch.
drop policy if exists "staff settings" on public.app_settings;
drop policy if exists "admin settings" on public.app_settings;
create policy "admin settings" on public.app_settings for update using (public.is_admin()) with check (public.is_admin());
alter table public.app_settings add column if not exists resale_enabled boolean not null default false;

-- ------------------------------------------------------------- accounts ---
-- Super admins manage who is passenger / staff / admin.
-- (Dropped first: migration 25 gives this a longer return type, and a re-run must be able to pass here.)
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role::text, p.created_at, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.role::text desc, p.created_at desc;
end $$;

create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_role not in ('passenger', 'staff', 'admin') then raise exception 'BAD_ROLE: Unknown role.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'NOT_ALLOWED: You can''t remove your own super admin access.'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user;
end $$;

revoke execute on function public.admin_list_users(), public.set_user_role(uuid, text) from public, anon;
grant execute on function public.admin_list_users(), public.set_user_role(uuid, text) to authenticated;

-- ------------------------------------------------------------------ ERP ---
do $$ begin create type public.expense_category as enum (
  'fuel', 'service', 'repair', 'tyres', 'salary', 'toll', 'parking', 'cleaning',
  'insurance', 'license', 'permit', 'commission', 'office', 'other'
); exception when duplicate_object then null; end $$;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  category public.expense_category not null,
  amount integer not null check (amount >= 0),
  bus_id text references public.buses (id) on delete set null,
  schedule_id text references public.schedules (id) on delete set null,
  travel_date date,
  description text not null default '',
  vendor text not null default '',
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'bank', 'cheque', 'other')),
  litres numeric(8, 2) check (litres is null or litres > 0),        -- fuel
  odometer_km integer check (odometer_km is null or odometer_km >= 0), -- fuel / service
  next_due_date date,                                                  -- service
  next_due_km integer,                                                 -- service
  receipt_path text,                                                   -- storage bucket "receipts"
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (spent_on);
create index if not exists expenses_bus_idx on public.expenses (bus_id, spent_on);

create table if not exists public.other_income (
  id uuid primary key default gen_random_uuid(),
  received_on date not null default current_date,
  category text not null check (category in ('charter', 'parcel', 'advertising', 'other')),
  amount integer not null check (amount >= 0),
  bus_id text references public.buses (id) on delete set null,
  description text not null default '',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.bus_documents (
  id uuid primary key default gen_random_uuid(),
  bus_id text not null references public.buses (id) on delete cascade,
  kind text not null check (kind in ('insurance', 'revenue_license', 'route_permit', 'emission_test', 'fitness_certificate', 'other')),
  number text not null default '',
  expires_on date not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.crew (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null check (role in ('driver', 'conductor', 'cleaner', 'mechanic', 'office')),
  phone text not null default '',
  license_no text not null default '',
  license_expires date,
  monthly_salary integer not null default 0 check (monthly_salary >= 0),
  bus_id text references public.buses (id) on delete set null,
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;
alter table public.other_income enable row level security;
alter table public.bus_documents enable row level security;
alter table public.crew enable row level security;

-- Super admins: everything.
drop policy if exists "admin expenses" on public.expenses;
create policy "admin expenses" on public.expenses for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin income" on public.other_income;
create policy "admin income" on public.other_income for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin documents" on public.bus_documents;
create policy "admin documents" on public.bus_documents for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin crew" on public.crew;
create policy "admin crew" on public.crew for all using (public.is_admin()) with check (public.is_admin());
-- Staff on the road: log (and see) running costs only.
drop policy if exists "staff log running costs" on public.expenses;
create policy "staff log running costs" on public.expenses for insert
  with check (public.is_staff() and category in ('fuel', 'toll', 'parking', 'cleaning') and created_by = auth.uid());
drop policy if exists "staff see running costs" on public.expenses;
create policy "staff see running costs" on public.expenses for select
  using (public.is_staff() and category in ('fuel', 'toll', 'parking', 'cleaning'));
-- Staff can see bus paperwork (crew and salaries are super-admin only).
drop policy if exists "staff see documents" on public.bus_documents;
create policy "staff see documents" on public.bus_documents for select using (public.is_staff());

-- Receipts (photos of bills).
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
drop policy if exists "staff upload receipts" on storage.objects;
create policy "staff upload receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "read receipts" on storage.objects;
create policy "read receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- --------------------------------------------------------------- resale ---
create table if not exists public.resale_listings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null check (price > 0),
  status text not null default 'listed' check (status in ('listed', 'sold', 'withdrawn')),
  buyer_id uuid references public.profiles (id) on delete set null,
  new_booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at timestamptz
);
create unique index if not exists resale_one_open_listing on public.resale_listings (booking_id) where status = 'listed';
alter table public.resale_listings enable row level security;
drop policy if exists "own or staff listings" on public.resale_listings;
create policy "own or staff listings" on public.resale_listings for select
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.is_staff());
revoke insert, update, delete on public.resale_listings from anon, authenticated;

-- Public marketplace: open listings for future departures, no personal data.
create or replace function public.get_resale_listings()
returns table (id uuid, price integer, paid integer, schedule_id text, travel_date date, from_stop text, to_stop text, seats text[], listed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.price, (b.total - b.fee), b.schedule_id, b.travel_date, b.from_stop, b.to_stop, b.seats, l.created_at
  from public.resale_listings l join public.bookings b on b.id = l.booking_id
  where l.status = 'listed' and b.status = 'confirmed' and b.travel_date >= current_date
    and (select resale_enabled from public.app_settings)
  order by b.travel_date, l.created_at;
$$;
grant execute on function public.get_resale_listings() to anon, authenticated;

create or replace function public.list_for_resale(p_booking uuid, p_price integer) returns public.resale_listings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; leaves timestamptz; l public.resale_listings;
begin
  select * into cfg from public.app_settings;
  if not cfg.resale_enabled then raise exception 'RESALE_OFF: Seat resale isn''t available yet.'; end if;
  select * into bk from public.bookings where id = p_booking for update;
  if not found or bk.user_id is distinct from auth.uid() then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status <> 'confirmed' then raise exception 'NOT_ALLOWED: Only confirmed bookings can be resold.'; end if;
  if bk.channel <> 'online' then raise exception 'NOT_ALLOWED: Counter tickets can''t be resold online.'; end if;
  if exists (select 1 from public.booking_bikes where booking_id = bk.id) then raise exception 'NOT_ALLOWED: Bookings with a bike can''t be resold. Cancel the bike first.'; end if;
  if p_price > bk.total - bk.fee then raise exception 'TOO_HIGH: You can''t sell for more than you paid (LKR %).', bk.total - bk.fee; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  leaves := ((bk.travel_date + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves - make_interval(hours => 2) then raise exception 'CLOSED: Too close to departure to resell.'; end if;
  insert into public.resale_listings (booking_id, seller_id, price) values (bk.id, auth.uid(), p_price) returning * into l;
  return l;
exception when unique_violation then
  raise exception 'ALREADY_LISTED: This booking is already listed.';
end $$;

create or replace function public.withdraw_listing(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.resale_listings set status = 'withdrawn'
  where id = p_listing and status = 'listed' and (seller_id = auth.uid() or public.is_staff());
  if not found then raise exception 'NOT_FOUND: Listing not found.'; end if;
end $$;

-- Buying hands the seats over in one transaction: the seller's booking is
-- closed (they're paid the listing price) and the buyer gets a new booking
-- for the same seats; nobody else can grab them in between.
create or replace function public.buy_resale(p_listing uuid, p_passenger jsonb, p_contact jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; old public.bookings; nb public.bookings; bus public.buses; s text;
  gender text := coalesce(p_passenger ->> 'gender', ''); per_seat int;
begin
  select * into cfg from public.app_settings;
  if not cfg.resale_enabled then raise exception 'RESALE_OFF: Seat resale isn''t available yet.'; end if;
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in to buy.'; end if;
  select * into l from public.resale_listings where id = p_listing for update;
  if not found or l.status <> 'listed' then raise exception 'GONE: This ticket has just been sold.'; end if;
  if l.seller_id = auth.uid() then raise exception 'NOT_ALLOWED: That''s your own listing.'; end if;
  select * into old from public.bookings where id = l.booking_id for update;
  if old.status <> 'confirmed' then raise exception 'GONE: This ticket is no longer available.'; end if;
  select b.* into bus from public.buses b join public.schedules sc on sc.bus_id = b.id where sc.id = old.schedule_id;
  foreach s in array old.seats loop
    if s = any (bus.ladies_seats) and gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;
  update public.bookings set status = 'cancelled', refund_amount = l.price, refunded_at = now() where id = old.id;
  per_seat := ceil(l.price::numeric / cardinality(old.seats));
  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_gender,
    passenger_phone, contact_email, contact_phone, user_id, created_by, channel, fare, fee, discount, bike_fee, total)
  values (public.new_booking_ref(), old.schedule_id, old.travel_date, old.from_stop, old.to_stop, old.seats,
    left(coalesce(nullif(trim(p_passenger ->> 'name'), ''), 'Passenger'), 120), gender, left(coalesce(p_passenger ->> 'phone', ''), 40),
    left(coalesce(p_contact ->> 'email', ''), 200), left(coalesce(p_contact ->> 'phone', ''), 40),
    auth.uid(), auth.uid(), 'online', per_seat, cfg.booking_fee, per_seat * cardinality(old.seats) - l.price, 0, l.price + cfg.booking_fee)
  returning * into nb;
  update public.resale_listings set status = 'sold', buyer_id = auth.uid(), new_booking_id = nb.id, sold_at = now() where id = l.id;
  return nb;
end $$;

revoke execute on function public.list_for_resale(uuid, integer), public.withdraw_listing(uuid), public.buy_resale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.list_for_resale(uuid, integer), public.withdraw_listing(uuid), public.buy_resale(uuid, jsonb, jsonb) to authenticated;

-- If a listed booking is cancelled (by the passenger or staff), withdraw the
-- listing. buy_resale marks it 'sold' straight after, so sales are unaffected.
create or replace function public.withdraw_listing_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.resale_listings set status = 'withdrawn' where booking_id = new.id and status = 'listed';
  end if;
  return new;
end $$;
drop trigger if exists bookings_withdraw_listing on public.bookings;
create trigger bookings_withdraw_listing after update of status on public.bookings
  for each row execute function public.withdraw_listing_on_cancel();


-- =============================================================================
-- ▼ 20261003000000_passenger_features.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 3: passenger conveniences + staff tools
--  1. Payment options & seat holds: PayHere (card / eZ Cash / mCash / Genie),
--     bank transfer and pay-at-counter. Unpaid holds expire automatically.
--  2. Rewards: every Nth completed trip, one seat free.
--  3. Waitlist for full departures, with automatic offers on cancellation.
--  4. Saved passengers (one-tap rebooking).
--  5. Live trips: bus location + trip updates (departed / delayed / arriving).
--  6. Conductor contact for passengers on the day of travel.
--  7. Parcel & charter requests.
--  8. Daily cash count for counter sales.
--  9. Message queue for SMS / WhatsApp (sent by /api/messages/dispatch).
-- Enum values added here are compared as text so this file runs in one go.
-- =============================================================================

alter type public.booking_status add value if not exists 'held';

-- ---------------------------------------------------------------- settings ---
alter table public.app_settings
  add column if not exists payments_mode text not null default 'demo' check (payments_mode in ('demo', 'payhere')),
  add column if not exists hold_minutes_counter integer not null default 120,
  add column if not exists hold_minutes_bank integer not null default 1440,
  add column if not exists bank_details text not null default '',
  add column if not exists reward_every integer not null default 10 check (reward_every >= 0),
  add column if not exists messaging jsonb not null default '{"sms": true, "whatsapp": false}',
  add column if not exists site_url text not null default 'https://www.siyanlanka.lk';

-- ------------------------------------------------------------- bookings -----
alter table public.bookings
  add column if not exists payment_method text not null default 'card'
    check (payment_method in ('card', 'wallet', 'bank', 'counter', 'cash', 'free')),
  add column if not exists payment_status text not null default 'paid' check (payment_status in ('paid', 'unpaid', 'refunded')),
  add column if not exists hold_expires_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_ref text,
  add column if not exists reward_used boolean not null default false;

-- Held (unpaid) bookings keep their seats until the hold expires.
create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status::text in ('confirmed', 'boarded', 'held') then
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender)
    select new.id, new.schedule_id, new.travel_date, s, new.passenger_gender from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;

create or replace function public.bike_spaces_used(p_schedule text, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int), 0)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.schedule_id = p_schedule and b.travel_date = p_date and b.status::text in ('confirmed', 'boarded', 'held');
$$;

create or replace function public.get_bike_usage(p_from date, p_to date)
returns table (schedule_id text, travel_date date, spaces int)
language sql stable security definer set search_path = public as $$
  select b.schedule_id, b.travel_date,
         sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.travel_date between p_from and p_to and b.status::text in ('confirmed', 'boarded', 'held')
  group by 1, 2;
$$;

-- Release unpaid holds whose time is up (called before booking, by the app on
-- refresh, and by the dispatcher cron). Safe for anyone to call.
create or replace function public.release_expired_holds() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings set status = 'cancelled', payment_status = 'unpaid'
  where status::text = 'held' and hold_expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.release_expired_holds() to anon, authenticated;

-- ------------------------------------------------------------------ rewards ---
-- Completed trip = boarded, or confirmed and the travel date has passed.
create or replace function public.loyalty_status(p_user uuid default auth.uid())
returns table (trips integer, every integer, earned integer, used integer, available integer, next_in integer)
language sql stable security definer set search_path = public as $$
  with s as (select reward_every as every from public.app_settings),
  t as (
    select count(*)::int as trips from public.bookings
    where user_id = p_user and (status::text = 'boarded' or (status::text = 'confirmed' and travel_date < current_date))
  ),
  u as (select count(*)::int as used from public.bookings where user_id = p_user and reward_used and status::text <> 'cancelled')
  select t.trips, s.every,
         case when s.every > 0 then t.trips / s.every else 0 end,
         u.used,
         greatest(0, case when s.every > 0 then t.trips / s.every else 0 end - u.used),
         case when s.every > 0 then s.every - (t.trips % s.every) else 0 end
  from s, t, u;
$$;
grant execute on function public.loyalty_status(uuid) to authenticated;

-- ----------------------------------------------------- create_booking v2 ---
-- Adds: p.payment ('card' | 'wallet' | 'bank' | 'counter'), p.use_reward.
-- In payments_mode 'payhere', card/wallet bookings are held until PayHere
-- confirms; in 'demo' they're confirmed straight away (simulated payment).
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;

  v_fare := (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') then raise exception 'BAD_BIKE: Unknown kind of bike.'; end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if bike ->> 'kind' <> 'bicycle' and length(coalesce(bike ->> 'reg_no', '')) < 4 then raise exception 'BAD_BIKE: Add the number plate.'; end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, (b ->> 'kind')::public.bike_kind, left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

-- Cancelling a held (unpaid) booking refunds nothing.
create or replace function public.cancel_booking(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes;
  leaves timestamptz; hrs numeric; pct int := 0; tier jsonb; staff boolean := public.is_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not staff) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text not in ('confirmed', 'held') then raise exception 'NOT_ALLOWED: Only confirmed bookings can be cancelled.'; end if;
  if bk.payment_status = 'unpaid' then
    update public.bookings set status = 'cancelled', refund_amount = 0, refunded_at = now() where id = p_id returning * into bk;
    return bk;
  end if;
  if staff and bk.user_id is distinct from auth.uid() then
    pct := 100;
  else
    select * into sch from public.schedules where id = bk.schedule_id;
    select * into rt from public.routes where id = sch.route_id;
    leaves := ((bk.travel_date + sch.departure::time)
      + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
    hrs := extract(epoch from (leaves - now())) / 3600;
    for tier in select * from jsonb_array_elements(cfg.refund_policy) loop
      if hrs >= (tier ->> 'hoursBefore')::numeric then pct := (tier ->> 'percent')::int; exit; end if;
    end loop;
  end if;
  update public.bookings set status = 'cancelled', refund_amount = round((total - fee) * pct / 100.0), refunded_at = now(),
         payment_status = case when pct > 0 then 'refunded' else payment_status end
  where id = p_id returning * into bk;
  return bk;
end $$;

-- Staff take payment for a held booking (counter cash / bank transfer seen).
create or replace function public.confirm_payment(p_id uuid, p_method text, p_ref text default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if p_method not in ('cash', 'bank', 'card', 'wallet') then raise exception 'BAD_PAYMENT: Unknown payment method.'; end if;
  update public.bookings set status = 'confirmed', payment_status = 'paid', payment_method = p_method,
         paid_at = now(), payment_ref = p_ref, hold_expires_at = null
  where id = p_id and status::text = 'held' returning * into bk;
  if not found then raise exception 'NOT_FOUND: No unpaid hold with that id (it may have expired).'; end if;
  return bk;
end $$;
revoke execute on function public.confirm_payment(uuid, text, text) from public, anon;
grant execute on function public.confirm_payment(uuid, text, text) to authenticated;

-- PayHere server-to-server confirmation (called by /api/payhere/notify with
-- the secret key, after the signature check). Amount must match.
create or replace function public.mark_paid_by_gateway(p_ref text, p_amount numeric, p_gateway_ref text, p_method text) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  select * into bk from public.bookings where ref = p_ref for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if bk.payment_status = 'paid' then return bk; end if; -- idempotent
  if round(p_amount) <> bk.total then raise exception 'AMOUNT_MISMATCH'; end if;
  if bk.status::text = 'cancelled' then
    -- Paid after the hold expired: keep the money on record for a manual refund/rebook.
    update public.bookings set payment_status = 'paid', paid_at = now(), payment_ref = p_gateway_ref where id = bk.id returning * into bk;
    return bk;
  end if;
  update public.bookings set status = 'confirmed', payment_status = 'paid', payment_method = p_method, paid_at = now(),
         payment_ref = p_gateway_ref, hold_expires_at = null
  where id = bk.id returning * into bk;
  return bk;
end $$;
revoke execute on function public.mark_paid_by_gateway(text, numeric, text, text) from public, anon, authenticated;

-- --------------------------------------------------------------- waitlist ---
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  from_stop text not null,
  to_stop text not null,
  seats integer not null default 1 check (seats between 1 and 6),
  phone text not null default '',
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  offered_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists waitlist_one_active on public.waitlist (user_id, schedule_id, travel_date) where status in ('waiting', 'offered');
alter table public.waitlist enable row level security;
drop policy if exists "own waitlist" on public.waitlist;
create policy "own waitlist" on public.waitlist for select using (user_id = auth.uid() or public.is_staff());
drop policy if exists "join waitlist" on public.waitlist;
create policy "join waitlist" on public.waitlist for insert with check (user_id = auth.uid() and status = 'waiting' and travel_date >= current_date);
drop policy if exists "leave waitlist" on public.waitlist;
create policy "leave waitlist" on public.waitlist for update using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('cancelled', 'booked'));

-- In-app notifications (shown in the app; also queued as SMS/WhatsApp).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default '/my-bookings',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notifications from anon, authenticated;

-- --------------------------------------------------------------- messaging ---
create table if not exists public.message_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms', 'whatsapp')),
  to_phone text not null,
  body text not null,
  kind text not null default 'general',
  booking_id uuid references public.bookings (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists message_queue_pending on public.message_queue (created_at) where status = 'pending';
alter table public.message_queue enable row level security;
drop policy if exists "admin messages" on public.message_queue;
create policy "admin messages" on public.message_queue for select using (public.is_admin());
revoke insert, update, delete on public.message_queue from anon, authenticated;

create or replace function public.enqueue_message(p_phone text, p_body text, p_kind text, p_booking uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare m jsonb := (select messaging from public.app_settings);
begin
  if coalesce(trim(p_phone), '') = '' then return; end if;
  if coalesce((m ->> 'sms')::boolean, false) then
    insert into public.message_queue (channel, to_phone, body, kind, booking_id) values ('sms', p_phone, p_body, p_kind, p_booking);
  end if;
  if coalesce((m ->> 'whatsapp')::boolean, false) then
    insert into public.message_queue (channel, to_phone, body, kind, booking_id) values ('whatsapp', p_phone, p_body, p_kind, p_booking);
  end if;
end $$;
revoke execute on function public.enqueue_message(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.booking_departure_text(bk public.bookings) returns text
language sql stable security definer set search_path = public as $$
  select to_char(bk.travel_date + s.departure::time + make_interval(mins => (r.stops -> public.stop_index(r.stops, bk.from_stop) ->> 'offsetMin')::int),
                 'Dy DD Mon, HH12:MI AM')
  from public.schedules s join public.routes r on r.id = s.route_id where s.id = bk.schedule_id;
$$;

-- Booking messages: confirmed, held (how to pay), cancelled.
create or replace function public.booking_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text := (select site_url from public.app_settings); bank text := (select bank_details from public.app_settings);
  phone text := coalesce(nullif(new.contact_phone, ''), new.passenger_phone);
  trip text := new.from_stop || ' → ' || new.to_stop || ', ' || public.booking_departure_text(new) || ', seat ' || array_to_string(new.seats, ',');
begin
  if new.channel <> 'online' then return new; end if;
  if new.status::text = 'confirmed' and (tg_op = 'INSERT' or old.status::text <> 'confirmed') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' confirmed. ' || trip || '. Ticket: ' || site || '/my-bookings', 'booking_confirmed', new.id);
  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method in ('bank', 'counter') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat held, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' by '
      || to_char(new.hold_expires_at at time zone (select timezone from public.app_settings), 'Dy DD Mon HH12:MI AM')
      || case when new.payment_method = 'bank' then '. Bank: ' || bank || ' Ref: ' || new.ref else ' at our Bastian Mawatha counter' end || '.', 'booking_held', new.id);
  elsif new.status::text = 'cancelled' and tg_op = 'UPDATE' and old.status::text in ('confirmed', 'held') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' cancelled'
      || case when coalesce(new.refund_amount, 0) > 0 then '. Refund LKR ' || new.refund_amount || ' on its way.' else '.' end, 'booking_cancelled', new.id);
  end if;
  return new;
end $$;
drop trigger if exists bookings_messages on public.bookings;
create trigger bookings_messages after insert or update of status on public.bookings
  for each row execute function public.booking_messages();

-- When seats free up, offer them to the waitlist (oldest first).
create or replace function public.offer_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; cap int; taken int; site text := (select site_url from public.app_settings);
begin
  if not (new.status::text = 'cancelled' and old.status::text in ('confirmed', 'held')) then return new; end if;
  select b.rows * 4 + b.back_row_seats into cap from public.buses b join public.schedules s on s.bus_id = b.id where s.id = new.schedule_id;
  select count(*) into taken from public.booking_seats where schedule_id = new.schedule_id and travel_date = new.travel_date and active;
  for w in select * from public.waitlist where schedule_id = new.schedule_id and travel_date = new.travel_date and status = 'waiting' order by created_at loop
    exit when cap - taken < w.seats;
    update public.waitlist set status = 'offered', offered_at = now() where id = w.id;
    insert into public.notifications (user_id, title, body, url)
    values (w.user_id, 'A seat is free on your bus', w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book it before someone else does.',
            '/seats/' || w.schedule_id || '?date=' || w.travel_date || '&from=' || w.from_stop || '&to=' || w.to_stop);
    perform public.enqueue_message(w.phone, 'Siyan Lanka: A seat is free on ' || w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book now: ' || site || '/my-bookings', 'waitlist_offer');
    taken := taken + w.seats; -- offer to as many as the free seats cover
  end loop;
  return new;
end $$;
drop trigger if exists bookings_offer_waitlist on public.bookings;
create trigger bookings_offer_waitlist after update of status on public.bookings
  for each row execute function public.offer_waitlist();

-- ---------------------------------------------------------- saved people ---
alter table public.profiles add column if not exists saved_passengers jsonb not null default '[]';
grant update (saved_passengers) on public.profiles to authenticated;

-- ------------------------------------------------------------- live trips ---
create table if not exists public.bus_locations (
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  lat double precision not null,
  lng double precision not null,
  speed_kmh numeric,
  heading numeric,
  accuracy_m numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (schedule_id, travel_date)
);
create table if not exists public.trip_events (
  id uuid primary key default gen_random_uuid(),
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  kind text not null check (kind in ('departed', 'delayed', 'arriving', 'arrived', 'note')),
  stop text not null default '',
  minutes integer,
  message text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists trip_events_run on public.trip_events (schedule_id, travel_date, created_at);
alter table public.bus_locations enable row level security;
alter table public.trip_events enable row level security;
-- Where the bus is and its updates are public (no personal data).
drop policy if exists "read bus location" on public.bus_locations;
create policy "read bus location" on public.bus_locations for select using (true);
drop policy if exists "staff share location" on public.bus_locations;
create policy "staff share location" on public.bus_locations for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "read trip updates" on public.trip_events;
create policy "read trip updates" on public.trip_events for select using (true);
drop policy if exists "staff post updates" on public.trip_events;
create policy "staff post updates" on public.trip_events for insert with check (public.is_staff());
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bus_locations') then
    alter publication supabase_realtime add table public.bus_locations;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_events') then
    alter publication supabase_realtime add table public.trip_events;
  end if;
end $$;

-- Trip updates go to everyone on that departure who hasn't got off yet.
create or replace function public.trip_event_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; txt text;
begin
  txt := case new.kind
    when 'departed' then 'Your Siyan Lanka bus has left ' || coalesce(nullif(new.stop, ''), 'its stop') || '.'
    when 'delayed' then 'Your Siyan Lanka bus is running about ' || coalesce(new.minutes, 0) || ' min late.'
    when 'arriving' then 'Your Siyan Lanka bus is about ' || coalesce(new.minutes, 0) || ' min from ' || new.stop || '.'
    when 'arrived' then 'Your Siyan Lanka bus has reached ' || new.stop || '.'
    else 'Siyan Lanka: ' || new.message end;
  if new.message <> '' and new.kind <> 'note' then txt := txt || ' ' || new.message; end if;
  for b in select * from public.bookings where schedule_id = new.schedule_id and travel_date = new.travel_date and status::text in ('confirmed', 'held') loop
    perform public.enqueue_message(coalesce(nullif(b.contact_phone, ''), b.passenger_phone), txt, 'trip_' || new.kind, b.id);
  end loop;
  return new;
end $$;
drop trigger if exists trip_events_messages on public.trip_events;
create trigger trip_events_messages after insert on public.trip_events for each row execute function public.trip_event_messages();

-- Conductor's phone for passengers with a booking on that run, from the day before.
create or replace function public.get_trip_contact(p_booking uuid)
returns table (name text, role text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare bk public.bookings; v_bus text;
begin
  select * into bk from public.bookings where id = p_booking;
  if not found or (bk.user_id is distinct from auth.uid() and not public.is_staff()) then return; end if;
  if bk.travel_date > current_date + 1 or bk.travel_date < current_date - 1 then return; end if;
  select s.bus_id into v_bus from public.schedules s where s.id = bk.schedule_id;
  return query select c.full_name, c.role, c.phone from public.crew c
    where c.bus_id = v_bus and c.active and c.role in ('conductor', 'driver') and c.phone <> ''
    order by (c.role = 'conductor') desc limit 1;
end $$;
grant execute on function public.get_trip_contact(uuid) to authenticated;

-- ------------------------------------------------------ parcels & charters ---
create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('parcel', 'charter')),
  status text not null default 'new' check (status in ('new', 'quoted', 'confirmed', 'done', 'cancelled')),
  name text not null check (length(name) between 2 and 120),
  phone text not null check (length(phone) between 7 and 30),
  email text not null default '',
  details jsonb not null default '{}',
  quote_amount integer,
  staff_notes text not null default '',
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_requests enable row level security;
drop policy if exists "anyone can ask" on public.service_requests;
create policy "anyone can ask" on public.service_requests for insert
  with check (status = 'new' and quote_amount is null and staff_notes = '' and (user_id is null or user_id = auth.uid()) and length(details::text) < 4000);
drop policy if exists "own or staff requests" on public.service_requests;
create policy "own or staff requests" on public.service_requests for select using (user_id = auth.uid() or public.is_staff());
drop policy if exists "staff handle requests" on public.service_requests;
create policy "staff handle requests" on public.service_requests for update using (public.is_staff()) with check (public.is_staff());

-- --------------------------------------------------------------- cash count ---
create table if not exists public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  count_date date not null default current_date,
  expected integer not null,
  counted integer not null,
  notes text not null default '',
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index if not exists cash_counts_one_per_day on public.cash_counts (count_date, created_by);
alter table public.cash_counts enable row level security;
drop policy if exists "staff count cash" on public.cash_counts;
create policy "staff count cash" on public.cash_counts for insert with check (public.is_staff() and created_by = auth.uid());
drop policy if exists "see cash counts" on public.cash_counts;
create policy "see cash counts" on public.cash_counts for select using (created_by = auth.uid() or public.is_admin());

-- Staff can attach receipt photos to running costs they log.
drop policy if exists "staff see receipts own" on public.expenses;
create policy "staff see receipts own" on public.expenses for update
  using (public.is_staff() and created_by = auth.uid() and category in ('fuel', 'toll', 'parking', 'cleaning'))
  with check (public.is_staff() and created_by = auth.uid() and category in ('fuel', 'toll', 'parking', 'cleaning'));

-- Stop photos (public, shown to passengers).
insert into storage.buckets (id, name, public) values ('stop-photos', 'stop-photos', true) on conflict (id) do nothing;
drop policy if exists "staff upload stop photos" on storage.objects;
create policy "staff upload stop photos" on storage.objects for insert to authenticated with check (bucket_id = 'stop-photos' and public.is_staff());
drop policy if exists "read stop photos" on storage.objects;
create policy "read stop photos" on storage.objects for select using (bucket_id = 'stop-photos');


-- =============================================================================
-- ▼ 20261004000000_conductor_role.sql
-- =============================================================================
-- =============================================================================
-- Migration 4: conductor role.
-- Conductors use the phone-first conductor page (/conductor): passenger
-- lists, QR boarding, taking cash for held seats, selling a seat on board,
-- trip updates, sharing the bus location, logging fuel/tolls, cash count.
-- They can't change buses, routes or the timetable, or see paperwork and
-- parcel/hire requests (office staff only).
-- =============================================================================

alter type public.user_role add value if not exists 'conductor';

-- Anyone working for the company (office staff, super admin, conductor).
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin', 'conductor'));
$$;

-- Office staff only (not conductors).
create or replace function public.is_office_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin'));
$$;
grant execute on function public.is_office_staff() to anon, authenticated;

drop policy if exists "staff buses" on public.buses;
drop policy if exists "office buses" on public.buses;
create policy "office buses" on public.buses for all using (public.is_office_staff()) with check (public.is_office_staff());
drop policy if exists "staff routes" on public.routes;
drop policy if exists "office routes" on public.routes;
create policy "office routes" on public.routes for all using (public.is_office_staff()) with check (public.is_office_staff());
drop policy if exists "staff schedules" on public.schedules;
drop policy if exists "office schedules" on public.schedules;
create policy "office schedules" on public.schedules for all using (public.is_office_staff()) with check (public.is_office_staff());
drop policy if exists "staff see documents" on public.bus_documents;
drop policy if exists "office see documents" on public.bus_documents;
create policy "office see documents" on public.bus_documents for select using (public.is_office_staff());
drop policy if exists "own or staff requests" on public.service_requests;
drop policy if exists "own or office requests" on public.service_requests;
create policy "own or office requests" on public.service_requests for select using (user_id = auth.uid() or public.is_office_staff());
drop policy if exists "staff handle requests" on public.service_requests;
drop policy if exists "office handle requests" on public.service_requests;
create policy "office handle requests" on public.service_requests for update using (public.is_office_staff()) with check (public.is_office_staff());
drop policy if exists "staff edit profiles" on public.profiles;
drop policy if exists "office edit profiles" on public.profiles;
create policy "office edit profiles" on public.profiles for update using (public.is_office_staff());

create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_role not in ('passenger', 'conductor', 'staff', 'admin') then raise exception 'BAD_ROLE: Unknown role.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'NOT_ALLOWED: You can''t remove your own super admin access.'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user;
end $$;


-- =============================================================================
-- ▼ 20261005000000_payouts_slips_push_tracking.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 5: money back, slips, push, tracking history
--  1. Rewards switch (off by default; nothing is deleted).
--  2. Payouts: every refund and every resale sale becomes a row staff pay and
--     tick off. Passengers add the bank account the money should go to.
--  3. Seat resale: obeys Settings → Seat resale everywhere; online payment
--     goes through a reservation ("resale order") finished by the gateway.
--  4. Bank transfer slips: passenger uploads a photo, staff check it.
--  5. Push subscriptions + trip reminders sent when the app is closed.
--  6. Bus location history (the trail survives a page reload).
-- Safe to run again.
-- =============================================================================

-- ------------------------------------------------------------ 1. rewards ---
alter table public.app_settings add column if not exists rewards_enabled boolean not null default false;

-- With rewards off this reports "every 0", so nobody has a free trip and
-- create_booking refuses use_reward. Also: only your own figures (or staff).
create or replace function public.loyalty_status(p_user uuid default auth.uid())
returns table (trips integer, every integer, earned integer, used integer, available integer, next_in integer)
language sql stable security definer set search_path = public as $$
  with s as (select case when rewards_enabled then reward_every else 0 end as every from public.app_settings),
  ok as (select (p_user is not distinct from auth.uid() or public.is_staff()) as allowed),
  t as (
    select count(*)::int as trips from public.bookings, ok
    where ok.allowed and user_id = p_user and (status::text = 'boarded' or (status::text = 'confirmed' and travel_date < current_date))
  ),
  u as (select count(*)::int as used from public.bookings, ok where ok.allowed and user_id = p_user and reward_used and status::text <> 'cancelled')
  select t.trips, s.every,
         case when s.every > 0 then t.trips / s.every else 0 end,
         u.used,
         greatest(0, case when s.every > 0 then t.trips / s.every else 0 end - u.used),
         case when s.every > 0 then s.every - (t.trips % s.every) else 0 end
  from s, t, u;
$$;
grant execute on function public.loyalty_status(uuid) to authenticated;

-- ------------------------------------------------------------ 2. payouts ---
-- Money the company owes a passenger: a refund, or the price of a resold seat.
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'resale')),
  booking_id uuid references public.bookings (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  -- Where to send it: {"bank","branch","account_no","account_name"}
  payee jsonb not null default '{}',
  method text not null default '' check (method in ('', 'bank', 'cash', 'gateway', 'other')),
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null
);
create index if not exists payouts_pending_idx on public.payouts (created_at) where status = 'pending';
create index if not exists payouts_user_idx on public.payouts (user_id, created_at desc);
alter table public.payouts enable row level security;
-- Bank details are sensitive: the passenger and office staff only (not conductors).
drop policy if exists "own or office payouts" on public.payouts;
create policy "own or office payouts" on public.payouts for select using (user_id = auth.uid() or public.is_office_staff());
revoke insert, update, delete on public.payouts from anon, authenticated;

-- Creates the payout when money becomes owed on a booking:
--  * cancelled with a refund amount,
--  * a paid booking made cheaper (seat dropped / cheaper day),
--  * a gateway payment that arrived after the hold had expired.
create or replace function public.booking_payouts() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_amount int := 0; v_note text := ''; v_payee jsonb := '{}';
begin
  if new.status::text = 'cancelled' and coalesce(new.refund_amount, 0) > 0 and coalesce(old.refund_amount, 0) = 0 then
    v_amount := new.refund_amount; v_note := 'Booking ' || new.ref || ' cancelled';
  elsif new.status::text = 'cancelled' and old.status::text = 'cancelled' and new.payment_status = 'paid' and old.payment_status = 'unpaid' then
    v_amount := new.total; v_note := 'Paid after the seat hold for ' || new.ref || ' had expired';
  elsif new.status::text in ('confirmed', 'boarded') and old.status::text = new.status::text and new.payment_status = 'paid' and new.total < old.total then
    v_amount := old.total - new.total; v_note := 'Booking ' || new.ref || ' changed';
  end if;
  if v_amount <= 0 then return new; end if;
  -- Reuse the account this passenger gave last time.
  if new.user_id is not null then
    select p.payee into v_payee from public.payouts p
    where p.user_id = new.user_id and p.payee <> '{}'::jsonb order by p.created_at desc limit 1;
  end if;
  insert into public.payouts (kind, booking_id, user_id, amount, payee, notes)
  values ('refund', new.id, new.user_id, v_amount, coalesce(v_payee, '{}'), v_note);
  return new;
end $$;
drop trigger if exists bookings_payouts on public.bookings;
create trigger bookings_payouts after update of status, refund_amount, payment_status, total on public.bookings
  for each row execute function public.booking_payouts();

-- Passenger: say which bank account the money should go to.
create or replace function public.set_payout_details(p_id uuid, p_payee jsonb) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare po public.payouts; clean jsonb;
begin
  clean := jsonb_build_object(
    'bank', left(trim(coalesce(p_payee ->> 'bank', '')), 80),
    'branch', left(trim(coalesce(p_payee ->> 'branch', '')), 80),
    'account_no', left(regexp_replace(coalesce(p_payee ->> 'account_no', ''), '[^0-9A-Za-z -]', '', 'g'), 40),
    'account_name', left(trim(coalesce(p_payee ->> 'account_name', '')), 120));
  if length(clean ->> 'bank') < 2 or length(clean ->> 'account_no') < 5 or length(clean ->> 'account_name') < 2 then
    raise exception 'BAD_ACCOUNT: Add the bank, account number and the name on the account.';
  end if;
  update public.payouts set payee = clean where id = p_id and user_id = auth.uid() and status = 'pending' returning * into po;
  if not found then raise exception 'NOT_FOUND: That refund isn''t waiting for bank details.'; end if;
  return po;
end $$;

-- Office staff: the money has been sent.
create or replace function public.mark_payout_paid(p_id uuid, p_method text, p_reference text default '') returns public.payouts
language plpgsql security definer set search_path = public as $$
declare po public.payouts; bk public.bookings; what text;
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  if p_method not in ('bank', 'cash', 'gateway', 'other') then raise exception 'BAD_PAYMENT: Choose how it was paid.'; end if;
  update public.payouts set status = 'paid', method = p_method, reference = left(coalesce(p_reference, ''), 80), paid_at = now(), paid_by = auth.uid()
  where id = p_id and status = 'pending' returning * into po;
  if not found then raise exception 'NOT_FOUND: That payout is not waiting to be paid.'; end if;
  what := case when po.kind = 'resale' then 'Your resale payout' else 'Your refund' end;
  if po.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (po.user_id, what || ' has been paid', 'LKR ' || po.amount || case when p_method = 'bank' then ' sent to your bank account' when p_method = 'cash' then ' paid in cash' else ' paid' end
      || case when po.reference <> '' then ' (ref ' || po.reference || ')' else '' end || '.', '/my-bookings');
  end if;
  select * into bk from public.bookings where id = po.booking_id;
  if found then
    perform public.enqueue_message(coalesce(nullif(bk.contact_phone, ''), bk.passenger_phone),
      'Siyan Lanka: ' || what || ' of LKR ' || po.amount || ' for ' || bk.ref || ' has been paid'
      || case when po.reference <> '' then ', ref ' || po.reference else '' end || '.', 'payout_paid', bk.id);
  end if;
  return po;
end $$;

-- Office staff: nothing is owed after all (duplicate, settled another way…).
create or replace function public.cancel_payout(p_id uuid, p_reason text default '') returns public.payouts
language plpgsql security definer set search_path = public as $$
declare po public.payouts;
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  update public.payouts set status = 'cancelled', notes = trim(notes || ' · Cancelled: ' || left(coalesce(p_reason, ''), 200))
  where id = p_id and status = 'pending' returning * into po;
  if not found then raise exception 'NOT_FOUND: That payout is not waiting to be paid.'; end if;
  return po;
end $$;

revoke execute on function public.set_payout_details(uuid, jsonb), public.mark_payout_paid(uuid, text, text), public.cancel_payout(uuid, text) from public, anon;
grant execute on function public.set_payout_details(uuid, jsonb), public.mark_payout_paid(uuid, text, text), public.cancel_payout(uuid, text) to authenticated;

-- Bookings cancelled with a refund before this migration: add their payouts
-- once, so nothing owed is forgotten. (Marked so re-running adds nothing.)
insert into public.payouts (kind, booking_id, user_id, amount, notes, created_at)
select 'refund', b.id, b.user_id, b.refund_amount, 'Booking ' || b.ref || ' cancelled (before payouts were tracked)', coalesce(b.refunded_at, now())
from public.bookings b
where b.status::text = 'cancelled' and coalesce(b.refund_amount, 0) > 0 and b.travel_date >= current_date - 30
  and not exists (select 1 from public.payouts p where p.booking_id = b.id);

-- ------------------------------------------------------------- 3. resale ---
-- A buyer paying online first reserves the listing for a few minutes; the
-- seat changes hands only when the payment gateway confirms the money.
create table if not exists public.resale_orders (
  order_ref text primary key,
  listing_id uuid not null references public.resale_listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  passenger jsonb not null,
  contact jsonb not null,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refund_due')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  new_booking_id uuid references public.bookings (id) on delete set null
);
create index if not exists resale_orders_listing_idx on public.resale_orders (listing_id) where status = 'pending';
alter table public.resale_orders enable row level security;
drop policy if exists "own resale orders" on public.resale_orders;
create policy "own resale orders" on public.resale_orders for select using (buyer_id = auth.uid() or public.is_office_staff());
revoke insert, update, delete on public.resale_orders from anon, authenticated;

-- Marketplace: hides listings while someone is paying for them.
create or replace function public.get_resale_listings()
returns table (id uuid, price integer, paid integer, schedule_id text, travel_date date, from_stop text, to_stop text, seats text[], listed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.price, (b.total - b.fee), b.schedule_id, b.travel_date, b.from_stop, b.to_stop, b.seats, l.created_at
  from public.resale_listings l join public.bookings b on b.id = l.booking_id
  where l.status = 'listed' and b.status::text = 'confirmed' and b.travel_date >= current_date
    and (select resale_enabled from public.app_settings)
    and not exists (select 1 from public.resale_orders o
                    where o.listing_id = l.id and o.status = 'pending' and o.expires_at > now() and o.buyer_id is distinct from auth.uid())
  order by b.travel_date, l.created_at;
$$;
grant execute on function public.get_resale_listings() to anon, authenticated;

-- Checks shared by "buy now" and "reserve": is this listing really for sale to this buyer?
create or replace function public.resale_check(p_listing uuid, p_buyer uuid, p_gender text) returns public.resale_listings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; old public.bookings; bus public.buses; sch public.schedules; rt public.routes; s text; leaves timestamptz;
begin
  select * into cfg from public.app_settings;
  if not cfg.resale_enabled then raise exception 'RESALE_OFF: Seat resale isn''t available right now.'; end if;
  if p_buyer is null then raise exception 'SIGN_IN: Please sign in to buy.'; end if;
  select * into l from public.resale_listings where id = p_listing for update;
  if not found or l.status <> 'listed' then raise exception 'GONE: This ticket has just been sold.'; end if;
  if l.seller_id = p_buyer then raise exception 'NOT_ALLOWED: That''s your own listing.'; end if;
  select * into old from public.bookings where id = l.booking_id for update;
  if old.status::text <> 'confirmed' then raise exception 'GONE: This ticket is no longer available.'; end if;
  select * into sch from public.schedules where id = old.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  leaves := ((old.travel_date + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, old.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;
  foreach s in array old.seats loop
    if s = any (bus.ladies_seats) and coalesce(p_gender, '') <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;
  return l;
end $$;

-- The hand-over itself, in one transaction: the seller's booking closes (a
-- payout for the price is created for them) and the buyer gets a new booking
-- for the same seats. Internal: never callable from the browser.
create or replace function public.resale_transfer(p_listing uuid, p_buyer uuid, p_passenger jsonb, p_contact jsonb, p_method text, p_gateway_ref text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; old public.bookings; nb public.bookings; per_seat int;
  gender text := coalesce(p_passenger ->> 'gender', '');
begin
  select * into cfg from public.app_settings;
  l := public.resale_check(p_listing, p_buyer, gender);
  select * into old from public.bookings where id = l.booking_id;
  update public.bookings set status = 'cancelled', refund_amount = l.price, refunded_at = now() where id = old.id;
  -- The trigger filed it as a refund; it is really the seller's sale money.
  update public.payouts set kind = 'resale', notes = 'Seat ' || array_to_string(old.seats, ',') || ' on ' || old.ref || ' resold'
  where booking_id = old.id and status = 'pending' and kind = 'refund';
  per_seat := ceil(l.price::numeric / cardinality(old.seats));
  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_gender,
    passenger_phone, contact_email, contact_phone, user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    payment_method, payment_status, paid_at, payment_ref)
  values (public.new_booking_ref(), old.schedule_id, old.travel_date, old.from_stop, old.to_stop, old.seats,
    left(coalesce(nullif(trim(p_passenger ->> 'name'), ''), 'Passenger'), 120), gender, left(coalesce(p_passenger ->> 'phone', ''), 40),
    left(coalesce(p_contact ->> 'email', ''), 200), left(coalesce(p_contact ->> 'phone', ''), 40),
    p_buyer, p_buyer, 'online', per_seat, cfg.booking_fee, per_seat * cardinality(old.seats) - l.price, 0, l.price + cfg.booking_fee,
    p_method, 'paid', now(), p_gateway_ref)
  returning * into nb;
  update public.resale_listings set status = 'sold', buyer_id = p_buyer, new_booking_id = nb.id, sold_at = now() where id = l.id;
  insert into public.notifications (user_id, title, body, url)
  values (l.seller_id, 'Your seat has been sold', 'Seat ' || array_to_string(old.seats, ', ') || ', ' || old.from_stop || ' → ' || old.to_stop
    || '. We''ll pay you LKR ' || l.price || '. Add your bank account in My trips if you haven''t yet.', '/my-bookings');
  return nb;
end $$;
revoke execute on function public.resale_check(uuid, uuid, text), public.resale_transfer(uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;

-- Buy straight away. Only while Settings → Payments is on "demo" (no money
-- taken); with a live gateway the buyer must pay first (reserve_resale).
create or replace function public.buy_resale(p_listing uuid, p_passenger jsonb, p_contact jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
begin
  if (select payments_mode from public.app_settings) <> 'demo' then
    raise exception 'PAY_ONLINE: Pay online to buy this ticket.';
  end if;
  if exists (select 1 from public.resale_orders o where o.listing_id = p_listing and o.status = 'pending' and o.expires_at > now() and o.buyer_id <> auth.uid()) then
    raise exception 'GONE: Someone else is paying for this ticket right now. Try again in a few minutes.';
  end if;
  return public.resale_transfer(p_listing, auth.uid(), p_passenger, p_contact, 'card', null);
end $$;

-- Live gateway: hold the listing for 15 minutes and hand back what to pay.
create or replace function public.reserve_resale(p_listing uuid, p_passenger jsonb, p_contact jsonb) returns public.resale_orders
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; o public.resale_orders;
begin
  select * into cfg from public.app_settings;
  l := public.resale_check(p_listing, auth.uid(), coalesce(p_passenger ->> 'gender', ''));
  if exists (select 1 from public.resale_orders x where x.listing_id = l.id and x.status = 'pending' and x.expires_at > now() and x.buyer_id <> auth.uid()) then
    raise exception 'GONE: Someone else is paying for this ticket right now. Try again in a few minutes.';
  end if;
  -- One open order per buyer per listing: a retry replaces the earlier one's hold.
  update public.resale_orders set expires_at = now() where listing_id = l.id and buyer_id = auth.uid() and status = 'pending' and expires_at > now();
  insert into public.resale_orders (order_ref, listing_id, buyer_id, passenger, contact, amount, expires_at)
  values ('RS-' || upper(substr(md5(random()::text || clock_timestamp()::text || l.id::text), 1, 10)), l.id, auth.uid(),
    jsonb_build_object('name', left(coalesce(p_passenger ->> 'name', ''), 120), 'gender', coalesce(p_passenger ->> 'gender', ''), 'phone', left(coalesce(p_passenger ->> 'phone', ''), 40)),
    jsonb_build_object('email', left(coalesce(p_contact ->> 'email', ''), 200), 'phone', left(coalesce(p_contact ->> 'phone', ''), 40)),
    l.price + cfg.booking_fee, now() + interval '15 minutes')
  returning * into o;
  return o;
end $$;

-- Called by /api/payhere/notify (secret key) once the money has arrived.
-- If the ticket went to someone else meanwhile, the buyer is owed a refund.
create or replace function public.complete_resale(p_order_ref text, p_amount numeric, p_gateway_ref text, p_method text) returns public.resale_orders
language plpgsql security definer set search_path = public as $$
declare o public.resale_orders; nb public.bookings;
begin
  select * into o from public.resale_orders where order_ref = p_order_ref for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'pending' then return o; end if; -- idempotent
  if round(p_amount) <> o.amount then raise exception 'AMOUNT_MISMATCH'; end if;
  begin
    nb := public.resale_transfer(o.listing_id, o.buyer_id, o.passenger, o.contact, p_method, p_gateway_ref);
    update public.resale_orders set status = 'paid', new_booking_id = nb.id where order_ref = o.order_ref returning * into o;
  exception when raise_exception then
    insert into public.payouts (kind, user_id, amount, notes)
    values ('refund', o.buyer_id, o.amount, 'Resale order ' || o.order_ref || ' was paid (' || coalesce(p_gateway_ref, '') || ') but the ticket was no longer available');
    insert into public.notifications (user_id, title, body, url)
    values (o.buyer_id, 'That ticket was no longer available', 'Your payment of LKR ' || o.amount || ' will be refunded in full.', '/my-bookings');
    update public.resale_orders set status = 'refund_due' where order_ref = o.order_ref returning * into o;
  end;
  return o;
end $$;

revoke execute on function public.buy_resale(uuid, jsonb, jsonb), public.reserve_resale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.buy_resale(uuid, jsonb, jsonb), public.reserve_resale(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.complete_resale(text, numeric, text, text) from public, anon, authenticated;

-- Switching resale off takes open listings off sale; the seats stay with
-- their owners. (Listings come back if it's switched on again.)
-- Nothing to do here: every resale function and the marketplace check
-- app_settings.resale_enabled on each call.

-- -------------------------------------------------- 4. bank transfer slips ---
alter table public.bookings
  add column if not exists slip_path text,
  add column if not exists slip_reference text not null default '',
  add column if not exists slip_uploaded_at timestamptz,
  add column if not exists slip_rejected_reason text;

insert into storage.buckets (id, name, public) values ('payment-slips', 'payment-slips', false) on conflict (id) do nothing;
drop policy if exists "upload own payment slips" on storage.objects;
create policy "upload own payment slips" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "read payment slips" on storage.objects;
create policy "read payment slips" on storage.objects for select to authenticated
  using (bucket_id = 'payment-slips' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_office_staff()));

-- Passenger: "I've paid, here is the slip". Keeps the seat while staff check
-- it: the hold is extended once, by the bank-transfer hold time, never past
-- the booking cut-off.
create or replace function public.submit_payment_slip(p_booking uuid, p_path text, p_reference text default '') returns public.bookings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; leaves timestamptz; v_hold timestamptz;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_booking for update;
  if not found or bk.user_id is distinct from auth.uid() then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text <> 'held' or bk.payment_status <> 'unpaid' then raise exception 'NOT_ALLOWED: This booking isn''t waiting for payment (the hold may have expired).'; end if;
  if coalesce(p_path, '') = '' or split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'BAD_SLIP: Upload a photo of the slip.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  leaves := ((bk.travel_date + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  v_hold := bk.hold_expires_at;
  if bk.slip_uploaded_at is null then
    v_hold := least(greatest(coalesce(bk.hold_expires_at, now()), now() + make_interval(mins => cfg.hold_minutes_bank)),
                    leaves - make_interval(mins => cfg.booking_cutoff_minutes));
  end if;
  update public.bookings set slip_path = p_path, slip_reference = left(coalesce(p_reference, ''), 80), slip_uploaded_at = now(),
         slip_rejected_reason = null, payment_method = 'bank', hold_expires_at = v_hold
  where id = bk.id returning * into bk;
  return bk;
end $$;

-- Office staff: the slip is wrong / unreadable / the money hasn't arrived.
create or replace function public.reject_payment_slip(p_booking uuid, p_reason text default '') returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings; why text := left(coalesce(nullif(trim(p_reason), ''), 'We couldn''t match it to a payment'), 200);
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  update public.bookings set slip_path = null, slip_uploaded_at = null, slip_rejected_reason = why
  where id = p_booking and status::text = 'held' and slip_path is not null returning * into bk;
  if not found then raise exception 'NOT_FOUND: No slip waiting on that booking.'; end if;
  if bk.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (bk.user_id, 'We couldn''t accept your payment slip', bk.ref || ': ' || why || '. Please upload it again before the seat is released.', '/my-bookings');
  end if;
  perform public.enqueue_message(coalesce(nullif(bk.contact_phone, ''), bk.passenger_phone),
    'Siyan Lanka: We couldn''t accept the payment slip for ' || bk.ref || ' (' || why || '). Please upload it again in My trips.', 'slip_rejected', bk.id);
  return bk;
end $$;

revoke execute on function public.submit_payment_slip(uuid, text, text), public.reject_payment_slip(uuid, text) from public, anon;
grant execute on function public.submit_payment_slip(uuid, text, text), public.reject_payment_slip(uuid, text) to authenticated;

-- --------------------------------------------------------------- 5. push ---
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for select using (user_id = auth.uid());
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;

-- A browser belongs to whoever signed in on it last.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'BAD_SUBSCRIPTION: That browser subscription isn''t valid.';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) to authenticated;

-- In-app notifications are also pushed to the passenger's devices.
alter table public.notifications
  add column if not exists pushed_at timestamptz,
  add column if not exists tag text;
-- Anything older than this migration is treated as already delivered.
update public.notifications set pushed_at = created_at where pushed_at is null and created_at < now() - interval '1 hour';
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

alter table public.bookings add column if not exists reminder_sent_at timestamptz;

-- "Your bus leaves at …" once per booking, p_hours before the passenger's
-- own boarding time. Called every minute by /api/messages/dispatch.
create or replace function public.queue_trip_reminders(p_hours integer default 3) returns integer
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; r record; n int := 0;
begin
  select * into cfg from public.app_settings;
  for r in
    select b.id, b.user_id, b.ref, b.from_stop, b.to_stop, b.seats, bus.reg_no,
           ((b.travel_date + s.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, b.from_stop) ->> 'offsetMin')::int)) as local_leaves
    from public.bookings b
    join public.schedules s on s.id = b.schedule_id
    join public.routes rt on rt.id = s.route_id
    join public.buses bus on bus.id = s.bus_id
    where b.status::text = 'confirmed' and b.user_id is not null and b.reminder_sent_at is null
      and b.travel_date between current_date - 1 and current_date + 1
  loop
    if (r.local_leaves at time zone cfg.timezone) > now() and (r.local_leaves at time zone cfg.timezone) <= now() + make_interval(hours => p_hours) then
      insert into public.notifications (user_id, title, body, url, tag)
      values (r.user_id, 'Your bus leaves at ' || trim(to_char(r.local_leaves, 'HH12:MI AM')),
              r.from_stop || ' → ' || r.to_stop || ' · Seat ' || array_to_string(r.seats, ', ') || ' · ' || r.reg_no || '. Be at the boarding point 20 minutes early.',
              '/my-bookings', 'trip-' || r.id);
      update public.bookings set reminder_sent_at = now() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_trip_reminders(integer) from public, anon, authenticated;

-- --------------------------------------------------- 6. tracking history ---
create table if not exists public.bus_location_history (
  id bigint generated always as identity primary key,
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  lat double precision not null,
  lng double precision not null,
  speed_kmh numeric,
  heading numeric,
  recorded_at timestamptz not null default now()
);
create index if not exists bus_location_history_run on public.bus_location_history (schedule_id, travel_date, recorded_at desc);
alter table public.bus_location_history enable row level security;
drop policy if exists "read bus history" on public.bus_location_history;
create policy "read bus history" on public.bus_location_history for select using (true);
revoke insert, update, delete on public.bus_location_history from anon, authenticated;

-- Keeps the last 20 points per departure. A point is added when the bus has
-- moved ~50 m or 5 minutes have passed, so a parked bus doesn't fill the trail.
create or replace function public.keep_location_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare last public.bus_location_history;
begin
  select * into last from public.bus_location_history
  where schedule_id = new.schedule_id and travel_date = new.travel_date order by recorded_at desc limit 1;
  if found and abs(last.lat - new.lat) < 0.0005 and abs(last.lng - new.lng) < 0.0005 and new.updated_at - last.recorded_at < interval '5 minutes' then
    return new;
  end if;
  insert into public.bus_location_history (schedule_id, travel_date, lat, lng, speed_kmh, heading, recorded_at)
  values (new.schedule_id, new.travel_date, new.lat, new.lng, new.speed_kmh, new.heading, new.updated_at);
  delete from public.bus_location_history
  where schedule_id = new.schedule_id and travel_date = new.travel_date
    and id not in (select id from public.bus_location_history where schedule_id = new.schedule_id and travel_date = new.travel_date order by recorded_at desc limit 20);
  return new;
end $$;
drop trigger if exists bus_locations_history on public.bus_locations;
create trigger bus_locations_history after insert or update on public.bus_locations
  for each row execute function public.keep_location_history();


-- =============================================================================
-- ▼ 20261006000000_booking_code.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 6: a one-time code for every online booking
-- Passengers can stay signed in for a long time; each booking they place is
-- confirmed with a fresh code sent to their phone (or email, for accounts
-- without a phone). A code is good for one booking, for 20 minutes.
-- Staff and conductors selling at the counter are not asked.
-- Switch: Staff area → Settings → "Ask for a code on every booking".
-- Safe to run again.
-- =============================================================================
alter table public.app_settings
  add column if not exists booking_otp boolean not null default true,
  add column if not exists booking_otp_minutes integer not null default 20;
-- The number is verified on the seat page; 20 minutes covers that page and checkout.
alter table public.app_settings alter column booking_otp_minutes set default 20;
update public.app_settings set booking_otp_minutes = 20 where booking_otp_minutes = 10;

-- True when the caller's session was verified with a one-time code within the
-- last booking_otp_minutes AND that code hasn't already been used for a
-- booking. Supabase records how a session was verified in the token's "amr"
-- claim: [{"method":"otp","timestamp":<unix seconds>}].
create or replace function public.booking_code_ok() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare claims jsonb; ts bigint; verified timestamptz; last_booking timestamptz;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return false;
  end;
  if claims is null or jsonb_typeof(claims -> 'amr') <> 'array' then return false; end if;
  select max((a ->> 'timestamp')::bigint) into ts
  from jsonb_array_elements(claims -> 'amr') a
  where jsonb_typeof(a) = 'object' and a ->> 'method' = 'otp' and (a ->> 'timestamp') ~ '^[0-9]+$';
  if ts is null then return false; end if;
  verified := to_timestamp(ts);
  if verified < now() - make_interval(mins => (select booking_otp_minutes from public.app_settings)) then return false; end if;
  select max(created_at) into last_booking from public.bookings where user_id = auth.uid() and channel::text = 'online';
  return last_booking is null or last_booking < verified;
end $$;
revoke execute on function public.booking_code_ok() from public, anon;
grant execute on function public.booking_code_ok() to authenticated;

-- Enforced in the database, so it can't be skipped by calling the API directly.
create or replace function public.require_booking_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel::text = 'online' and auth.uid() is not null and new.user_id = auth.uid()
     and not public.is_staff()
     and (select booking_otp from public.app_settings)
     and not public.booking_code_ok() then
    raise exception 'CODE_REQUIRED: Confirm this booking with the code we send you.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_require_code on public.bookings;
create trigger bookings_require_code before insert on public.bookings
  for each row execute function public.require_booking_code();


-- =============================================================================
-- ▼ 20261007000000_payment_options.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 7: how passengers pay
--  1. Card / wallet: locked until Settings → "Card & wallet payments" is on.
--  2. Bank transfer: slip upload tells office staff; they mark it paid; the
--     passenger is told.
--  3. Pay at the counter: staff mark it paid; the passenger is told.
--  4. Pay on the bus: the seat is kept; the conductor takes cash when
--     scanning or later in the trip and marks it paid; the passenger is told.
-- Safe to run again.
-- =============================================================================
alter table public.app_settings
  add column if not exists card_payments boolean not null default false,
  add column if not exists pay_on_bus boolean not null default true;

alter table public.bookings drop constraint if exists bookings_payment_method_check;
alter table public.bookings add constraint bookings_payment_method_check
  check (payment_method in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash', 'free'));

-- ------------------------------------------------ 1. card / wallet locked ---
-- Enforced on every online booking a passenger makes (including resale
-- purchases), so it can't be skipped by calling the API. Without this, with
-- Payments on "Demo", a card booking was confirmed with no money taken.
create or replace function public.require_open_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel::text = 'online' and auth.uid() is not null and not public.is_staff()
     and new.payment_method in ('card', 'wallet') and new.total > 0
     and not (select card_payments from public.app_settings) then
    raise exception 'PAYMENT_UNAVAILABLE: Card and wallet payments aren''t available yet. Choose bank transfer, pay at the counter, or pay on the bus.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_require_open_payment on public.bookings;
create trigger bookings_require_open_payment before insert on public.bookings
  for each row execute function public.require_open_payment();

-- --------------------------------------------------- 4. pay on the bus ------
-- create_booking, unchanged except: payment "bus" is accepted and held until
-- 12 hours after the passenger's boarding time (so it is never released
-- before or during the trip).
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;

  v_fare := (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') then raise exception 'BAD_BIKE: Unknown kind of bike.'; end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if bike ->> 'kind' <> 'bicycle' and length(coalesce(bike ->> 'reg_no', '')) < 4 then raise exception 'BAD_BIKE: Add the number plate.'; end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, (b ->> 'kind')::public.bike_kind, left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

-- Staff (office or conductor) record a payment. Works for a held booking and
-- for a passenger who is already on board but hasn't paid yet.
create or replace function public.confirm_payment(p_id uuid, p_method text, p_ref text default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if p_method not in ('cash', 'bank', 'card', 'wallet') then raise exception 'BAD_PAYMENT: Unknown payment method.'; end if;
  update public.bookings set status = case when status::text = 'held' then 'confirmed' else status end,
         payment_status = 'paid', payment_method = p_method, paid_at = now(), payment_ref = p_ref, hold_expires_at = null
  where id = p_id and payment_status = 'unpaid' and status::text in ('held', 'boarded') returning * into bk;
  if not found then raise exception 'NOT_FOUND: No unpaid booking with that id (it may have expired or been paid already).'; end if;
  return bk;
end $$;
revoke execute on function public.confirm_payment(uuid, text, text) from public, anon;
grant execute on function public.confirm_payment(uuid, text, text) to authenticated;

-- ------------------------------------------------ who gets told what --------
-- Tell every office staff member (in-app + push to their devices).
create or replace function public.notify_office(p_title text, p_body text, p_url text) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, url)
  select id, p_title, p_body, p_url from public.profiles where role::text in ('staff', 'admin');
$$;
revoke execute on function public.notify_office(text, text, text) from public, anon, authenticated;

-- Texts to the passenger. New here: pay-on-the-bus wording, and "payment
-- received" when staff or the conductor mark a booking paid.
create or replace function public.booking_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text := (select site_url from public.app_settings); bank text := (select bank_details from public.app_settings);
  phone text := coalesce(nullif(new.contact_phone, ''), new.passenger_phone);
  trip text := new.from_stop || ' → ' || new.to_stop || ', ' || public.booking_departure_text(new) || ', seat ' || array_to_string(new.seats, ',');
begin
  if new.channel <> 'online' then return new; end if;
  if tg_op = 'UPDATE' and old.payment_status = 'unpaid' and new.payment_status = 'paid' and new.status::text in ('confirmed', 'boarded') then
    -- Marked paid by staff / the conductor / the gateway.
    perform public.enqueue_message(phone, 'Siyan Lanka: Payment of LKR ' || new.total || ' received. Booking ' || new.ref || ' is confirmed. ' || trip || '. Ticket: ' || site || '/my-bookings', 'booking_confirmed', new.id);
    if new.user_id is not null then
      insert into public.notifications (user_id, title, body, url)
      values (new.user_id, 'Payment received', 'LKR ' || new.total || ' for ' || new.ref || '. Your seat ' || array_to_string(new.seats, ', ') || ' is confirmed.', '/my-bookings');
    end if;
  elsif new.status::text = 'confirmed' and (tg_op = 'INSERT' or old.status::text not in ('confirmed', 'boarded', 'no-show')) then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' confirmed. ' || trip || '. Ticket: ' || site || '/my-bookings', 'booking_confirmed', new.id);
  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method = 'bus' then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat reserved, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' in cash to the conductor on the bus. Ticket: ' || site || '/my-bookings', 'booking_held', new.id);
  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method in ('bank', 'counter') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat held, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' by '
      || to_char(new.hold_expires_at at time zone (select timezone from public.app_settings), 'Dy DD Mon HH12:MI AM')
      || case when new.payment_method = 'bank' then '. Bank: ' || bank || ' Ref: ' || new.ref else ' at our Bastian Mawatha counter' end || '.', 'booking_held', new.id);
  elsif new.status::text = 'cancelled' and tg_op = 'UPDATE' and old.status::text in ('confirmed', 'held') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' cancelled'
      || case when coalesce(new.refund_amount, 0) > 0 then '. Refund LKR ' || new.refund_amount || ' on its way.' else '.' end, 'booking_cancelled', new.id);
  end if;
  return new;
end $$;
drop trigger if exists bookings_messages on public.bookings;
create trigger bookings_messages after insert or update of status, payment_status on public.bookings
  for each row execute function public.booking_messages();

-- Office staff hear about it when a counter booking is waiting for payment…
create or replace function public.booking_office_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel::text = 'online' and new.status::text = 'held' and new.payment_method = 'counter' then
    perform public.notify_office('Seat held: pay at counter', new.ref || ' · ' || new.passenger_name || ' · LKR ' || new.total || ' · ' || new.from_stop || ' → ' || new.to_stop, '/admin/bookings');
  end if;
  return new;
end $$;
drop trigger if exists bookings_office_alerts on public.bookings;
create trigger bookings_office_alerts after insert on public.bookings
  for each row execute function public.booking_office_alerts();

-- …and when a bank slip arrives.
create or replace function public.slip_office_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.slip_path is not null and new.slip_path is distinct from old.slip_path then
    perform public.notify_office('Bank slip to check', new.ref || ' · ' || new.passenger_name || ' · LKR ' || new.total
      || case when new.slip_reference <> '' then ' · ref ' || new.slip_reference else '' end, '/admin/bookings');
  end if;
  return new;
end $$;
drop trigger if exists bookings_slip_alert on public.bookings;
create trigger bookings_slip_alert after update of slip_path on public.bookings
  for each row execute function public.slip_office_alert();


-- =============================================================================
-- ▼ 20261008000000_send_bus_location.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 8: send the bus location to one passenger
-- The conductor (or office) taps a passenger and sends them where the bus is
-- right now: WhatsApp when it's set up and the number is on WhatsApp,
-- otherwise a text message. Safe to run again.
-- =============================================================================
-- A WhatsApp message that should go out as SMS instead if WhatsApp can't deliver it.
alter table public.message_queue add column if not exists fallback_sms boolean not null default false;

create or replace function public.send_bus_location(p_booking uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bk public.bookings; loc public.bus_locations; reg text; phone text; body text; chan text;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_booking;
  if not found or bk.status::text in ('cancelled', 'no-show') then raise exception 'NOT_FOUND: That booking isn''t active.'; end if;
  phone := coalesce(nullif(bk.contact_phone, ''), nullif(bk.passenger_phone, ''));
  if phone is null then raise exception 'NO_PHONE: There is no phone number on this booking.'; end if;
  select * into loc from public.bus_locations where schedule_id = bk.schedule_id and travel_date = bk.travel_date;
  if not found or loc.updated_at < now() - interval '10 minutes' then
    raise exception 'NO_LOCATION: Turn on "Share location" first, so there is a position to send.';
  end if;
  -- One tap is enough: don't let a double tap send (and bill) two messages.
  if exists (select 1 from public.message_queue where booking_id = bk.id and kind = 'bus_location' and created_at > now() - interval '2 minutes') then
    raise exception 'TOO_SOON: The location was sent to this passenger a moment ago.';
  end if;
  select b.reg_no into reg from public.schedules s join public.buses b on b.id = s.bus_id where s.id = bk.schedule_id;
  body := 'Siyan Lanka: Your bus ' || coalesce(reg, '') || ' (' || bk.from_stop || ' → ' || bk.to_stop || ', seat ' || array_to_string(bk.seats, ',')
    || ') is here now: https://maps.google.com/?q=' || round(loc.lat::numeric, 5) || ',' || round(loc.lng::numeric, 5)
    || ' (' || trim(to_char(loc.updated_at at time zone cfg.timezone, 'HH12:MI AM')) || '). Live: ' || cfg.site_url || '/track?ref=' || bk.ref;
  chan := case when coalesce((cfg.messaging ->> 'whatsapp')::boolean, false) then 'whatsapp' else 'sms' end;
  insert into public.message_queue (channel, to_phone, body, kind, booking_id, fallback_sms)
  values (chan, phone, body, 'bus_location', bk.id, chan = 'whatsapp');
  -- Also in the app (and as a push notification) for passengers with an account.
  if bk.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (bk.user_id, 'Your bus is on the way', 'See where ' || coalesce(reg, 'the bus') || ' is right now.', '/track?ref=' || bk.ref);
  end if;
  return chan;
end $$;
revoke execute on function public.send_bus_location(uuid) from public, anon;
grant execute on function public.send_bus_location(uuid) to authenticated;


-- =============================================================================
-- ▼ 20261009000000_seat_overrides.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 9: seat overrides
--  1. Reserved seats: set per bus. Nobody can book them online. Staff can
--     sell one only after the owner agrees: the owner gets a code by text,
--     tells the staff member, and the code unlocks that seat for that sale.
--  2. Ladies-only override: office staff can sell a ladies-only seat to a
--     male passenger for one sale.
-- Safe to run again.
-- =============================================================================
alter table public.buses add column if not exists reserved_seats text[] not null default '{}';

-- One request to the owner for specific reserved seats on one departure.
create table if not exists public.seat_approvals (
  id uuid primary key default gen_random_uuid(),
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  seats text[] not null,
  note text not null default '',
  code text not null,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'used', 'expired'))
);
create index if not exists seat_approvals_run on public.seat_approvals (schedule_id, travel_date, requested_at desc);
-- Nobody reads this table from the browser (it holds the codes): no policies.
alter table public.seat_approvals enable row level security;
revoke all on public.seat_approvals from anon, authenticated;

-- Staff: ask the owner to release reserved seats. Creates the code; the
-- server route /api/owner-approval texts it to the owner's number (.env).
create or replace function public.request_seat_approval(p_schedule text, p_date date, p_seats text[], p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare bus public.buses; v_seats text[]; v_id uuid;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select b.* into bus from public.schedules s join public.buses b on b.id = s.bus_id where s.id = p_schedule;
  if not found then raise exception 'NOT_FOUND: That departure doesn''t exist.'; end if;
  select array_agg(distinct upper(x)) into v_seats from unnest(p_seats) x where upper(x) = any (bus.reserved_seats);
  if v_seats is null then raise exception 'NOT_RESERVED: None of those seats is a reserved seat.'; end if;
  if exists (select 1 from public.booking_seats bs where bs.schedule_id = p_schedule and bs.travel_date = p_date and bs.seat = any (v_seats)) then
    raise exception 'SEAT_TAKEN: One of those seats is already sold.';
  end if;
  -- The owner shouldn't be flooded with texts: one request a minute per departure.
  if exists (select 1 from public.seat_approvals where schedule_id = p_schedule and travel_date = p_date and requested_at > now() - interval '1 minute') then
    raise exception 'TOO_SOON: A code was sent to the owner a moment ago. Wait a minute before asking again.';
  end if;
  update public.seat_approvals set status = 'expired' where schedule_id = p_schedule and travel_date = p_date and requested_by = auth.uid() and status in ('pending', 'approved');
  insert into public.seat_approvals (schedule_id, travel_date, seats, note, code, requested_by, expires_at)
  values (p_schedule, p_date, v_seats, left(coalesce(p_note, ''), 120),
          lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0'),
          auth.uid(), now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Staff: enter the code the owner read out. Right code → those seats can be
-- sold by this staff member for the next 15 minutes, once.
create or replace function public.verify_seat_approval(p_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a public.seat_approvals;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select * into a from public.seat_approvals where id = p_id and requested_by = auth.uid() for update;
  if not found or a.status <> 'pending' or a.expires_at < now() then
    raise exception 'EXPIRED: That code has run out. Ask the owner for a new one.';
  end if;
  if a.attempts >= 5 then
    update public.seat_approvals set status = 'expired' where id = a.id;
    return false;
  end if;
  if a.code <> regexp_replace(coalesce(p_code, ''), '\D', '', 'g') then
    update public.seat_approvals set attempts = attempts + 1, status = case when attempts + 1 >= 5 then 'expired' else status end where id = a.id;
    return false;
  end if;
  update public.seat_approvals set status = 'approved', expires_at = now() + interval '15 minutes' where id = a.id;
  return true;
end $$;
revoke execute on function public.request_seat_approval(text, date, text[], text), public.verify_seat_approval(uuid, text) from public, anon;
grant execute on function public.request_seat_approval(text, date, text[], text), public.verify_seat_approval(uuid, text) to authenticated;

-- Enforced on every booking and every seat change: a reserved seat needs an
-- approval the owner's code unlocked, for this departure, by this staff member.
create or replace function public.enforce_reserved_seats() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reserved text[]; v_new text[]; v_id uuid;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  select b.reserved_seats into v_reserved from public.schedules s join public.buses b on b.id = s.bus_id where s.id = new.schedule_id;
  if v_reserved is null or cardinality(v_reserved) = 0 then return new; end if;
  select array_agg(x) into v_new from unnest(new.seats) x
  where x = any (v_reserved)
    and not (tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and x = any (old.seats));
  if v_new is null then return new; end if;
  select id into v_id from public.seat_approvals
  where schedule_id = new.schedule_id and travel_date = new.travel_date and status = 'approved' and expires_at > now()
    and requested_by = auth.uid() and seats @> v_new
  order by requested_at desc limit 1 for update;
  if v_id is null then
    raise exception 'RESERVED_SEAT: Seat % is reserved. It can only be sold with the owner''s approval.', array_to_string(v_new, ', ');
  end if;
  update public.seat_approvals set status = 'used' where id = v_id;
  return new;
end $$;
drop trigger if exists bookings_reserved_seats on public.bookings;
create trigger bookings_reserved_seats before insert or update of seats, schedule_id, travel_date on public.bookings
  for each row execute function public.enforce_reserved_seats();

-- create_booking, unchanged except the ladies-only override for office staff.
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and gender <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;

  v_fare := (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') then raise exception 'BAD_BIKE: Unknown kind of bike.'; end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if bike ->> 'kind' <> 'bicycle' and length(coalesce(bike ->> 'reg_no', '')) < 4 then raise exception 'BAD_BIKE: Add the number plate.'; end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, (b ->> 'kind')::public.bike_kind, left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;


-- =============================================================================
-- ▼ 20261010000000_alternate_day_timetable.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 10: alternate-day timetable
-- One bus going out one night and back the next can't be written as fixed
-- weekdays (a week has 7 days). A departure can now run "every N days from a
-- date" instead. When repeat_every is set, the weekday list is ignored (the
-- app keeps all seven ticked) and this rule decides. Safe to run again.
-- =============================================================================
alter table public.schedules
  add column if not exists repeat_every integer,
  add column if not exists repeat_from date;
alter table public.schedules drop constraint if exists schedules_repeat_check;
alter table public.schedules add constraint schedules_repeat_check
  check ((repeat_every is null and repeat_from is null) or (repeat_every between 2 and 14 and repeat_from is not null));

create or replace function public.schedule_runs_on(sch public.schedules, d date) returns boolean
language sql immutable as $$
  select case
    when sch.repeat_every is not null then d >= sch.repeat_from and (d - sch.repeat_from) % sch.repeat_every = 0
    else extract(dow from d)::smallint = any (sch.days)
  end;
$$;

-- Every new booking and every date change is checked, whichever function made it.
create or replace function public.enforce_running_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare sch public.schedules;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  select * into sch from public.schedules where id = new.schedule_id;
  if found and not public.schedule_runs_on(sch, new.travel_date) then
    raise exception 'NOT_FOUND: The bus does not run on that day.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_running_day on public.bookings;
create trigger bookings_running_day before insert or update of travel_date, schedule_id on public.bookings
  for each row execute function public.enforce_running_day();


-- =============================================================================
-- ▼ 20261011000000_bike_categories.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 11: bike categories set by the admin
-- The list of bike categories (name, icon, price, spaces, plate needed,
-- offered or not) is edited in Staff area → Settings → Bikes and stored in
-- app_settings.bikes. The database no longer has a fixed list of kinds.
-- Safe to run again.
-- =============================================================================
-- Was a fixed list (bicycle / scooter / motorbike); now any category id.
alter table public.booking_bikes alter column kind type text using kind::text;

-- create_booking, unchanged except: a category must exist and be offered,
-- the number plate is required only where the category says so, and the
-- category id is stored as text.
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and gender <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;

  v_fare := (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') or not coalesce((kinds -> (bike ->> 'kind') ->> 'active')::boolean, true) then
        raise exception 'BAD_BIKE: That kind of bike isn''t carried. Choose another.';
      end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if coalesce((kinds -> (bike ->> 'kind') ->> 'needsPlate')::boolean, bike ->> 'kind' <> 'bicycle') and length(coalesce(bike ->> 'reg_no', '')) < 4 then
        raise exception 'BAD_BIKE: Add the number plate.';
      end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, b ->> 'kind', left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;


-- =============================================================================
-- ▼ 20261012000000_flat_route_fare.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 12: one price per route
-- A ticket costs the route's price whichever stops the passenger uses
-- (getting off in the middle costs the same). Set per route in Staff area →
-- Routes & timetable → Edit; routes can still be switched to per-stop fares.
-- Safe to run again.
-- =============================================================================
alter table public.routes add column if not exists flat_fare boolean not null default true;

-- create_booking, unchanged except how the fare per seat is worked out.
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and gender <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;

  -- One price for the whole route (the default): the full-route fare wherever
  -- the passenger gets on or off. Otherwise the difference between the stops.
  v_fare := case when rt.flat_fare then (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int
                 else (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int end;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') or not coalesce((kinds -> (bike ->> 'kind') ->> 'active')::boolean, true) then
        raise exception 'BAD_BIKE: That kind of bike isn''t carried. Choose another.';
      end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if coalesce((kinds -> (bike ->> 'kind') ->> 'needsPlate')::boolean, bike ->> 'kind' <> 'bicycle') and length(coalesce(bike ->> 'reg_no', '')) < 4 then
        raise exception 'BAD_BIKE: Add the number plate.';
      end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, b ->> 'kind', left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;


-- =============================================================================
-- ▼ 20261013000000_flexible_seat_layout.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 13: flexible seat layouts
-- A bus can have any arrangement and any seat numbers: 2+2, 2+3, a side with
-- one row fewer, gaps for doors, a back bench of any width, seats numbered
-- 1…51 like the printed booking sheet. The layout is edited in Staff area →
-- Buses → Edit and stored as a grid in buses.seat_map:
--   {"left":2,"right":2,"cells":[["4","3",null,"1","2"], …, ["48","47","49","50","51"]]}
-- (rows front to back, cells left to right, null = no seat there).
-- Buses without a seat_map keep the classic 2+2 layout from rows /
-- back_row_seats. Safe to run again.
-- =============================================================================
alter table public.buses add column if not exists seat_map jsonb;
alter table public.buses drop constraint if exists buses_seat_map_check;
alter table public.buses add constraint buses_seat_map_check
  check (seat_map is null or (jsonb_typeof(seat_map -> 'cells') = 'array' and pg_column_size(seat_map) < 20000));

-- Every seat number in a stored layout.
create or replace function public.seat_map_ids(p_map jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(cell #>> '{}'), '{}')
  from jsonb_array_elements(p_map -> 'cells') r, jsonb_array_elements(r) cell
  where jsonb_typeof(cell) = 'string' and cell #>> '{}' <> '';
$$;

-- Is this seat number on this bus? (Used by every booking and seat change.)
create or replace function public.seat_is_on_bus(p_bus public.buses, p_seat text) returns boolean
language plpgsql immutable as $$
declare r int; c text; m text[];
begin
  if p_bus.seat_map is not null then
    return p_seat = any (public.seat_map_ids(p_bus.seat_map));
  end if;
  -- classic layout: rows of A B | C D, then a back bench
  m := regexp_match(p_seat, '^([0-9]+)([A-F])$');
  if m is null then return false; end if;
  r := m[1]::int; c := m[2];
  if r between 1 and p_bus.rows then return c in ('A', 'B', 'C', 'D'); end if;
  if r = p_bus.rows + 1 then return position(c in 'ABCDEF') between 1 and p_bus.back_row_seats; end if;
  return false;
end $$;

create or replace function public.bus_capacity(p_bus public.buses) returns integer
language sql immutable as $$
  select case when p_bus.seat_map is not null then cardinality(public.seat_map_ids(p_bus.seat_map))
              else p_bus.rows * 4 + p_bus.back_row_seats end;
$$;

-- A layout can't be saved with the same seat number twice.
create or replace function public.check_seat_map() returns trigger
language plpgsql as $$
declare ids text[];
begin
  if new.seat_map is null then return new; end if;
  ids := public.seat_map_ids(new.seat_map);
  if cardinality(ids) = 0 then raise exception 'BAD_LAYOUT: The layout has no seats.'; end if;
  if cardinality(ids) > 80 then raise exception 'BAD_LAYOUT: A bus can have at most 80 seats.'; end if;
  if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) then raise exception 'BAD_LAYOUT: Each seat needs its own number.'; end if;
  if exists (select 1 from unnest(ids) x where x !~ '^[A-Z0-9]{1,4}$') then raise exception 'BAD_LAYOUT: Seat numbers can use letters and digits only, up to 4 characters.'; end if;
  return new;
end $$;
drop trigger if exists buses_check_seat_map on public.buses;
create trigger buses_check_seat_map before insert or update of seat_map on public.buses
  for each row execute function public.check_seat_map();

-- Waitlist offers: capacity now comes from the bus's layout.
create or replace function public.offer_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; cap int; taken int; site text := (select site_url from public.app_settings);
begin
  if not (new.status::text = 'cancelled' and old.status::text in ('confirmed', 'held')) then return new; end if;
  select public.bus_capacity(b) into cap from public.buses b join public.schedules s on s.bus_id = b.id where s.id = new.schedule_id;
  select count(*) into taken from public.booking_seats where schedule_id = new.schedule_id and travel_date = new.travel_date and active;
  for w in select * from public.waitlist where schedule_id = new.schedule_id and travel_date = new.travel_date and status = 'waiting' order by created_at loop
    exit when cap - taken < w.seats;
    update public.waitlist set status = 'offered', offered_at = now() where id = w.id;
    insert into public.notifications (user_id, title, body, url)
    values (w.user_id, 'A seat is free on your bus', w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book it before someone else does.',
            '/seats/' || w.schedule_id || '?date=' || w.travel_date || '&from=' || w.from_stop || '&to=' || w.to_stop);
    perform public.enqueue_message(w.phone, 'Siyan Lanka: A seat is free on ' || w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book now: ' || site || '/my-bookings', 'waitlist_offer');
    taken := taken + w.seats; -- offer to as many as the free seats cover
  end loop;
  return new;
end $$;


-- =============================================================================
-- ▼ 20261014000000_mobile_booking_code.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 14: every booking is confirmed on a mobile
-- However the passenger signed in (email or phone), a seat is confirmed with a
-- 6-digit code texted to the mobile number they give for the booking. The
-- code is ours (not the sign-in code), so:
--   * an account that signed in with email is asked for a mobile too;
--   * signing in with a code a moment ago no longer counts;
--   * the booking's contact number is the number that was verified.
-- Replaces the rule from migration 6. Switch and time limit are unchanged
-- (Settings → "Code on every booking"; app_settings.booking_otp_minutes).
-- Safe to run again.
-- =============================================================================
-- 0771234567 / +94 77 123 4567 / 94771234567 → 94771234567 (null if it isn't a Sri Lankan mobile)
create or replace function public.lk_mobile(p text) returns text
language sql immutable as $$
  select case when d ~ '^947[0-9]{8}$' then d end
  from (select regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^0094', '94'), '^0', '94') as d) x;
$$;

create table if not exists public.booking_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  phone text not null,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'verified', 'used', 'expired')),
  verified_at timestamptz
);
create index if not exists booking_codes_user_idx on public.booking_codes (user_id, created_at desc);
create index if not exists booking_codes_phone_idx on public.booking_codes (phone, created_at desc);
-- Holds the codes: nobody reads it from the browser (no policies).
alter table public.booking_codes enable row level security;
revoke all on public.booking_codes from anon, authenticated;

-- Passenger: "text me a code". The server route /api/booking-code sends it.
create or replace function public.request_booking_code(p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_phone text := public.lk_mobile(p_phone); v_id uuid;
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  if v_phone is null then raise exception 'BAD_PHONE: Enter a Sri Lankan mobile number, like 077 123 4567.'; end if;
  -- Texts cost money and must not be used to pester a number.
  if exists (select 1 from public.booking_codes where (user_id = auth.uid() or phone = v_phone) and created_at > now() - interval '50 seconds') then
    raise exception 'TOO_SOON: A code was sent less than a minute ago. Wait a moment, then ask again.';
  end if;
  if (select count(*) from public.booking_codes where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 6
     or (select count(*) from public.booking_codes where phone = v_phone and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'TOO_MANY: Too many codes were asked for. Try again in an hour.';
  end if;
  update public.booking_codes set status = 'expired' where user_id = auth.uid() and status in ('pending', 'verified');
  insert into public.booking_codes (user_id, phone, code, expires_at)
  values (auth.uid(), v_phone, lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0'), now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Passenger: enter the code. Right code → that number is verified for one booking.
create or replace function public.verify_booking_code(p_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c public.booking_codes;
begin
  select * into c from public.booking_codes where id = p_id and user_id = auth.uid() for update;
  if not found or c.status <> 'pending' or c.expires_at < now() then
    raise exception 'EXPIRED: That code has run out. Ask for a new one.';
  end if;
  if c.code <> regexp_replace(coalesce(p_code, ''), '\D', '', 'g') then
    update public.booking_codes set attempts = attempts + 1, status = case when attempts + 1 >= 5 then 'expired' else status end where id = c.id;
    return false;
  end if;
  update public.booking_codes set status = 'verified', verified_at = now() where id = c.id;
  return true;
end $$;
revoke execute on function public.request_booking_code(text), public.verify_booking_code(uuid, text) from public, anon;
grant execute on function public.request_booking_code(text), public.verify_booking_code(uuid, text) to authenticated;

-- Is there a verified, unused code for this caller and this number, recent enough?
create or replace function public.booking_code_ok(p_phone text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.booking_codes
    where user_id = auth.uid() and status = 'verified'
      and verified_at > now() - make_interval(mins => (select booking_otp_minutes from public.app_settings))
      and (p_phone is null or phone = public.lk_mobile(p_phone)));
$$;
revoke execute on function public.booking_code_ok(text) from public, anon;
grant execute on function public.booking_code_ok(text) to authenticated;
drop function if exists public.booking_code_ok();

-- Enforced on every online booking a passenger makes, so it can't be skipped
-- by calling the API. The booking's contact number must be the verified one,
-- and each code confirms one booking.
create or replace function public.require_booking_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (new.channel::text = 'online' and auth.uid() is not null and new.user_id = auth.uid()
          and not public.is_staff() and (select booking_otp from public.app_settings)) then
    return new;
  end if;
  select id into v_id from public.booking_codes
  where user_id = auth.uid() and status = 'verified'
    and verified_at > now() - make_interval(mins => (select booking_otp_minutes from public.app_settings))
    and phone = public.lk_mobile(coalesce(nullif(new.contact_phone, ''), new.passenger_phone))
  order by verified_at desc limit 1 for update;
  if v_id is null then
    raise exception 'CODE_REQUIRED: Confirm this booking with the code we send you.';
  end if;
  update public.booking_codes set status = 'used' where id = v_id;
  return new;
end $$;
drop trigger if exists bookings_require_code on public.bookings;
create trigger bookings_require_code before insert on public.bookings
  for each row execute function public.require_booking_code();


-- =============================================================================
-- ▼ 20261015000000_cash_close.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 15: closing the day
-- When a conductor or ticket seller closes the day, the system works out the
-- cash THEY should be holding (cash they took, minus cash refunds they paid
-- out), compares it with what they counted, and:
--   * refuses to close a day that is short or over without a note;
--   * tells the super admins when a day closes short or over.
-- The expected figure is worked out by the database, not sent by the browser.
-- Safe to run again.
-- =============================================================================
-- Who recorded each payment (needed to know whose cash it is).
alter table public.bookings add column if not exists paid_by uuid references public.profiles (id) on delete set null;

create or replace function public.stamp_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    if new.paid_at is null then new.paid_at := now(); end if;
    if auth.uid() is not null and public.is_staff() then new.paid_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists bookings_stamp_payment on public.bookings;
create trigger bookings_stamp_payment before insert or update of payment_status on public.bookings
  for each row execute function public.stamp_payment();

-- Sales made before this migration: a counter / phone sale paid in cash was taken by whoever made it.
update public.bookings set paid_by = created_by
where paid_by is null and created_by is not null and channel::text <> 'online' and payment_method = 'cash' and payment_status in ('paid', 'refunded');

-- Cash one staff member should be holding for one day (the company's local date).
-- (Replaced by the 3-argument version in migration 16; dropped first so a re-run never leaves both.)
drop function if exists public.cash_summary(date, text);
drop function if exists public.cash_expected(uuid, date, text);
create or replace function public.cash_expected(p_user uuid, p_date date) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date) from public, anon, authenticated;

-- What the Close the day screen shows the signed-in staff member.
create or replace function public.cash_summary(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(auth.uid(), p_date),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = auth.uid() and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded') and (b.paid_at at time zone tz)::date = p_date), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = auth.uid() and p.method = 'cash' and p.status = 'paid' and (p.paid_at at time zone tz)::date = p_date), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date) from public, anon;
grant execute on function public.cash_summary(date) to authenticated;

-- Closing the day: the database sets the expected figure and insists on a note when the cash doesn't match.
create or replace function public.check_cash_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance
  new.created_by := auth.uid();
  new.expected := public.cash_expected(auth.uid(), new.count_date);
  if new.counted < 0 then raise exception 'BAD_AMOUNT: Enter the cash you counted.'; end if;
  if new.counted <> new.expected and length(trim(coalesce(new.notes, ''))) < 3 then
    raise exception 'NOTE_NEEDED: The cash is % by LKR %. Add a note saying what happened.',
      case when new.counted < new.expected then 'short' else 'over' end, abs(new.counted - new.expected);
  end if;
  return new;
end $$;
drop trigger if exists cash_counts_check on public.cash_counts;
create trigger cash_counts_check before insert on public.cash_counts
  for each row execute function public.check_cash_count();

-- A day that closes short or over is reported to the super admins.
create or replace function public.report_cash_difference() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.counted = new.expected then return new; end if;
  select coalesce(nullif(full_name, ''), 'A staff member') into who from public.profiles where id = new.created_by;
  insert into public.notifications (user_id, title, body, url)
  select p.id,
         'Cash ' || case when new.counted < new.expected then 'short' else 'over' end || ' by LKR ' || abs(new.counted - new.expected),
         who || ', ' || to_char(new.count_date, 'Dy DD Mon') || ': should have LKR ' || new.expected || ', counted LKR ' || new.counted || '. Note: ' || new.notes,
         '/admin/cash'
  from public.profiles p where p.role::text = 'admin' and p.id <> new.created_by;
  return new;
end $$;
drop trigger if exists cash_counts_report on public.cash_counts;
create trigger cash_counts_report after insert on public.cash_counts
  for each row execute function public.report_cash_difference();


-- =============================================================================
-- ▼ 20261016000000_cash_close_per_trip.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 16: close a trip, or any day
-- A conductor closes the cash for the DEPARTURE chosen on the conductor
-- screen (a night bus spans two dates, so "today" is the wrong unit): the
-- cash they took for bookings on that departure. Office staff close a day
-- (any date up to today): the cash they took on that date.
-- Safe to run again.
-- =============================================================================
alter table public.cash_counts add column if not exists schedule_id text references public.schedules (id) on delete set null;
-- One close per person per day, and one per person per departure.
drop index if exists public.cash_counts_one_per_day;
create unique index if not exists cash_counts_one_each on public.cash_counts (count_date, created_by, (coalesce(schedule_id, '')));

drop function if exists public.cash_summary(date);
drop function if exists public.cash_expected(uuid, date);

-- p_schedule given: cash this person took for bookings on that departure
--   (travel date p_date), whenever they took it, less cash refunds they paid
--   on those bookings.
-- p_schedule null: cash this person took ON the date p_date (company time),
--   less cash refunds they paid that day.
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
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

drop function if exists public.cash_summary(date, text, uuid); -- (re-run: migration 28 puts it back)
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
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text) from public, anon;
grant execute on function public.cash_summary(date, text) to authenticated;

create or replace function public.check_cash_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance
  new.created_by := auth.uid();
  if new.schedule_id is null and new.count_date > (now() at time zone (select timezone from public.app_settings))::date then
    raise exception 'TOO_EARLY: That day hasn''t happened yet.';
  end if;
  new.expected := public.cash_expected(auth.uid(), new.count_date, new.schedule_id);
  if new.counted < 0 then raise exception 'BAD_AMOUNT: Enter the cash you counted.'; end if;
  if new.counted <> new.expected and length(trim(coalesce(new.notes, ''))) < 3 then
    raise exception 'NOTE_NEEDED: The cash is % by LKR %. Add a note saying what happened.',
      case when new.counted < new.expected then 'short' else 'over' end, abs(new.counted - new.expected);
  end if;
  return new;
end $$;


-- =============================================================================
-- ▼ 20261017000000_cash_overview.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 17: cash overview and unfinished closes
--  * Super admin: for any day, every bus and trip that ran, what was sold and
--    how it was paid, who took cash and whether they have closed it.
--  * Everyone who takes cash: a list of earlier days / trips where they took
--    cash and never closed, so a missed close can be finished later.
-- Safe to run again.
-- =============================================================================
-- Earlier cash this person took that is not covered by any close of theirs.
-- Conductors are reminded by trip, office staff by day. Today (and today's
-- trips) are not "unfinished" yet. Looks back 60 days.
create or replace function public.cash_unclosed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
  today date := (now() at time zone tz)::date;
  by_trip boolean := exists (select 1 from public.profiles where id = auth.uid() and role::text = 'conductor');
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return coalesce((
    with open_cash as (
      select b.schedule_id, b.travel_date, (b.paid_at at time zone tz)::date as paid_day, b.total
      from public.bookings b
      where b.paid_by = auth.uid() and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
        and b.paid_at > now() - interval '60 days'
        -- not covered by a close of that trip, nor by a close of the day the cash was taken
        and not exists (select 1 from public.cash_counts c where c.created_by = auth.uid() and c.schedule_id = b.schedule_id and c.count_date = b.travel_date)
        and not exists (select 1 from public.cash_counts c where c.created_by = auth.uid() and c.schedule_id is null and c.count_date = (b.paid_at at time zone tz)::date)
    ),
    grouped as (
      select 'trip' as kind, travel_date as d, schedule_id as sch, sum(total)::int as amount, count(*)::int as payments
      from open_cash where by_trip and travel_date < today group by travel_date, schedule_id
      union all
      select 'day', paid_day, null, sum(total)::int, count(*)::int
      from open_cash where not by_trip and paid_day < today group by paid_day
    )
    select jsonb_agg(jsonb_build_object('kind', kind, 'date', d, 'schedule_id', sch, 'amount', amount, 'payments', payments) order by d, sch)
    from grouped), '[]'::jsonb);
end $$;
revoke execute on function public.cash_unclosed() from public, anon;
grant execute on function public.cash_unclosed() to authenticated;

-- Super admin: everything about one day's money, bus by bus.
create or replace function public.cash_overview(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admin only.'; end if;
  return jsonb_build_object(
    -- every departure that runs on this date (or has bookings on it), with its money
    'trips', coalesce((
      select jsonb_agg(t order by t ->> 'departure', t ->> 'schedule_id') from (
        select jsonb_build_object(
          'schedule_id', s.id, 'departure', s.departure,
          'route', (r.stops -> 0 ->> 'name') || ' → ' || (r.stops -> (jsonb_array_length(r.stops) - 1) ->> 'name'),
          'bus', bus.name || ' · ' || bus.reg_no, 'capacity', public.bus_capacity(bus),
          'seats', coalesce((select sum(cardinality(b.seats)) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.status::text in ('confirmed', 'boarded', 'held')), 0),
          'cash', coalesce((select sum(b.total) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_status = 'paid' and b.payment_method = 'cash' and b.status::text <> 'cancelled'), 0),
          'other_paid', coalesce((select sum(b.total) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_status = 'paid' and b.payment_method <> 'cash' and b.status::text <> 'cancelled'), 0),
          'unpaid', coalesce((select sum(b.total) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_status = 'unpaid' and b.status::text in ('held', 'boarded')), 0),
          -- who took cash for this trip, and whether they closed it
          'people', coalesce((
            select jsonb_agg(jsonb_build_object(
              'name', coalesce(nullif(p.full_name, ''), 'Staff'), 'role', p.role::text,
              'expected', public.cash_expected(p.id, p_date, s.id),
              'closed', c.id is not null, 'counted', c.counted, 'recorded_expected', c.expected, 'notes', coalesce(c.notes, '')) order by p.full_name)
            from (select distinct paid_by from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_method = 'cash' and b.paid_by is not null
                  union select created_by from public.cash_counts c2 where c2.schedule_id = s.id and c2.count_date = p_date) x
            join public.profiles p on p.id = x.paid_by
            left join public.cash_counts c on c.created_by = p.id and c.schedule_id = s.id and c.count_date = p_date), '[]'::jsonb)) as t
        from public.schedules s
        join public.routes r on r.id = s.route_id
        join public.buses bus on bus.id = s.bus_id
        where (s.active and public.schedule_runs_on(s, p_date))
           or exists (select 1 from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date)) q), '[]'::jsonb),
    -- cash taken ON this date, person by person, and whether they closed the day
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(p.full_name, ''), 'Staff'), 'role', p.role::text,
        'expected', public.cash_expected(p.id, p_date, null),
        'closed', c.id is not null, 'counted', c.counted, 'recorded_expected', c.expected, 'notes', coalesce(c.notes, '')) order by p.full_name)
      from (select distinct paid_by from public.bookings b where b.payment_method = 'cash' and b.paid_by is not null and (b.paid_at at time zone tz)::date = p_date
            union select created_by from public.cash_counts c2 where c2.schedule_id is null and c2.count_date = p_date) x
      join public.profiles p on p.id = x.paid_by and p.role::text <> 'conductor' -- conductors close by trip (listed above)
      left join public.cash_counts c on c.created_by = p.id and c.schedule_id is null and c.count_date = p_date), '[]'::jsonb));
end $$;
revoke execute on function public.cash_overview(date) from public, anon;
grant execute on function public.cash_overview(date) to authenticated;


-- =============================================================================
-- ▼ 20261018000000_renewal_reminders.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 18: reminders to renew documents
-- Bus paperwork (insurance, revenue licence, route permit, emission test,
-- fitness certificate) and crew driving licences are chased automatically:
-- a reminder 30, 14, 7, 3 and 1 days before the expiry date, on the day, and
-- every 3 days after it has expired, until the date is updated.
-- Each reminder goes to every super admin (in the app, and as a push
-- notification) and, by text, to the owner's number (OWNER_PHONE in .env).
-- Sent by the every-minute cron (/api/messages/dispatch). Safe to run again.
-- =============================================================================
alter table public.bus_documents
  add column if not exists reminded_for date,      -- the expiry date the last reminder was about
  add column if not exists reminded_stage integer; -- how far along that reminder was (30, 14, 7, 3, 1, 0, -1, -2 …)
alter table public.crew
  add column if not exists reminded_for date,
  add column if not exists reminded_stage integer;

-- Which reminder a number of days-left belongs to. Falls as time passes.
create or replace function public.renewal_stage(days_left integer) returns integer
language sql immutable as $$
  select case when days_left > 30 then null
              when days_left > 14 then 30 when days_left > 7 then 14 when days_left > 3 then 7
              when days_left > 1 then 3 when days_left > 0 then 1 when days_left = 0 then 0
              else -1 - ((-days_left - 1) / 3) end; -- expired: a new stage every 3 days
$$;

-- Queues the reminders that are due and returns their wording (for the text
-- to the owner). A reminder is due when the stage has moved on since the last
-- one, or the expiry date has changed. Called by the server only.
create or replace function public.queue_renewal_reminders() returns text[]
language plpgsql security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
  today date := (now() at time zone tz)::date;
  r record; lines text[] := '{}'; line text; title text; d int; st int;
  labels jsonb := '{"insurance":"Insurance","revenue_license":"Revenue licence","route_permit":"Route permit","emission_test":"Emission test","fitness_certificate":"Fitness certificate","other":"Document"}';
begin
  for r in
    select 'doc' as src, bd.id::text as id, coalesce(labels ->> bd.kind, 'Document') || ' for ' || b.reg_no as what, bd.expires_on, bd.reminded_for, bd.reminded_stage, '/admin/fleet-health' as url
    from public.bus_documents bd join public.buses b on b.id = bd.bus_id
    union all
    select 'crew', c.id::text, 'Driving licence of ' || c.full_name, c.license_expires, c.reminded_for, c.reminded_stage, '/admin/crew'
    from public.crew c where c.license_expires is not null and coalesce(c.active, true)
  loop
    d := r.expires_on - today;
    st := public.renewal_stage(d);
    continue when st is null;
    continue when r.reminded_for is not distinct from r.expires_on and r.reminded_stage is not null and r.reminded_stage <= st;
    line := r.what || case when d > 1 then ' expires in ' || d || ' days' when d = 1 then ' expires tomorrow' when d = 0 then ' expires today'
                           when d = -1 then ' expired yesterday' else ' expired ' || (-d) || ' days ago' end
            || ' (' || to_char(r.expires_on, 'Dy DD Mon YYYY') || ')';
    title := case when d < 0 then 'Expired: ' when d <= 3 then 'Renew now: ' else 'Renew soon: ' end || r.what;
    insert into public.notifications (user_id, title, body, url)
    select p.id, title, line || '. Update it once it is renewed.', r.url from public.profiles p where p.role::text = 'admin';
    if r.src = 'doc' then update public.bus_documents set reminded_for = r.expires_on, reminded_stage = st where id::text = r.id;
    else update public.crew set reminded_for = r.expires_on, reminded_stage = st where id::text = r.id; end if;
    lines := lines || line;
  end loop;
  return lines;
end $$;
revoke execute on function public.queue_renewal_reminders() from public, anon, authenticated;


-- =============================================================================
-- ▼ 20261019000000_salary_settlement.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 19: salary settlement
-- Each crew member's pay for a month is settled person by person:
--   earned  = monthly salary + (pay per trip × trips their bus ran) + bonuses − deductions
--   balance = earned − advances already given − salary already paid
-- crew_pay holds every advance, salary payment, bonus and deduction. Advances
-- and salary payments are money leaving the company, so each also has a row
-- in expenses (category "salary") and shows in Finance. Super admin only.
-- Safe to run again.
-- =============================================================================
alter table public.crew add column if not exists per_trip_pay integer not null default 0;
alter table public.crew drop constraint if exists crew_per_trip_pay_check;
alter table public.crew add constraint crew_per_trip_pay_check check (per_trip_pay >= 0);

create table if not exists public.crew_pay (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), -- the month the pay is FOR
  kind text not null check (kind in ('advance', 'salary', 'bonus', 'deduction')),
  amount integer not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'cash' check (method in ('cash', 'bank', 'cheque', 'other')),
  notes text not null default '',
  expense_id uuid references public.expenses (id) on delete set null, -- for advances and salary payments
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists crew_pay_month_idx on public.crew_pay (month, crew_id);
alter table public.crew_pay enable row level security;
drop policy if exists "admin crew pay" on public.crew_pay;
create policy "admin crew pay" on public.crew_pay for all using (public.is_admin()) with check (public.is_admin());

-- Removing an advance or a salary payment removes its expense too, so Finance stays right.
create or replace function public.crew_pay_remove_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.expense_id is not null then delete from public.expenses where id = old.expense_id; end if;
  return old;
end $$;
drop trigger if exists crew_pay_expense on public.crew_pay;
create trigger crew_pay_expense after delete on public.crew_pay
  for each row execute function public.crew_pay_remove_expense();


-- =============================================================================
-- ▼ 20261020000000_seat_beside_a_woman.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 20: the seat beside a woman travelling alone
-- When a woman has booked ONE seat, the seat(s) right beside hers (same side
-- of the aisle) are kept for women. A man can't book there online, unless:
--   * it is the same account as hers (she is adding a seat for a companion);
--   * the booking is made by office staff (a manual override at the counter).
-- A booking of two or more seats together is never restricted: whoever books
-- a pair decides who sits in it.
-- Switch: Staff area → Settings → "Seat beside a woman travelling alone"
-- (app_settings.ladies_adjacent). Enforced here, so it can't be skipped by
-- calling the API. Safe to run again.
-- =============================================================================
alter table public.app_settings add column if not exists ladies_adjacent boolean not null default true;

-- Passengers' seat maps need to know which booked seats belong to someone
-- travelling alone (nothing else about the booking is published).
alter table public.booking_seats add column if not exists solo boolean not null default false;
grant select (solo) on public.booking_seats to anon, authenticated;

create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status::text in ('confirmed', 'boarded', 'held') then
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender, solo)
    select new.id, new.schedule_id, new.travel_date, s, new.passenger_gender, cardinality(new.seats) = 1 from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;
update public.booking_seats bs set solo = (cardinality(b.seats) = 1) from public.bookings b where b.id = bs.booking_id and bs.solo is distinct from (cardinality(b.seats) = 1);

-- The seat(s) right beside a seat: next to it in the same row with no aisle
-- or gap between. Works for a stored layout and for the classic 2+2 one.
create or replace function public.seat_neighbours(p_bus public.buses, p_seat text) returns text[]
language plpgsql immutable as $$
declare r jsonb; i int; n int; out text[] := '{}'; m text[]; rw int; pos int; back text;
begin
  if p_bus.seat_map is not null then
    for r in select value from jsonb_array_elements(p_bus.seat_map -> 'cells') loop
      n := jsonb_array_length(r);
      for i in 0 .. n - 1 loop
        if jsonb_typeof(r -> i) = 'string' and r ->> i = p_seat then
          if i > 0 and jsonb_typeof(r -> (i - 1)) = 'string' and r ->> (i - 1) <> '' then out := out || (r ->> (i - 1)); end if;
          if i < n - 1 and jsonb_typeof(r -> (i + 1)) = 'string' and r ->> (i + 1) <> '' then out := out || (r ->> (i + 1)); end if;
          return out;
        end if;
      end loop;
    end loop;
    return out;
  end if;
  -- classic layout: A B | C D in each row; a back bench of 4 is A B | C D too, 5 or 6 sit side by side
  m := regexp_match(p_seat, '^([0-9]+)([A-F])$');
  if m is null then return out; end if;
  rw := m[1]::int; pos := position(m[2] in 'ABCDEF');
  if rw <= p_bus.rows or p_bus.back_row_seats = 4 then
    return array[rw || case m[2] when 'A' then 'B' when 'B' then 'A' when 'C' then 'D' else 'C' end];
  end if;
  back := left('ABCDEF', p_bus.back_row_seats);
  if pos > 1 then out := out || (rw || substr(back, pos - 1, 1)); end if;
  if pos < p_bus.back_row_seats then out := out || (rw || substr(back, pos + 1, 1)); end if;
  return out;
end $$;

create or replace function public.enforce_seat_beside_woman() returns trigger
language plpgsql security definer set search_path = public as $$
declare bus public.buses; s text; nb text; other public.bookings;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if not (select ladies_adjacent from public.app_settings) then return new; end if;
  if auth.uid() is null or public.is_office_staff() then return new; end if; -- gateway / office override
  if new.passenger_gender = 'Female' then return new; end if;
  select b.* into bus from public.schedules sc join public.buses b on b.id = sc.bus_id where sc.id = new.schedule_id;
  if not found then return new; end if;
  foreach s in array new.seats loop
    -- on a seat change, only the seats being moved into are checked
    continue when tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and s = any (old.seats);
    foreach nb in array public.seat_neighbours(bus, s) loop
      continue when nb = any (new.seats);
      select b.* into other from public.bookings b
      where b.schedule_id = new.schedule_id and b.travel_date = new.travel_date and b.id <> new.id
        and b.status::text in ('confirmed', 'boarded', 'held') and nb = any (b.seats) limit 1;
      if found and other.passenger_gender = 'Female' and cardinality(other.seats) = 1
         and (new.user_id is null or other.user_id is distinct from new.user_id) then
        raise exception 'LADIES_NEIGHBOUR: Seat % is beside a woman travelling alone, so it is kept for women passengers. Please choose another seat.', s;
      end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists bookings_seat_beside_woman on public.bookings;
create trigger bookings_seat_beside_woman before insert or update of seats, schedule_id, travel_date, passenger_gender on public.bookings
  for each row execute function public.enforce_seat_beside_woman();


-- =============================================================================
-- ▼ 20261021000000_seat_holds.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 21: seats held during checkout are real
-- The "Seats are held for 9:51" countdown used to be a timer in the
-- passenger's browser only: nothing was held, staff couldn't see it, and
-- someone else could take the seat meanwhile. Now choosing seats places a
-- real hold (10 minutes) that:
--   * other passengers see as "held by another passenger" and can't book;
--   * staff see on the Departures seat map, with the time it runs out;
--   * office staff can override by selling the seat (conductors can't);
--   * turns into the booking when the passenger completes it, or lapses.
-- Safe to run again.
-- =============================================================================
create table if not exists public.seat_holds (
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  seat text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (schedule_id, travel_date, seat)
);
create index if not exists seat_holds_user_idx on public.seat_holds (user_id);
alter table public.seat_holds enable row level security;
-- Anyone can see THAT a seat is held and until when (needed for live seat maps); never by whom.
drop policy if exists "see seat holds" on public.seat_holds;
create policy "see seat holds" on public.seat_holds for select using (true);
revoke all on public.seat_holds from anon, authenticated;
grant select (schedule_id, travel_date, seat, expires_at) on public.seat_holds to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seat_holds') then
    alter publication supabase_realtime add table public.seat_holds;
  end if;
exception when others then null; -- no realtime publication (local test database)
end $$;

-- Passenger: hold these seats for me while I check out. Replaces whatever I
-- was holding before (one selection at a time). Returns when the hold ends.
create or replace function public.hold_seats(p_schedule text, p_date date, p_seats text[]) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz := now() + interval '10 minutes'; v_seats text[]; taken text;
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  delete from public.seat_holds where expires_at < now() or user_id = auth.uid();
  select array_agg(distinct upper(x)) into v_seats from unnest(coalesce(p_seats, '{}')) x where x <> '';
  if v_seats is null then return null; end if; -- nothing selected: holds released
  if cardinality(v_seats) > 10 then raise exception 'TOO_MANY: Too many seats.'; end if;
  select bs.seat into taken from public.booking_seats bs where bs.schedule_id = p_schedule and bs.travel_date = p_date and bs.active and bs.seat = any (v_seats) limit 1;
  if found then raise exception 'SEAT_TAKEN: Seat % was just booked by someone else. Please pick another.', taken; end if;
  begin
    insert into public.seat_holds (schedule_id, travel_date, seat, user_id, expires_at)
    select p_schedule, p_date, s, auth.uid(), v_until from unnest(v_seats) s;
  exception when unique_violation then
    raise exception 'SEAT_HELD: One of those seats is being booked by someone else right now. Pick another, or try again in a few minutes.';
  end;
  return v_until;
end $$;

create or replace function public.release_seat_holds() returns void
language sql security definer set search_path = public as $$
  delete from public.seat_holds where user_id = auth.uid();
$$;

-- Current holds for a range of dates; "mine" marks the caller's own.
create or replace function public.get_seat_holds(p_from date, p_to date)
returns table (schedule_id text, travel_date date, seat text, expires_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select h.schedule_id, h.travel_date, h.seat, h.expires_at, h.user_id is not distinct from auth.uid()
  from public.seat_holds h where h.travel_date between p_from and p_to and h.expires_at > now();
$$;
revoke execute on function public.hold_seats(text, date, text[]), public.release_seat_holds() from public, anon;
grant execute on function public.hold_seats(text, date, text[]), public.release_seat_holds() to authenticated;
grant execute on function public.get_seat_holds(date, date) to anon, authenticated;

-- A seat someone else is holding can't be booked, except by office staff
-- (their override at the counter). Checked on every booking and seat change.
create or replace function public.respect_seat_holds() returns trigger
language plpgsql security definer set search_path = public as $$
declare held text;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if public.is_office_staff() then return new; end if;
  select h.seat into held from public.seat_holds h
  where h.schedule_id = new.schedule_id and h.travel_date = new.travel_date and h.seat = any (new.seats)
    and h.expires_at > now() and h.user_id is distinct from coalesce(new.user_id, auth.uid())
    and not (tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and h.seat = any (old.seats))
  limit 1;
  if found then
    raise exception 'SEAT_HELD: Seat % is being booked by someone else right now. Pick another, or try again in a few minutes.', held;
  end if;
  return new;
end $$;
drop trigger if exists bookings_respect_holds on public.bookings;
create trigger bookings_respect_holds before insert or update of seats, schedule_id, travel_date on public.bookings
  for each row execute function public.respect_seat_holds();

-- Once a seat is booked (by the holder, or by office staff overriding), its hold is gone.
create or replace function public.clear_seat_holds() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('confirmed', 'boarded', 'held') then
    delete from public.seat_holds where schedule_id = new.schedule_id and travel_date = new.travel_date and seat = any (new.seats);
  end if;
  return new;
end $$;
drop trigger if exists bookings_clear_holds on public.bookings;
create trigger bookings_clear_holds after insert or update of seats, schedule_id, travel_date, status on public.bookings
  for each row execute function public.clear_seat_holds();


-- =============================================================================
-- ▼ 20261022000000_live_updates.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 22: live updates for staff screens
-- The seat map (booking_seats) and seat holds already publish their changes,
-- which is what keeps every open seat picker in step. This adds bookings, so
-- staff screens also update at once when a payment is recorded, a slip is
-- uploaded or a passenger is boarded on another device. Each person still
-- only receives the rows they are allowed to read. Safe to run again.
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
exception when others then null; -- no realtime publication (local test database)
end $$;


-- =============================================================================
-- ▼ 20261023000000_odometer_log.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 23: daily odometer readings
-- The distance each bus really travels is logged as odometer readings, apart
-- from fuel: the counter staff (asking the conductor) or the conductor enter
-- the reading each day. The distance for a day is the difference from the
-- reading before it. Readings typed with a fuel or service expense still
-- count; the app combines the two.
-- Safe to run again.
-- =============================================================================
create table if not exists public.odometer_logs (
  id uuid primary key default gen_random_uuid(),
  bus_id text not null references public.buses (id) on delete cascade,
  log_date date not null,
  reading_km integer not null check (reading_km > 0),
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists odometer_logs_bus_idx on public.odometer_logs (bus_id, log_date desc, reading_km desc);
alter table public.odometer_logs enable row level security;
-- Staff of every kind (office and conductors) read and add; only office staff correct or remove.
drop policy if exists "staff read odometer" on public.odometer_logs;
create policy "staff read odometer" on public.odometer_logs for select using (public.is_staff());
drop policy if exists "staff add odometer" on public.odometer_logs;
create policy "staff add odometer" on public.odometer_logs for insert with check (public.is_staff());
drop policy if exists "office fix odometer" on public.odometer_logs;
create policy "office fix odometer" on public.odometer_logs for delete using (public.is_office_staff());

-- An odometer only goes up: a reading can't be lower than an earlier day's,
-- or higher than a later day's, and it can't be dated in the future.
create or replace function public.check_odometer() returns trigger
language plpgsql security definer set search_path = public as $$
declare lo int; hi int; today date := (now() at time zone (select timezone from public.app_settings))::date;
begin
  if new.log_date > today then raise exception 'BAD_DATE: That day hasn''t happened yet.'; end if;
  select max(reading_km) into lo from public.odometer_logs where bus_id = new.bus_id and log_date < new.log_date;
  select min(reading_km) into hi from public.odometer_logs where bus_id = new.bus_id and log_date > new.log_date;
  if lo is not null and new.reading_km < lo then
    raise exception 'BAD_READING: The reading can''t be lower than an earlier one (% km). Check the number.', lo;
  end if;
  if hi is not null and new.reading_km > hi then
    raise exception 'BAD_READING: The reading can''t be higher than a later one (% km). Check the number or the date.', hi;
  end if;
  if lo is not null and new.reading_km - lo > 3000 then
    raise exception 'BAD_READING: That is % km more than the last reading. Check the number.', new.reading_km - lo;
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
drop trigger if exists odometer_logs_check on public.odometer_logs;
create trigger odometer_logs_check before insert on public.odometer_logs
  for each row execute function public.check_odometer();


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
drop function if exists public.cash_summary(date, text, uuid); -- (re-run: migration 28 puts it back)
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


-- =============================================================================
-- ▼ seed.sql
-- =============================================================================
-- Starting data: settings, coach ND-2323, Route 48 both ways, timetable.
-- Same as lib/seed.ts (minus the sample bookings). Safe to re-run.

insert into public.app_settings (id, booking_fee, promo_code, promo_percent, max_seats_per_booking, booking_cutoff_minutes)
values (true, 120, 'SIYAN10', 10, 6, 30)
on conflict (id) do nothing;

insert into public.buses (id, name, reg_no, type, rows, back_row_seats, ladies_seats, amenities, status, bike_spaces)
values ('bus-1', 'Siyan Gold', 'ND-2323', 'AC', 10, 5, array['1A','1B'],
        array['Air conditioning','Reclining seats','USB charging','Reading lights'], 'active', 4)
on conflict (id) do nothing;

insert into public.routes (id, stops, active) values
  ('route-48-east', '[{"name": "Colombo", "offsetMin": 0, "fareFromStart": 0, "lat": 6.9338, "lng": 79.8524, "landmark": "Bastian Mawatha bus stand, Pettah (next to the Central Bus Stand)"}, {"name": "Kadawatha", "offsetMin": 30, "fareFromStart": 250, "lat": 7.001, "lng": 79.9534, "landmark": "Kandy Road, opposite Kadawatha interchange"}, {"name": "Nittambuwa", "offsetMin": 60, "fareFromStart": 450, "lat": 7.1446, "lng": 80.0957, "landmark": "Main bus stand, Kandy Road"}, {"name": "Kurunegala", "offsetMin": 125, "fareFromStart": 850, "lat": 7.4863, "lng": 80.3647, "landmark": "Clock tower roundabout, Kurunegala town"}, {"name": "Dambulla", "offsetMin": 205, "fareFromStart": 1300, "lat": 7.8601, "lng": 80.6517, "landmark": "Dambulla bus stand, near the Economic Centre"}, {"name": "Habarana", "offsetMin": 240, "fareFromStart": 1500, "lat": 8.0372, "lng": 80.7485, "landmark": "Habarana junction (Trincomalee / Polonnaruwa roads)"}, {"name": "Polonnaruwa", "offsetMin": 295, "fareFromStart": 1800, "lat": 7.9403, "lng": 81.0188, "landmark": "Kaduruwela bus stand"}, {"name": "Welikanda", "offsetMin": 340, "fareFromStart": 2000, "lat": 7.9606, "lng": 81.2003, "landmark": "Welikanda town, A11 main road"}, {"name": "Valaichchenai", "offsetMin": 395, "fareFromStart": 2200, "lat": 7.9228, "lng": 81.5306, "landmark": "Valaichchenai junction, A15"}, {"name": "Batticaloa", "offsetMin": 440, "fareFromStart": 2400, "lat": 7.7171, "lng": 81.7005, "landmark": "Batticaloa central bus stand"}, {"name": "Kalmunai", "offsetMin": 495, "fareFromStart": 2600, "lat": 7.4136, "lng": 81.8269, "landmark": "Kalmunai bus stand, Main Street"}, {"name": "Akkaraipattu", "offsetMin": 530, "fareFromStart": 2800, "lat": 7.2167, "lng": 81.85, "landmark": "Akkaraipattu bus stand, Main Street"}]'::jsonb, true),
  ('route-48-west', '[{"name": "Akkaraipattu", "offsetMin": 0, "fareFromStart": 0, "lat": 7.2167, "lng": 81.85, "landmark": "Akkaraipattu bus stand, Main Street"}, {"name": "Kalmunai", "offsetMin": 35, "fareFromStart": 200, "lat": 7.4136, "lng": 81.8269, "landmark": "Kalmunai bus stand, Main Street"}, {"name": "Batticaloa", "offsetMin": 90, "fareFromStart": 400, "lat": 7.7171, "lng": 81.7005, "landmark": "Batticaloa central bus stand"}, {"name": "Valaichchenai", "offsetMin": 135, "fareFromStart": 600, "lat": 7.9228, "lng": 81.5306, "landmark": "Valaichchenai junction, A15"}, {"name": "Welikanda", "offsetMin": 190, "fareFromStart": 800, "lat": 7.9606, "lng": 81.2003, "landmark": "Welikanda town, A11 main road"}, {"name": "Polonnaruwa", "offsetMin": 235, "fareFromStart": 1000, "lat": 7.9403, "lng": 81.0188, "landmark": "Kaduruwela bus stand"}, {"name": "Habarana", "offsetMin": 290, "fareFromStart": 1300, "lat": 8.0372, "lng": 80.7485, "landmark": "Habarana junction (Trincomalee / Polonnaruwa roads)"}, {"name": "Dambulla", "offsetMin": 325, "fareFromStart": 1500, "lat": 7.8601, "lng": 80.6517, "landmark": "Dambulla bus stand, near the Economic Centre"}, {"name": "Kurunegala", "offsetMin": 405, "fareFromStart": 1950, "lat": 7.4863, "lng": 80.3647, "landmark": "Clock tower roundabout, Kurunegala town"}, {"name": "Nittambuwa", "offsetMin": 470, "fareFromStart": 2350, "lat": 7.1446, "lng": 80.0957, "landmark": "Main bus stand, Kandy Road"}, {"name": "Kadawatha", "offsetMin": 500, "fareFromStart": 2550, "lat": 7.001, "lng": 79.9534, "landmark": "Kandy Road, opposite Kadawatha interchange"}, {"name": "Colombo", "offsetMin": 530, "fareFromStart": 2800, "lat": 6.9338, "lng": 79.8524, "landmark": "Bastian Mawatha bus stand, Pettah (next to the Central Bus Stand)"}]'::jsonb, true)
on conflict (id) do update set stops = excluded.stops;

-- Out Mon/Wed/Fri 9:00 PM from Colombo; back Tue/Thu/Sat 8:00 PM from Akkaraipattu.
insert into public.schedules (id, route_id, bus_id, departure, days, active) values
  ('sch-cmb-2100', 'route-48-east', 'bus-1', '21:00', array[1,3,5]::smallint[], true),
  ('sch-akp-2000', 'route-48-west', 'bus-1', '20:00', array[2,4,6]::smallint[], true)
on conflict (id) do nothing;

-- =============================================================================
-- Siyan Lanka Travels — migration 33: full GPS log for every trip
-- bus_locations keeps only the latest position (each fix overwrites the last),
-- and bus_location_history keeps only the last 20 points. This adds
-- bus_location_log: EVERY position the conductor's phone sends is kept, never
-- overwritten, so the office can see the exact road a bus took on a trip
-- (Staff area → GPS trip log).
--
-- Nothing changes for conductors or passengers: a trigger on bus_locations
-- copies each new position into the log. A position less than 100 m (straight
-- line) from the last logged one is not added as a new row: that row's
-- last_seen_at is moved on instead, so a parked bus doesn't fill the log but
-- the time it stood there is still known.
--
-- Also adds route_plans: draft versions of a route, made in the route editor.
-- Safe to run again.
-- =============================================================================
create table if not exists public.bus_location_log (
  id bigint generated always as identity primary key,
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  lat double precision not null,
  lng double precision not null,
  speed_kmh numeric,
  heading numeric,
  accuracy_m numeric,
  recorded_at timestamptz not null default now(),
  -- Last time the bus was still within 100 m of this point.
  last_seen_at timestamptz,
  recorded_by uuid
);
alter table public.bus_location_log add column if not exists last_seen_at timestamptz;
create index if not exists bus_location_log_run on public.bus_location_log (schedule_id, travel_date, recorded_at);
create index if not exists bus_location_log_date on public.bus_location_log (travel_date);

alter table public.bus_location_log enable row level security;
-- Office staff and admins can read it. Nobody writes to it directly: only the trigger does.
drop policy if exists "office read gps log" on public.bus_location_log;
create policy "office read gps log" on public.bus_location_log for select using (public.is_office_staff());
revoke insert, update, delete on public.bus_location_log from anon, authenticated;

-- Every insert/update of the live position adds one row to the log.
create or replace function public.keep_location_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare last public.bus_location_log; metres double precision;
begin
  -- An update that didn't bring a new position (same time, same place) adds nothing.
  if tg_op = 'UPDATE' and new.updated_at = old.updated_at and new.lat = old.lat and new.lng = old.lng then
    return new;
  end if;
  select * into last from public.bus_location_log
  where schedule_id = new.schedule_id and travel_date = new.travel_date
  order by recorded_at desc, id desc limit 1;
  if found then
    metres := 2 * 6371000 * asin(sqrt(
      power(sin(radians(new.lat - last.lat) / 2), 2)
      + cos(radians(last.lat)) * cos(radians(new.lat)) * power(sin(radians(new.lng - last.lng) / 2), 2)));
    -- Less than 100 m from the last logged point: don't add a row, just note the bus is still around there.
    if metres < 100 then
      update public.bus_location_log
      set last_seen_at = greatest(coalesce(last_seen_at, recorded_at), new.updated_at)
      where id = last.id;
      return new;
    end if;
  end if;
  insert into public.bus_location_log (schedule_id, travel_date, lat, lng, speed_kmh, heading, accuracy_m, recorded_at, recorded_by)
  values (new.schedule_id, new.travel_date, new.lat, new.lng, new.speed_kmh, new.heading, new.accuracy_m, new.updated_at, new.updated_by);
  return new;
end $$;
drop trigger if exists bus_locations_log on public.bus_locations;
create trigger bus_locations_log after insert or update on public.bus_locations
  for each row execute function public.keep_location_log();

-- The trips that have GPS points on a day, with how many and from when to when.
create or replace function public.gps_log_trips(p_date date)
returns table (schedule_id text, points bigint, first_at timestamptz, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.schedule_id, count(*), min(l.recorded_at), max(l.recorded_at)
  from public.bus_location_log l
  where l.travel_date = p_date and public.is_office_staff()
  group by l.schedule_id;
$$;
revoke execute on function public.gps_log_trips(date) from public, anon;
grant execute on function public.gps_log_trips(date) to authenticated;

-- ------------------------------------------------------------ route plans ---
-- Draft versions of a route (Routes & timetable → Edit route → Save as draft):
-- a copy of the stops to try ideas on, not live until "Save route".
create table if not exists public.route_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Draft',
  route_id text references public.routes (id) on delete cascade,
  stops jsonb not null default '[]',
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Earlier drafts of this update had other columns: bring an existing table into this shape.
alter table public.route_plans add column if not exists route_id text references public.routes (id) on delete cascade;
alter table public.route_plans drop column if exists schedule_id;
alter table public.route_plans drop column if exists travel_date;
alter table public.route_plans drop column if exists detour_speed_kmh;
alter table public.route_plans drop column if exists sample_km;
alter table public.route_plans drop column if exists stop_edits;
alter table public.route_plans drop column if exists bus_factor;
create index if not exists route_plans_route on public.route_plans (route_id, updated_at desc);
alter table public.route_plans enable row level security;
drop policy if exists "office route plans" on public.route_plans;
create policy "office route plans" on public.route_plans for all using (public.is_office_staff()) with check (public.is_office_staff());

-- Admins only: delete GPS points. With p_ids: just those points. Without: the
-- whole trip (that departure on that day). Returns how many were deleted.
create or replace function public.delete_gps_log(p_schedule text, p_date date, p_ids bigint[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Only an admin can delete GPS points.'; end if;
  delete from public.bus_location_log
  where schedule_id = p_schedule and travel_date = p_date and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.delete_gps_log(text, date, bigint[]) from public, anon;
grant execute on function public.delete_gps_log(text, date, bigint[]) to authenticated;


-- =============================================================================
-- Siyan Lanka Travels — migration 34: share a route plan by link
-- In the route editor, "Share" makes a private link (/share/route/<token>)
-- that shows a read-only snapshot of the route as it was when shared: the
-- stops, the road line, the times and a note. Anyone with the link can open
-- it without signing in; nobody can list the links or guess one (the token is
-- 22 random characters). Office staff can turn a link off at any time.
-- Safe to run again.
-- =============================================================================
create table if not exists public.route_shares (
  token text primary key check (length(token) >= 16),
  route_id text references public.routes (id) on delete cascade,
  title text not null default 'Route plan',
  note text not null default '',
  -- Snapshot: [{name, lat, lng, offsetMin, landmark?}]
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) >= 2),
  -- The road line [[lat, lng], …] at the time of sharing (null: the page asks the routing server).
  path jsonb,
  distance_km numeric,
  -- "HH:MM" departure for clock times (optional).
  departure text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists route_shares_route on public.route_shares (route_id, created_at desc);

alter table public.route_shares enable row level security;
-- Office staff and admins make, list and turn off links. The public never reads the table directly.
drop policy if exists "office route shares" on public.route_shares;
create policy "office route shares" on public.route_shares for all using (public.is_office_staff()) with check (public.is_office_staff());
revoke all on public.route_shares from anon;

-- The public page: one link by its token, only while it is switched on.
create or replace function public.get_route_share(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', s.title, 'note', s.note, 'stops', s.stops, 'path', s.path,
    'distance_km', s.distance_km, 'departure', s.departure, 'created_at', s.created_at)
  from public.route_shares s
  where s.token = p_token and s.revoked_at is null;
$$;
revoke execute on function public.get_route_share(text) from public;
grant execute on function public.get_route_share(text) to anon, authenticated;


-- =============================================================================
-- ▼ 20261035000000_security_fixes.sql
-- =============================================================================
-- =============================================================================
-- Siyan Lanka Travels — migration 35: close two money holes
--  1. modify_booking: a passenger could add seats to a PAID booking without
--     paying (total went up, payment stayed "paid"), then drop them again and
--     get a payout for money never received. Seat drops also skipped the
--     refund policy (100% back instead of the cancellation tier).
--     Now passengers can swap seats and move dates, but not change how many
--     seats they have: more seats = a new booking, fewer = cancel and rebook.
--     Office staff can still change the seat count at the counter.
--  2. bookings: every staff account (conductors too) could UPDATE any column
--     directly through the API (total, refund_amount, payment_status…), which
--     creates payouts or hides cash. The app only ever writes `status`
--     directly; everything else goes through functions. Now only `status` is
--     writable, and direct status changes are limited to boarding moves.
--  3. Card & wallet can't be opened while Payments is still on "demo".
--  4. Seat holds only for real seats on a running, bookable departure.
--  5. Passengers sign in with their mobile; their email (optional) is kept on
--     the profile just for e-tickets.
-- Safe to run again.
-- =============================================================================

create or replace function public.modify_booking(p_id uuid, p_seats text[] default null, p_date date default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; bus public.buses;
  v_seats text[]; v_d date; s text; leaves timestamptz; used int; mine int;
  office boolean := public.is_office_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not public.is_staff()) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text <> 'confirmed' then raise exception 'NOT_ALLOWED: This booking can no longer be changed.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  v_seats := coalesce((select array_agg(distinct upper(x)) from unnest(p_seats) x where x <> ''), bk.seats);
  v_d := coalesce(p_date, bk.travel_date);
  if cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Keep at least one seat.'; end if;
  -- NEW: only office staff may change the number of seats on a booking.
  if cardinality(v_seats) <> cardinality(bk.seats) and not office then
    raise exception 'SEAT_COUNT: To add seats, make a new booking. To drop a seat, cancel this booking and book again.';
  end if;
  -- schedule_runs_on also understands alternate-day timetables (migration 10).
  if not public.schedule_runs_on(sch, v_d) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;
  leaves := ((v_d + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then raise exception 'CLOSED: Too close to departure to change this booking.'; end if;
  if cardinality(v_seats) > cfg.max_seats_per_booking and not office then raise exception 'TOO_MANY: Up to % seats per booking.', cfg.max_seats_per_booking; end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and bk.passenger_gender <> 'Female' and not (s = any (bk.seats)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;
  if v_d <> bk.travel_date then
    select count(*) into mine from public.booking_bikes where booking_id = bk.id;
    if mine > 0 then
      perform pg_advisory_xact_lock(hashtext(sch.id || v_d::text));
      used := public.bike_spaces_used(sch.id, v_d);
      if used + (select coalesce(sum((cfg.bikes -> 'kinds' -> kind::text ->> 'spaces')::int), 0) from public.booking_bikes where booking_id = bk.id) > bus.bike_spaces then
        raise exception 'BIKES_FULL: No room for your bike on that date.';
      end if;
    end if;
  end if;
  update public.bookings
     set seats = v_seats, travel_date = v_d,
         total = bk.fare * cardinality(v_seats) - bk.discount + bk.bike_fee + bk.fee
   where id = p_id returning * into bk;
  return bk;
end $$;
revoke execute on function public.modify_booking(uuid, text[], date) from public, anon;
grant execute on function public.modify_booking(uuid, text[], date) to authenticated;

-- 2a. Direct writes to bookings: the status column only.
revoke update on public.bookings from anon, authenticated;
grant update (status) on public.bookings to authenticated;

-- 2b. …and only the boarding moves the conductor screen makes. Cancelling
-- goes through cancel_booking(); payments through confirm_payment() etc.
-- Functions run as their owner, so this only applies to direct API writes.
create or replace function public.limit_direct_booking_updates() returns trigger
language plpgsql as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if new.status is distinct from old.status and not (
       (old.status::text in ('confirmed', 'held') and new.status::text in ('boarded', 'no-show'))
    or (old.status::text in ('boarded', 'no-show') and new.status::text = case when old.payment_status = 'paid' then 'confirmed' else 'held' end)
  ) then
    raise exception 'NOT_ALLOWED: That change has to be made from the booking screen.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_limit_direct_updates on public.bookings;
create trigger bookings_limit_direct_updates before update on public.bookings
  for each row execute function public.limit_direct_booking_updates();

-- 3. Card & wallet can only be opened once PayHere is live. On "demo" a card
-- booking is confirmed with no money taken, so opening card payments then
-- would give tickets away. (Only checked for changes made from the app.)
create or replace function public.check_payment_settings() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') and new.card_payments and new.payments_mode <> 'payhere'
     and (new.card_payments is distinct from old.card_payments or new.payments_mode is distinct from old.payments_mode) then
    raise exception 'PAYHERE_FIRST: Switch Payments to PayHere before opening card and wallet payments. On demo, card bookings are confirmed without any money taken.';
  end if;
  return new;
end $$;
drop trigger if exists app_settings_check_payments on public.app_settings;
create trigger app_settings_check_payments before update on public.app_settings
  for each row execute function public.check_payment_settings();

-- 4. Seat holds: only real seats on a departure that is open for booking,
-- so nobody can block seats on a bus that isn't running or doesn't exist.
create or replace function public.hold_seats(p_schedule text, p_date date, p_seats text[]) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz := now() + interval '10 minutes'; v_seats text[]; taken text; s text;
  cfg public.app_settings; sch public.schedules; rt public.routes; bus public.buses; leaves timestamptz;
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  delete from public.seat_holds where expires_at < now() or user_id = auth.uid();
  select array_agg(distinct upper(x)) into v_seats from unnest(coalesce(p_seats, '{}')) x where x <> '';
  if v_seats is null then return null; end if; -- nothing selected: holds released
  select * into cfg from public.app_settings;
  if cardinality(v_seats) > greatest(cfg.max_seats_per_booking, 1) and not public.is_office_staff() then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  select * into sch from public.schedules where id = p_schedule and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  if not public.schedule_runs_on(sch, p_date) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;
  leaves := ((p_date + sch.departure::time) + make_interval(mins => (rt.stops -> 0 ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves + interval '1 day' then raise exception 'CLOSED: This bus has already left.'; end if;
  if not public.is_staff() and coalesce(cfg.booking_window_days, 0) > 0
     and p_date > (now() at time zone cfg.timezone)::date + cfg.booking_window_days then
    raise exception 'TOO_EARLY: Booking opens % days before travel.', cfg.booking_window_days;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
  end loop;
  select bs.seat into taken from public.booking_seats bs where bs.schedule_id = p_schedule and bs.travel_date = p_date and bs.active and bs.seat = any (v_seats) limit 1;
  if found then raise exception 'SEAT_TAKEN: Seat % was just booked by someone else. Please pick another.', taken; end if;
  begin
    insert into public.seat_holds (schedule_id, travel_date, seat, user_id, expires_at)
    select p_schedule, p_date, x, auth.uid(), v_until from unnest(v_seats) x;
  exception when unique_violation then
    raise exception 'SEAT_HELD: One of those seats is being booked by someone else right now. Pick another, or try again in a few minutes.';
  end;
  return v_until;
end $$;
revoke execute on function public.hold_seats(text, date, text[]) from public, anon;
grant execute on function public.hold_seats(text, date, text[]) to authenticated;

-- 5. Passengers sign in with their mobile number. An email address is
-- optional and only used to send the e-ticket, so it lives on the profile
-- (not as a second way to sign in). Staff keep signing in with email.
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (email = '' or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
grant update (email) on public.profiles to authenticated;
-- Existing accounts: copy the address they signed up with.
update public.profiles p set email = lower(u.email)
from auth.users u where u.id = p.id and p.email = '' and coalesce(u.email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(nullif(new.email, ''), new.raw_user_meta_data ->> 'email', '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then v_email := ''; end if;
  insert into public.profiles (id, full_name, phone, email)
  values (new.id, left(new.raw_user_meta_data ->> 'full_name', 120), coalesce(nullif(new.phone, ''), new.raw_user_meta_data ->> 'phone'), v_email)
  on conflict (id) do nothing;
  return new;
end $$;

drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, created_at timestamptz, last_sign_in_at timestamptz, branch_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  return query
    select p.id, coalesce(nullif(u.email::text, ''), p.email), p.full_name, coalesce(nullif(p.phone, ''), u.phone::text), p.role::text, p.created_at, u.last_sign_in_at, p.branch_id
    from public.profiles p join auth.users u on u.id = p.id
    order by p.role::text desc, p.created_at desc;
end $$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;



-- Tell the API about the new functions and columns straight away (otherwise the app can take a while to see them).
notify pgrst, 'reload schema';

-- 20261036000000_conductor_tools.sql
-- Tools for the conductor app:
--   1. Road reports: conductors mark police, checkpoints, accidents, roadworks…
--      on the map; every conductor (and the office) sees them until they expire.
--   2. Conductors can read the office's route drafts (Routes & timetable).
--   3. Optional stops: a stop on a route can be "on request", served only when
--      at least N seats are booked to or from it. At the cut-off (hours before
--      the bus leaves its first stop) the trip is settled: the detour runs, or
--      the passengers who booked it are moved to the nearest main stop and told.
--   4. A stop can be "hidden" ({"hidden": true}): it only shapes the road and
--      can't be booked to or from.
-- Safe to run more than once.

-- ------------------------------------------------------------ road reports ---
create table if not exists public.road_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('police', 'checkpoint', 'accident', 'roadworks', 'flood', 'breakdown', 'other')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  note text not null default '' check (length(note) <= 200),
  reported_by uuid references public.profiles (id) on delete set null,
  reporter_name text not null default '',
  schedule_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  confirmations integer not null default 0,
  cleared_at timestamptz,
  cleared_by uuid references public.profiles (id) on delete set null
);
create index if not exists road_reports_live on public.road_reports (expires_at) where cleared_at is null;
alter table public.road_reports enable row level security;
drop policy if exists "staff read road reports" on public.road_reports;
create policy "staff read road reports" on public.road_reports for select using (public.is_staff());
-- Written only through the functions below.
revoke insert, update, delete on public.road_reports from anon, authenticated;

-- One vote per person per report: still there / gone.
create table if not exists public.road_report_votes (
  report_id uuid not null references public.road_reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  still_there boolean not null,
  voted_at timestamptz not null default now(),
  primary key (report_id, user_id)
);
alter table public.road_report_votes enable row level security;
drop policy if exists "staff read road votes" on public.road_report_votes;
create policy "staff read road votes" on public.road_report_votes for select using (public.is_staff());
revoke insert, update, delete on public.road_report_votes from anon, authenticated;

create or replace function public.report_road(p_kind text, p_lat double precision, p_lng double precision, p_note text default '', p_schedule text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'STAFF_ONLY: Staff only.'; end if;
  if (select count(*) from public.road_reports where reported_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'TOO_MANY: You have sent a lot of reports in the last hour. Try again later.';
  end if;
  -- The same thing reported again close by (300 m, same kind) counts as a confirmation.
  select id into v_id from public.road_reports
   where cleared_at is null and expires_at > now() and kind = p_kind
     and abs(lat - p_lat) < 0.003 and abs(lng - p_lng) < 0.003
   order by created_at desc limit 1;
  if v_id is not null then
    perform public.vote_road_report(v_id, true);
    return v_id;
  end if;
  select coalesce(nullif(full_name, ''), 'Conductor') into v_name from public.profiles where id = auth.uid();
  insert into public.road_reports (kind, lat, lng, note, reported_by, reporter_name, schedule_id)
  values (p_kind, p_lat, p_lng, left(trim(coalesce(p_note, '')), 200), auth.uid(), coalesce(v_name, ''), p_schedule)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.report_road(text, double precision, double precision, text, text) from public, anon;
grant execute on function public.report_road(text, double precision, double precision, text, text) to authenticated;

-- "Still there" keeps a report alive for another hour; "Gone" from the person who
-- reported it, from office staff, or from two other people clears it.
create or replace function public.vote_road_report(p_id uuid, p_still_there boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.road_reports; gone int;
begin
  if not public.is_staff() then raise exception 'STAFF_ONLY: Staff only.'; end if;
  select * into r from public.road_reports where id = p_id for update;
  if not found or r.cleared_at is not null then return; end if;
  insert into public.road_report_votes (report_id, user_id, still_there) values (p_id, auth.uid(), p_still_there)
  on conflict (report_id, user_id) do update set still_there = excluded.still_there, voted_at = now();
  if p_still_there then
    update public.road_reports
       set confirmations = (select count(*) from public.road_report_votes where report_id = p_id and still_there),
           expires_at = greatest(expires_at, now() + interval '1 hour')
     where id = p_id;
  else
    select count(*) into gone from public.road_report_votes where report_id = p_id and not still_there;
    if r.reported_by = auth.uid() or public.is_office_staff() or gone >= 2 then
      update public.road_reports set cleared_at = now(), cleared_by = auth.uid() where id = p_id;
    end if;
  end if;
end $$;
revoke execute on function public.vote_road_report(uuid, boolean) from public, anon;
grant execute on function public.vote_road_report(uuid, boolean) to authenticated;

-- --------------------------------------------- route drafts for conductors ---
do $$ begin
  if to_regclass('public.route_plans') is not null then
    execute 'drop policy if exists "staff read route plans" on public.route_plans';
    execute 'create policy "staff read route plans" on public.route_plans for select using (public.is_staff())';
  end if;
end $$;

-- ---------------------------------------------------------- optional stops ---
-- In routes.stops: {"name": "...", "optional": true, "minSeats": 4} marks a stop "on request".
alter table public.app_settings add column if not exists optional_stop_cutoff_hours integer not null default 3
  check (optional_stop_cutoff_hours between 0 and 72);

create table if not exists public.optional_stop_decisions (
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  stop text not null,
  runs boolean not null,
  seats integer not null,
  min_seats integer not null,
  moved_to text,
  decided_at timestamptz not null default now(),
  primary key (schedule_id, travel_date, stop)
);
alter table public.optional_stop_decisions enable row level security;
drop policy if exists "read stop decisions" on public.optional_stop_decisions;
create policy "read stop decisions" on public.optional_stop_decisions for select using (true);
revoke insert, update, delete on public.optional_stop_decisions from anon, authenticated;

create or replace function public.stop_is_optional(p_stop jsonb) returns boolean
language sql immutable as $$ select coalesce((p_stop ->> 'optional')::boolean, false) $$;

-- When the run is settled: the first stop's departure minus the cut-off.
create or replace function public.optional_cutoff(p_schedule text, p_date date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ((p_date + s.departure::time) at time zone cfg.timezone) - make_interval(hours => cfg.optional_stop_cutoff_hours)
  from public.schedules s, public.app_settings cfg where s.id = p_schedule;
$$;

-- Seats booked to or from each optional stop of one departure, and what was decided.
create or replace function public.optional_stop_status(p_schedule text, p_date date)
returns table (stop text, min_seats integer, seats integer, decided boolean, runs boolean, moved_to text, cutoff timestamptz)
language sql stable security definer set search_path = public as $$
  select st ->> 'name',
         greatest(coalesce((st ->> 'minSeats')::int, 1), 1),
         coalesce((select sum(cardinality(b.seats))::int from public.bookings b
                    where b.schedule_id = p_schedule and b.travel_date = p_date
                      and b.status::text in ('confirmed', 'held', 'boarded')
                      and (lower(b.from_stop) = lower(st ->> 'name') or lower(b.to_stop) = lower(st ->> 'name'))), 0),
         d.stop is not null, coalesce(d.runs, false), d.moved_to,
         public.optional_cutoff(p_schedule, p_date)
  from public.schedules s
  join public.routes r on r.id = s.route_id
  cross join lateral jsonb_array_elements(r.stops) st
  left join public.optional_stop_decisions d on d.schedule_id = p_schedule and d.travel_date = p_date and d.stop = st ->> 'name'
  where s.id = p_schedule and public.stop_is_optional(st);
$$;
grant execute on function public.optional_stop_status(text, date) to anon, authenticated;

-- The nearest main (not optional) stop to stop number p_idx, looking only at
-- stops with an index in [p_lo, p_hi]. Nearest = closest in time on the route.
create or replace function public.nearest_main_stop(p_stops jsonb, p_idx int, p_lo int, p_hi int) returns text
language sql immutable as $$
  select e.stop ->> 'name'
  from jsonb_array_elements(p_stops) with ordinality as e(stop, ord)
  where not public.stop_is_optional(e.stop) and not coalesce((e.stop ->> 'hidden')::boolean, false) and (ord - 1) between p_lo and p_hi
  order by abs(((e.stop ->> 'offsetMin')::int) - ((p_stops -> p_idx ->> 'offsetMin')::int)), ord
  limit 1;
$$;

-- Settle every departure whose cut-off has passed. Run by the message dispatcher.
create or replace function public.settle_optional_stops() returns integer
language plpgsql security definer set search_path = public as $$
declare run record; st record; b record; n int := 0; v_from int; v_to int; v_last int; v_new_from text; v_new_to text; v_moved text;
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
    for st in select * from public.optional_stop_status(run.schedule_id, run.travel_date) where not decided loop
      if st.seats >= st.min_seats then
        insert into public.optional_stop_decisions (schedule_id, travel_date, stop, runs, seats, min_seats)
        values (run.schedule_id, run.travel_date, st.stop, true, st.seats, st.min_seats) on conflict do nothing;
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
          if lower(b.from_stop) = lower(st.stop) then v_new_from := public.nearest_main_stop(run.stops, v_from, 0, v_to - 1); end if;
          if lower(b.to_stop) = lower(st.stop) then v_new_to := public.nearest_main_stop(run.stops, v_to, coalesce(public.stop_index(run.stops, v_new_from), v_from) + 1, v_last); end if;
          if v_new_from is null or v_new_to is null then continue; end if;  -- nowhere sensible: leave it for the office
          update public.bookings set from_stop = v_new_from, to_stop = v_new_to where id = b.id;
          v_moved := case when lower(b.from_stop) = lower(st.stop) then v_new_from else v_new_to end;
          if b.user_id is not null then
            insert into public.notifications (user_id, title, body, url, tag)
            values (b.user_id, 'Your stop has changed',
                    'Not enough passengers booked ' || st.stop || ', so the bus is not going there on this trip. '
                      || case when lower(b.from_stop) = lower(st.stop) then 'Please board at ' || v_new_from else 'You will get off at ' || v_new_to end
                      || ' instead. Your seat stays the same.',
                    '/my-bookings?ref=' || b.ref, 'optional-' || b.id || '-' || st.stop);
          end if;
          perform public.enqueue_message(coalesce(nullif(b.contact_phone, ''), b.passenger_phone),
            'Siyan Lanka ' || b.ref || ': not enough passengers booked ' || st.stop || ', so the bus is not going there on '
              || to_char(run.travel_date, 'DD Mon') || '. '
              || case when lower(b.from_stop) = lower(st.stop) then 'Please board at ' || v_new_from else 'You will get off at ' || v_new_to end
              || ' instead. Same seat, same ticket.',
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

-- After the cut-off, an optional stop can only be booked if its detour is running.
create or replace function public.check_optional_stop_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stops jsonb; v_stop text;
begin
  if tg_op = 'UPDATE' and new.from_stop = old.from_stop and new.to_stop = old.to_stop then return new; end if;
  if new.status::text not in ('confirmed', 'held', 'boarded') then return new; end if;
  select r.stops into v_stops from public.schedules s join public.routes r on r.id = s.route_id where s.id = new.schedule_id;
  foreach v_stop in array array[new.from_stop, new.to_stop] loop
    -- A hidden point only shapes the road: nobody gets on or off there.
    if coalesce((v_stops -> public.stop_index(v_stops, v_stop) ->> 'hidden')::boolean, false) then
      raise exception 'STOP_HIDDEN: % is not a stop on this route. Choose another stop.', v_stop;
    end if;
    if public.stop_is_optional(v_stops -> public.stop_index(v_stops, v_stop))
       and public.optional_cutoff(new.schedule_id, new.travel_date) <= now()
       and not exists (select 1 from public.optional_stop_decisions d
                        where d.schedule_id = new.schedule_id and d.travel_date = new.travel_date and lower(d.stop) = lower(v_stop) and d.runs) then
      raise exception 'STOP_NOT_RUNNING: The bus is not going to % on this trip (not enough passengers booked it). Choose another stop.', v_stop;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists check_optional_stop_booking on public.bookings;
create trigger check_optional_stop_booking before insert or update of from_stop, to_stop on public.bookings
  for each row execute function public.check_optional_stop_booking();

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261037000000_bus_photos.sql
-- =============================================================================
-- =============================================================================
-- 20261037000000_bus_photos.sql
-- Bus photos.
-- Each bus can have a few photos (the first is the cover). They're public,
-- like stop photos, so passengers can see the bus they're booking.
-- =============================================================================

alter table public.buses add column if not exists photos text[] not null default '{}';

insert into storage.buckets (id, name, public) values ('bus-photos', 'bus-photos', true) on conflict (id) do nothing;
drop policy if exists "office upload bus photos" on storage.objects;
create policy "office upload bus photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'bus-photos' and public.is_office_staff());
drop policy if exists "office delete bus photos" on storage.objects;
create policy "office delete bus photos" on storage.objects for delete to authenticated
  using (bucket_id = 'bus-photos' and public.is_office_staff());
drop policy if exists "read bus photos" on storage.objects;
create policy "read bus photos" on storage.objects for select using (bucket_id = 'bus-photos');

-- Starting cover for Siyan Gold (the photo ships with the website). Only fills
-- an empty gallery, so photos added in the staff area are never replaced.
update public.buses set photos = array['/buses/siyan-gold.jpg']
 where photos = '{}' and regexp_replace(reg_no, '[^0-9]', '', 'g') = '2323';

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261038000000_archive_routes.sql
-- =============================================================================
-- =============================================================================
-- 20261038000000_archive_routes.sql
-- Deleting a departure or route that old tickets point to.
-- Tickets must keep their departure (for history, reports and refunds), so
-- such a departure can't really be deleted. "Delete" now archives it instead:
-- it's closed for booking and hidden from every list, and the old tickets
-- still work. A route whose departures are all archived is archived the same way.
-- =============================================================================

alter table public.routes add column if not exists archived boolean not null default false;
alter table public.schedules add column if not exists archived boolean not null default false;

-- An archived departure or route never takes bookings again.
create or replace function public.archived_stays_closed() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.archived then new.active := false; end if;
  return new;
end $$;
drop trigger if exists archived_stays_closed on public.routes;
create trigger archived_stays_closed before insert or update on public.routes
  for each row execute function public.archived_stays_closed();
drop trigger if exists archived_stays_closed on public.schedules;
create trigger archived_stays_closed before insert or update on public.schedules
  for each row execute function public.archived_stays_closed();

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261039000000_route_names.sql
-- =============================================================================
-- =============================================================================
-- 20261039000000_route_names.sql
-- Routes can have a name staff choose ("Akkaraipattu to Colombo"). Empty means
-- the app shows "first stop → last stop", as before.
-- =============================================================================

alter table public.routes add column if not exists name text check (name is null or length(name) <= 60);

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261040000000_route_timing.sql
-- =============================================================================
-- =============================================================================
-- 20261040000000_route_timing.sql
-- The route editor's timing settings are kept with each route: bus time =
-- car time × bus_factor, plus stop_min minutes at every stop (hidden shaping
-- points add none). Empty = the editor's defaults (1.1 and 2 minutes).
-- =============================================================================

alter table public.routes add column if not exists bus_factor numeric(3,2) check (bus_factor is null or bus_factor between 0.5 and 3);
alter table public.routes add column if not exists stop_min integer check (stop_min is null or stop_min between 0 and 30);

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261041000000_route_variants.sql
-- =============================================================================
-- =============================================================================
-- 20261041000000_route_variants.sql
-- Route variants: other ways the bus goes, drawn by staff, for when some
-- on-request stops don't fill. Each variant has every main stop plus the
-- on-request stops it covers; a trip uses the one that matches the on-request
-- stops running. (Replaces the automatic stop re-ordering tried earlier.)
-- =============================================================================

alter table public.routes add column if not exists variants jsonb not null default '[]'::jsonb
  check (jsonb_typeof(variants) = 'array');

drop function if exists public.trip_stop_pairs(text, date);

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261042000000_tonight_way.sql
-- =============================================================================
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


-- =============================================================================
-- ▼ 20261043000000_refunds_and_test_passengers.sql
-- =============================================================================
-- =============================================================================
-- 20261043000000_refunds_and_test_passengers.sql
--   1. Refunds: cancelling 4 hours or more before the bus leaves the
--      passenger's stop → 90% of the fare back (10% service charge for
--      admin and payment processing); less than 4 hours, or not turning up →
--      nothing (the booking is forfeited). Changeable in Staff area → Settings.
--   2. Test passengers: bookings made from Staff area → Test passengers (to try
--      the conductor app) are marked, so they can be listed and deleted
--      together and left out of reports.
-- =============================================================================

alter table public.app_settings alter column refund_policy set default '[{"hoursBefore":4,"percent":90},{"hoursBefore":0,"percent":0}]';
update public.app_settings set refund_policy = '[{"hoursBefore":4,"percent":90},{"hoursBefore":0,"percent":0}]';

alter table public.bookings add column if not exists is_test boolean not null default false;
create index if not exists bookings_test_idx on public.bookings (schedule_id, travel_date) where is_test;

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261044000000_conductor_change_stops.sql
-- =============================================================================
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


-- =============================================================================
-- ▼ 20261045000000_payments_fees_promo.sql
-- =============================================================================
-- =============================================================================
-- 20261045000000_payments_fees_promo.sql
-- What a passenger pays, and who gets what:
--   ticket fare (e.g. LKR 3,000)
--   + card fee: the payment gateway's cut, a percent of what goes through it
--     (card / wallet only; none for bank transfer)            → gateway_fee
--   + platform fee per booking (Settings, e.g. LKR 120)       → fee
--   = total, all collected from the passenger.
-- Online bookings are paid: by the gateway (the seat is held until it says
-- paid) or by bank transfer (held until the office checks the slip). Paying on
-- the bus or at the counter is no longer offered online; staff sales are as before.
-- The promo code (Settings: code and percent) can be limited to a passenger's
-- first trip, and to bookings made in the installed app. "In the app" is what
-- the app reports (a browser can't prove it was installed), so treat it as a
-- nudge to install, with the first-trip rule as the real limit.
-- money_breakdown(): per month, fares / gateway fees / platform fees, so the
-- platform fees for a month can be paid out.
-- =============================================================================

alter table public.app_settings
  add column if not exists gateway_fee_percent numeric(5,2) not null default 3.00 check (gateway_fee_percent between 0 and 20),
  add column if not exists promo_first_order boolean not null default true,
  add column if not exists promo_app_only boolean not null default true;
alter table public.app_settings alter column booking_fee set default 120;
update public.app_settings set booking_fee = 120 where booking_fee = 50;   -- the old default
update public.app_settings set promo_code = 'SIYAN10', promo_percent = 10 where coalesce(promo_code, '') = '';
alter table public.app_settings alter column pay_on_bus set default false;
update public.app_settings set pay_on_bus = false;

alter table public.bookings add column if not exists gateway_fee integer not null default 0 check (gateway_fee >= 0);

create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  v_gw int := 0; earlier int;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;
  -- Online, a seat is only sold when it is paid: through the payment gateway, or by bank transfer (slip checked by the office).
  if chan = 'online' and pay not in ('card', 'wallet', 'bank') then
    raise exception 'PAYMENT_UNAVAILABLE: Pay online by card or by bank transfer.';
  end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and gender <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;

  -- One price for the whole route (the default): the full-route fare wherever
  -- the passenger gets on or off. Otherwise the difference between the stops.
  v_fare := case when rt.flat_fare then (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int
                 else (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int end;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and coalesce(p ->> 'promo', '') <> '' then
    if cfg.promo_code is null or upper(trim(p ->> 'promo')) <> upper(cfg.promo_code) or cfg.promo_percent <= 0 then
      raise exception 'PROMO: That promo code isn''t valid.';
    end if;
    -- First trip only: no earlier booking that went ahead (cancelled ones don't count).
    if cfg.promo_first_order then
      select count(*) into earlier from public.bookings where user_id = uid and status::text <> 'cancelled';
      if earlier > 0 then raise exception 'PROMO: This code is for your first trip only.'; end if;
    end if;
    -- Booked in the installed app (the app tells us; see the note in the migration).
    if cfg.promo_app_only and not coalesce((p ->> 'in_app')::boolean, false) then
      raise exception 'PROMO: This code works when you book in the Siyan Lanka app. Install it, then book from there.';
    end if;
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') or not coalesce((kinds -> (bike ->> 'kind') ->> 'active')::boolean, true) then
        raise exception 'BAD_BIKE: That kind of bike isn''t carried. Choose another.';
      end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if coalesce((kinds -> (bike ->> 'kind') ->> 'needsPlate')::boolean, bike ->> 'kind' <> 'bicycle') and length(coalesce(bike ->> 'reg_no', '')) < 4 then
        raise exception 'BAD_BIKE: Add the number plate.';
      end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  -- Card / wallet: everything goes through the gateway, which takes its cut, so a held seat waits for it.
  if chan = 'online' and pay in ('card', 'wallet') and base - disc + bike_total + v_fee > 0 then
    v_gw := ceil((base - disc + bike_total + v_fee) * cfg.gateway_fee_percent / 100.0);
    v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; v_gw := 0; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, gateway_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, v_gw, base - disc + bike_total + v_fee + v_gw,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, b ->> 'kind', left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

-- Changing seats or date, or stops, keeps the card fee in the total.
create or replace function public.modify_booking(p_id uuid, p_seats text[] default null, p_date date default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; bus public.buses;
  v_seats text[]; v_d date; s text; leaves timestamptz; used int; mine int;
  office boolean := public.is_office_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not public.is_staff()) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text <> 'confirmed' then raise exception 'NOT_ALLOWED: This booking can no longer be changed.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  v_seats := coalesce((select array_agg(distinct upper(x)) from unnest(p_seats) x where x <> ''), bk.seats);
  v_d := coalesce(p_date, bk.travel_date);
  if cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Keep at least one seat.'; end if;
  -- NEW: only office staff may change the number of seats on a booking.
  if cardinality(v_seats) <> cardinality(bk.seats) and not office then
    raise exception 'SEAT_COUNT: To add seats, make a new booking. To drop a seat, cancel this booking and book again.';
  end if;
  -- schedule_runs_on also understands alternate-day timetables (migration 10).
  if not public.schedule_runs_on(sch, v_d) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;
  leaves := ((v_d + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then raise exception 'CLOSED: Too close to departure to change this booking.'; end if;
  if cardinality(v_seats) > cfg.max_seats_per_booking and not office then raise exception 'TOO_MANY: Up to % seats per booking.', cfg.max_seats_per_booking; end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and bk.passenger_gender <> 'Female' and not (s = any (bk.seats)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;
  if v_d <> bk.travel_date then
    select count(*) into mine from public.booking_bikes where booking_id = bk.id;
    if mine > 0 then
      perform pg_advisory_xact_lock(hashtext(sch.id || v_d::text));
      used := public.bike_spaces_used(sch.id, v_d);
      if used + (select coalesce(sum((cfg.bikes -> 'kinds' -> kind::text ->> 'spaces')::int), 0) from public.booking_bikes where booking_id = bk.id) > bus.bike_spaces then
        raise exception 'BIKES_FULL: No room for your bike on that date.';
      end if;
    end if;
  end if;
  update public.bookings
     set seats = v_seats, travel_date = v_d,
         total = bk.fare * cardinality(v_seats) - bk.discount + bk.bike_fee + bk.fee + bk.gateway_fee
   where id = p_id returning * into bk;
  return bk;
end $$;


-- A refund is a share of the ticket: the platform fee and the gateway's cut aren't refunded.
create or replace function public.cancel_booking(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes;
  leaves timestamptz; hrs numeric; pct int := 0; tier jsonb; staff boolean := public.is_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not staff) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text not in ('confirmed', 'held') then raise exception 'NOT_ALLOWED: Only confirmed bookings can be cancelled.'; end if;
  if bk.payment_status = 'unpaid' then
    update public.bookings set status = 'cancelled', refund_amount = 0, refunded_at = now() where id = p_id returning * into bk;
    return bk;
  end if;
  if staff and bk.user_id is distinct from auth.uid() then
    pct := 100;
  else
    select * into sch from public.schedules where id = bk.schedule_id;
    select * into rt from public.routes where id = sch.route_id;
    leaves := ((bk.travel_date + sch.departure::time)
      + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
    hrs := extract(epoch from (leaves - now())) / 3600;
    for tier in select * from jsonb_array_elements(cfg.refund_policy) loop
      if hrs >= (tier ->> 'hoursBefore')::numeric then pct := (tier ->> 'percent')::int; exit; end if;
    end loop;
  end if;
  update public.bookings set status = 'cancelled', refund_amount = round((total - fee - gateway_fee) * pct / 100.0), refunded_at = now(),
         payment_status = case when pct > 0 then 'refunded' else payment_status end
  where id = p_id returning * into bk;
  return bk;
end $$;

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
    -- (a card payment's fee follows the new amount)
    update public.bookings
       set fare = new_fare,
           gateway_fee = case when payment_method in ('card', 'wallet')
                              then ceil(greatest(0, new_fare * cardinality(seats) - discount + bike_fee + fee) * (select gateway_fee_percent from public.app_settings) / 100.0)
                              else 0 end
     where id = bk.id;
    update public.bookings set total = greatest(0, fare * cardinality(seats) - discount + bike_fee + fee + gateway_fee) where id = bk.id;
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

-- Per month (by the day the money came in): what passengers paid and how it splits.
-- Refunds are taken off the ticket part (the fees aren't refunded).
create or replace function public.money_breakdown(p_from date, p_to date)
returns table (month date, bookings bigint, seats bigint, tickets bigint, gateway_fees bigint, platform_fees bigint, refunds bigint, collected bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('month', (b.paid_at at time zone (select timezone from public.app_settings)))::date as month,
         count(*), coalesce(sum(cardinality(b.seats)), 0),
         coalesce(sum(b.total - b.fee - b.gateway_fee), 0),
         coalesce(sum(b.gateway_fee), 0),
         coalesce(sum(b.fee), 0),
         coalesce(sum(coalesce(b.refund_amount, 0)) filter (where b.payment_status = 'refunded'), 0),
         coalesce(sum(b.total), 0)
  from public.bookings b
  where public.is_admin()
    and b.paid_at is not null and b.payment_status in ('paid', 'refunded') and coalesce(b.is_test, false) = false
    and (b.paid_at at time zone (select timezone from public.app_settings))::date between p_from and p_to
  group by 1 order by 1 desc;
$$;
revoke execute on function public.money_breakdown(date, date) from public, anon;
grant execute on function public.money_breakdown(date, date) to authenticated;

notify pgrst, 'reload schema';


-- =============================================================================
-- ▼ 20261046000000_bank_details.sql
-- =============================================================================
-- =============================================================================
-- 20261046000000_bank_details.sql
-- The account passengers pay into by bank transfer (shown at checkout, in My
-- trips and in the "seat held" text). Only filled in where none was set, or the
-- old placeholder account is still there; change it any time in
-- Staff area → Settings → Payments → Bank details.
-- =============================================================================
alter table public.app_settings alter column bank_details set default 'Bank of Ceylon (BOC) · A/C 95572680 · Siyan Lanka';
update public.app_settings
   set bank_details = 'Bank of Ceylon (BOC) · A/C 95572680 · Siyan Lanka'
 where coalesce(trim(bank_details), '') = '' or bank_details like '%0077411020%';


-- =============================================================================
-- ▼ 20261047000000_seat_genders.sql
-- =============================================================================
-- =============================================================================
-- 20261047000000_seat_genders.sql
-- Who sits in each seat, instead of one gender for the whole booking.
--  * bookings.seat_genders: {"3A": "Female", "3B": ""} ('' = not given).
--  * A seat beside someone else's seat must say male or female (online); seats
--    side by side in the same booking (travelling together) may leave it out.
--  * Women-only seats (bus.ladies_seats) need that seat to be a woman's, not
--    the whole booking's lead passenger.
--  * "Beside a woman travelling alone" is per seat now: a woman's seat whose
--    neighbour isn't in her own booking is protected, even when her booking
--    has other seats elsewhere on the bus.
--  * The public seat map (booking_seats) shows each seat's own gender and
--    whether it sits alone.
-- Old bookings (no seat_genders) keep using the passenger's gender.
-- =============================================================================

alter table public.bookings add column if not exists seat_genders jsonb not null default '{}';

-- The gender for one seat of a booking.
create or replace function public.seat_gender(p_bk public.bookings, p_seat text) returns text
language sql immutable as $$
  select case when p_bk.seat_genders ? p_seat then coalesce(p_bk.seat_genders ->> p_seat, '') else coalesce(p_bk.passenger_gender, '') end;
$$;

-- Does a seat of this booking sit alone (no neighbour in the same booking)?
create or replace function public.seat_alone(p_bk public.bookings, p_bus public.buses, p_seat text) returns boolean
language sql stable as $$
  select not exists (select 1 from unnest(public.seat_neighbours(p_bus, p_seat)) nb where nb = any (p_bk.seats));
$$;

create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
declare bus public.buses;
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status::text in ('confirmed', 'boarded', 'held') then
    select b.* into bus from public.schedules sc join public.buses b on b.id = sc.bus_id where sc.id = new.schedule_id;
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender, solo)
    select new.id, new.schedule_id, new.travel_date, s, public.seat_gender(new, s),
           case when bus.id is null then cardinality(new.seats) = 1 else public.seat_alone(new, bus, s) end
    from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;

create or replace function public.enforce_seat_beside_woman() returns trigger
language plpgsql security definer set search_path = public as $$
declare bus public.buses; s text; nb text; other public.bookings;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if not (select ladies_adjacent from public.app_settings) then return new; end if;
  if auth.uid() is null or public.is_office_staff() then return new; end if; -- gateway / office override
  select b.* into bus from public.schedules sc join public.buses b on b.id = sc.bus_id where sc.id = new.schedule_id;
  if not found then return new; end if;
  foreach s in array new.seats loop
    -- on a seat change, only the seats being moved into are checked
    continue when tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and s = any (old.seats);
    -- a woman may sit beside a woman
    continue when public.seat_gender(new, s) = 'Female';
    foreach nb in array public.seat_neighbours(bus, s) loop
      continue when nb = any (new.seats);
      select b.* into other from public.bookings b
      where b.schedule_id = new.schedule_id and b.travel_date = new.travel_date and b.id <> new.id
        and b.status::text in ('confirmed', 'boarded', 'held') and nb = any (b.seats) limit 1;
      if found and public.seat_gender(other, nb) = 'Female' and public.seat_alone(other, bus, nb)
         and (new.user_id is null or other.user_id is distinct from new.user_id) then
        raise exception 'LADIES_NEIGHBOUR: Seat % is beside a woman travelling alone, so it is kept for women passengers. Please choose another seat.', s;
      end if;
    end loop;
  end loop;
  return new;
end $$;

-- Changing who sits where also refreshes the seat map and is checked.
drop trigger if exists bookings_sync_seats on public.bookings;
create trigger bookings_sync_seats after insert or update of status, seats, travel_date, schedule_id, passenger_gender, seat_genders
  on public.bookings for each row execute function public.sync_booking_seats();
drop trigger if exists bookings_seat_beside_woman on public.bookings;
create trigger bookings_seat_beside_woman before insert or update of seats, schedule_id, travel_date, passenger_gender, seat_genders on public.bookings
  for each row execute function public.enforce_seat_beside_woman();

-- Refresh the public seat map of upcoming trips with per-seat genders.
update public.booking_seats bs
   set gender = public.seat_gender(b, bs.seat),
       solo = public.seat_alone(b, bu, bs.seat)
  from public.bookings b
  join public.schedules sc on sc.id = b.schedule_id
  join public.buses bu on bu.id = sc.bus_id
 where bs.booking_id = b.id and b.travel_date >= current_date - 1;

create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  v_gw int := 0; earlier int;
  sg jsonb := '{}'; sgen text; nb text; alone boolean;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;
  -- Online, a seat is only sold when it is paid: through the payment gateway, or by bank transfer (slip checked by the office).
  if chan = 'online' and pay not in ('card', 'wallet', 'bank') then
    raise exception 'PAYMENT_UNAVAILABLE: Pay online by card or by bank transfer.';
  end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    -- Who sits in this seat: its own answer ("seat_genders": {"3A": "Female", "3B": ""}), else the passenger's.
    sgen := case when p -> 'seat_genders' ? s then coalesce(p -> 'seat_genders' ->> s, '') else gender end;
    if sgen not in ('', 'Male', 'Female') then sgen := ''; end if;
    sg := sg || jsonb_build_object(s, sgen);
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and sgen <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
    -- A seat that sits beside someone else's seat needs to know who sits in it (the
    -- "beside a woman travelling alone" rule uses it). Seats side by side in one
    -- booking (travelling together) don't.
    if chan = 'online' and sgen = '' then
      alone := false;
      foreach nb in array public.seat_neighbours(bus, s) loop
        if not nb = any (v_seats) then alone := true; end if;
      end loop;
      if alone then raise exception 'GENDER_NEEDED: Tell us who sits in seat % (male or female): the seat beside it is someone else''s.', s; end if;
    end if;
  end loop;

  -- One price for the whole route (the default): the full-route fare wherever
  -- the passenger gets on or off. Otherwise the difference between the stops.
  v_fare := case when rt.flat_fare then (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int
                 else (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int end;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and coalesce(p ->> 'promo', '') <> '' then
    if cfg.promo_code is null or upper(trim(p ->> 'promo')) <> upper(cfg.promo_code) or cfg.promo_percent <= 0 then
      raise exception 'PROMO: That promo code isn''t valid.';
    end if;
    -- First trip only: no earlier booking that went ahead (cancelled ones don't count).
    if cfg.promo_first_order then
      select count(*) into earlier from public.bookings where user_id = uid and status::text <> 'cancelled';
      if earlier > 0 then raise exception 'PROMO: This code is for your first trip only.'; end if;
    end if;
    -- Booked in the installed app (the app tells us; see the note in the migration).
    if cfg.promo_app_only and not coalesce((p ->> 'in_app')::boolean, false) then
      raise exception 'PROMO: This code works when you book in the Siyan Lanka app. Install it, then book from there.';
    end if;
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') or not coalesce((kinds -> (bike ->> 'kind') ->> 'active')::boolean, true) then
        raise exception 'BAD_BIKE: That kind of bike isn''t carried. Choose another.';
      end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if coalesce((kinds -> (bike ->> 'kind') ->> 'needsPlate')::boolean, bike ->> 'kind' <> 'bicycle') and length(coalesce(bike ->> 'reg_no', '')) < 4 then
        raise exception 'BAD_BIKE: Add the number plate.';
      end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  -- Card / wallet: everything goes through the gateway, which takes its cut, so a held seat waits for it.
  if chan = 'online' and pay in ('card', 'wallet') and base - disc + bike_total + v_fee > 0 then
    v_gw := ceil((base - disc + bike_total + v_fee) * cfg.gateway_fee_percent / 100.0);
    v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; v_gw := 0; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, gateway_fee, total, seat_genders,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, v_gw, base - disc + bike_total + v_fee + v_gw, sg,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, b ->> 'kind', left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

notify pgrst, 'reload schema';
