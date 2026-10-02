-- =============================================================================
-- Siyan Lanka Travels — migration 15: closing the day
-- When a conductor or ticket seller closes the day, the system works out the
-- cash THEY should be holding (cash they took, minus cash refunds they paid
-- out), compares it with what they counted, and:
--   * refuses to close a day that is short or over without a note;
--   * tells the super admins when a day closes short or over.
-- The expected figure is worked out by the database, not sent by the browser.
-- Safe to run again.
-- =============================================================================
-- Who recorded each payment (needed to know whose cash it is).
alter table public.bookings add column if not exists paid_by uuid references public.profiles (id) on delete set null;

create or replace function public.stamp_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    if new.paid_at is null then new.paid_at := now(); end if;
    if auth.uid() is not null and public.is_staff() then new.paid_by := auth.uid(); end if;
  end if;
  return new;
end $$;
drop trigger if exists bookings_stamp_payment on public.bookings;
create trigger bookings_stamp_payment before insert or update of payment_status on public.bookings
  for each row execute function public.stamp_payment();

-- Sales made before this migration: a counter / phone sale paid in cash was taken by whoever made it.
update public.bookings set paid_by = created_by
where paid_by is null and created_by is not null and channel::text <> 'online' and payment_method = 'cash' and payment_status in ('paid', 'refunded');

-- Cash one staff member should be holding for one day (the company's local date).
-- (Replaced by the 3-argument version in migration 16; dropped first so a re-run never leaves both.)
drop function if exists public.cash_summary(date, text);
drop function if exists public.cash_expected(uuid, date, text);
create or replace function public.cash_expected(p_user uuid, p_date date) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select sum(b.total) from public.bookings b
    where b.paid_by = p_user and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded')
      and (b.paid_at at time zone (select timezone from public.app_settings))::date = p_date), 0)::int
  - coalesce((
    select sum(p.amount) from public.payouts p
    where p.paid_by = p_user and p.method = 'cash' and p.status = 'paid'
      and (p.paid_at at time zone (select timezone from public.app_settings))::date = p_date), 0)::int;
$$;
revoke execute on function public.cash_expected(uuid, date) from public, anon, authenticated;

-- What the Close the day screen shows the signed-in staff member.
create or replace function public.cash_summary(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  return jsonb_build_object(
    'expected', public.cash_expected(auth.uid(), p_date),
    'taken', coalesce((select jsonb_agg(jsonb_build_object('ref', b.ref, 'name', b.passenger_name, 'seats', b.seats, 'from', b.from_stop, 'to', b.to_stop,
                 'amount', b.total, 'at', b.paid_at, 'where', case when b.channel::text = 'online' then 'collected' else b.channel::text end) order by b.paid_at)
               from public.bookings b
               where b.paid_by = auth.uid() and b.payment_method = 'cash' and b.payment_status in ('paid', 'refunded') and (b.paid_at at time zone tz)::date = p_date), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('ref', coalesce(bk.ref, ''), 'name', coalesce(bk.passenger_name, ''), 'amount', p.amount, 'at', p.paid_at) order by p.paid_at)
               from public.payouts p left join public.bookings bk on bk.id = p.booking_id
               where p.paid_by = auth.uid() and p.method = 'cash' and p.status = 'paid' and (p.paid_at at time zone tz)::date = p_date), '[]'::jsonb));
end $$;
revoke execute on function public.cash_summary(date) from public, anon;
grant execute on function public.cash_summary(date) to authenticated;

-- Closing the day: the database sets the expected figure and insists on a note when the cash doesn't match.
create or replace function public.check_cash_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service role / maintenance
  new.created_by := auth.uid();
  new.expected := public.cash_expected(auth.uid(), new.count_date);
  if new.counted < 0 then raise exception 'BAD_AMOUNT: Enter the cash you counted.'; end if;
  if new.counted <> new.expected and length(trim(coalesce(new.notes, ''))) < 3 then
    raise exception 'NOTE_NEEDED: The cash is % by LKR %. Add a note saying what happened.',
      case when new.counted < new.expected then 'short' else 'over' end, abs(new.counted - new.expected);
  end if;
  return new;
end $$;
drop trigger if exists cash_counts_check on public.cash_counts;
create trigger cash_counts_check before insert on public.cash_counts
  for each row execute function public.check_cash_count();

-- A day that closes short or over is reported to the super admins.
create or replace function public.report_cash_difference() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.counted = new.expected then return new; end if;
  select coalesce(nullif(full_name, ''), 'A staff member') into who from public.profiles where id = new.created_by;
  insert into public.notifications (user_id, title, body, url)
  select p.id,
         'Cash ' || case when new.counted < new.expected then 'short' else 'over' end || ' by LKR ' || abs(new.counted - new.expected),
         who || ', ' || to_char(new.count_date, 'Dy DD Mon') || ': should have LKR ' || new.expected || ', counted LKR ' || new.counted || '. Note: ' || new.notes,
         '/admin/cash'
  from public.profiles p where p.role::text = 'admin' and p.id <> new.created_by;
  return new;
end $$;
drop trigger if exists cash_counts_report on public.cash_counts;
create trigger cash_counts_report after insert on public.cash_counts
  for each row execute function public.report_cash_difference();
