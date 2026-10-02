-- =============================================================================
-- Siyan Lanka Travels — migration 16: close a trip, or any day
-- A conductor closes the cash for the DEPARTURE chosen on the conductor
-- screen (a night bus spans two dates, so "today" is the wrong unit): the
-- cash they took for bookings on that departure. Office staff close a day
-- (any date up to today): the cash they took on that date.
-- Safe to run again.
-- =============================================================================
alter table public.cash_counts add column if not exists schedule_id text references public.schedules (id) on delete set null;
-- One close per person per day, and one per person per departure.
drop index if exists public.cash_counts_one_per_day;
create unique index if not exists cash_counts_one_each on public.cash_counts (count_date, created_by, (coalesce(schedule_id, '')));

drop function if exists public.cash_summary(date);
drop function if exists public.cash_expected(uuid, date);

-- p_schedule given: cash this person took for bookings on that departure
--   (travel date p_date), whenever they took it, less cash refunds they paid
--   on those bookings.
-- p_schedule null: cash this person took ON the date p_date (company time),
--   less cash refunds they paid that day.
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
               else (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date end), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon, authenticated;

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
                 and case when p_schedule is not null then bk.schedule_id = p_schedule and bk.travel_date = p_date else (p.paid_at at time zone tz)::date = p_date end), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date, text) from public, anon;
grant execute on function public.cash_summary(date, text) to authenticated;

create or replace function public.check_cash_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance
  new.created_by := auth.uid();
  if new.schedule_id is null and new.count_date > (now() at time zone (select timezone from public.app_settings))::date then
    raise exception 'TOO_EARLY: That day hasn''t happened yet.';
  end if;
  new.expected := public.cash_expected(auth.uid(), new.count_date, new.schedule_id);
  if new.counted < 0 then raise exception 'BAD_AMOUNT: Enter the cash you counted.'; end if;
  if new.counted <> new.expected and length(trim(coalesce(new.notes, ''))) < 3 then
    raise exception 'NOTE_NEEDED: The cash is % by LKR %. Add a note saying what happened.',
      case when new.counted < new.expected then 'short' else 'over' end, abs(new.counted - new.expected);
  end if;
  return new;
end $$;
