-- =============================================================================
-- 20261040000000_route_timing.sql
-- The route editor's timing settings are kept with each route: bus time =
-- car time × bus_factor, plus stop_min minutes at every stop (hidden shaping
-- points add none). Empty = the editor's defaults (1.1 and 2 minutes).
-- =============================================================================

alter table public.routes add column if not exists bus_factor numeric(3,2) check (bus_factor is null or bus_factor between 0.5 and 3);
alter table public.routes add column if not exists stop_min integer check (stop_min is null or stop_min between 0 and 30);

notify pgrst, 'reload schema';
