-- =============================================================================
-- Siyan Lanka Travels — migration 34: share a route plan by link
-- In the route editor, "Share" makes a private link (/share/route/<token>)
-- that shows a read-only snapshot of the route as it was when shared: the
-- stops, the road line, the times and a note. Anyone with the link can open
-- it without signing in; nobody can list the links or guess one (the token is
-- 22 random characters). Office staff can turn a link off at any time.
-- Safe to run again.
-- =============================================================================
create table if not exists public.route_shares (
  token text primary key check (length(token) >= 16),
  route_id text references public.routes (id) on delete cascade,
  title text not null default 'Route plan',
  note text not null default '',
  -- Snapshot: [{name, lat, lng, offsetMin, landmark?}]
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) >= 2),
  -- The road line [[lat, lng], …] at the time of sharing (null: the page asks the routing server).
  path jsonb,
  distance_km numeric,
  -- "HH:MM" departure for clock times (optional).
  departure text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists route_shares_route on public.route_shares (route_id, created_at desc);

alter table public.route_shares enable row level security;
-- Office staff and admins make, list and turn off links. The public never reads the table directly.
drop policy if exists "office route shares" on public.route_shares;
create policy "office route shares" on public.route_shares for all using (public.is_office_staff()) with check (public.is_office_staff());
revoke all on public.route_shares from anon;

-- The public page: one link by its token, only while it is switched on.
create or replace function public.get_route_share(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', s.title, 'note', s.note, 'stops', s.stops, 'path', s.path,
    'distance_km', s.distance_km, 'departure', s.departure, 'created_at', s.created_at)
  from public.route_shares s
  where s.token = p_token and s.revoked_at is null;
$$;
revoke execute on function public.get_route_share(text) from public;
grant execute on function public.get_route_share(text) to anon, authenticated;

notify pgrst, 'reload schema';
