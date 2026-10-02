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
--  12. Starting data: settings, bus ND-2323, Route 48 both ways, timetable
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
-- ▼ seed.sql
-- =============================================================================
-- Starting data: settings, coach ND-2323, Route 48 both ways, timetable.
-- Same as lib/seed.ts (minus the sample bookings). Safe to re-run.

insert into public.app_settings (id, booking_fee, promo_code, promo_percent, max_seats_per_booking, booking_cutoff_minutes)
values (true, 50, 'SIYAN10', 10, 6, 30)
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
