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
