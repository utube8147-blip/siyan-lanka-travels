-- =============================================================================
-- Siyan Lanka Travels — migration 35: close two money holes
--  1. modify_booking: a passenger could add seats to a PAID booking without
--     paying (total went up, payment stayed "paid"), then drop them again and
--     get a payout for money never received. Seat drops also skipped the
--     refund policy (100% back instead of the cancellation tier).
--     Now passengers can swap seats and move dates, but not change how many
--     seats they have: more seats = a new booking, fewer = cancel and rebook.
--     Office staff can still change the seat count at the counter.
--  2. bookings: every staff account (conductors too) could UPDATE any column
--     directly through the API (total, refund_amount, payment_status…), which
--     creates payouts or hides cash. The app only ever writes `status`
--     directly; everything else goes through functions. Now only `status` is
--     writable, and direct status changes are limited to boarding moves.
--  3. Card & wallet can't be opened while Payments is still on "demo".
--  4. Seat holds only for real seats on a running, bookable departure.
--  5. Passengers sign in with their mobile; their email (optional) is kept on
--     the profile just for e-tickets.
-- Safe to run again.
-- =============================================================================

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
         total = bk.fare * cardinality(v_seats) - bk.discount + bk.bike_fee + bk.fee
   where id = p_id returning * into bk;
  return bk;
end $$;
revoke execute on function public.modify_booking(uuid, text[], date) from public, anon;
grant execute on function public.modify_booking(uuid, text[], date) to authenticated;

-- 2a. Direct writes to bookings: the status column only.
revoke update on public.bookings from anon, authenticated;
grant update (status) on public.bookings to authenticated;

-- 2b. …and only the boarding moves the conductor screen makes. Cancelling
-- goes through cancel_booking(); payments through confirm_payment() etc.
-- Functions run as their owner, so this only applies to direct API writes.
create or replace function public.limit_direct_booking_updates() returns trigger
language plpgsql as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if new.status is distinct from old.status and not (
       (old.status::text in ('confirmed', 'held') and new.status::text in ('boarded', 'no-show'))
    or (old.status::text in ('boarded', 'no-show') and new.status::text = case when old.payment_status = 'paid' then 'confirmed' else 'held' end)
  ) then
    raise exception 'NOT_ALLOWED: That change has to be made from the booking screen.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_limit_direct_updates on public.bookings;
create trigger bookings_limit_direct_updates before update on public.bookings
  for each row execute function public.limit_direct_booking_updates();

-- 3. Card & wallet can only be opened once PayHere is live. On "demo" a card
-- booking is confirmed with no money taken, so opening card payments then
-- would give tickets away. (Only checked for changes made from the app.)
create or replace function public.check_payment_settings() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') and new.card_payments and new.payments_mode <> 'payhere'
     and (new.card_payments is distinct from old.card_payments or new.payments_mode is distinct from old.payments_mode) then
    raise exception 'PAYHERE_FIRST: Switch Payments to PayHere before opening card and wallet payments. On demo, card bookings are confirmed without any money taken.';
  end if;
  return new;
end $$;
drop trigger if exists app_settings_check_payments on public.app_settings;
create trigger app_settings_check_payments before update on public.app_settings
  for each row execute function public.check_payment_settings();

-- 4. Seat holds: only real seats on a departure that is open for booking,
-- so nobody can block seats on a bus that isn't running or doesn't exist.
create or replace function public.hold_seats(p_schedule text, p_date date, p_seats text[]) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz := now() + interval '10 minutes'; v_seats text[]; taken text; s text;
  cfg public.app_settings; sch public.schedules; rt public.routes; bus public.buses; leaves timestamptz;
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  delete from public.seat_holds where expires_at < now() or user_id = auth.uid();
  select array_agg(distinct upper(x)) into v_seats from unnest(coalesce(p_seats, '{}')) x where x <> '';
  if v_seats is null then return null; end if; -- nothing selected: holds released
  select * into cfg from public.app_settings;
  if cardinality(v_seats) > greatest(cfg.max_seats_per_booking, 1) and not public.is_office_staff() then
    raise exception 'TOO_MANY: You can book up to % seats at once.', cfg.max_seats_per_booking;
  end if;
  select * into sch from public.schedules where id = p_schedule and active;
  if not found then raise exception 'NOT_FOUND: That departure is not running.'; end if;
  select * into rt from public.routes where id = sch.route_id;
  select * into bus from public.buses where id = sch.bus_id;
  if not public.schedule_runs_on(sch, p_date) then raise exception 'NOT_FOUND: The bus does not run on that day.'; end if;
  leaves := ((p_date + sch.departure::time) + make_interval(mins => (rt.stops -> 0 ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves + interval '1 day' then raise exception 'CLOSED: This bus has already left.'; end if;
  if not public.is_staff() and coalesce(cfg.booking_window_days, 0) > 0
     and p_date > (now() at time zone cfg.timezone)::date + cfg.booking_window_days then
    raise exception 'TOO_EARLY: Booking opens % days before travel.', cfg.booking_window_days;
  end if;
  foreach s in array v_seats loop
    if not public.seat_is_on_bus(bus, s) then raise exception 'BAD_SEAT: Seat % does not exist on this bus.', s; end if;
  end loop;
  select bs.seat into taken from public.booking_seats bs where bs.schedule_id = p_schedule and bs.travel_date = p_date and bs.active and bs.seat = any (v_seats) limit 1;
  if found then raise exception 'SEAT_TAKEN: Seat % was just booked by someone else. Please pick another.', taken; end if;
  begin
    insert into public.seat_holds (schedule_id, travel_date, seat, user_id, expires_at)
    select p_schedule, p_date, x, auth.uid(), v_until from unnest(v_seats) x;
  exception when unique_violation then
    raise exception 'SEAT_HELD: One of those seats is being booked by someone else right now. Pick another, or try again in a few minutes.';
  end;
  return v_until;
end $$;
revoke execute on function public.hold_seats(text, date, text[]) from public, anon;
grant execute on function public.hold_seats(text, date, text[]) to authenticated;

-- 5. Passengers sign in with their mobile number. An email address is
-- optional and only used to send the e-ticket, so it lives on the profile
-- (not as a second way to sign in). Staff keep signing in with email.
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_check check (email = '' or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
grant update (email) on public.profiles to authenticated;
-- Existing accounts: copy the address they signed up with.
update public.profiles p set email = lower(u.email)
from auth.users u where u.id = p.id and p.email = '' and coalesce(u.email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(nullif(new.email, ''), new.raw_user_meta_data ->> 'email', '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then v_email := ''; end if;
  insert into public.profiles (id, full_name, phone, email)
  values (new.id, left(new.raw_user_meta_data ->> 'full_name', 120), coalesce(nullif(new.phone, ''), new.raw_user_meta_data ->> 'phone'), v_email)
  on conflict (id) do nothing;
  return new;
end $$;

drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, created_at timestamptz, last_sign_in_at timestamptz, branch_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  return query
    select p.id, coalesce(nullif(u.email::text, ''), p.email), p.full_name, coalesce(nullif(p.phone, ''), u.phone::text), p.role::text, p.created_at, u.last_sign_in_at, p.branch_id
    from public.profiles p join auth.users u on u.id = p.id
    order by p.role::text desc, p.created_at desc;
end $$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

notify pgrst, 'reload schema';
