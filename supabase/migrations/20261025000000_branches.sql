-- =============================================================================
-- Siyan Lanka Travels — migration 25: branches (more than one booking place)
--  1. Branches: each counter / office / agent you sell from.
--  2. Every staff account belongs to a branch (Accounts & roles).
--  3. Every booking remembers the branch that made it and the branch that took
--     the money, as it was on the day (moving a person later changes nothing).
--  4. Sales and cash by branch and by person, for any dates (super admins).
--  5. "Pay at the counter" texts name the counters that take payments.
-- Safe to run again.
-- =============================================================================

-- ------------------------------------------------------------ 1. branches ---
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  address text not null default '',
  phone text not null default '',
  takes_payments boolean not null default true,   -- passengers can pay held seats here
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists branches_name_key on public.branches (lower(trim(name)));
alter table public.branches enable row level security;
-- Names and addresses of counters are public (the payment page lists them).
drop policy if exists "read branches" on public.branches;
create policy "read branches" on public.branches for select using (true);
drop policy if exists "admin branches" on public.branches;
create policy "admin branches" on public.branches for all using (public.is_admin()) with check (public.is_admin());

-- The counter you already have, so nothing changes until you add a second one.
insert into public.branches (name, address)
select 'Bastian Mawatha', 'Bastian Mawatha, Pettah, Colombo 11'
where not exists (select 1 from public.branches);

-- ------------------------------------------------- 2. staff belong to one ---
alter table public.profiles add column if not exists branch_id uuid references public.branches (id) on delete set null;

create or replace function public.set_user_branch(p_user uuid, p_branch uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch) then
    raise exception 'NOT_FOUND: That branch doesn''t exist.';
  end if;
  if p_branch is not null and (select role::text from public.profiles where id = p_user) = 'passenger' then
    raise exception 'NOT_ALLOWED: Only staff accounts belong to a branch. Set the role first.';
  end if;
  update public.profiles set branch_id = p_branch where id = p_user;
end $$;
revoke execute on function public.set_user_branch(uuid, uuid) from public, anon;
grant execute on function public.set_user_branch(uuid, uuid) to authenticated;

-- A passenger has no branch: clear it when a staff account is turned back.
create or replace function public.clear_branch_for_passengers() returns trigger
language plpgsql as $$
begin
  if new.role::text = 'passenger' then new.branch_id := null; end if;
  return new;
end $$;
drop trigger if exists profiles_clear_branch on public.profiles;
create trigger profiles_clear_branch before update of role on public.profiles
  for each row execute function public.clear_branch_for_passengers();

-- The accounts list now carries the branch (the return type changed, so drop first).
drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, created_at timestamptz, last_sign_in_at timestamptz, branch_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role::text, p.created_at, u.last_sign_in_at, p.branch_id
    from public.profiles p join auth.users u on u.id = p.id
    order by p.role::text desc, p.created_at desc;
end $$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ------------------------------------- 3. bookings remember their branch ----
alter table public.bookings
  add column if not exists branch_id uuid references public.branches (id) on delete set null,       -- who sold it
  add column if not exists paid_branch_id uuid references public.branches (id) on delete set null;  -- who took the money
create index if not exists bookings_branch_idx on public.bookings (branch_id, created_at);
create index if not exists bookings_paid_branch_idx on public.bookings (paid_branch_id, paid_at);

-- Sold at: the branch of the staff member who made the booking. Online
-- bookings are made by the passenger, so they have none ("Online").
create or replace function public.stamp_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null and new.created_by is not null then
    select p.branch_id into new.branch_id from public.profiles p where p.id = new.created_by and p.role::text <> 'passenger';
  end if;
  return new;
end $$;
drop trigger if exists bookings_stamp_branch on public.bookings;
create trigger bookings_stamp_branch before insert on public.bookings
  for each row execute function public.stamp_branch();

-- Paid at: as before this records who took the payment, and now their branch too.
create or replace function public.stamp_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and (tg_op = 'INSERT' or old.payment_status is distinct from 'paid') then
    if new.paid_at is null then new.paid_at := now(); end if;
    if auth.uid() is not null and public.is_staff() then
      new.paid_by := auth.uid();
      new.paid_branch_id := (select p.branch_id from public.profiles p where p.id = auth.uid());
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------ 4. sales by branch --------
-- For the company's local dates p_from..p_to:
--   sold   = bookings a branch MADE in those days (not cancelled)
--   taken  = payments a branch RECORDED in those days, cash and other
--   refunds = cash refunds its people paid out in those days
-- Rows with no branch: "online" (passengers booking themselves, card and
-- bank payments) and staff who have not been given a branch yet.
create or replace function public.branch_sales(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings); out jsonb;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'BAD_DATES: Choose up to one year.'; end if;
  with sold as (
    select b.branch_id, b.created_by as person, (b.channel::text = 'online') as online,
           count(*) as bookings, sum(cardinality(b.seats)) as seats, sum(b.total) as value
    from public.bookings b
    where (b.created_at at time zone tz)::date between p_from and p_to and b.status::text <> 'cancelled'
    group by 1, 2, 3
  ), taken as (
    select b.paid_branch_id as branch_id, b.paid_by as person, (b.paid_by is null) as online,
           sum(b.total) filter (where b.payment_method = 'cash') as cash,
           sum(b.total) filter (where b.payment_method <> 'cash') as other
    from public.bookings b
    where b.payment_status in ('paid', 'refunded') and b.paid_at is not null and (b.paid_at at time zone tz)::date between p_from and p_to
    group by 1, 2, 3
  ), refunds as (
    select pr.branch_id, p.paid_by as person, false as online, sum(p.amount) as refunded
    from public.payouts p left join public.profiles pr on pr.id = p.paid_by
    where p.method = 'cash' and p.status = 'paid' and p.paid_at is not null and (p.paid_at at time zone tz)::date between p_from and p_to
    group by 1, 2
  ), keys as (
    select branch_id, person, online from sold union select branch_id, person, online from taken union select branch_id, person, online from refunds
  ), rows as (
    select k.branch_id, k.online,
           case when k.online then null else k.person end as person,
           sum(coalesce(s.bookings, 0)) as bookings, sum(coalesce(s.seats, 0)) as seats, sum(coalesce(s.value, 0)) as value,
           sum(coalesce(t.cash, 0)) as cash, sum(coalesce(t.other, 0)) as other, sum(coalesce(r.refunded, 0)) as refunded
    from keys k
    left join sold s on s.branch_id is not distinct from k.branch_id and s.person is not distinct from k.person and s.online = k.online
    left join taken t on t.branch_id is not distinct from k.branch_id and t.person is not distinct from k.person and t.online = k.online
    left join refunds r on r.branch_id is not distinct from k.branch_id and r.person is not distinct from k.person and r.online = k.online
    group by 1, 2, 3
  ), people as (
    select r.*, coalesce(nullif(p.full_name, ''), 'Staff member') as name, p.role::text as role from rows r left join public.profiles p on p.id = r.person
  ), grouped as (
    select case when online and branch_id is null then 'online' when branch_id is null then 'none' else branch_id::text end as key,
           sum(bookings) as bookings, sum(seats) as seats, sum(value) as value, sum(cash) as cash, sum(other) as other, sum(refunded) as refunded,
           coalesce(jsonb_agg(jsonb_build_object('id', person, 'name', name, 'role', role, 'bookings', bookings, 'seats', seats, 'value', value,
                    'cash', cash, 'other', other, 'refunded', refunded) order by value desc, name) filter (where person is not null), '[]'::jsonb) as people
    from people group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key, 'name', coalesce(br.name, case g.key when 'online' then 'Online' else 'No branch set' end),
           'bookings', g.bookings, 'seats', g.seats, 'value', g.value, 'cash', g.cash, 'other', g.other, 'refunded', g.refunded, 'people', g.people)
           order by (g.key in ('online', 'none')), g.value desc), '[]'::jsonb)
    into out
  from grouped g left join public.branches br on br.id::text = g.key;
  return out;
end $$;
revoke execute on function public.branch_sales(date, date) from public, anon;
grant execute on function public.branch_sales(date, date) to authenticated;

-- --------------------------------------- 5. "pay at the counter" wording ----
-- "at our Bastian Mawatha counter" / "at our Bastian Mawatha or Kalmunai counter".
create or replace function public.counter_text() returns text
language sql stable security definer set search_path = public as $$
  select 'at our ' || coalesce((select string_agg(trim(name), ' or ' order by created_at) || ' ' from public.branches where active and takes_payments), '') || 'counter';
$$;
revoke execute on function public.counter_text() from public, anon, authenticated;

-- The booking texts from migration 24, unchanged except that the counter
-- hold names the counters above.
create or replace function public.booking_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bank text;
  site text;
  phone text := coalesce(nullif(new.contact_phone, ''), new.passenger_phone);
  email text := nullif(trim(new.contact_email), '');
  departs text := public.booking_departure_text(new);
  seats text := array_to_string(new.seats, ', ');
  trip text := new.from_stop || ' → ' || new.to_stop || ', ' || departs || ', seat ' || array_to_string(new.seats, ',');
  reg text; pay text; l_ticket text; l_track text; l_trips text; done boolean; just_paid boolean;
begin
  if new.channel <> 'online' then return new; end if;
  select * into cfg from public.app_settings;
  site := rtrim(coalesce(cfg.site_url, ''), '/'); bank := cfg.bank_details;

  done := new.status::text in ('confirmed', 'boarded') or (new.status::text = 'held' and new.payment_method = 'bus');
  just_paid := tg_op = 'UPDATE' and old.payment_status = 'unpaid' and new.payment_status = 'paid' and new.status::text in ('confirmed', 'boarded');

  if new.status::text = 'cancelled' then
    if tg_op = 'UPDATE' and old.status::text in ('confirmed', 'held') then
      perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' cancelled'
        || case when coalesce(new.refund_amount, 0) > 0 then '. Refund LKR ' || new.refund_amount || ' on its way.' else '.' end, 'booking_cancelled', new.id);
    end if;

  elsif done and public.claim_booking_notice(new.id, 'details') then
    select b.reg_no into reg from public.schedules s join public.buses b on b.id = s.bus_id where s.id = new.schedule_id;
    if email is null and new.user_id is not null then
      select nullif(u.email, '') into email from auth.users u where u.id = new.user_id;
    end if;
    pay := case when new.payment_status = 'paid' then 'Paid LKR ' || new.total
                when new.payment_method = 'bus' then 'Pay LKR ' || new.total || ' in cash on the bus'
                else 'Total LKR ' || new.total end;
    l_ticket := site || '/my-bookings?ref=' || new.ref;
    l_track := site || '/track?ref=' || new.ref;
    l_trips := site || '/my-bookings';
    -- Plain letters only ("to", not an arrow): special characters make a text
    -- cost more than twice as many parts.
    perform public.enqueue_message(phone,
      'Siyan Lanka: Booking ' || new.ref || ' confirmed.' || E'\n'
      || new.from_stop || ' to ' || new.to_stop || E'\n'
      || departs || E'\n'
      || 'Seat ' || seats || coalesce(', bus ' || reg, '') || E'\n'
      || pay || E'\n'
      || 'Ticket: ' || l_ticket || E'\n'
      || 'Track bus: ' || l_track || E'\n'
      || 'My trips: ' || l_trips || E'\n'
      || 'Be at the boarding point 20 min early.',
      'booking_confirmed', new.id);
    perform public.enqueue_email(email, 'Your ticket ' || new.ref || ': ' || new.from_stop || ' to ' || new.to_stop,
      'Booking ' || new.ref || ' confirmed.' || E'\n' || new.from_stop || ' to ' || new.to_stop || E'\n' || departs || E'\n'
      || 'Seat ' || seats || coalesce(', bus ' || reg, '') || E'\n' || pay || E'\n\n'
      || 'Ticket: ' || l_ticket || E'\n' || 'Track your bus: ' || l_track || E'\n' || 'My trips: ' || l_trips,
      'booking_confirmed', new.id,
      jsonb_build_object('ref', new.ref, 'name', new.passenger_name, 'from', new.from_stop, 'to', new.to_stop, 'departs', departs,
        'seats', seats, 'bus', coalesce(reg, ''), 'pay', pay, 'ticket_url', l_ticket, 'track_url', l_track, 'trips_url', l_trips));
    if new.user_id is not null then
      insert into public.notifications (user_id, title, body, url, tag)
      values (new.user_id, 'Booking confirmed: ' || new.ref,
              new.from_stop || ' → ' || new.to_stop || ' · ' || departs || ' · Seat ' || seats || '. ' || pay || '.',
              '/my-bookings?ref=' || new.ref, 'booking-' || new.id);
    end if;

  elsif just_paid then
    -- The full message went out earlier (pay on the bus): just a short receipt.
    perform public.enqueue_message(phone, 'Siyan Lanka: Payment of LKR ' || new.total || ' received for booking ' || new.ref || '. Thank you.', 'payment_received', new.id);
    if new.user_id is not null then
      insert into public.notifications (user_id, title, body, url)
      values (new.user_id, 'Payment received', 'LKR ' || new.total || ' for ' || new.ref || '. Your seat ' || seats || ' is confirmed.', '/my-bookings?ref=' || new.ref);
    end if;

  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method in ('bank', 'counter') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat held, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' by '
      || to_char(new.hold_expires_at at time zone cfg.timezone, 'Dy DD Mon HH12:MI AM')
      || case when new.payment_method = 'bank' then '. Bank: ' || bank || ' Ref: ' || new.ref else ' ' || public.counter_text() end || '.', 'booking_held', new.id);
  end if;
  return new;
end $$;
drop trigger if exists bookings_messages on public.bookings;
create trigger bookings_messages after insert or update of status, payment_status on public.bookings
  for each row execute function public.booking_messages();
