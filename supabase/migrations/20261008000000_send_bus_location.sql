-- =============================================================================
-- Siyan Lanka Travels — migration 8: send the bus location to one passenger
-- The conductor (or office) taps a passenger and sends them where the bus is
-- right now: WhatsApp when it's set up and the number is on WhatsApp,
-- otherwise a text message. Safe to run again.
-- =============================================================================
-- A WhatsApp message that should go out as SMS instead if WhatsApp can't deliver it.
alter table public.message_queue add column if not exists fallback_sms boolean not null default false;

create or replace function public.send_bus_location(p_booking uuid) returns text
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bk public.bookings; loc public.bus_locations; reg text; phone text; body text; chan text;
begin
  if not public.is_staff() then raise exception 'NOT_ALLOWED: Staff only.'; end if;
  select * into cfg from public.app_settings;
  select * into bk from public.bookings where id = p_booking;
  if not found or bk.status::text in ('cancelled', 'no-show') then raise exception 'NOT_FOUND: That booking isn''t active.'; end if;
  phone := coalesce(nullif(bk.contact_phone, ''), nullif(bk.passenger_phone, ''));
  if phone is null then raise exception 'NO_PHONE: There is no phone number on this booking.'; end if;
  select * into loc from public.bus_locations where schedule_id = bk.schedule_id and travel_date = bk.travel_date;
  if not found or loc.updated_at < now() - interval '10 minutes' then
    raise exception 'NO_LOCATION: Turn on "Share location" first, so there is a position to send.';
  end if;
  -- One tap is enough: don't let a double tap send (and bill) two messages.
  if exists (select 1 from public.message_queue where booking_id = bk.id and kind = 'bus_location' and created_at > now() - interval '2 minutes') then
    raise exception 'TOO_SOON: The location was sent to this passenger a moment ago.';
  end if;
  select b.reg_no into reg from public.schedules s join public.buses b on b.id = s.bus_id where s.id = bk.schedule_id;
  body := 'Siyan Lanka: Your bus ' || coalesce(reg, '') || ' (' || bk.from_stop || ' → ' || bk.to_stop || ', seat ' || array_to_string(bk.seats, ',')
    || ') is here now: https://maps.google.com/?q=' || round(loc.lat::numeric, 5) || ',' || round(loc.lng::numeric, 5)
    || ' (' || trim(to_char(loc.updated_at at time zone cfg.timezone, 'HH12:MI AM')) || '). Live: ' || cfg.site_url || '/track?ref=' || bk.ref;
  chan := case when coalesce((cfg.messaging ->> 'whatsapp')::boolean, false) then 'whatsapp' else 'sms' end;
  insert into public.message_queue (channel, to_phone, body, kind, booking_id, fallback_sms)
  values (chan, phone, body, 'bus_location', bk.id, chan = 'whatsapp');
  -- Also in the app (and as a push notification) for passengers with an account.
  if bk.user_id is not null then
    insert into public.notifications (user_id, title, body, url)
    values (bk.user_id, 'Your bus is on the way', 'See where ' || coalesce(reg, 'the bus') || ' is right now.', '/track?ref=' || bk.ref);
  end if;
  return chan;
end $$;
revoke execute on function public.send_bus_location(uuid) from public, anon;
grant execute on function public.send_bus_location(uuid) to authenticated;
