-- =============================================================================
-- Siyan Lanka Travels — migration 5: money back, slips, push, tracking history
--  1. Rewards switch (off by default; nothing is deleted).
--  2. Payouts: every refund and every resale sale becomes a row staff pay and
--     tick off. Passengers add the bank account the money should go to.
--  3. Seat resale: obeys Settings → Seat resale everywhere; online payment
--     goes through a reservation ("resale order") finished by the gateway.
--  4. Bank transfer slips: passenger uploads a photo, staff check it.
--  5. Push subscriptions + trip reminders sent when the app is closed.
--  6. Bus location history (the trail survives a page reload).
-- Safe to run again.
-- =============================================================================

-- ------------------------------------------------------------ 1. rewards ---
alter table public.app_settings add column if not exists rewards_enabled boolean not null default false;

-- With rewards off this reports "every 0", so nobody has a free trip and
-- create_booking refuses use_reward. Also: only your own figures (or staff).
create or replace function public.loyalty_status(p_user uuid default auth.uid())
returns table (trips integer, every integer, earned integer, used integer, available integer, next_in integer)
language sql stable security definer set search_path = public as $$
  with s as (select case when rewards_enabled then reward_every else 0 end as every from public.app_settings),
  ok as (select (p_user is not distinct from auth.uid() or public.is_staff()) as allowed),
  t as (
    select count(*)::int as trips from public.bookings, ok
    where ok.allowed and user_id = p_user and (status::text = 'boarded' or (status::text = 'confirmed' and travel_date < current_date))
  ),
  u as (select count(*)::int as used from public.bookings, ok where ok.allowed and user_id = p_user and reward_used and status::text <> 'cancelled')
  select t.trips, s.every,
         case when s.every > 0 then t.trips / s.every else 0 end,
         u.used,
         greatest(0, case when s.every > 0 then t.trips / s.every else 0 end - u.used),
         case when s.every > 0 then s.every - (t.trips % s.every) else 0 end
  from s, t, u;
$$;
grant execute on function public.loyalty_status(uuid) to authenticated;

-- ------------------------------------------------------------ 2. payouts ---
-- Money the company owes a passenger: a refund, or the price of a resold seat.
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'resale')),
  booking_id uuid references public.bookings (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  -- Where to send it: {"bank","branch","account_no","account_name"}
  payee jsonb not null default '{}',
  method text not null default '' check (method in ('', 'bank', 'cash', 'gateway', 'other')),
  reference text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles (id) on delete set null
);
create index if not exists payouts_pending_idx on public.payouts (created_at) where status = 'pending';
create index if not exists payouts_user_idx on public.payouts (user_id, created_at desc);
alter table public.payouts enable row level security;
-- Bank details are sensitive: the passenger and office staff only (not conductors).
drop policy if exists "own or office payouts" on public.payouts;
create policy "own or office payouts" on public.payouts for select using (user_id = auth.uid() or public.is_office_staff());
revoke insert, update, delete on public.payouts from anon, authenticated;

-- Creates the payout when money becomes owed on a booking:
--  * cancelled with a refund amount,
--  * a paid booking made cheaper (seat dropped / cheaper day),
--  * a gateway payment that arrived after the hold had expired.
create or replace function public.booking_payouts() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_amount int := 0; v_note text := ''; v_payee jsonb := '{}';
begin
  if new.status::text = 'cancelled' and coalesce(new.refund_amount, 0) > 0 and coalesce(old.refund_amount, 0) = 0 then
    v_amount := new.refund_amount; v_note := 'Booking ' || new.ref || ' cancelled';
  elsif new.status::text = 'cancelled' and old.status::text = 'cancelled' and new.payment_status = 'paid' and old.payment_status = 'unpaid' then
    v_amount := new.total; v_note := 'Paid after the seat hold for ' || new.ref || ' had expired';
  elsif new.status::text in ('confirmed', 'boarded') and old.status::text = new.status::text and new.payment_status = 'paid' and new.total < old.total then
    v_amount := old.total - new.total; v_note := 'Booking ' || new.ref || ' changed';
  end if;
  if v_amount <= 0 then return new; end if;
  -- Reuse the account this passenger gave last time.
  if new.user_id is not null then
    select p.payee into v_payee from public.payouts p
    where p.user_id = new.user_id and p.payee <> '{}'::jsonb order by p.created_at desc limit 1;
  end if;
  insert into public.payouts (kind, booking_id, user_id, amount, payee, notes)
  values ('refund', new.id, new.user_id, v_amount, coalesce(v_payee, '{}'), v_note);
  return new;
end $$;
drop trigger if exists bookings_payouts on public.bookings;
create trigger bookings_payouts after update of status, refund_amount, payment_status, total on public.bookings
  for each row execute function public.booking_payouts();

-- Passenger: say which bank account the money should go to.
create or replace function public.set_payout_details(p_id uuid, p_payee jsonb) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare po public.payouts; clean jsonb;
begin
  clean := jsonb_build_object(
    'bank', left(trim(coalesce(p_payee ->> 'bank', '')), 80),
    'branch', left(trim(coalesce(p_payee ->> 'branch', '')), 80),
    'account_no', left(regexp_replace(coalesce(p_payee ->> 'account_no', ''), '[^0-9A-Za-z -]', '', 'g'), 40),
    'account_name', left(trim(coalesce(p_payee ->> 'account_name', '')), 120));
  if length(clean ->> 'bank') < 2 or length(clean ->> 'account_no') < 5 or length(clean ->> 'account_name') < 2 then
    raise exception 'BAD_ACCOUNT: Add the bank, account number and the name on the account.';
  end if;
  update public.payouts set payee = clean where id = p_id and user_id = auth.uid() and status = 'pending' returning * into po;
  if not found then raise exception 'NOT_FOUND: That refund isn''t waiting for bank details.'; end if;
  return po;
end $$;

-- Office staff: the money has been sent.
create or replace function public.mark_payout_paid(p_id uuid, p_method text, p_reference text default '') returns public.payouts
language plpgsql security definer set search_path = public as $$
declare po public.payouts; bk public.bookings; what text;
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  if p_method not in ('bank', 'cash', 'gateway', 'other') then raise exception 'BAD_PAYMENT: Choose how it was paid.'; end if;
  update public.payouts set status = 'paid', method = p_method, reference = left(coalesce(p_reference, ''), 80), paid_at = now(), paid_by = auth.uid()
  where id = p_id and status = 'pending' returning * into po;
  if not found then raise exception 'NOT_FOUND: That payout is not waiting to be paid.'; end if;
  what := case when po.kind = 'resale' then 'Your resale payout' else 'Your refund' end;
  if po.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (po.user_id, what || ' has been paid', 'LKR ' || po.amount || case when p_method = 'bank' then ' sent to your bank account' when p_method = 'cash' then ' paid in cash' else ' paid' end
      || case when po.reference <> '' then ' (ref ' || po.reference || ')' else '' end || '.', '/my-bookings');
  end if;
  select * into bk from public.bookings where id = po.booking_id;
  if found then
    perform public.enqueue_message(coalesce(nullif(bk.contact_phone, ''), bk.passenger_phone),
      'Siyan Lanka: ' || what || ' of LKR ' || po.amount || ' for ' || bk.ref || ' has been paid'
      || case when po.reference <> '' then ', ref ' || po.reference else '' end || '.', 'payout_paid', bk.id);
  end if;
  return po;
end $$;

-- Office staff: nothing is owed after all (duplicate, settled another way…).
create or replace function public.cancel_payout(p_id uuid, p_reason text default '') returns public.payouts
language plpgsql security definer set search_path = public as $$
declare po public.payouts;
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  update public.payouts set status = 'cancelled', notes = trim(notes || ' · Cancelled: ' || left(coalesce(p_reason, ''), 200))
  where id = p_id and status = 'pending' returning * into po;
  if not found then raise exception 'NOT_FOUND: That payout is not waiting to be paid.'; end if;
  return po;
end $$;

revoke execute on function public.set_payout_details(uuid, jsonb), public.mark_payout_paid(uuid, text, text), public.cancel_payout(uuid, text) from public, anon;
grant execute on function public.set_payout_details(uuid, jsonb), public.mark_payout_paid(uuid, text, text), public.cancel_payout(uuid, text) to authenticated;

-- Bookings cancelled with a refund before this migration: add their payouts
-- once, so nothing owed is forgotten. (Marked so re-running adds nothing.)
insert into public.payouts (kind, booking_id, user_id, amount, notes, created_at)
select 'refund', b.id, b.user_id, b.refund_amount, 'Booking ' || b.ref || ' cancelled (before payouts were tracked)', coalesce(b.refunded_at, now())
from public.bookings b
where b.status::text = 'cancelled' and coalesce(b.refund_amount, 0) > 0 and b.travel_date >= current_date - 30
  and not exists (select 1 from public.payouts p where p.booking_id = b.id);

-- ------------------------------------------------------------- 3. resale ---
-- A buyer paying online first reserves the listing for a few minutes; the
-- seat changes hands only when the payment gateway confirms the money.
create table if not exists public.resale_orders (
  order_ref text primary key,
  listing_id uuid not null references public.resale_listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  passenger jsonb not null,
  contact jsonb not null,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refund_due')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  new_booking_id uuid references public.bookings (id) on delete set null
);
create index if not exists resale_orders_listing_idx on public.resale_orders (listing_id) where status = 'pending';
alter table public.resale_orders enable row level security;
drop policy if exists "own resale orders" on public.resale_orders;
create policy "own resale orders" on public.resale_orders for select using (buyer_id = auth.uid() or public.is_office_staff());
revoke insert, update, delete on public.resale_orders from anon, authenticated;

-- Marketplace: hides listings while someone is paying for them.
create or replace function public.get_resale_listings()
returns table (id uuid, price integer, paid integer, schedule_id text, travel_date date, from_stop text, to_stop text, seats text[], listed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.price, (b.total - b.fee), b.schedule_id, b.travel_date, b.from_stop, b.to_stop, b.seats, l.created_at
  from public.resale_listings l join public.bookings b on b.id = l.booking_id
  where l.status = 'listed' and b.status::text = 'confirmed' and b.travel_date >= current_date
    and (select resale_enabled from public.app_settings)
    and not exists (select 1 from public.resale_orders o
                    where o.listing_id = l.id and o.status = 'pending' and o.expires_at > now() and o.buyer_id is distinct from auth.uid())
  order by b.travel_date, l.created_at;
$$;
grant execute on function public.get_resale_listings() to anon, authenticated;

-- Checks shared by "buy now" and "reserve": is this listing really for sale to this buyer?
create or replace function public.resale_check(p_listing uuid, p_buyer uuid, p_gender text) returns public.resale_listings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; old public.bookings; bus public.buses; sch public.schedules; rt public.routes; s text; leaves timestamptz;
begin
  select * into cfg from public.app_settings;
  if not cfg.resale_enabled then raise exception 'RESALE_OFF: Seat resale isn''t available right now.'; end if;
  if p_buyer is null then raise exception 'SIGN_IN: Please sign in to buy.'; end if;
  select * into l from public.resale_listings where id = p_listing for update;
  if not found or l.status <> 'listed' then raise exception 'GONE: This ticket has just been sold.'; end if;
  if l.seller_id = p_buyer then raise exception 'NOT_ALLOWED: That''s your own listing.'; end if;
  select * into old from public.bookings where id = l.booking_id for update;
  if old.status::text <> 'confirmed' then raise exception 'GONE: This ticket is no longer available.'; end if;
  select * into sch from public.schedules where id = old.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  leaves := ((old.travel_date + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, old.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;
  foreach s in array old.seats loop
    if s = any (bus.ladies_seats) and coalesce(p_gender, '') <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;
  return l;
end $$;

-- The hand-over itself, in one transaction: the seller's booking closes (a
-- payout for the price is created for them) and the buyer gets a new booking
-- for the same seats. Internal: never callable from the browser.
create or replace function public.resale_transfer(p_listing uuid, p_buyer uuid, p_passenger jsonb, p_contact jsonb, p_method text, p_gateway_ref text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; old public.bookings; nb public.bookings; per_seat int;
  gender text := coalesce(p_passenger ->> 'gender', '');
begin
  select * into cfg from public.app_settings;
  l := public.resale_check(p_listing, p_buyer, gender);
  select * into old from public.bookings where id = l.booking_id;
  update public.bookings set status = 'cancelled', refund_amount = l.price, refunded_at = now() where id = old.id;
  -- The trigger filed it as a refund; it is really the seller's sale money.
  update public.payouts set kind = 'resale', notes = 'Seat ' || array_to_string(old.seats, ',') || ' on ' || old.ref || ' resold'
  where booking_id = old.id and status = 'pending' and kind = 'refund';
  per_seat := ceil(l.price::numeric / cardinality(old.seats));
  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_gender,
    passenger_phone, contact_email, contact_phone, user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    payment_method, payment_status, paid_at, payment_ref)
  values (public.new_booking_ref(), old.schedule_id, old.travel_date, old.from_stop, old.to_stop, old.seats,
    left(coalesce(nullif(trim(p_passenger ->> 'name'), ''), 'Passenger'), 120), gender, left(coalesce(p_passenger ->> 'phone', ''), 40),
    left(coalesce(p_contact ->> 'email', ''), 200), left(coalesce(p_contact ->> 'phone', ''), 40),
    p_buyer, p_buyer, 'online', per_seat, cfg.booking_fee, per_seat * cardinality(old.seats) - l.price, 0, l.price + cfg.booking_fee,
    p_method, 'paid', now(), p_gateway_ref)
  returning * into nb;
  update public.resale_listings set status = 'sold', buyer_id = p_buyer, new_booking_id = nb.id, sold_at = now() where id = l.id;
  insert into public.notifications (user_id, title, body, url)
  values (l.seller_id, 'Your seat has been sold', 'Seat ' || array_to_string(old.seats, ', ') || ', ' || old.from_stop || ' → ' || old.to_stop
    || '. We''ll pay you LKR ' || l.price || '. Add your bank account in My trips if you haven''t yet.', '/my-bookings');
  return nb;
end $$;
revoke execute on function public.resale_check(uuid, uuid, text), public.resale_transfer(uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;

-- Buy straight away. Only while Settings → Payments is on "demo" (no money
-- taken); with a live gateway the buyer must pay first (reserve_resale).
create or replace function public.buy_resale(p_listing uuid, p_passenger jsonb, p_contact jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
begin
  if (select payments_mode from public.app_settings) <> 'demo' then
    raise exception 'PAY_ONLINE: Pay online to buy this ticket.';
  end if;
  if exists (select 1 from public.resale_orders o where o.listing_id = p_listing and o.status = 'pending' and o.expires_at > now() and o.buyer_id <> auth.uid()) then
    raise exception 'GONE: Someone else is paying for this ticket right now. Try again in a few minutes.';
  end if;
  return public.resale_transfer(p_listing, auth.uid(), p_passenger, p_contact, 'card', null);
end $$;

-- Live gateway: hold the listing for 15 minutes and hand back what to pay.
create or replace function public.reserve_resale(p_listing uuid, p_passenger jsonb, p_contact jsonb) returns public.resale_orders
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; o public.resale_orders;
begin
  select * into cfg from public.app_settings;
  l := public.resale_check(p_listing, auth.uid(), coalesce(p_passenger ->> 'gender', ''));
  if exists (select 1 from public.resale_orders x where x.listing_id = l.id and x.status = 'pending' and x.expires_at > now() and x.buyer_id <> auth.uid()) then
    raise exception 'GONE: Someone else is paying for this ticket right now. Try again in a few minutes.';
  end if;
  -- One open order per buyer per listing: a retry replaces the earlier one's hold.
  update public.resale_orders set expires_at = now() where listing_id = l.id and buyer_id = auth.uid() and status = 'pending' and expires_at > now();
  insert into public.resale_orders (order_ref, listing_id, buyer_id, passenger, contact, amount, expires_at)
  values ('RS-' || upper(substr(md5(random()::text || clock_timestamp()::text || l.id::text), 1, 10)), l.id, auth.uid(),
    jsonb_build_object('name', left(coalesce(p_passenger ->> 'name', ''), 120), 'gender', coalesce(p_passenger ->> 'gender', ''), 'phone', left(coalesce(p_passenger ->> 'phone', ''), 40)),
    jsonb_build_object('email', left(coalesce(p_contact ->> 'email', ''), 200), 'phone', left(coalesce(p_contact ->> 'phone', ''), 40)),
    l.price + cfg.booking_fee, now() + interval '15 minutes')
  returning * into o;
  return o;
end $$;

-- Called by /api/payhere/notify (secret key) once the money has arrived.
-- If the ticket went to someone else meanwhile, the buyer is owed a refund.
create or replace function public.complete_resale(p_order_ref text, p_amount numeric, p_gateway_ref text, p_method text) returns public.resale_orders
language plpgsql security definer set search_path = public as $$
declare o public.resale_orders; nb public.bookings;
begin
  select * into o from public.resale_orders where order_ref = p_order_ref for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status <> 'pending' then return o; end if; -- idempotent
  if round(p_amount) <> o.amount then raise exception 'AMOUNT_MISMATCH'; end if;
  begin
    nb := public.resale_transfer(o.listing_id, o.buyer_id, o.passenger, o.contact, p_method, p_gateway_ref);
    update public.resale_orders set status = 'paid', new_booking_id = nb.id where order_ref = o.order_ref returning * into o;
  exception when raise_exception then
    insert into public.payouts (kind, user_id, amount, notes)
    values ('refund', o.buyer_id, o.amount, 'Resale order ' || o.order_ref || ' was paid (' || coalesce(p_gateway_ref, '') || ') but the ticket was no longer available');
    insert into public.notifications (user_id, title, body, url)
    values (o.buyer_id, 'That ticket was no longer available', 'Your payment of LKR ' || o.amount || ' will be refunded in full.', '/my-bookings');
    update public.resale_orders set status = 'refund_due' where order_ref = o.order_ref returning * into o;
  end;
  return o;
end $$;

revoke execute on function public.buy_resale(uuid, jsonb, jsonb), public.reserve_resale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.buy_resale(uuid, jsonb, jsonb), public.reserve_resale(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.complete_resale(text, numeric, text, text) from public, anon, authenticated;

-- Switching resale off takes open listings off sale; the seats stay with
-- their owners. (Listings come back if it's switched on again.)
-- Nothing to do here: every resale function and the marketplace check
-- app_settings.resale_enabled on each call.

-- -------------------------------------------------- 4. bank transfer slips ---
alter table public.bookings
  add column if not exists slip_path text,
  add column if not exists slip_reference text not null default '',
  add column if not exists slip_uploaded_at timestamptz,
  add column if not exists slip_rejected_reason text;

insert into storage.buckets (id, name, public) values ('payment-slips', 'payment-slips', false) on conflict (id) do nothing;
drop policy if exists "upload own payment slips" on storage.objects;
create policy "upload own payment slips" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-slips' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "read payment slips" on storage.objects;
create policy "read payment slips" on storage.objects for select to authenticated
  using (bucket_id = 'payment-slips' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_office_staff()));

-- Passenger: "I've paid, here is the slip". Keeps the seat while staff check
-- it: the hold is extended once, by the bank-transfer hold time, never past
-- the booking cut-off.
create or replace function public.submit_payment_slip(p_booking uuid, p_path text, p_reference text default '') returns public.bookings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; leaves timestamptz; v_hold timestamptz;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_booking for update;
  if not found or bk.user_id is distinct from auth.uid() then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text <> 'held' or bk.payment_status <> 'unpaid' then raise exception 'NOT_ALLOWED: This booking isn''t waiting for payment (the hold may have expired).'; end if;
  if coalesce(p_path, '') = '' or split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'BAD_SLIP: Upload a photo of the slip.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  leaves := ((bk.travel_date + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  v_hold := bk.hold_expires_at;
  if bk.slip_uploaded_at is null then
    v_hold := least(greatest(coalesce(bk.hold_expires_at, now()), now() + make_interval(mins => cfg.hold_minutes_bank)),
                    leaves - make_interval(mins => cfg.booking_cutoff_minutes));
  end if;
  update public.bookings set slip_path = p_path, slip_reference = left(coalesce(p_reference, ''), 80), slip_uploaded_at = now(),
         slip_rejected_reason = null, payment_method = 'bank', hold_expires_at = v_hold
  where id = bk.id returning * into bk;
  return bk;
end $$;

-- Office staff: the slip is wrong / unreadable / the money hasn't arrived.
create or replace function public.reject_payment_slip(p_booking uuid, p_reason text default '') returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings; why text := left(coalesce(nullif(trim(p_reason), ''), 'We couldn''t match it to a payment'), 200);
begin
  if not public.is_office_staff() then raise exception 'NOT_ALLOWED: Office staff only.'; end if;
  update public.bookings set slip_path = null, slip_uploaded_at = null, slip_rejected_reason = why
  where id = p_booking and status::text = 'held' and slip_path is not null returning * into bk;
  if not found then raise exception 'NOT_FOUND: No slip waiting on that booking.'; end if;
  if bk.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (bk.user_id, 'We couldn''t accept your payment slip', bk.ref || ': ' || why || '. Please upload it again before the seat is released.', '/my-bookings');
  end if;
  perform public.enqueue_message(coalesce(nullif(bk.contact_phone, ''), bk.passenger_phone),
    'Siyan Lanka: We couldn''t accept the payment slip for ' || bk.ref || ' (' || why || '). Please upload it again in My trips.', 'slip_rejected', bk.id);
  return bk;
end $$;

revoke execute on function public.submit_payment_slip(uuid, text, text), public.reject_payment_slip(uuid, text) from public, anon;
grant execute on function public.submit_payment_slip(uuid, text, text), public.reject_payment_slip(uuid, text) to authenticated;

-- --------------------------------------------------------------- 5. push ---
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for select using (user_id = auth.uid());
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;

-- A browser belongs to whoever signed in on it last.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'BAD_SUBSCRIPTION: That browser subscription isn''t valid.';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.remove_push_subscription(text) to authenticated;

-- In-app notifications are also pushed to the passenger's devices.
alter table public.notifications
  add column if not exists pushed_at timestamptz,
  add column if not exists tag text;
-- Anything older than this migration is treated as already delivered.
update public.notifications set pushed_at = created_at where pushed_at is null and created_at < now() - interval '1 hour';
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

alter table public.bookings add column if not exists reminder_sent_at timestamptz;

-- "Your bus leaves at …" once per booking, p_hours before the passenger's
-- own boarding time. Called every minute by /api/messages/dispatch.
create or replace function public.queue_trip_reminders(p_hours integer default 3) returns integer
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; r record; n int := 0;
begin
  select * into cfg from public.app_settings;
  for r in
    select b.id, b.user_id, b.ref, b.from_stop, b.to_stop, b.seats, bus.reg_no,
           ((b.travel_date + s.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, b.from_stop) ->> 'offsetMin')::int)) as local_leaves
    from public.bookings b
    join public.schedules s on s.id = b.schedule_id
    join public.routes rt on rt.id = s.route_id
    join public.buses bus on bus.id = s.bus_id
    where b.status::text = 'confirmed' and b.user_id is not null and b.reminder_sent_at is null
      and b.travel_date between current_date - 1 and current_date + 1
  loop
    if (r.local_leaves at time zone cfg.timezone) > now() and (r.local_leaves at time zone cfg.timezone) <= now() + make_interval(hours => p_hours) then
      insert into public.notifications (user_id, title, body, url, tag)
      values (r.user_id, 'Your bus leaves at ' || trim(to_char(r.local_leaves, 'HH12:MI AM')),
              r.from_stop || ' → ' || r.to_stop || ' · Seat ' || array_to_string(r.seats, ', ') || ' · ' || r.reg_no || '. Be at the boarding point 20 minutes early.',
              '/my-bookings', 'trip-' || r.id);
      update public.bookings set reminder_sent_at = now() where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_trip_reminders(integer) from public, anon, authenticated;

-- --------------------------------------------------- 6. tracking history ---
create table if not exists public.bus_location_history (
  id bigint generated always as identity primary key,
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  lat double precision not null,
  lng double precision not null,
  speed_kmh numeric,
  heading numeric,
  recorded_at timestamptz not null default now()
);
create index if not exists bus_location_history_run on public.bus_location_history (schedule_id, travel_date, recorded_at desc);
alter table public.bus_location_history enable row level security;
drop policy if exists "read bus history" on public.bus_location_history;
create policy "read bus history" on public.bus_location_history for select using (true);
revoke insert, update, delete on public.bus_location_history from anon, authenticated;

-- Keeps the last 20 points per departure. A point is added when the bus has
-- moved ~50 m or 5 minutes have passed, so a parked bus doesn't fill the trail.
create or replace function public.keep_location_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare last public.bus_location_history;
begin
  select * into last from public.bus_location_history
  where schedule_id = new.schedule_id and travel_date = new.travel_date order by recorded_at desc limit 1;
  if found and abs(last.lat - new.lat) < 0.0005 and abs(last.lng - new.lng) < 0.0005 and new.updated_at - last.recorded_at < interval '5 minutes' then
    return new;
  end if;
  insert into public.bus_location_history (schedule_id, travel_date, lat, lng, speed_kmh, heading, recorded_at)
  values (new.schedule_id, new.travel_date, new.lat, new.lng, new.speed_kmh, new.heading, new.updated_at);
  delete from public.bus_location_history
  where schedule_id = new.schedule_id and travel_date = new.travel_date
    and id not in (select id from public.bus_location_history where schedule_id = new.schedule_id and travel_date = new.travel_date order by recorded_at desc limit 20);
  return new;
end $$;
drop trigger if exists bus_locations_history on public.bus_locations;
create trigger bus_locations_history after insert or update on public.bus_locations
  for each row execute function public.keep_location_history();
