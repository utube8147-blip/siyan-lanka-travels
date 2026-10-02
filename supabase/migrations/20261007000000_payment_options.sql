-- =============================================================================
-- Siyan Lanka Travels — migration 7: how passengers pay
--  1. Card / wallet: locked until Settings → "Card & wallet payments" is on.
--  2. Bank transfer: slip upload tells office staff; they mark it paid; the
--     passenger is told.
--  3. Pay at the counter: staff mark it paid; the passenger is told.
--  4. Pay on the bus: the seat is kept; the conductor takes cash when
--     scanning or later in the trip and marks it paid; the passenger is told.
-- Safe to run again.
-- =============================================================================
alter table public.app_settings
  add column if not exists card_payments boolean not null default false,
  add column if not exists pay_on_bus boolean not null default true;

alter table public.bookings drop constraint if exists bookings_payment_method_check;
alter table public.bookings add constraint bookings_payment_method_check
  check (payment_method in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash', 'free'));

-- ------------------------------------------------ 1. card / wallet locked ---
-- Enforced on every online booking a passenger makes (including resale
-- purchases), so it can't be skipped by calling the API. Without this, with
-- Payments on "Demo", a card booking was confirmed with no money taken.
create or replace function public.require_open_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel::text = 'online' and auth.uid() is not null and not public.is_staff()
     and new.payment_method in ('card', 'wallet') and new.total > 0
     and not (select card_payments from public.app_settings) then
    raise exception 'PAYMENT_UNAVAILABLE: Card and wallet payments aren''t available yet. Choose bank transfer, pay at the counter, or pay on the bus.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_require_open_payment on public.bookings;
create trigger bookings_require_open_payment before insert on public.bookings
  for each row execute function public.require_open_payment();

-- --------------------------------------------------- 4. pay on the bus ------
-- create_booking, unchanged except: payment "bus" is accepted and held until
-- 12 hours after the passenger's boarding time (so it is never released
-- before or during the trip).
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
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;

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
    if pay = 'bus' then
      -- Pay the conductor in cash. The seat is kept until the trip is over.
      if not cfg.pay_on_bus then raise exception 'PAYMENT_UNAVAILABLE: Paying on the bus isn''t available right now. Choose another way to pay.'; end if;
      v_status := 'held'; v_pay_status := 'unpaid'; v_hold := leaves + interval '12 hours';
    elsif pay in ('bank', 'counter') then
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

-- Staff (office or conductor) record a payment. Works for a held booking and
-- for a passenger who is already on board but hasn't paid yet.
create or replace function public.confirm_payment(p_id uuid, p_method text, p_ref text default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare bk public.bookings;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  if p_method not in ('cash', 'bank', 'card', 'wallet') then raise exception 'BAD_PAYMENT: Unknown payment method.'; end if;
  update public.bookings set status = case when status::text = 'held' then 'confirmed' else status end,
         payment_status = 'paid', payment_method = p_method, paid_at = now(), payment_ref = p_ref, hold_expires_at = null
  where id = p_id and payment_status = 'unpaid' and status::text in ('held', 'boarded') returning * into bk;
  if not found then raise exception 'NOT_FOUND: No unpaid booking with that id (it may have expired or been paid already).'; end if;
  return bk;
end $$;
revoke execute on function public.confirm_payment(uuid, text, text) from public, anon;
grant execute on function public.confirm_payment(uuid, text, text) to authenticated;

-- ------------------------------------------------ who gets told what --------
-- Tell every office staff member (in-app + push to their devices).
create or replace function public.notify_office(p_title text, p_body text, p_url text) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, title, body, url)
  select id, p_title, p_body, p_url from public.profiles where role::text in ('staff', 'admin');
$$;
revoke execute on function public.notify_office(text, text, text) from public, anon, authenticated;

-- Texts to the passenger. New here: pay-on-the-bus wording, and "payment
-- received" when staff or the conductor mark a booking paid.
create or replace function public.booking_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare site text := (select site_url from public.app_settings); bank text := (select bank_details from public.app_settings);
  phone text := coalesce(nullif(new.contact_phone, ''), new.passenger_phone);
  trip text := new.from_stop || ' → ' || new.to_stop || ', ' || public.booking_departure_text(new) || ', seat ' || array_to_string(new.seats, ',');
begin
  if new.channel <> 'online' then return new; end if;
  if tg_op = 'UPDATE' and old.payment_status = 'unpaid' and new.payment_status = 'paid' and new.status::text in ('confirmed', 'boarded') then
    -- Marked paid by staff / the conductor / the gateway.
    perform public.enqueue_message(phone, 'Siyan Lanka: Payment of LKR ' || new.total || ' received. Booking ' || new.ref || ' is confirmed. ' || trip || '. Ticket: ' || site || '/my-bookings', 'booking_confirmed', new.id);
    if new.user_id is not null then
      insert into public.notifications (user_id, title, body, url)
      values (new.user_id, 'Payment received', 'LKR ' || new.total || ' for ' || new.ref || '. Your seat ' || array_to_string(new.seats, ', ') || ' is confirmed.', '/my-bookings');
    end if;
  elsif new.status::text = 'confirmed' and (tg_op = 'INSERT' or old.status::text not in ('confirmed', 'boarded', 'no-show')) then
    perform public.enqueue_message(phone, 'Siyan Lanka: Booking ' || new.ref || ' confirmed. ' || trip || '. Ticket: ' || site || '/my-bookings', 'booking_confirmed', new.id);
  elsif new.status::text = 'held' and tg_op = 'INSERT' and new.payment_method = 'bus' then
    perform public.enqueue_message(phone, 'Siyan Lanka: Seat reserved, ' || new.ref || '. ' || trip || '. Pay LKR ' || new.total || ' in cash to the conductor on the bus. Ticket: ' || site || '/my-bookings', 'booking_held', new.id);
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
drop trigger if exists bookings_messages on public.bookings;
create trigger bookings_messages after insert or update of status, payment_status on public.bookings
  for each row execute function public.booking_messages();

-- Office staff hear about it when a counter booking is waiting for payment…
create or replace function public.booking_office_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel::text = 'online' and new.status::text = 'held' and new.payment_method = 'counter' then
    perform public.notify_office('Seat held: pay at counter', new.ref || ' · ' || new.passenger_name || ' · LKR ' || new.total || ' · ' || new.from_stop || ' → ' || new.to_stop, '/admin/bookings');
  end if;
  return new;
end $$;
drop trigger if exists bookings_office_alerts on public.bookings;
create trigger bookings_office_alerts after insert on public.bookings
  for each row execute function public.booking_office_alerts();

-- …and when a bank slip arrives.
create or replace function public.slip_office_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.slip_path is not null and new.slip_path is distinct from old.slip_path then
    perform public.notify_office('Bank slip to check', new.ref || ' · ' || new.passenger_name || ' · LKR ' || new.total
      || case when new.slip_reference <> '' then ' · ref ' || new.slip_reference else '' end, '/admin/bookings');
  end if;
  return new;
end $$;
drop trigger if exists bookings_slip_alert on public.bookings;
create trigger bookings_slip_alert after update of slip_path on public.bookings
  for each row execute function public.slip_office_alert();
