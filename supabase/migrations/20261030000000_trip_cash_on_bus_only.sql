-- =============================================================================
-- Siyan Lanka Travels — migration 30: a trip's cash is only what was collected on the bus
-- "Cash you should have for this trip" counted every cash payment that person
-- had recorded for the trip, wherever it was taken. Someone who sold seats at
-- the counter and then opened the conductor page saw the counter money as
-- cash to carry on the bus (and it was already in their day's count).
-- Now a trip's cash is:
--   - fares collected for seats booked online (pay on the bus, or a held seat
--     paid to the conductor), by whoever collected them; and
--   - anything a conductor account records, since a conductor only works on the bus.
-- Seats sold for cash at a counter or by phone by office staff stay in the
-- office's day count and are not part of the trip's cash. Card and bank
-- payments were never counted.
-- Safe to run again.
-- =============================================================================
create or replace function public.is_trip_cash(p_channel text, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_channel = 'online' or exists (select 1 from public.profiles where id = p_user and role::text = 'conductor');
$$;
revoke execute on function public.is_trip_cash(text, uuid) from public, anon, authenticated;

create or replace function public.cash_expected(p_user uuid, p_date date, p_schedule text default null) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date and public.is_trip_cash(b.channel::text, p_user)
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
                 and case when p_schedule is not null then b.schedule_id = p_schedule and b.travel_date = p_date and public.is_trip_cash(b.channel::text, who) else (b.paid_at at time zone tz)::date = p_date end), '[]'::jsonb),
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
      select pr.id, exists (select 1 from public.bookings b where b.paid_by = pr.id and b.schedule_id = p_schedule and b.travel_date = p_date and public.is_trip_cash(b.channel::text, pr.id)
                              and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')) as took
      from public.profiles pr where pr.role::text in ('conductor', 'staff', 'admin')
    ) x join public.profiles p on p.id = x.id
    where x.took or p.role::text = 'conductor'), '[]'::jsonb);
end $$;
revoke execute on function public.trip_cash_people(text, date) from public, anon;
grant execute on function public.trip_cash_people(text, date) to authenticated;
