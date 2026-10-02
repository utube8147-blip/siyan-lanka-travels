-- =============================================================================
-- Siyan Lanka Travels — migration 6: a one-time code for every online booking
-- Passengers can stay signed in for a long time; each booking they place is
-- confirmed with a fresh code sent to their phone (or email, for accounts
-- without a phone). A code is good for one booking, for 20 minutes.
-- Staff and conductors selling at the counter are not asked.
-- Switch: Staff area → Settings → "Ask for a code on every booking".
-- Safe to run again.
-- =============================================================================
alter table public.app_settings
  add column if not exists booking_otp boolean not null default true,
  add column if not exists booking_otp_minutes integer not null default 20;
-- The number is verified on the seat page; 20 minutes covers that page and checkout.
alter table public.app_settings alter column booking_otp_minutes set default 20;
update public.app_settings set booking_otp_minutes = 20 where booking_otp_minutes = 10;

-- True when the caller's session was verified with a one-time code within the
-- last booking_otp_minutes AND that code hasn't already been used for a
-- booking. Supabase records how a session was verified in the token's "amr"
-- claim: [{"method":"otp","timestamp":<unix seconds>}].
create or replace function public.booking_code_ok() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare claims jsonb; ts bigint; verified timestamptz; last_booking timestamptz;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return false;
  end;
  if claims is null or jsonb_typeof(claims -> 'amr') <> 'array' then return false; end if;
  select max((a ->> 'timestamp')::bigint) into ts
  from jsonb_array_elements(claims -> 'amr') a
  where jsonb_typeof(a) = 'object' and a ->> 'method' = 'otp' and (a ->> 'timestamp') ~ '^[0-9]+$';
  if ts is null then return false; end if;
  verified := to_timestamp(ts);
  if verified < now() - make_interval(mins => (select booking_otp_minutes from public.app_settings)) then return false; end if;
  select max(created_at) into last_booking from public.bookings where user_id = auth.uid() and channel::text = 'online';
  return last_booking is null or last_booking < verified;
end $$;
revoke execute on function public.booking_code_ok() from public, anon;
grant execute on function public.booking_code_ok() to authenticated;

-- Enforced in the database, so it can't be skipped by calling the API directly.
create or replace function public.require_booking_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channel::text = 'online' and auth.uid() is not null and new.user_id = auth.uid()
     and not public.is_staff()
     and (select booking_otp from public.app_settings)
     and not public.booking_code_ok() then
    raise exception 'CODE_REQUIRED: Confirm this booking with the code we send you.';
  end if;
  return new;
end $$;
drop trigger if exists bookings_require_code on public.bookings;
create trigger bookings_require_code before insert on public.bookings
  for each row execute function public.require_booking_code();
