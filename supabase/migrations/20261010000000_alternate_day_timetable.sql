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
