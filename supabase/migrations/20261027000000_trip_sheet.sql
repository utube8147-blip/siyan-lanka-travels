-- =============================================================================
-- Siyan Lanka Travels — migration 27: the conductor's trip sheet
-- When a conductor closes a trip they also enter what they wrote on the paper
-- sheet: fuel put in, tolls, parking and other costs paid on the road. Costs
-- paid out of the cash they collected come off the cash they should hand in,
-- so an honest trip closes "balanced" and not "short".
-- Safe to run again.
-- =============================================================================

-- Paid out of the cash collected on the trip (or, for the office, out of the till).
alter table public.expenses add column if not exists from_takings boolean not null default false;
create index if not exists expenses_trip_idx on public.expenses (schedule_id, travel_date) where schedule_id is not null;

-- Staff on the road could log fuel, tolls, parking and cleaning. On a trip
-- sheet they may also log an "other" cost (a puncture, a bulb, tea for a
-- breakdown crew) against that trip.
drop policy if exists "staff log running costs" on public.expenses;
create policy "staff log running costs" on public.expenses for insert
  with check (public.is_staff() and created_by = auth.uid()
    and (category in ('fuel', 'toll', 'parking', 'cleaning') or (category = 'other' and schedule_id is not null)));
drop policy if exists "staff see running costs" on public.expenses;
create policy "staff see running costs" on public.expenses for select
  using (public.is_staff() and (category in ('fuel', 'toll', 'parking', 'cleaning') or (category = 'other' and schedule_id is not null and created_by = auth.uid())));

-- A cost paid from the takings is cash by definition, and it can't be added
-- to a trip (or day) that person has already closed: the count they signed
-- off would no longer add up. The office can still add it for them.
create or replace function public.check_trip_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.from_takings then return new; end if;
  new.payment_method := 'cash';
  if public.is_admin() then return new; end if;
  if exists (
    select 1 from public.cash_counts c
    where c.created_by = coalesce(new.created_by, auth.uid())
      and case when new.schedule_id is not null then c.schedule_id = new.schedule_id and c.count_date = new.travel_date
               else c.schedule_id is null and c.count_date = new.spent_on end
  ) then
    raise exception 'CLOSED: That trip is already closed. Ask the office to add this cost.';
  end if;
  return new;
end $$;
drop trigger if exists expenses_trip_check on public.expenses;
create trigger expenses_trip_check before insert on public.expenses
  for each row execute function public.check_trip_expense();

-- Cash one person should be holding: cash they took, less cash refunds they
-- paid, and now less the costs they paid out of that cash.
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
    where e.created_by = p_user and e.from_takings
      and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date
               else e.schedule_id is null and e.spent_on = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

-- The same summary as before, with the costs paid from the cash listed.
create or replace function public.cash_summary(p_date date, p_schedule text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(auth.uid(), p_date, p_schedule),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = auth.uid() and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date else (b.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = auth.uid() and p.method = 'cash' and p.status = 'paid'
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
    'paid_out', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
                 'detail', trim(both ' ' from coalesce(nullif(e.vendor, ''), '') || ' ' || coalesce(e.description, ''))) order by e.created_at)
               from public.expenses e
               where e.created_by = auth.uid() and e.from_takings
                 and case when p_schedule is not null then e.schedule_id = p_schedule and e.travel_date = p_date else e.schedule_id is null and e.spent_on = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text) from public, anon;
grant execute on function public.cash_summary(date, text) to authenticated;

-- Everything logged against one trip (by anyone), for the trip sheet on the
-- closing screen: what is already saved is shown, not typed again.
create or replace function public.trip_sheet(p_schedule text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'category', e.category::text, 'amount', e.amount, 'litres', e.litres, 'odometer_km', e.odometer_km,
           'vendor', e.vendor, 'description', e.description, 'from_takings', e.from_takings, 'mine', e.created_by = auth.uid(),
           'by', coalesce((select nullif(full_name, '') from public.profiles where id = e.created_by), '')) order by e.created_at)
         from public.expenses e where e.schedule_id = p_schedule and e.travel_date = p_date), '[]'::jsonb);
end $$;
revoke execute on function public.trip_sheet(text, date) from public, anon;
grant execute on function public.trip_sheet(text, date) to authenticated;
