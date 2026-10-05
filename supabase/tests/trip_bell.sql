\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1','p@x.lk'),('00000000-0000-0000-0000-0000000000e2','q@x.lk');
insert into public.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000e1','P'),('00000000-0000-0000-0000-0000000000e2','Q') on conflict do nothing;
insert into public.schedules (id, route_id, bus_id, departure, days, active)
values ('sch-bell','route-48-east','bus-1', to_char((now() at time zone 'Asia/Colombo') + interval '150 minutes','HH24:MI'), array[0,1,2,3,4,5,6]::smallint[], true);
alter table public.bookings disable trigger user;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, user_id, fare, total, status, payment_method, payment_status, created_at)
select r, 'sch-bell', ((now() at time zone 'Asia/Colombo') + interval '150 minutes')::date, 'Colombo','Kalmunai', array[s], 'X', '00000000-0000-0000-0000-0000000000e1', 1, 1, 'confirmed','card','paid', now() - interval '2 days'
from (values ('BELL-ON','1C'),('BELL-OFF','1D')) v(r,s);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1', true) is not null as as_owner;
select public.set_trip_notifications((select id from public.bookings where ref='BELL-OFF'), false) as now_on;
select public.queue_trip_reminders() as reminders_queued;
select b.ref from public.booking_notices n join public.bookings b on b.id = n.booking_id where n.kind = '3h';
insert into public.trip_events (schedule_id, travel_date, kind, stop) select schedule_id, travel_date, 'delayed', '' from public.bookings where ref='BELL-ON';
select count(*) as pushes_for_delay from public.notifications where title = 'Your bus is running late';
\echo someone else cannot switch it:
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2', true) is not null as as_other;
\set ON_ERROR_STOP 0
select public.set_trip_notifications((select id from public.bookings where ref='BELL-ON'), false);
rollback;
