-- Booking message once + ticket email + reminders (1 day / 3 hours / 1 hour / start).
-- Run on a database set up with local_supabase_stub.sql then setup.sql. Prints
-- what was queued; everything is rolled back at the end.
\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'asha@example.com');
insert into public.profiles (id, full_name) values ('00000000-0000-0000-0000-000000000001','Asha') on conflict do nothing;
update public.app_settings set site_url='https://www.siyanlanka.lk/';
-- schedules leaving at chosen lead times (local time Asia/Colombo), every day
create temp table lead(name text, mins int);
insert into lead values ('d24', 23*60+30), ('h3', 150), ('h1', 30), ('st', -5), ('far', 30*60), ('late3', 150);
insert into public.schedules (id, route_id, bus_id, departure, days, active)
select 'sch-'||name, 'route-48-east', 'bus-1', to_char((now() at time zone 'Asia/Colombo') + make_interval(mins => mins), 'HH24:MI'), array[0,1,2,3,4,5,6]::smallint[], true from lead;
alter table public.bookings disable trigger user;
alter table public.bookings enable trigger bookings_messages;
-- A: paid online booking
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, contact_email, user_id, fare, total, status, payment_method, payment_status, created_at)
select 'SLT-'||upper(name), 'sch-'||name, ((now() at time zone 'Asia/Colombo') + make_interval(mins => mins))::date, 'Colombo', 'Batticaloa', array['3A','3B'], 'Asha', '0771234567',
  case when name='h3' then '' else 'ticket@example.com' end, '00000000-0000-0000-0000-000000000001', 2400, 4850, 'confirmed', 'card', 'paid',
  case when name='late3' then now() else now() - interval '3 days' end from lead;
update public.bookings set status='boarded' where ref='SLT-FAR';
update public.bookings set status='confirmed' where ref='SLT-FAR';
-- B: pay on the bus, later paid
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, user_id, fare, total, status, payment_method, payment_status)
values ('SLT-BUS', 'sch-far', current_date+5, 'Colombo', 'Kalmunai', array['5A'], 'Ravi', '0711111111', null, 2600, 2650, 'held', 'bus', 'unpaid');
update public.bookings set status='confirmed', payment_status='paid' where ref='SLT-BUS';
-- C: bank hold, later paid
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, user_id, fare, total, status, payment_method, payment_status, hold_expires_at)
values ('SLT-BANK', 'sch-far', current_date+6, 'Colombo', 'Kalmunai', array['6A'], 'Nimal', '0722222222', null, 2600, 2650, 'held', 'bank', 'unpaid', now()+interval '1 day');
update public.bookings set status='confirmed', payment_status='paid' where ref='SLT-BANK';
update public.bookings set status='cancelled' where ref='SLT-BANK';
\echo === queue per booking
select b.ref, q.channel, q.kind, coalesce(q.to_email,q.to_phone) as "to", length(q.body) len from public.message_queue q join public.bookings b on b.id=q.booking_id order by b.ref, q.created_at, q.channel;
\echo === the text
select body from public.message_queue q join public.bookings b on b.id=q.booking_id where b.ref='SLT-BUS' and kind='booking_confirmed';
select body ~ '^[\x0A\x20-\x7E]*$' as gsm_plain from public.message_queue where kind='booking_confirmed' and channel='sms' limit 1;
select subject, data from public.message_queue where channel='email' limit 1;
\echo === reminders run 1, 2
select public.queue_trip_reminders(); select public.queue_trip_reminders();
select b.ref, n.kind from public.booking_notices n join public.bookings b on b.id=n.booking_id where kind<>'details' order by 1;
select title, body, url, right(tag,6) tag from public.notifications where tag like 'trip-%' order by title;
\echo === conductor marks departed
insert into public.trip_events (schedule_id, travel_date, kind, stop) select schedule_id, travel_date, 'departed', 'Colombo' from public.bookings where ref='SLT-H1';
select title, body, url from public.notifications where title='Your bus has started';
select b.ref, n.kind from public.booking_notices n join public.bookings b on b.id=n.booking_id where b.ref='SLT-H1' order by 2;
rollback;
