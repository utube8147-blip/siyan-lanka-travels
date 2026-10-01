-- =============================================================================
-- Siyan Lanka Travels — migration 3: passenger conveniences + staff tools
--  1. Payment options & seat holds: PayHere (card / eZ Cash / mCash / Genie),
--     bank transfer and pay-at-counter. Unpaid holds expire automatically.
--  2. Rewards: every Nth completed trip, one seat free.
--  3. Waitlist for full departures, with automatic offers on cancellation.
--  4. Saved passengers (one-tap rebooking).
--  5. Live trips: bus location + trip updates (departed / delayed / arriving).
--  6. Conductor contact for passengers on the day of travel.
--  7. Parcel & charter requests.
--  8. Daily cash count for counter sales.
--  9. Message queue for SMS / WhatsApp (sent by /api/messages/dispatch).
-- Enum values added here are compared as text so this file runs in one go.
-- =============================================================================

alter type public.booking_status add value if not exists 'held';

-- ---------------------------------------------------------------- settings ---
alter table public.app_settings
  add column if not exists payments_mode text not null default 'demo' check (payments_mode in ('demo', 'payhere')),
  add column if not exists hold_minutes_counter integer not null default 120,
  add column if not exists hold_minutes_bank integer not null default 1440,
  add column if not exists bank_details text not null default '',
  add column if not exists reward_every integer not null default 10 check (reward_every >= 0),
  add column if not exists messaging jsonb not null default '{"sms": true, "whatsapp": false}',
  add column if not exists site_url text not null default 'https://www.siyanlanka.lk';

-- ------------------------------------------------------------- bookings -----
alter table public.bookings
  add column if not exists payment_method text not null default 'card'
    check (payment_method in ('card', 'wallet', 'bank', 'counter', 'cash', 'free')),
  add column if not exists payment_status text not null default 'paid' check (payment_status in ('paid', 'unpaid', 'refunded')),
  add column if not exists hold_expires_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_ref text,
  add column if not exists reward_used boolean not null default false;

-- Held (unpaid) bookings keep their seats until the hold expires.
create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status::text in ('confirmed', 'boarded', 'held') then
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender)
    select new.id, new.schedule_id, new.travel_date, s, new.passenger_gender from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;

create or replace function public.bike_spaces_used(p_schedule text, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int), 0)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.schedule_id = p_schedule and b.travel_date = p_date and b.status::text in ('confirmed', 'boarded', 'held');
$$;

create or replace function public.get_bike_usage(p_from date, p_to date)
returns table (schedule_id text, travel_date date, spaces int)
language sql stable security definer set search_path = public as $$
  select b.schedule_id, b.travel_date,
         sum(((select bikes from public.app_settings) -> 'kinds' -> k.kind::text ->> 'spaces')::int)::int
  from public.booking_bikes k join public.bookings b on b.id = k.booking_id
  where b.travel_date between p_from and p_to and b.status::text in ('confirmed', 'boarded', 'held')
  group by 1, 2;
$$;

-- Release unpaid holds whose time is up (called before booking, by the app on
-- refresh, and by the dispatcher cron). Safe for anyone to call.
create function public.release_expired_holds() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings set status = 'cancelled', payment_status = 'unpaid'
  where status::text = 'held' and hold_expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.release_expired_holds() to anon, authenticated;

-- ------------------------------------------------------------------ rewards ---
-- Completed trip = boarded, or confirmed and the travel date has passed.
create function public.loyalty_status(p_user uuid default auth.uid())
returns table (trips integer, every integer, earned integer, used integer, available integer, next_in integer)
language sql stable security definer set search_path = public as $$
  with s as (select reward_every as every from public.app_settings),
  t as (
    select count(*)::int as trips from public.bookings
    where user_id = p_user and (status::text = 'boarded' or (status::text = 'confirmed' and travel_date < current_date))
  ),
  u as (select count(*)::int as used from public.bookings where user_id = p_user and reward_used and status::text <> 'cancelled')
  select t.trips, s.every,
         case when s.every > 0 then t.trips / s.every else 0 end,
         u.used,
         greatest(0, case when s.every > 0 then t.trips / s.every else 0 end - u.used),
         case when s.every > 0 then s.every - (t.trips % s.every) else 0 end
  from s, t, u;
$$;
grant execute on function public.loyalty_status(uuid) to authenticated;

-- ----------------------------------------------------- create_booking v2 ---
-- Adds: p.payment ('card' | 'wallet' | 'bank' | 'counter'), p.use_reward.
-- In payments_mode 'payhere', card/wallet bookings are held until PayHere
-- confirms; in 'demo' they're confirmed straight away (simulated payment).
create or replace function public.create_booking(p jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings;
  uid uuid := auth.uid();
  staff boolean := public.is_staff();
  chan public.booking_channel := coalesce(nullif(p ->> 'channel', ''), 'online')::public.booking_channel;
  pay text := coalesce(nullif(p ->> 'payment', ''), case when coalesce(nullif(p ->> 'channel', ''), 'online') = 'online' then 'card' else 'cash' end);
  sch public.schedules; rt public.routes; bus public.buses;
  d date := (p ->> 'date')::date;
  fi int; ti int; stops jsonb; v_seats text[]; s text;
  gender text := coalesce(p -> 'passenger' ->> 'gender', '');
  v_fare int; base int; disc int := 0; v_fee int; bike_total int := 0; full_fare int;
  leaves timestamptz; bike jsonb; need int := 0; kinds jsonb; bfee int; share numeric;
  v_status text := 'confirmed'; v_pay_status text := 'paid'; v_hold timestamptz; v_reward boolean := false;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

  select * into sch from public.schedules where id = p ->> 'schedule_id' and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id and active;
  select * into bus from public.buses where id = sch.bus_id and status = 'active';
  if rt.id is null or bus.id is null then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  if not (extract(dow from d)::smallint = any (sch.days)) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;

  stops := rt.stops;
  fi := public.stop_index(stops, p ->> 'from');
  ti := public.stop_index(stops, p ->> 'to');
  if fi is null or ti is null or fi >= ti then raise exception 'BAD_STOPS: Choose a boarding point before the drop-off.'; end if;

  leaves := ((d + sch.departure::time) + make_interval(mins => (stops -> fi ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if chan = 'online' and now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then
    raise exception 'CLOSED: Online booking for this departure has closed.';
  end if;
  if now() > leaves then raise exception 'CLOSED: This bus has already left.'; end if;

  select array_agg(distinct upper(x)) into v_seats from jsonb_array_elements_text(p -> 'seats') x;
  if v_seats is null or cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Pick at least one seat.'; end if;
  if chan = 'online' and cardinality(v_seats) > cfg.max_seats_per_booking then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;

  v_fare := (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and cfg.promo_code is not null and upper(coalesce(p ->> 'promo', '')) = upper(cfg.promo_code) then
    disc := round(base * cfg.promo_percent / 100.0);
  end if;
  -- Reward: one seat free (on top of any promo, never below zero).
  if chan = 'online' and coalesce((p ->> 'use_reward')::boolean, false) then
    if (select available from public.loyalty_status(uid)) < 1 then raise exception 'NO_REWARD: You don''t have a free trip yet.'; end if;
    disc := least(base, disc + v_fare);
    v_reward := true;
  end if;
  v_fee := case when chan = 'online' then cfg.booking_fee else 0 end;

  if jsonb_array_length(coalesce(p -> 'bikes', '[]')) > 0 then
    kinds := cfg.bikes -> 'kinds';
    if jsonb_array_length(p -> 'bikes') > (cfg.bikes ->> 'maxPerBooking')::int then
      raise exception 'TOO_MANY_BIKES: Up to % bikes per booking.', cfg.bikes ->> 'maxPerBooking';
    end if;
    perform pg_advisory_xact_lock(hashtext(sch.id || d::text));
    full_fare := greatest(1, (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int);
    share := least(1, v_fare::numeric / full_fare);
    for bike in select * from jsonb_array_elements(p -> 'bikes') loop
      if not kinds ? (bike ->> 'kind') then raise exception 'BAD_BIKE: Unknown kind of bike.'; end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if bike ->> 'kind' <> 'bicycle' and length(coalesce(bike ->> 'reg_no', '')) < 4 then raise exception 'BAD_BIKE: Add the number plate.'; end if;
      if chan = 'online' and coalesce(bike ->> 'photo_path', '') = '' then raise exception 'BAD_BIKE: Upload a photo of each bike.'; end if;
      need := need + (kinds -> (bike ->> 'kind') ->> 'spaces')::int;
      bfee := greatest((cfg.bikes ->> 'minFee')::int, (round((kinds -> (bike ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int);
      bike_total := bike_total + bfee;
    end loop;
    if public.bike_spaces_used(sch.id, d) + need > bus.bike_spaces then
      raise exception 'BIKES_FULL: The luggage compartment is full for this departure.';
    end if;
  end if;

  -- Payment state
  if chan = 'online' then
    if pay in ('bank', 'counter') then
      v_status := 'held'; v_pay_status := 'unpaid';
      v_hold := least(now() + make_interval(mins => case when pay = 'bank' then cfg.hold_minutes_bank else cfg.hold_minutes_counter end),
                      leaves - make_interval(mins => cfg.booking_cutoff_minutes));
    elsif cfg.payments_mode = 'payhere' and base - disc + bike_total + v_fee > 0 then
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
    end if;
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, base - disc + bike_total + v_fee,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, (b ->> 'kind')::public.bike_kind, left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

-- Cancelling a held (unpaid) booking refunds nothing.
create or replace function public.cancel_booking(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes;
  leaves timestamptz; hrs numeric; pct int := 0; tier jsonb; staff boolean := public.is_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not staff) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text not in ('confirmed', 'held') then raise exception 'NOT_ALLOWED: Only confirmed bookings can be cancelled.'; end if;
  if bk.payment_status = 'unpaid' then
    update public.bookings set status = 'cancelled', refund_amount = 0, refunded_at = now() where id = p_id returning * into bk;
    return bk;
  end if;
  if staff and bk.user_id is distinct from auth.uid() then
    pct := 100;
  else
    select * into sch from public.schedules where id = bk.schedule_id;
    select * into rt from public.routes where id = sch.route_id;
    leaves := ((bk.travel_date + sch.departure::time)
      + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
    hrs := extract(epoch from (leaves - now())) / 3600;
    for tier in select * from jsonb_array_elements(cfg.refund_policy) loop
      if hrs >= (tier ->> 'hoursBefore')::numeric then pct := (tier ->> 'percent')::int; exit; end if;
    end loop;
  end if;
  update public.bookings set status = 'cancelled', refund_amount = round((total - fee) * pct / 100.0), refunded_at = now(),
         payment_status = case when pct > 0 then 'refunded' else payment_status end
  where id = p_id returning * into bk;
  return bk;
end $$;

-- Staff take payment for a held booking (counter cash / bank transfer seen).
create function public.confirm_payment(p_id uuid, p_method text, p_ref text default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if p_method not in ('cash', 'bank', 'card', 'wallet') then raise exception 'BAD_PAYMENT: Unknown payment method.'; end if;
  update public.bookings set status = 'confirmed', payment_status = 'paid', payment_method = p_method,
         paid_at = now(), payment_ref = p_ref, hold_expires_at = null
  where id = p_id and status::text = 'held' returning * into bk;
  if not found then raise exception 'NOT_FOUND: No unpaid hold with that id (it may have expired).'; end if;
  return bk;
end $$;
revoke execute on function public.confirm_payment(uuid, text, text) from public, anon;
grant execute on function public.confirm_payment(uuid, text, text) to authenticated;

-- PayHere server-to-server confirmation (called by /api/payhere/notify with
-- the secret key, after the signature check). Amount must match.
create function public.mark_paid_by_gateway(p_ref text, p_amount numeric, p_gateway_ref text, p_method text) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  select * into bk from public.bookings where ref = p_ref for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if bk.payment_status = 'paid' then return bk; end if; -- idempotent
  if round(p_amount) <> bk.total then raise exception 'AMOUNT_MISMATCH'; end if;
  if bk.status::text = 'cancelled' then
    -- Paid after the hold expired: keep the money on record for a manual refund/rebook.
    update public.bookings set payment_status = 'paid', paid_at = now(), payment_ref = p_gateway_ref where id = bk.id returning * into bk;
    return bk;
  end if;
  update public.bookings set status = 'confirmed', payment_status = 'paid', payment_method = p_method, paid_at = now(),
         payment_ref = p_gateway_ref, hold_expires_at = null
  where id = bk.id returning * into bk;
  return bk;
end $$;
revoke execute on function public.mark_paid_by_gateway(text, numeric, text, text) from public, anon, authenticated;

-- --------------------------------------------------------------- waitlist ---
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  from_stop text not null,
  to_stop text not null,
  seats integer not null default 1 check (seats between 1 and 6),
  phone text not null default '',
  status text not null default 'waiting' check (status in ('waiting', 'offered', 'booked', 'cancelled', 'expired')),
  offered_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index waitlist_one_active on public.waitlist (user_id, schedule_id, travel_date) where status in ('waiting', 'offered');
alter table public.waitlist enable row level security;
create policy "own waitlist" on public.waitlist for select using (user_id = auth.uid() or public.is_staff());
create policy "join waitlist" on public.waitlist for insert with check (user_id = auth.uid() and status = 'waiting' and travel_date >= current_date);
create policy "leave waitlist" on public.waitlist for update using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('cancelled', 'booked'));

-- In-app notifications (shown in the app; also queued as SMS/WhatsApp).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default '/my-bookings',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "read own notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notifications from anon, authenticated;

-- --------------------------------------------------------------- messaging ---
create table public.message_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('sms', 'whatsapp')),
  to_phone text not null,
  body text not null,
  kind text not null default 'general',
  booking_id uuid references public.bookings (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index message_queue_pending on public.message_queue (created_at) where status = 'pending';
alter table public.message_queue enable row level security;
create policy "admin messages" on public.message_queue for select using (public.is_admin());
revoke insert, update, delete on public.message_queue from anon, authenticated;

create function public.enqueue_message(p_phone text, p_body text, p_kind text, p_booking uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare m jsonb := (select messaging from public.app_settings);
begin
  if coalesce(trim(p_phone), '') = '' then return; end if;
  if coalesce((m ->> 'sms')::boolean, false) then
    insert into public.message_queue (channel, to_phone, body, kind, booking_id) values ('sms', p_phone, p_body, p_kind, p_booking);
  end if;
  if coalesce((m ->> 'whatsapp')::boolean, false) then
    insert into public.message_queue (channel, to_phone, body, kind, booking_id) values ('whatsapp', p_phone, p_body, p_kind, p_booking);
  end if;
end $$;
revoke execute on function public.enqueue_message(text, text, text, uuid) from public, anon, authenticated;

create function public.booking_departure_text(bk public.bookings) returns text
language sql stable security definer set search_path = public as $$
  select to_char(bk.travel_date + s.departure::time + make_interval(mins => (r.stops -> public.stop_index(r.stops, bk.from_stop) ->> 'offsetMin')::int),
                 'Dy DD Mon, HH12:MI AM')
  from public.schedules s join public.routes r on r.id = s.route_id where s.id = bk.schedule_id;
$$;

-- Booking messages: confirmed, held (how to pay), cancelled.
create function public.booking_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text := (select site_url from public.app_settings); bank text := (select bank_details from public.app_settings);
  phone text := coalesce(nullif(new.contact_phone, ''), new.passenger_phone);
  trip text := new.from_stop || ' → ' || new.to_stop || ', ' || public.booking_departure_text(new) || ', seat ' || array_to_string(new.seats, ',');
begin
  if new.channel <> 'online' then return new; end if;
  if new.status::text = 'confirmed' and (tg_op = 'INSERT' or old.status::text <> 'confirmed') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' confirmed. ' || trip || '. Ticket: ' || site || '/my-bookings', 'booking_confirmed', new.id);
  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method in ('bank', 'counter') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat held, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' by '
      || to_char(new.hold_expires_at at time zone (select timezone from public.app_settings), 'Dy DD Mon HH12:MI AM')
      || case when new.payment_method = 'bank' then '. Bank: ' || bank || ' Ref: ' || new.ref else ' at our Bastian Mawatha counter' end || '.', 'booking_held', new.id);
  elsif new.status::text = 'cancelled' and tg_op = 'UPDATE' and old.status::text in ('confirmed', 'held') then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' cancelled'
      || case when coalesce(new.refund_amount, 0) > 0 then '. Refund LKR ' || new.refund_amount || ' on its way.' else '.' end, 'booking_cancelled', new.id);
  end if;
  return new;
end $$;
create trigger bookings_messages after insert or update of status on public.bookings
  for each row execute function public.booking_messages();

-- When seats free up, offer them to the waitlist (oldest first).
create function public.offer_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; cap int; taken int; site text := (select site_url from public.app_settings);
begin
  if not (new.status::text = 'cancelled' and old.status::text in ('confirmed', 'held')) then return new; end if;
  select b.rows * 4 + b.back_row_seats into cap from public.buses b join public.schedules s on s.bus_id = b.id where s.id = new.schedule_id;
  select count(*) into taken from public.booking_seats where schedule_id = new.schedule_id and travel_date = new.travel_date and active;
  for w in select * from public.waitlist where schedule_id = new.schedule_id and travel_date = new.travel_date and status = 'waiting' order by created_at loop
    exit when cap - taken < w.seats;
    update public.waitlist set status = 'offered', offered_at = now() where id = w.id;
    insert into public.notifications (user_id, title, body, url)
    values (w.user_id, 'A seat is free on your bus', w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book it before someone else does.',
            '/seats/' || w.schedule_id || '?date=' || w.travel_date || '&from=' || w.from_stop || '&to=' || w.to_stop);
    perform public.enqueue_message(w.phone, 'Siyan Lanka: A seat is free on ' || w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book now: ' || site || '/my-bookings', 'waitlist_offer');
    taken := taken + w.seats; -- offer to as many as the free seats cover
  end loop;
  return new;
end $$;
create trigger bookings_offer_waitlist after update of status on public.bookings
  for each row execute function public.offer_waitlist();

-- ---------------------------------------------------------- saved people ---
alter table public.profiles add column if not exists saved_passengers jsonb not null default '[]';
grant update (saved_passengers) on public.profiles to authenticated;

-- ------------------------------------------------------------- live trips ---
create table public.bus_locations (
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  lat double precision not null,
  lng double precision not null,
  speed_kmh numeric,
  heading numeric,
  accuracy_m numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (schedule_id, travel_date)
);
create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  kind text not null check (kind in ('departed', 'delayed', 'arriving', 'arrived', 'note')),
  stop text not null default '',
  minutes integer,
  message text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index trip_events_run on public.trip_events (schedule_id, travel_date, created_at);
alter table public.bus_locations enable row level security;
alter table public.trip_events enable row level security;
-- Where the bus is and its updates are public (no personal data).
create policy "read bus location" on public.bus_locations for select using (true);
create policy "staff share location" on public.bus_locations for all using (public.is_staff()) with check (public.is_staff());
create policy "read trip updates" on public.trip_events for select using (true);
create policy "staff post updates" on public.trip_events for insert with check (public.is_staff());
alter publication supabase_realtime add table public.bus_locations, public.trip_events;

-- Trip updates go to everyone on that departure who hasn't got off yet.
create function public.trip_event_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; txt text;
begin
  txt := case new.kind
    when 'departed' then 'Your Siyan Lanka bus has left ' || coalesce(nullif(new.stop, ''), 'its stop') || '.'
    when 'delayed' then 'Your Siyan Lanka bus is running about ' || coalesce(new.minutes, 0) || ' min late.'
    when 'arriving' then 'Your Siyan Lanka bus is about ' || coalesce(new.minutes, 0) || ' min from ' || new.stop || '.'
    when 'arrived' then 'Your Siyan Lanka bus has reached ' || new.stop || '.'
    else 'Siyan Lanka: ' || new.message end;
  if new.message <> '' and new.kind <> 'note' then txt := txt || ' ' || new.message; end if;
  for b in select * from public.bookings where schedule_id = new.schedule_id and travel_date = new.travel_date and status::text in ('confirmed', 'held') loop
    perform public.enqueue_message(coalesce(nullif(b.contact_phone, ''), b.passenger_phone), txt, 'trip_' || new.kind, b.id);
  end loop;
  return new;
end $$;
create trigger trip_events_messages after insert on public.trip_events for each row execute function public.trip_event_messages();

-- Conductor's phone for passengers with a booking on that run, from the day before.
create function public.get_trip_contact(p_booking uuid)
returns table (name text, role text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare bk public.bookings; v_bus text;
begin
  select * into bk from public.bookings where id = p_booking;
  if not found or (bk.user_id is distinct from auth.uid() and not public.is_staff()) then return; end if;
  if bk.travel_date > current_date + 1 or bk.travel_date < current_date - 1 then return; end if;
  select s.bus_id into v_bus from public.schedules s where s.id = bk.schedule_id;
  return query select c.full_name, c.role, c.phone from public.crew c
    where c.bus_id = v_bus and c.active and c.role in ('conductor', 'driver') and c.phone <> ''
    order by (c.role = 'conductor') desc limit 1;
end $$;
grant execute on function public.get_trip_contact(uuid) to authenticated;

-- ------------------------------------------------------ parcels & charters ---
create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('parcel', 'charter')),
  status text not null default 'new' check (status in ('new', 'quoted', 'confirmed', 'done', 'cancelled')),
  name text not null check (length(name) between 2 and 120),
  phone text not null check (length(phone) between 7 and 30),
  email text not null default '',
  details jsonb not null default '{}',
  quote_amount integer,
  staff_notes text not null default '',
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_requests enable row level security;
create policy "anyone can ask" on public.service_requests for insert
  with check (status = 'new' and quote_amount is null and staff_notes = '' and (user_id is null or user_id = auth.uid()) and length(details::text) < 4000);
create policy "own or staff requests" on public.service_requests for select using (user_id = auth.uid() or public.is_staff());
create policy "staff handle requests" on public.service_requests for update using (public.is_staff()) with check (public.is_staff());

-- --------------------------------------------------------------- cash count ---
create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  count_date date not null default current_date,
  expected integer not null,
  counted integer not null,
  notes text not null default '',
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index cash_counts_one_per_day on public.cash_counts (count_date, created_by);
alter table public.cash_counts enable row level security;
create policy "staff count cash" on public.cash_counts for insert with check (public.is_staff() and created_by = auth.uid());
create policy "see cash counts" on public.cash_counts for select using (created_by = auth.uid() or public.is_admin());

-- Staff can attach receipt photos to running costs they log.
create policy "staff see receipts own" on public.expenses for update
  using (public.is_staff() and created_by = auth.uid() and category in ('fuel', 'toll', 'parking', 'cleaning'))
  with check (public.is_staff() and created_by = auth.uid() and category in ('fuel', 'toll', 'parking', 'cleaning'));

-- Stop photos (public, shown to passengers).
insert into storage.buckets (id, name, public) values ('stop-photos', 'stop-photos', true) on conflict (id) do nothing;
create policy "staff upload stop photos" on storage.objects for insert to authenticated with check (bucket_id = 'stop-photos' and public.is_staff());
create policy "read stop photos" on storage.objects for select using (bucket_id = 'stop-photos');
