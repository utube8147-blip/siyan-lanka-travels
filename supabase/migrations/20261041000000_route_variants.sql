-- =============================================================================
-- 20261041000000_route_variants.sql
-- Route variants: other ways the bus goes, drawn by staff, for when some
-- on-request stops don't fill. Each variant has every main stop plus the
-- on-request stops it covers; a trip uses the one that matches the on-request
-- stops running. (Replaces the automatic stop re-ordering tried earlier.)
-- =============================================================================

alter table public.routes add column if not exists variants jsonb not null default '[]'::jsonb
  check (jsonb_typeof(variants) = 'array');

drop function if exists public.trip_stop_pairs(text, date);

notify pgrst, 'reload schema';
