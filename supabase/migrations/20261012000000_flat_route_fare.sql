-- =============================================================================
-- Siyan Lanka Travels — migration 12: one price per route
-- A ticket costs the route's price whichever stops the passenger uses
-- (getting off in the middle costs the same). Set per route in Staff area →
-- Routes & timetable → Edit; routes can still be switched to per-stop fares.
-- Safe to run again.
-- =============================================================================
alter table public.routes add column if not exists flat_fare boolean not null default true;

-- create_booking, unchanged except how the fare per seat is worked out.
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
    select bk.id, b ->> 'kind', left(b ->> 'description', 120), upper(left(coalesce(b ->> 'reg_no', ''), 20)),
           nullif(b ->> 'photo_path', ''),
           greatest((cfg.bikes ->> 'minFee')::int, (round((cfg.bikes -> 'kinds' -> (b ->> 'kind') ->> 'fullRouteFee')::int * share / 50) * 50)::int)
    from jsonb_array_elements(p -> 'bikes') b;
  end if;
  return bk;
end $$;
