-- =============================================================================
-- Siyan Lanka Travels — migration 28: the booking centre closes the trip
-- The conductor fills in the paper trip sheet and hands it in with the cash.
-- Office staff type it into "Close a trip" for that conductor: odometer, fuel,
-- costs and the cash handed over. The conductor's phone only shows how much
-- cash they should be holding.
-- Safe to run again.
-- =============================================================================

-- Who typed it in, when that is not the person whose cash it is.
-- (Plain ids on purpose: a second link to profiles would make the app's
-- "who closed it" lookup ambiguous.)
alter table public.cash_counts add column if not exists entered_by uuid;
-- Whose trip cash a cost came out of (the conductor), when the office typed it.
alter table public.expenses add column if not exists takings_of uuid;

-- ------------------------------------------------------- closing for someone ---
-- Office staff may close a trip (or day) for another staff member. Everyone
-- else still closes only their own.
create or replace function public.check_cash_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance
  if new.created_by is not null and new.created_by <> auth.uid() and public.is_office_staff() then
    if not exists (select 1 from public.profiles where id = new.created_by and role::text in ('conductor', 'staff', 'admin')) then
      raise exception 'NOT_FOUND: Choose the staff member whose cash this is.';
    end if;
    new.entered_by := auth.uid();
  else
    new.created_by := auth.uid();
    new.entered_by := null;
  end if;
  if new.schedule_id is null and new.count_date > (now() at time zone (select timezone from public.app_settings))::date then
    raise exception 'TOO_EARLY: That day hasn''t happened yet.';
  end if;
  new.expected := public.cash_expected(new.created_by, new.count_date, new.schedule_id);
  if new.counted < 0 then raise exception 'BAD_AMOUNT: Enter the cash that was counted.'; end if;
  if new.counted <> new.expected and length(trim(coalesce(new.notes, ''))) < 3 then
    raise exception 'NOTE_NEEDED: The cash is % by LKR %. Add a note saying what happened.',
      case when new.counted < new.expected then 'short' else 'over' end, abs(new.counted - new.expected);
  end if;
  return new;
end $$;

drop policy if exists "staff count cash" on public.cash_counts;
create policy "staff count cash" on public.cash_counts for insert
  with check (public.is_staff() and (created_by = auth.uid() or public.is_office_staff()));
drop policy if exists "see cash counts" on public.cash_counts;
create policy "see cash counts" on public.cash_counts for select
  using (created_by = auth.uid() or entered_by = auth.uid() or public.is_admin());

-- ------------------------------------------- costs out of someone's trip cash ---
create or replace function public.check_trip_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.from_takings then
    new.takings_of := null;
    return new;
  end if;
  new.payment_method := 'cash';
  -- Only the office can say it came out of someone else's cash.
  if new.takings_of is null or not public.is_office_staff() then new.takings_of := coalesce(auth.uid(), new.created_by); end if;
  if public.is_admin() then return new; end if;
  if exists (
    select 1 from public.cash_counts c
    where c.created_by = new.takings_of
      and case when new.schedule_id is not null then c.schedule_id = new.schedule_id and c.count_date = new.travel_date
               else c.schedule_id is null and c.count_date = new.spent_on end
  ) then
    raise exception 'CLOSED: That trip is already closed. Ask a super admin to add this cost.';
  end if;
  return new;
end $$;
update public.expenses set takings_of = created_by where from_takings and takings_of is null;

-- Office staff log any road cost against a trip, not only their own.
drop policy if exists "staff see running costs" on public.expenses;
create policy "staff see running costs" on public.expenses for select
  using (public.is_staff() and (category in ('fuel', 'toll', 'parking', 'cleaning')
    or (category = 'other' and schedule_id is not null and (created_by = auth.uid() or public.is_office_staff()))));

create or replace function public.cash_expected(p_user uuid, p_date date, p_schedule text default null) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date
               else (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p left join public.bookings bk on bk.id = p.booking_id
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int
  - coalesce((
    select sum(e.amount) from public.expenses e
    where coalesce(e.takings_of, e.created_by) = p_user and e.from_takings
      and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date
               else e.schedule_id is null and e.spent_on = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

-- The cash summary, for yourself or (office staff) for the person named.
drop function if exists public.cash_summary(date, text);
create or replace function public.cash_summary(p_date date, p_schedule text default null, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings); who uuid := coalesce(p_user, auth.uid());
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if who <> auth.uid() and not public.is_office_staff() then raise exception 'NOT_ALLOWED: You can only see your own cash.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(who, p_date, p_schedule),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = who and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date else (b.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = who and p.method = 'cash' and p.status = 'paid'
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'paid_out', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
                 'detail', trim(both ' ' from coalesce(nullif(e.vendor, ''), '') || ' ' || coalesce(e.description, ''))) order by e.created_at)
               from public.expenses e
               where coalesce(e.takings_of, e.created_by) = who and e.from_takings
                 and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date else e.schedule_id is null and e.spent_on = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text, uuid) from public, anon;
grant execute on function public.cash_summary(date, text, uuid) to authenticated;

-- Who the office can close a trip for: everyone who took cash on it, then the
-- conductors (a trip with no cash still has a sheet to enter), each with what
-- they should hand in and whether it is closed already.
create or replace function public.trip_cash_people(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), 'Staff member'), 'role', p.role::text, 'took_cash', x.took,
             'expected', public.cash_expected(p.id, p_date, p_schedule),
             'closed', exists (select 1 from public.cash_counts c where c.created_by = p.id and c.schedule_id = p_schedule and c.count_date = p_date))
           order by x.took desc, (p.role::text = 'conductor') desc, p.full_name)
    from (
      select pr.id, exists (select 1 from public.bookings b where b.paid_by = pr.id and b.schedule_id = p_schedule and b.travel_date = p_date
                              and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')) as took
      from public.profiles pr where pr.role::text in ('conductor', 'staff', 'admin')
    ) x join public.profiles p on p.id = x.id
    where x.took or p.role::text = 'conductor'), '[]'::jsonb);
end $$;
revoke execute on function public.trip_cash_people(text, date) from public, anon;
grant execute on function public.trip_cash_people(text, date) to authenticated;

-- The sheet for a trip, now saying whose cash each cost came out of.
create or replace function public.trip_sheet(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
           'vendor', e.vendor, 'description', e.description, 'from_takings', e.from_takings, 'mine', e.created_by = auth.uid(),
           'by', coalesce((select nullif(full_name, '') from public.profiles where id = e.created_by), '')) order by e.created_at)
         from public.expenses e where e.schedule_id = p_schedule and e.travel_date = p_date), '[]'::jsonb);
end $$;
