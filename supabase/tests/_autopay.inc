\set QUIET on
-- Test only (never in the app's database): with payments_mode = 'demo', an
-- online card / wallet booking is paid at once, as if the gateway answered
-- straight away. Since migration 45 such a booking waits for the gateway.
set client_min_messages = warning;
create or replace function public.test_autopay() returns trigger language plpgsql as $$
begin
  if new.channel::text = 'online' and new.payment_method in ('card', 'wallet') and new.status::text = 'held'
     and (select payments_mode from public.app_settings) = 'demo' then
    new.status := 'confirmed'; new.payment_status := 'paid'; new.paid_at := now(); new.hold_expires_at := null;
  end if;
  return new;
end $$;
drop trigger if exists test_autopay on public.bookings;
create trigger test_autopay before insert on public.bookings for each row execute function public.test_autopay();
reset client_min_messages;
