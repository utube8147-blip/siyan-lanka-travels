-- =============================================================================
-- 20261047000000_seat_genders.sql
-- Who sits in each seat, instead of one gender for the whole booking.
--  * bookings.seat_genders: {"3A": "Female", "3B": ""} ('' = not given).
--  * A seat beside someone else's seat must say male or female (online); seats
--    side by side in the same booking (travelling together) may leave it out.
--  * Women-only seats (bus.ladies_seats) need that seat to be a woman's, not
--    the whole booking's lead passenger.
--  * "Beside a woman travelling alone" is per seat now: a woman's seat whose
--    neighbour isn't in her own booking is protected, even when her booking
--    has other seats elsewhere on the bus.
--  * The public seat map (booking_seats) shows each seat's own gender and
--    whether it sits alone.
-- Old bookings (no seat_genders) keep using the passenger's gender.
-- =============================================================================

alter table public.bookings add column if not exists seat_genders jsonb not null default '{}';

-- The gender for one seat of a booking.
create or replace function public.seat_gender(p_bk public.bookings, p_seat text) returns text
language sql immutable as $$
  select case when p_bk.seat_genders ? p_seat then coalesce(p_bk.seat_genders ->> p_seat, '') else coalesce(p_bk.passenger_gender, '') end;
$$;

-- Does a seat of this booking sit alone (no neighbour in the same booking)?
create or replace function public.seat_alone(p_bk public.bookings, p_bus public.buses, p_seat text) returns boolean
language sql stable as $$
  select not exists (select 1 from unnest(public.seat_neighbours(p_bus, p_seat)) nb where nb = any (p_bk.seats));
$$;

create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
declare bus public.buses;
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status::text in ('confirmed', 'boarded', 'held') then
    select b.* into bus from public.schedules sc join public.buses b on b.id = sc.bus_id where sc.id = new.schedule_id;
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender, solo)
    select new.id, new.schedule_id, new.travel_date, s, public.seat_gender(new, s),
           case when bus.id is null then cardinality(new.seats) = 1 else public.seat_alone(new, bus, s) end
    from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;

create or replace function public.enforce_seat_beside_woman() returns trigger
language plpgsql security definer set search_path = public as $$
declare bus public.buses; s text; nb text; other public.bookings;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if not (select ladies_adjacent from public.app_settings) then return new; end if;
  if auth.uid() is null or public.is_office_staff() then return new; end if; -- gateway / office override
  select b.* into bus from public.schedules sc join public.buses b on b.id = sc.bus_id where sc.id = new.schedule_id;
  if not found then return new; end if;
  foreach s in array new.seats loop
    -- on a seat change, only the seats being moved into are checked
    continue when tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and s = any (old.seats);
    -- a woman may sit beside a woman
    continue when public.seat_gender(new, s) = 'Female';
    foreach nb in array public.seat_neighbours(bus, s) loop
      continue when nb = any (new.seats);
      select b.* into other from public.bookings b
      where b.schedule_id = new.schedule_id and b.travel_date = new.travel_date and b.id <> new.id
        and b.status::text in ('confirmed', 'boarded', 'held') and nb = any (b.seats) limit 1;
      if found and public.seat_gender(other, nb) = 'Female' and public.seat_alone(other, bus, nb)
         and (new.user_id is null or other.user_id is distinct from new.user_id) then
        raise exception 'LADIES_NEIGHBOUR: Seat % is beside a woman travelling alone, so it is kept for women passengers. Please choose another seat.', s;
      end if;
    end loop;
  end loop;
  return new;
end $$;

-- Changing who sits where also refreshes the seat map and is checked.
drop trigger if exists bookings_sync_seats on public.bookings;
create trigger bookings_sync_seats after insert or update of status, seats, travel_date, schedule_id, passenger_gender, seat_genders
  on public.bookings for each row execute function public.sync_booking_seats();
drop trigger if exists bookings_seat_beside_woman on public.bookings;
create trigger bookings_seat_beside_woman before insert or update of seats, schedule_id, travel_date, passenger_gender, seat_genders on public.bookings
  for each row execute function public.enforce_seat_beside_woman();

-- Refresh the public seat map of upcoming trips with per-seat genders.
update public.booking_seats bs
   set gender = public.seat_gender(b, bs.seat),
       solo = public.seat_alone(b, bu, bs.seat)
  from public.bookings b
  join public.schedules sc on sc.id = b.schedule_id
  join public.buses bu on bu.id = sc.bus_id
 where bs.booking_id = b.id and b.travel_date >= current_date - 1;

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
  sg jsonb := '{}'; sgen text; nb text; alone boolean;
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
    -- Who sits in this seat: its own answer ("seat_genders": {"3A": "Female", "3B": ""}), else the passenger's.
    sgen := case when p -> 'seat_genders' ? s then coalesce(p -> 'seat_genders' ->> s, '') else gender end;
    if sgen not in ('', 'Male', 'Female') then sgen := ''; end if;
    sg := sg || jsonb_build_object(s, sgen);
    -- Office staff can override the ladies-only rule for one sale ("override_ladies": true).
    if s = any (bus.ladies_seats) and sgen <> 'Female'
       and not (public.is_office_staff() and coalesce((p ->> 'override_ladies')::boolean, false)) then
      raise exception 'LADIES_SEAT: Seat % is for female passengers.', s;
    end if;
    -- A seat that sits beside someone else's seat needs to know who sits in it (the
    -- "beside a woman travelling alone" rule uses it). Seats side by side in one
    -- booking (travelling together) don't.
    if chan = 'online' and sgen = '' then
      alone := false;
      foreach nb in array public.seat_neighbours(bus, s) loop
        if not nb = any (v_seats) then alone := true; end if;
      end loop;
      if alone then raise exception 'GENDER_NEEDED: Tell us who sits in seat % (male or female): the seat beside it is someone else''s.', s; end if;
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
    user_id, created_by, channel, fare, fee, discount, bike_fee, gateway_fee, total, seat_genders,
    status, payment_method, payment_status, hold_expires_at, paid_at, reward_used)
  values (public.new_booking_ref(), sch.id, d, stops -> fi ->> 'name', stops -> ti ->> 'name', v_seats,
    left(coalesce(nullif(trim(p -> 'passenger' ->> 'name'), ''), 'Passenger'), 120), gender,
    left(coalesce(p -> 'passenger' ->> 'phone', ''), 40), left(coalesce(p -> 'contact' ->> 'email', ''), 200),
    left(coalesce(p -> 'contact' ->> 'phone', ''), 40),
    case when chan = 'online' then uid end, uid, chan, v_fare, v_fee, disc, bike_total, v_gw, base - disc + bike_total + v_fee + v_gw, sg,
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

notify pgrst, 'reload schema';
