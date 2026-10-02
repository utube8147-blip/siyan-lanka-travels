-- =============================================================================
-- Siyan Lanka Travels — migration 14: every booking is confirmed on a mobile
-- However the passenger signed in (email or phone), a seat is confirmed with a
-- 6-digit code texted to the mobile number they give for the booking. The
-- code is ours (not the sign-in code), so:
--   * an account that signed in with email is asked for a mobile too;
--   * signing in with a code a moment ago no longer counts;
--   * the booking's contact number is the number that was verified.
-- Replaces the rule from migration 6. Switch and time limit are unchanged
-- (Settings → "Code on every booking"; app_settings.booking_otp_minutes).
-- Safe to run again.
-- =============================================================================
-- 0771234567 / +94 77 123 4567 / 94771234567 → 94771234567 (null if it isn't a Sri Lankan mobile)
create or replace function public.lk_mobile(p text) returns text
language sql immutable as $$
  select case when d ~ '^947[0-9]{8}$' then d end
  from (select regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^0094', '94'), '^0', '94') as d) x;
$$;

create table if not exists public.booking_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  phone text not null,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'verified', 'used', 'expired')),
  verified_at timestamptz
);
create index if not exists booking_codes_user_idx on public.booking_codes (user_id, created_at desc);
create index if not exists booking_codes_phone_idx on public.booking_codes (phone, created_at desc);
-- Holds the codes: nobody reads it from the browser (no policies).
alter table public.booking_codes enable row level security;
revoke all on public.booking_codes from anon, authenticated;

-- Passenger: "text me a code". The server route /api/booking-code sends it.
create or replace function public.request_booking_code(p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_phone text := public.lk_mobile(p_phone); v_id uuid;
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  if v_phone is null then raise exception 'BAD_PHONE: Enter a Sri Lankan mobile number, like 077 123 4567.'; end if;
  -- Texts cost money and must not be used to pester a number.
  if exists (select 1 from public.booking_codes where (user_id = auth.uid() or phone = v_phone) and created_at > now() - interval '50 seconds') then
    raise exception 'TOO_SOON: A code was sent less than a minute ago. Wait a moment, then ask again.';
  end if;
  if (select count(*) from public.booking_codes where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 6
     or (select count(*) from public.booking_codes where phone = v_phone and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'TOO_MANY: Too many codes were asked for. Try again in an hour.';
  end if;
  update public.booking_codes set status = 'expired' where user_id = auth.uid() and status in ('pending', 'verified');
  insert into public.booking_codes (user_id, phone, code, expires_at)
  values (auth.uid(), v_phone, lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0'), now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Passenger: enter the code. Right code → that number is verified for one booking.
create or replace function public.verify_booking_code(p_id uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare c public.booking_codes;
begin
  select * into c from public.booking_codes where id = p_id and user_id = auth.uid() for update;
  if not found or c.status <> 'pending' or c.expires_at < now() then
    raise exception 'EXPIRED: That code has run out. Ask for a new one.';
  end if;
  if c.code <> regexp_replace(coalesce(p_code, ''), '\D', '', 'g') then
    update public.booking_codes set attempts = attempts + 1, status = case when attempts + 1 >= 5 then 'expired' else status end where id = c.id;
    return false;
  end if;
  update public.booking_codes set status = 'verified', verified_at = now() where id = c.id;
  return true;
end $$;
revoke execute on function public.request_booking_code(text), public.verify_booking_code(uuid, text) from public, anon;
grant execute on function public.request_booking_code(text), public.verify_booking_code(uuid, text) to authenticated;

-- Is there a verified, unused code for this caller and this number, recent enough?
create or replace function public.booking_code_ok(p_phone text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.booking_codes
    where user_id = auth.uid() and status = 'verified'
      and verified_at > now() - make_interval(mins => (select booking_otp_minutes from public.app_settings))
      and (p_phone is null or phone = public.lk_mobile(p_phone)));
$$;
revoke execute on function public.booking_code_ok(text) from public, anon;
grant execute on function public.booking_code_ok(text) to authenticated;
drop function if exists public.booking_code_ok();

-- Enforced on every online booking a passenger makes, so it can't be skipped
-- by calling the API. The booking's contact number must be the verified one,
-- and each code confirms one booking.
create or replace function public.require_booking_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (new.channel::text = 'online' and auth.uid() is not null and new.user_id = auth.uid()
          and not public.is_staff() and (select booking_otp from public.app_settings)) then
    return new;
  end if;
  select id into v_id from public.booking_codes
  where user_id = auth.uid() and status = 'verified'
    and verified_at > now() - make_interval(mins => (select booking_otp_minutes from public.app_settings))
    and phone = public.lk_mobile(coalesce(nullif(new.contact_phone, ''), new.passenger_phone))
  order by verified_at desc limit 1 for update;
  if v_id is null then
    raise exception 'CODE_REQUIRED: Confirm this booking with the code we send you.';
  end if;
  update public.booking_codes set status = 'used' where id = v_id;
  return new;
end $$;
drop trigger if exists bookings_require_code on public.bookings;
create trigger bookings_require_code before insert on public.bookings
  for each row execute function public.require_booking_code();
