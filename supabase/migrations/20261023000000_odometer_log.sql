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
