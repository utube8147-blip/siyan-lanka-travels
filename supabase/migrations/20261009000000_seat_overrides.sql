-- =============================================================================
-- Siyan Lanka Travels — migration 9: seat overrides
--  1. Reserved seats: set per bus. Nobody can book them online. Staff can
--     sell one only after the owner agrees: the owner gets a code by text,
--     tells the staff member, and the code unlocks that seat for that sale.
--  2. Ladies-only override: office staff can sell a ladies-only seat to a
--     male passenger for one sale.
-- Safe to run again.
-- =============================================================================
alter table public.buses add column if not exists reserved_seats text[] not null default '{}';

-- One request to the owner for specific reserved seats on one departure.
create table if not exists public.seat_approvals (
  id uuid primary key default gen_random_uuid(),
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  seats text[] not null,
  note text not null default '',
  code text not null,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'used', 'expired'))
);
create index if not exists seat_approvals_run on public.seat_approvals (schedule_id, travel_date, requested_at desc);
-- Nobody reads this table from the browser (it holds the codes): no policies.
alter table public.seat_approvals enable row level security;
revoke all on public.seat_approvals from anon, authenticated;

-- Staff: ask the owner to release reserved seats. Creates the code; the
-- server route /api/owner-approval texts it to the owner's number (.env).
create or replace function public.request_seat_approval(p_schedule text, p_date date, p_seats text[], p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare bus public.buses; v_seats text[]; v_id uuid;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select b.* into bus from public.schedules s join public.buses b on b.id = s.bus_id where s.id = p_schedule;
  if not found then raise exception 'NOT_FOUND: That departure doesn''t exist.'; end if;
  select array_agg(distinct upper(x)) into v_seats from unnest(p_seats) x where upper(x) = any (bus.reserved_seats);
  if v_seats is null then raise exception 'NOT_RESERVED: None of those seats is a reserved seat.'; end if;
  if exists (select 1 from public.booking_seats bs where bs.schedule_id = p_schedule and bs.travel_date = p_date and bs.seat = any (v_seats)) then
    raise exception 'SEAT_TAKEN: One of those seats is already sold.';
  end if;
  -- The owner shouldn't be flooded with texts: one request a minute per departure.
  if exists (select 1 from public.seat_approvals where schedule_id = p_schedule and travel_date = p_date and requested_at > now() - interval '1 minute') then
    raise exception 'TOO_SOON: A code was sent to the owner a moment ago. Wait a minute before asking again.';
  end if;
  update public.seat_approvals set status = 'expired' where schedule_id = p_schedule and travel_date = p_date and requested_by = auth.uid() and status in ('pending', 'approved');
  insert into public.seat_approvals (schedule_id, travel_date, seats, note, code, requested_by, expires_at)
  values (p_schedule, p_date, v_seats, left(coalesce(p_note, ''), 120),
          lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0'),
          auth.uid(), now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Staff: enter the code the owner read out. Right code → those seats can be
-- sold by this staff member for the next 15 minutes, once.
create or replace function public.verify_seat_approval(p_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a public.seat_approvals;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select * into a from public.seat_approvals where id = p_id and requested_by = auth.uid() for update;
  if not found or a.status <> 'pending' or a.expires_at < now() then
    raise exception 'EXPIRED: That code has run out. Ask the owner for a new one.';
  end if;
  if a.attempts >= 5 then
    update public.seat_approvals set status = 'expired' where id = a.id;
    return false;
  end if;
  if a.code <> regexp_replace(coalesce(p_code, ''), '\D', '', 'g') then
    update public.seat_approvals set attempts = attempts + 1, status = case when attempts + 1 >= 5 then 'expired' else status end where id = a.id;
    return false;
  end if;
  update public.seat_approvals set status = 'approved', expires_at = now() + interval '15 minutes' where id = a.id;
  return true;
end $$;
revoke execute on function public.request_seat_approval(text, date, text[], text), public.verify_seat_approval(uuid, text) from public, anon;
grant execute on function public.request_seat_approval(text, date, text[], text), public.verify_seat_approval(uuid, text) to authenticated;

-- Enforced on every booking and every seat change: a reserved seat needs an
-- approval the owner's code unlocked, for this departure, by this staff member.
create or replace function public.enforce_reserved_seats() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reserved text[]; v_new text[]; v_id uuid;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  select b.reserved_seats into v_reserved from public.schedules s join public.buses b on b.id = s.bus_id where s.id = new.schedule_id;
  if v_reserved is null or cardinality(v_reserved) = 0 then return new; end if;
  select array_agg(x) into v_new from unnest(new.seats) x
  where x = any (v_reserved)
    and not (tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and x = any (old.seats));
  if v_new is null then return new; end if;
  select id into v_id from public.seat_approvals
  where schedule_id = new.schedule_id and travel_date = new.travel_date and status = 'approved' and expires_at > now()
    and requested_by = auth.uid() and seats @> v_new
  order by requested_at desc limit 1 for update;
  if v_id is null then
    raise exception 'RESERVED_SEAT: Seat % is reserved. It can only be sold with the owner''s approval.', array_to_string(v_new, ', ');
  end if;
  update public.seat_approvals set status = 'used' where id = v_id;
  return new;
end $$;
drop trigger if exists bookings_reserved_seats on public.bookings;
create trigger bookings_reserved_seats before insert or update of seats, schedule_id, travel_date on public.bookings
  for each row execute function public.enforce_reserved_seats();

-- create_booking, unchanged except the ladies-only override for office staff.
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
