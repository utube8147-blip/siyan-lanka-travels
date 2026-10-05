-- Trip sheet: costs paid from the trip cash come off the cash to hand in; closed trips are locked;
-- conductors still cannot log office costs. Run after local_supabase_stub.sql and setup.sql. The last three inserts are meant to fail.
\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1','con@x.lk');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000c1','Suresh','conductor') on conflict (id) do update set role='conductor', full_name='Suresh';
alter table public.bookings disable trigger user; alter table public.bookings enable trigger bookings_stamp_payment;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1', true) is not null as as_conductor;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel, status, payment_method, payment_status)
values ('TS-1','sch-cmb-2100', current_date-1,'Colombo','Kalmunai',array['4A'],'A',2600,2650,'online','boarded','cash','paid'),
       ('TS-2','sch-cmb-2100', current_date-1,'Colombo','Kalmunai',array['4B','4C'],'B',2600,5250,'online','boarded','cash','paid');
\echo expected before costs (7900):
select public.cash_expected('00000000-0000-0000-0000-0000000000c1', current_date-1, 'sch-cmb-2100');
set local role authenticated;
insert into public.expenses (category, amount, bus_id, schedule_id, travel_date, vendor, litres, odometer_km, from_takings, payment_method, created_by) values ('fuel', 3000, 'bus-1','sch-cmb-2100', current_date-1,'Ceypetco Dambulla', 8.2, 184500, true, 'other', '00000000-0000-0000-0000-0000000000c1');
insert into public.expenses (category, amount, bus_id, schedule_id, travel_date, description, from_takings, created_by) values ('toll', 400, 'bus-1','sch-cmb-2100', current_date-1,'Kadawatha', true, '00000000-0000-0000-0000-0000000000c1');
insert into public.expenses (category, amount, bus_id, schedule_id, travel_date, description, from_takings, created_by) values ('other', 500, 'bus-1','sch-cmb-2100', current_date-1,'puncture', false, '00000000-0000-0000-0000-0000000000c1');
\echo summary (expected 4500, paid_out 2 rows, fuel forced to cash):
select s->>'expected' expected, jsonb_array_length(s->'paid_out') paid_out from (select public.cash_summary(current_date-1, 'sch-cmb-2100') s) x;
select jsonb_array_length(public.trip_sheet('sch-cmb-2100', current_date-1)) as sheet_rows;
select category, payment_method, from_takings from public.expenses where schedule_id='sch-cmb-2100' order by created_at;
\echo close the trip balanced at 4500 with no note:
insert into public.cash_counts (count_date, schedule_id, expected, counted, notes) values (current_date-1, 'sch-cmb-2100', 0, 4500, '') returning expected, counted;
\echo a cost after closing is refused:
savepoint x;
\set ON_ERROR_STOP 0
insert into public.expenses (category, amount, bus_id, schedule_id, travel_date, from_takings, created_by) values ('toll', 100, 'bus-1','sch-cmb-2100', current_date-1, true, '00000000-0000-0000-0000-0000000000c1');
rollback to x;
\echo a conductor still cannot log a salary, or an "other" with no trip:
insert into public.expenses (category, amount, created_by) values ('salary', 100, '00000000-0000-0000-0000-0000000000c1');
rollback to x;
insert into public.expenses (category, amount, created_by) values ('other', 100, '00000000-0000-0000-0000-0000000000c1');
rollback;
