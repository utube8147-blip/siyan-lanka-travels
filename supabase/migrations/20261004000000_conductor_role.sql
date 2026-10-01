-- =============================================================================
-- Migration 4: conductor role.
-- Conductors use the phone-first conductor page (/conductor): passenger
-- lists, QR boarding, taking cash for held seats, selling a seat on board,
-- trip updates, sharing the bus location, logging fuel/tolls, cash count.
-- They can't change buses, routes or the timetable, or see paperwork and
-- parcel/hire requests (office staff only).
-- =============================================================================

alter type public.user_role add value if not exists 'conductor';

-- Anyone working for the company (office staff, super admin, conductor).
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin', 'conductor'));
$$;

-- Office staff only (not conductors).
create function public.is_office_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin'));
$$;
grant execute on function public.is_office_staff() to anon, authenticated;

drop policy "staff buses" on public.buses;
create policy "office buses" on public.buses for all using (public.is_office_staff()) with check (public.is_office_staff());
drop policy "staff routes" on public.routes;
create policy "office routes" on public.routes for all using (public.is_office_staff()) with check (public.is_office_staff());
drop policy "staff schedules" on public.schedules;
create policy "office schedules" on public.schedules for all using (public.is_office_staff()) with check (public.is_office_staff());
drop policy "staff see documents" on public.bus_documents;
create policy "office see documents" on public.bus_documents for select using (public.is_office_staff());
drop policy "own or staff requests" on public.service_requests;
create policy "own or office requests" on public.service_requests for select using (user_id = auth.uid() or public.is_office_staff());
drop policy "staff handle requests" on public.service_requests;
create policy "office handle requests" on public.service_requests for update using (public.is_office_staff()) with check (public.is_office_staff());
drop policy "staff edit profiles" on public.profiles;
create policy "office edit profiles" on public.profiles for update using (public.is_office_staff());

create or replace function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_role not in ('passenger', 'conductor', 'staff', 'admin') then raise exception 'BAD_ROLE: Unknown role.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'NOT_ALLOWED: You can''t remove your own super admin access.'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user;
end $$;
