-- =============================================================================
-- Siyan Lanka Travels — migration 17: cash overview and unfinished closes
--  * Super admin: for any day, every bus and trip that ran, what was sold and
--    how it was paid, who took cash and whether they have closed it.
--  * Everyone who takes cash: a list of earlier days / trips where they took
--    cash and never closed, so a missed close can be finished later.
-- Safe to run again.
-- =============================================================================
-- Earlier cash this person took that is not covered by any close of theirs.
-- Conductors are reminded by trip, office staff by day. Today (and today's
-- trips) are not "unfinished" yet. Looks back 60 days.
create or replace function public.cash_unclosed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
  today date := (now() at time zone tz)::date;
  by_trip boolean := exists (select 1 from public.profiles where id = auth.uid() and role::text = 'conductor');
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return coalesce((
    with open_cash as (
      select b.schedule_id, b.travel_date, (b.paid_at at time zone tz)::date as paid_day, b.total
      from public.bookings b
      where b.paid_by = auth.uid() and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
        and b.paid_at > now() - interval '60 days'
        -- not covered by a close of that trip, nor by a close of the day the cash was taken
        and not exists (select 1 from public.cash_counts c where c.created_by = auth.uid() and c.schedule_id = b.schedule_id and c.count_date = b.travel_date)
        and not exists (select 1 from public.cash_counts c where c.created_by = auth.uid() and c.schedule_id is null and c.count_date = (b.paid_at at time zone tz)::date)
    ),
    grouped as (
      select 'trip' as kind, travel_date as d, schedule_id as sch, sum(total)::int as amount, count(*)::int as payments
      from open_cash where by_trip and travel_date < today group by travel_date, schedule_id
      union all
      select 'day', paid_day, null, sum(total)::int, count(*)::int
      from open_cash where not by_trip and paid_day < today group by paid_day
    )
    select jsonb_agg(jsonb_build_object('kind', kind, 'date', d, 'schedule_id', sch, 'amount', amount, 'payments', payments) order by d, sch)
    from grouped), '[]'::jsonb);
end $$;
revoke execute on function public.cash_unclosed() from public, anon;
grant execute on function public.cash_unclosed() to authenticated;

-- Super admin: everything about one day's money, bus by bus.
create or replace function public.cash_overview(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admin only.'; end if;
  return jsonb_build_object(
    -- every departure that runs on this date (or has bookings on it), with its money
    'trips', coalesce((
      select jsonb_agg(t order by t ->> 'departure', t ->> 'schedule_id') from (
        select jsonb_build_object(
          'schedule_id', s.id, 'departure', s.departure,
          'route', (r.stops -> 0 ->> 'name') || ' → ' || (r.stops -> (jsonb_array_length(r.stops) - 1) ->> 'name'),
          'bus', bus.name || ' · ' || bus.reg_no, 'capacity', public.bus_capacity(bus),
          'seats', coalesce((select sum(cardinality(b.seats)) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.status::text in ('confirmed', 'boarded', 'held')), 0),
          'cash', coalesce((select sum(b.total) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_status = 'paid' and b.payment_method = 'cash' and b.status::text <> 'cancelled'), 0),
          'other_paid', coalesce((select sum(b.total) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_status = 'paid' and b.payment_method <> 'cash' and b.status::text <> 'cancelled'), 0),
          'unpaid', coalesce((select sum(b.total) from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_status = 'unpaid' and b.status::text in ('held', 'boarded')), 0),
          -- who took cash for this trip, and whether they closed it
          'people', coalesce((
            select jsonb_agg(jsonb_build_object(
              'name', coalesce(nullif(p.full_name, ''), 'Staff'), 'role', p.role::text,
              'expected', public.cash_expected(p.id, p_date, s.id),
              'closed', c.id is not null, 'counted', c.counted, 'recorded_expected', c.expected, 'notes', coalesce(c.notes, '')) order by p.full_name)
            from (select distinct paid_by from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date and b.payment_method = 'cash' and b.paid_by is not null
                  union select created_by from public.cash_counts c2 where c2.schedule_id = s.id and c2.count_date = p_date) x
            join public.profiles p on p.id = x.paid_by
            left join public.cash_counts c on c.created_by = p.id and c.schedule_id = s.id and c.count_date = p_date), '[]'::jsonb)) as t
        from public.schedules s
        join public.routes r on r.id = s.route_id
        join public.buses bus on bus.id = s.bus_id
        where (s.active and public.schedule_runs_on(s, p_date))
           or exists (select 1 from public.bookings b where b.schedule_id = s.id and b.travel_date = p_date)) q), '[]'::jsonb),
    -- cash taken ON this date, person by person, and whether they closed the day
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(p.full_name, ''), 'Staff'), 'role', p.role::text,
        'expected', public.cash_expected(p.id, p_date, null),
        'closed', c.id is not null, 'counted', c.counted, 'recorded_expected', c.expected, 'notes', coalesce(c.notes, '')) order by p.full_name)
      from (select distinct paid_by from public.bookings b where b.payment_method = 'cash' and b.paid_by is not null and (b.paid_at at time zone tz)::date = p_date
            union select created_by from public.cash_counts c2 where c2.schedule_id is null and c2.count_date = p_date) x
      join public.profiles p on p.id = x.paid_by and p.role::text <> 'conductor' -- conductors close by trip (listed above)
      left join public.cash_counts c on c.created_by = p.id and c.schedule_id is null and c.count_date = p_date), '[]'::jsonb));
end $$;
revoke execute on function public.cash_overview(date) from public, anon;
grant execute on function public.cash_overview(date) to authenticated;
