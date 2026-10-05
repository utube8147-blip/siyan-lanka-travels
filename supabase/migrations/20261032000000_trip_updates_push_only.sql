-- =============================================================================
-- Siyan Lanka Travels — migration 32: conductor updates are push notifications only
-- "Update passengers" (left, running late, arriving, arrived, a note) no longer
-- sends a text or WhatsApp message to every passenger: on a full bus that was
-- about 45 texts each time. It now goes as a push notification to passengers
-- who have an account and that trip's bell on, and it still shows on the
-- tracking page for everyone. The booking text, payment texts and "send bus
-- location to this passenger" are not changed.
-- Safe to run again.
-- =============================================================================
create or replace function public.trip_event_messages() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; txt text; head text;
begin
  txt := case new.kind
    when 'departed' then 'Your Siyan Lanka bus has left ' || coalesce(nullif(new.stop, ''), 'its stop') || '.'
    when 'delayed' then 'Your Siyan Lanka bus is running about ' || coalesce(new.minutes, 0) || ' min late.'
    when 'arriving' then 'Your Siyan Lanka bus is about ' || coalesce(new.minutes, 0) || ' min from ' || new.stop || '.'
    when 'arrived' then 'Your Siyan Lanka bus has reached ' || new.stop || '.'
    else 'Siyan Lanka: ' || new.message end;
  if new.message <> '' and new.kind <> 'note' then txt := txt || ' ' || new.message; end if;
  head := case new.kind
    when 'departed' then 'Your bus has started'
    when 'delayed' then 'Your bus is running late'
    when 'arriving' then 'Your bus is nearly there'
    when 'arrived' then 'Your bus has arrived'
    else 'Trip update' end;
  for b in select * from public.bookings where schedule_id = new.schedule_id and travel_date = new.travel_date and status::text in ('confirmed', 'held') loop
    if b.user_id is not null and b.notify then
      if new.kind = 'departed' and (new.stop = '' or new.stop = b.from_stop) then
        perform public.claim_booking_notice(b.id, 'start');
      end if;
      insert into public.notifications (user_id, title, body, url, tag)
      values (b.user_id, head, txt || ' Tap to track it live.', '/track?ref=' || b.ref, 'trip-' || b.id || '-' || new.kind || '-' || left(new.id::text, 8));
    end if;
  end loop;
  return new;
end $$;
