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

notify pgrst, 'reload schema';
