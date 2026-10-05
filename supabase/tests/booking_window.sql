-- Booking window: passengers up to 7 days ahead, staff any date, 0 = no limit.
-- Run after local_supabase_stub.sql and setup.sql. The two "refused" inserts are meant to fail.
\set ON_ERROR_STOP 0
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1','pax@x.lk'),('00000000-0000-0000-0000-0000000000b2','desk@x.lk');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000b1','Pax','passenger'),('00000000-0000-0000-0000-0000000000b2','Desk','staff')
  on conflict (id) do update set role = excluded.role;
insert into public.schedules (id, route_id, bus_id, departure, days, active) values ('sch-w','route-48-east','bus-1','21:00',array[0,1,2,3,4,5,6]::smallint[],true);
alter table public.bookings disable trigger user; alter table public.bookings enable trigger bookings_booking_window;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1', true) is not null as as_passenger;
\echo passenger, 7 days ahead (allowed):
savepoint a;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel) values ('W-7','sch-w',(now() at time zone 'Asia/Colombo')::date+7,'Colombo','Kalmunai',array['7A'],'P',1,1,'online') returning ref;
\echo passenger, 8 days ahead (refused):
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel) values ('W-8','sch-w',(now() at time zone 'Asia/Colombo')::date+8,'Colombo','Kalmunai',array['8A'],'P',1,1,'online') returning ref;
rollback to a;
\echo passenger moves a booking to 20 days ahead (refused):
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel) values ('W-M','sch-w',(now() at time zone 'Asia/Colombo')::date+2,'Colombo','Kalmunai',array['9A'],'P',1,1,'online');
savepoint b;
update public.bookings set travel_date = travel_date + 18 where ref='W-M';
rollback to b;
\echo staff, 30 days ahead (allowed):
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2', true) is not null as as_staff;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel) values ('W-S','sch-w',(now() at time zone 'Asia/Colombo')::date+30,'Colombo','Kalmunai',array['10A'],'P',1,1,'counter') returning ref;
\echo limit off (0), passenger 30 days ahead (allowed):
update public.app_settings set booking_window_days = 0;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1', true) is not null as as_passenger;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel) values ('W-0','sch-w',(now() at time zone 'Asia/Colombo')::date+31,'Colombo','Kalmunai',array['11A'],'P',1,1,'online') returning ref;
rollback;
