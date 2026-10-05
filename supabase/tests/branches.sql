-- Branches: two counters and an online booking; prints who sold and who was paid, and the report.
-- Run after local_supabase_stub.sql and setup.sql. Rolled back at the end.
\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1','admin@x.lk'),('00000000-0000-0000-0000-0000000000a2','col@x.lk'),('00000000-0000-0000-0000-0000000000a3','kal@x.lk'),('00000000-0000-0000-0000-0000000000a4','pax@x.lk');
insert into public.profiles (id, full_name, role) values
 ('00000000-0000-0000-0000-0000000000a1','Owner','admin'),('00000000-0000-0000-0000-0000000000a2','Colombo desk','staff'),
 ('00000000-0000-0000-0000-0000000000a3','Kalmunai desk','staff'),('00000000-0000-0000-0000-0000000000a4','Passenger','passenger')
 on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1', true);
insert into public.branches (name, address) values ('Kalmunai', 'Main Street, Kalmunai');
select public.set_user_branch('00000000-0000-0000-0000-0000000000a2', (select id from public.branches where name='Bastian Mawatha'));
select public.set_user_branch('00000000-0000-0000-0000-0000000000a3', (select id from public.branches where name='Kalmunai'));
\echo counter text:
select public.counter_text();
select email, role, (select name from public.branches b where b.id = u.branch_id) branch from public.admin_list_users() u order by email;
alter table public.bookings disable trigger user;
alter table public.bookings enable trigger bookings_stamp_branch; alter table public.bookings enable trigger bookings_stamp_payment; alter table public.bookings enable trigger bookings_messages;
-- Colombo desk sells 2 seats for cash
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2', true);
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, created_by, channel, fare, total, status, payment_method, payment_status)
values ('SLT-C1','sch-cmb-2100', current_date+3, 'Colombo','Kalmunai', array['1C','1D'], 'A','0771111111','00000000-0000-0000-0000-0000000000a2','counter',2600,5200,'confirmed','cash','paid');
-- Kalmunai desk sells 1 seat for cash
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3', true);
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, created_by, channel, fare, total, status, payment_method, payment_status)
values ('SLT-K1','sch-akp-2000', current_date+4, 'Kalmunai','Colombo', array['2C'], 'B','0772222222','00000000-0000-0000-0000-0000000000a3','counter',2600,2600,'confirmed','cash','paid');
-- Passenger books online, pay at counter; Kalmunai desk takes the cash
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4', true);
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, user_id, created_by, channel, fare, total, status, payment_method, payment_status, hold_expires_at)
values ('SLT-O1','sch-akp-2000', current_date+4, 'Kalmunai','Colombo', array['3C'], 'C','0773333333','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a4','online',2600,2650,'held','counter','unpaid', now()+interval '1 day');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3', true);
update public.bookings set status='confirmed', payment_status='paid', payment_method='cash' where ref='SLT-O1';
\echo hold text:
select body from public.message_queue where kind='booking_held';
select ref, (select name from public.branches where id=branch_id) sold_at, (select name from public.branches where id=paid_branch_id) paid_at from public.bookings where ref like 'SLT-%' order by ref;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1', true);
\echo report:
select jsonb_pretty(public.branch_sales(current_date - 1, current_date + 1));
rollback;
