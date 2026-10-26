-- =============================================================================
-- 20261045000000_payments_fees_promo.sql
-- What a passenger pays, and who gets what:
--   ticket fare (e.g. LKR 3,000)
--   + card fee: the payment gateway's cut, a percent of what goes through it
--     (card / wallet only; none for bank transfer)            → gateway_fee
--   + platform fee per booking (Settings, e.g. LKR 120)       → fee
--   = total, all collected from the passenger.
-- Online bookings are paid: by the gateway (the seat is held until it says
-- paid) or by bank transfer (held until the office checks the slip). Paying on
-- the bus or at the counter is no longer offered online; staff sales are as before.
-- The promo code (Settings: code and percent) can be limited to a passenger's
-- first trip, and to bookings made in the installed app. "In the app" is what
-- the app reports (a browser can't prove it was installed), so treat it as a
-- nudge to install, with the first-trip rule as the real limit.
-- money_breakdown(): per month, fares / gateway fees / platform fees, so the
-- platform fees for a month can be paid out.
-- =============================================================================

alter table public.app_settings
  add column if not exists gateway_fee_percent numeric(5,2) not null default 3.00 check (gateway_fee_percent between 0 and 20),
  add column if not exists promo_first_order boolean not null default true,
  add column if not exists promo_app_only boolean not null default true;
alter table public.app_settings alter column booking_fee set default 120;
update public.app_settings set booking_fee = 120 where booking_fee = 50;   -- the old default
update public.app_settings set promo_code = 'SIYAN10', promo_percent = 10 where coalesce(promo_code, '') = '';
alter table public.app_settings alter column pay_on_bus set default false;
update public.app_settings set pay_on_bus = false;

alter table public.bookings add column if not exists gateway_fee integer not null default 0 check (gateway_fee >= 0);

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
  v_gw int := 0; earlier int;
  bk public.bookings;
begin
  perform public.release_expired_holds();
  select * into cfg from public.app_settings;
  if chan <> 'online' and not staff then raise exception 'NOT_ALLOWED: Only staff can make counter or phone bookings.'; end if;
  if chan = 'online' and uid is null then raise exception 'SIGN_IN: Please sign in to book.'; end if;
  if pay not in ('card', 'wallet', 'bank', 'counter', 'bus', 'cash') then raise exception 'BAD_PAYMENT: Choose how you''ll pay.'; end if;
  -- Online, a seat is only sold when it is paid: through the payment gateway, or by bank transfer (slip checked by the office).
  if chan = 'online' and pay not in ('card', 'wallet', 'bank') then
    raise exception 'PAYMENT_UNAVAILABLE: Pay online by card or by bank transfer.';
  end if;

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
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and gender <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;

  -- One price for the whole route (the default): the full-route fare wherever
  -- the passenger gets on or off. Otherwise the difference between the stops.
  v_fare := case when rt.flat_fare then (stops -> (jsonb_array_length(stops) - 1) ->> 'fareFromStart')::int
                 else (stops -> ti ->> 'fareFromStart')::int - (stops -> fi ->> 'fareFromStart')::int end;
  base := v_fare * cardinality(v_seats);
  if chan = 'online' and coalesce(p ->> 'promo', '') <> '' then
    if cfg.promo_code is null or upper(trim(p ->> 'promo')) <> upper(cfg.promo_code) or cfg.promo_percent <= 0 then
      raise exception 'PROMO: That promo code isn''t valid.';
    end if;
    -- First trip only: no earlier booking that went ahead (cancelled ones don't count).
    if cfg.promo_first_order then
      select count(*) into earlier from public.bookings where user_id = uid and status::text <> 'cancelled';
      if earlier > 0 then raise exception 'PROMO: This code is for your first trip only.'; end if;
    end if;
    -- Booked in the installed app (the app tells us; see the note in the migration).
    if cfg.promo_app_only and not coalesce((p ->> 'in_app')::boolean, false) then
      raise exception 'PROMO: This code works when you book in the Siyan Lanka app. Install it, then book from there.';
    end if;
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
      if not kinds ? (bike ->> 'kind') or not coalesce((kinds -> (bike ->> 'kind') ->> 'active')::boolean, true) then
        raise exception 'BAD_BIKE: That kind of bike isn''t carried. Choose another.';
      end if;
      if length(coalesce(bike ->> 'description', '')) < 3 then raise exception 'BAD_BIKE: Describe each bike (make and colour).'; end if;
      if coalesce((kinds -> (bike ->> 'kind') ->> 'needsPlate')::boolean, bike ->> 'kind' <> 'bicycle') and length(coalesce(bike ->> 'reg_no', '')) < 4 then
        raise exception 'BAD_BIKE: Add the number plate.';
      end if;
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
  -- Card / wallet: everything goes through the gateway, which takes its cut, so a held seat waits for it.
  if chan = 'online' and pay in ('card', 'wallet') and base - disc + bike_total + v_fee > 0 then
    v_gw := ceil((base - disc + bike_total + v_fee) * cfg.gateway_fee_percent / 100.0);
    v_status := 'held'; v_pay_status := 'unpaid'; v_hold := now() + interval '20 minutes';
  end if;
  if base - disc + bike_total + v_fee = 0 then pay := 'free'; v_status := 'confirmed'; v_pay_status := 'paid'; v_hold := null; v_gw := 0; end if;

  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats,
    passenger_name, passenger_gender, passenger_phone, contact_email, contact_phone,
    user_id, created_by, channel, fare, fee, discount, bike_fee, gateway_fee, total,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, v_gw, base - disc + bike_total + v_fee + v_gw,
    v_status::public.booking_status, pay, v_pay_status, v_hold, case when v_pay_status = 'paid' then now() end, v_reward)
  returning * into bk;

  if bike_total > 0 then
    insert into public.booking_bikes (booking_id, kind, description, reg_no, photo_path, fee)
    select bk.id, b ->> 'kind', left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;

-- Changing seats or date, or stops, keeps the card fee in the total.
create or replace function public.modify_booking(p_id uuid, p_seats text[] default null, p_date date default null) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; bus public.buses;
  v_seats text[]; v_d date; s text; leaves timestamptz; used int; mine int;
  office boolean := public.is_office_staff();
begin
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_id for update;
  if not found or (bk.user_id is distinct from auth.uid() and not public.is_staff()) then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status::text <> 'confirmed' then raise exception 'NOT_ALLOWED: This booking can no longer be changed.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  v_seats := coalesce((select array_agg(distinct upper(x)) from unnest(p_seats) x where x <> ''), bk.seats);
  v_d := coalesce(p_date, bk.travel_date);
  if cardinality(v_seats) = 0 then raise exception 'NO_SEATS: Keep at least one seat.'; end if;
  -- NEW: only office staff may change the number of seats on a booking.
  if cardinality(v_seats) <> cardinality(bk.seats) and not office then
    raise exception 'SEAT_COUNT: To add seats, make a new booking. To drop a seat, cancel this booking and book again.';
  end if;
  -- schedule_runs_on also understands alternate-day timetables (migration 10).
  if not public.schedule_runs_on(sch, v_d) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;
  leaves := ((v_d + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves - make_interval(mins => cfg.booking_cutoff_minutes) then raise exception 'CLOSED: Too close to departure to change this booking.'; end if;
  if cardinality(v_seats) > cfg.max_seats_per_booking and not office then raise exception 'TOO_MANY: Up to % seats per booking.', cfg.max_seats_per_booking; end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
    if s = any (bus.ladies_seats) and bk.passenger_gender <> 'Female' and not (s = any (bk.seats)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
  end loop;
  if v_d <> bk.travel_date then
    select count(*) into mine from public.booking_bikes where booking_id = bk.id;
    if mine > 0 then
      perform pg_advisory_xact_lock(hashtext(sch.id || v_d::text));
      used := public.bike_spaces_used(sch.id, v_d);
      if used + (select coalesce(sum((cfg.bikes -> 'kinds' -> kind::text ->> 'spaces')::int), 0) from public.booking_bikes where booking_id = bk.id) > bus.bike_spaces then
        raise exception 'BIKES_FULL: No room for your bike on that date.';
      end if;
    end if;
  end if;
  update public.bookings
     set seats = v_seats, travel_date = v_d,
         total = bk.fare * cardinality(v_seats) - bk.discount + bk.bike_fee + bk.fee + bk.gateway_fee
   where id = p_id returning * into bk;
  return bk;
end $$;


-- A refund is a share of the ticket: the platform fee and the gateway's cut aren't refunded.
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
  update public.bookings set status = 'cancelled', refund_amount = round((total - fee - gateway_fee) * pct / 100.0), refunded_at = now(),
         payment_status = case when pct > 0 then 'refunded' else payment_status end
  where id = p_id returning * into bk;
  return bk;
end $$;

create or replace function public.change_booking_stops(p_id uuid, p_from text, p_to text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  bk public.bookings; sch public.schedules; rt public.routes;
  fi int; ti int; v_from text; v_to text; new_fare int; diff int := 0; money_changed boolean := false;
  msg text;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select * into bk from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status not in ('confirmed', 'held', 'boarded') then raise exception 'NOT_ALLOWED: This booking can no longer be changed.'; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;

  fi := public.stop_index(rt.stops, p_from);
  ti := public.stop_index(rt.stops, p_to);
  if fi is null then raise exception 'BAD_STOP: % is not a stop on this route.', p_from; end if;
  if ti is null then raise exception 'BAD_STOP: % is not a stop on this route.', p_to; end if;
  if coalesce((rt.stops -> fi ->> 'hidden')::boolean, false) then raise exception 'STOP_HIDDEN: % is not a stop on this route. Choose another stop.', p_from; end if;
  if coalesce((rt.stops -> ti ->> 'hidden')::boolean, false) then raise exception 'STOP_HIDDEN: % is not a stop on this route. Choose another stop.', p_to; end if;
  if fi >= ti then raise exception 'BAD_STOPS: The stop where they get on has to come before the one where they get off.'; end if;
  v_from := rt.stops -> fi ->> 'name';
  v_to := rt.stops -> ti ->> 'name';
  if bk.status = 'boarded' and lower(v_from) <> lower(bk.from_stop) then
    raise exception 'ON_BOARD: They are already on the bus; only the stop where they get off can change.';
  end if;
  if lower(v_from) = lower(bk.from_stop) and lower(v_to) = lower(bk.to_stop) then
    return jsonb_build_object('changed', false, 'fare_diff', 0, 'money_changed', false);
  end if;

  if not rt.flat_fare then
    new_fare := (rt.stops -> ti ->> 'fareFromStart')::int - (rt.stops -> fi ->> 'fareFromStart')::int;
    diff := (new_fare - bk.fare) * cardinality(bk.seats);
  end if;

  -- booked_from / booked_to stay for moves at the on-request cut-off ("the bus
  -- doesn't go to the stop you booked"); a change agreed with the passenger
  -- simply becomes their stop, with the old one in booking_stop_changes.
  update public.bookings set from_stop = v_from, to_stop = v_to where id = bk.id;
  -- Back to the stop first booked: nothing to remember any more.
  update public.bookings
     set booked_from = case when lower(booked_from) = lower(from_stop) then null else booked_from end,
         booked_to = case when lower(booked_to) = lower(to_stop) then null else booked_to end
   where id = bk.id;
  -- Not paid yet: they pay the fare for the new stretch.
  if diff <> 0 and bk.payment_status = 'unpaid' then
    -- (a card payment's fee follows the new amount)
    update public.bookings
       set fare = new_fare,
           gateway_fee = case when payment_method in ('card', 'wallet')
                              then ceil(greatest(0, new_fare * cardinality(seats) - discount + bike_fee + fee) * (select gateway_fee_percent from public.app_settings) / 100.0)
                              else 0 end
     where id = bk.id;
    update public.bookings set total = greatest(0, fare * cardinality(seats) - discount + bike_fee + fee + gateway_fee) where id = bk.id;
    money_changed := true;
  end if;

  insert into public.booking_stop_changes (booking_id, old_from, old_to, new_from, new_to, fare_diff, note, changed_by)
  values (bk.id, bk.from_stop, bk.to_stop, v_from, v_to, case when money_changed then 0 else diff end, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  msg := 'Siyan Lanka ' || bk.ref || ': as agreed with the conductor, '
      || case when lower(v_from) <> lower(bk.from_stop) and lower(v_to) <> lower(bk.to_stop) then 'you now get on at ' || v_from || ' and off at ' || v_to
              when lower(v_from) <> lower(bk.from_stop) then 'you now get on at ' || v_from
              else 'you now get off at ' || v_to end
      || '. Same seat, same ticket.';
  if bk.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (bk.user_id, 'Your stop has changed', substring(msg from position(': ' in msg) + 2), '/my-bookings?ref=' || bk.ref);
  end if;
  perform public.enqueue_message(coalesce(nullif(bk.contact_phone, ''), bk.passenger_phone), msg, 'stop_change', bk.id);

  return jsonb_build_object('changed', true, 'from', v_from, 'to', v_to, 'fare_diff', diff, 'money_changed', money_changed);
end $$;

-- Per month (by the day the money came in): what passengers paid and how it splits.
-- Refunds are taken off the ticket part (the fees aren't refunded).
create or replace function public.money_breakdown(p_from date, p_to date)
returns table (month date, bookings bigint, seats bigint, tickets bigint, gateway_fees bigint, platform_fees bigint, refunds bigint, collected bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('month', (b.paid_at at time zone (select timezone from public.app_settings)))::date as month,
         count(*), coalesce(sum(cardinality(b.seats)), 0),
         coalesce(sum(b.total - b.fee - b.gateway_fee), 0),
         coalesce(sum(b.gateway_fee), 0),
         coalesce(sum(b.fee), 0),
         coalesce(sum(coalesce(b.refund_amount, 0)) filter (where b.payment_status = 'refunded'), 0),
         coalesce(sum(b.total), 0)
  from public.bookings b
  where public.is_admin()
    and b.paid_at is not null and b.payment_status in ('paid', 'refunded') and coalesce(b.is_test, false) = false
    and (b.paid_at at time zone (select timezone from public.app_settings))::date between p_from and p_to
  group by 1 order by 1 desc;
$$;
revoke execute on function public.money_breakdown(date, date) from public, anon;
grant execute on function public.money_breakdown(date, date) to authenticated;

notify pgrst, 'reload schema';
