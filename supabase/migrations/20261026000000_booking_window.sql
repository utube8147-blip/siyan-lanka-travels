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
