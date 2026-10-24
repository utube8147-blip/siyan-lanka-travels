-- =============================================================================
-- 20261039000000_route_names.sql
-- Routes can have a name staff choose ("Akkaraipattu to Colombo"). Empty means
-- the app shows "first stop → last stop", as before.
-- =============================================================================

alter table public.routes add column if not exists name text check (name is null or length(name) <= 60);

notify pgrst, 'reload schema';
