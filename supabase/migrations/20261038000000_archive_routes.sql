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
