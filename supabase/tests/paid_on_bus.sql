\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9','one@x.lk');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000a9','One person, both jobs','admin') on conflict (id) do update set role='admin';
alter table public.bookings disable trigger user; alter table public.bookings enable trigger bookings_stamp_payment;
-- four seats booked ONLINE, unpaid (three to pay at the counter, one on the bus)
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel, status, payment_method, payment_status, hold_expires_at)
values ('PB-78','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['7','8'],'S',3000,6050,'online','held','counter','unpaid', now()+interval '1 day'),
       ('PB-13','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['13'],'S',3000,3050,'online','held','counter','unpaid', now()+interval '1 day'),
       ('PB-15','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['15'],'S',3000,3050,'online','held','counter','unpaid', now()+interval '1 day'),
       ('PB-5','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['5'],'S',3000,3050,'online','held','bus','unpaid', now()+interval '2 days');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a9', true) is not null as signed_in;
-- the office marks three of them paid in cash (Bookings / Departures screen)
select (public.confirm_payment(id, 'cash', null)).ref from public.bookings where ref in ('PB-78','PB-13','PB-15') order by ref;
\echo same account opens the conductor page: trip cash (0, not 12150)
select s->>'expected' as trip_cash, jsonb_array_length(s->'taken') as fares from (select public.cash_summary(current_date+1, 'sch-akp-2000') s) x;
-- on the bus, the same person taps "cash received" for seat 5 on the conductor screen
select (public.collect_on_bus(id)).ref from public.bookings where ref = 'PB-5';
\echo trip cash now (3050, 1 fare):
select s->>'expected' as trip_cash, jsonb_array_length(s->'taken') as fares from (select public.cash_summary(current_date+1, 'sch-akp-2000') s) x;
\echo office day count (12150: the three counter payments, not seat 5):
select public.cash_summary((now() at time zone 'Asia/Colombo')::date)->>'expected' as office_day;
select ref, paid_on_bus from public.bookings where ref like 'PB-%' order by ref;
rollback;
