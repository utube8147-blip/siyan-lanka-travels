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
create type public.user_role as enum ('passenger', 'staff');
create type public.bus_type as enum ('AC', 'Non-AC');
create type public.bus_status as enum ('active', 'maintenance', 'retired');
create type public.booking_status as enum ('confirmed', 'boarded', 'cancelled', 'no-show');
create type public.booking_channel as enum ('online', 'counter', 'phone');
create type public.bike_kind as enum ('bicycle', 'scooter', 'motorbike');

-- --------------------------------------------------------------- profiles ---
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'passenger',
  created_at timestamptz not null default now()
);

-- New sign-ups get a profile automatically.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff');
$$;

-- --------------------------------------------------------------- settings ---
-- One row. Mirrors config/operator.ts so prices are decided server-side.
create table public.app_settings (
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
create table public.buses (
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
create table public.routes (
  id text primary key default ('route-' || substr(md5(gen_random_uuid()::text), 1, 8)),
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) >= 2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.schedules (
  id text primary key default ('sch-' || substr(md5(gen_random_uuid()::text), 1, 8)),
  route_id text not null references public.routes (id) on delete restrict,
  bus_id text not null references public.buses (id) on delete restrict,
  departure text not null check (departure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days smallint[] not null check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(days) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- bookings ---
create table public.bookings (
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
create index bookings_user_idx on public.bookings (user_id, travel_date);
create index bookings_departure_idx on public.bookings (schedule_id, travel_date);

-- One row per seat of a live booking. The partial unique index is what makes
-- double-booking impossible, even with two payments at the same instant.
create table public.booking_seats (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  schedule_id text not null,
  travel_date date not null,
  seat text not null,
  gender text not null default '',
  active boolean not null default true,
  primary key (booking_id, seat)
);
create unique index booking_seats_one_per_departure on public.booking_seats (schedule_id, travel_date, seat) where active;

create table public.booking_bikes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind public.bike_kind not null,
  description text not null,
  reg_no text not null default '',
  photo_path text,                          -- in storage bucket "bike-photos"
  fee integer not null
);
create index booking_bikes_booking_idx on public.booking_bikes (booking_id);

-- Keep booking_seats in step with bookings (status, seats, date).
create function public.sync_booking_seats() returns trigger
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

create trigger bookings_sync_seats after insert or update of status, seats, travel_date, schedule_id, passenger_gender
  on public.bookings for each row execute function public.sync_booking_seats();

-- ---------------------------------------------------------------- helpers ---
create function public.seat_is_on_bus(p_bus public.buses, p_seat text) returns boolean
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

create function public.stop_index(p_stops jsonb, p_name text) returns int
language sql immutable as $$
  select (ord - 1)::int from jsonb_array_elements(p_stops) with ordinality as e(stop, ord)
  where lower(trim(stop ->> 'name')) = lower(trim(p_name)) limit 1;
$$;

-- Bike spaces already booked on a departure (anyone can read this).
create function public.bike_spaces_used(p_schedule text, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int), 0)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.schedule_id = p_schedule and b.travel_date = p_date and b.status in ('confirmed', 'boarded');
$$;

create function public.get_bike_usage(p_from date, p_to date)
returns table (schedule_id text, travel_date date, spaces int)
language sql stable security definer set search_path = public as $$
  select b.schedule_id, b.travel_date,
         sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.travel_date between p_from and p_to and b.status in ('confirmed', 'boarded')
  group by 1, 2;
$$;

create function public.new_booking_ref() returns text
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
create function public.create_booking(p jsonb) returns public.bookings
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
create function public.cancel_booking(p_id uuid) returns public.bookings
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
create function public.modify_booking(p_id uuid, p_seats text[] default null, p_date date default null) returns public.bookings
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

create policy "own profile" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "staff edit profiles" on public.profiles for update using (public.is_staff());
-- Passengers may change their name/phone but never their role.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "read settings" on public.app_settings for select using (true);
create policy "staff settings" on public.app_settings for update using (public.is_staff());

create policy "read buses" on public.buses for select using (true);
create policy "staff buses" on public.buses for all using (public.is_staff()) with check (public.is_staff());
create policy "read routes" on public.routes for select using (true);
create policy "staff routes" on public.routes for all using (public.is_staff()) with check (public.is_staff());
create policy "read schedules" on public.schedules for select using (true);
create policy "staff schedules" on public.schedules for all using (public.is_staff()) with check (public.is_staff());

-- Bookings: read own; staff read/update all. No direct inserts: use create_booking().
create policy "read own bookings" on public.bookings for select using (user_id = auth.uid() or public.is_staff());
create policy "staff update bookings" on public.bookings for update using (public.is_staff()) with check (public.is_staff());
revoke insert, delete on public.bookings from anon, authenticated;

-- Seat map: everyone sees which seats are taken, but not whose booking.
create policy "read live seats" on public.booking_seats for select using (active);
revoke all on public.booking_seats from anon, authenticated;
grant select (schedule_id, travel_date, seat, gender, active) on public.booking_seats to anon, authenticated;

create policy "read own bikes" on public.booking_bikes for select using (
  public.is_staff() or exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = auth.uid()));
revoke insert, update, delete on public.booking_bikes from anon, authenticated;

-- Functions callable from the app.
revoke execute on function public.create_booking(jsonb), public.cancel_booking(uuid), public.modify_booking(uuid, text[], date) from public, anon;
grant execute on function public.create_booking(jsonb), public.cancel_booking(uuid), public.modify_booking(uuid, text[], date) to authenticated;
grant execute on function public.get_bike_usage(date, date), public.bike_spaces_used(text, date), public.is_staff() to anon, authenticated;

-- Live seat map updates.
alter publication supabase_realtime add table public.booking_seats;

-- ---------------------------------------------------------------- storage ---
insert into storage.buckets (id, name, public) values ('bike-photos', 'bike-photos', false) on conflict (id) do nothing;

-- Passengers upload into a folder named after their user id; staff see all.
create policy "upload own bike photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'bike-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own bike photos" on storage.objects for select to authenticated
  using (bucket_id = 'bike-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
