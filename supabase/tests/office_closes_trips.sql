-- The booking centre closes a trip for the conductor; a conductor sees only their own cash.
-- Run after local_supabase_stub.sql and setup.sql. One select is meant to fail.
\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1','con@x.lk'),('00000000-0000-0000-0000-0000000000d2','desk@x.lk'),('00000000-0000-0000-0000-0000000000d3','con2@x.lk');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000d1','Suresh','conductor'),('00000000-0000-0000-0000-0000000000d2','Desk','staff'),('00000000-0000-0000-0000-0000000000d3','Other conductor','conductor')
  on conflict (id) do update set role=excluded.role, full_name=excluded.full_name;
alter table public.bookings disable trigger user; alter table public.bookings enable trigger bookings_stamp_payment;
-- the conductor collects two fares on the bus
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1', true) is not null as as_conductor;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel, status, payment_method, payment_status)
values ('OC-1','sch-cmb-2100', current_date-1,'Colombo','Kalmunai',array['4A'],'A',2600,2650,'online','boarded','cash','paid'),
       ('OC-2','sch-cmb-2100', current_date-1,'Colombo','Kalmunai',array['4B','4C'],'B',2600,5250,'online','boarded','cash','paid');
set local role authenticated;
\echo conductor sees what he should hold (7900):
select public.cash_summary(current_date-1, 'sch-cmb-2100')->>'expected' as conductor_sees;
\echo conductor cannot look at someone else:
savepoint a;
\set ON_ERROR_STOP 0
select public.cash_summary(current_date-1, 'sch-cmb-2100', '00000000-0000-0000-0000-0000000000d3');
rollback to a;
\set ON_ERROR_STOP 1
-- the office types in the sheet for him
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d2', true) is not null as as_office;
\echo who can be closed for this trip:
select x->>'name' as name, x->>'role' as role, x->>'took_cash' as took_cash, x->>'expected' as expected, x->>'closed' as closed from jsonb_array_elements(public.trip_cash_people('sch-cmb-2100', current_date-1)) x;
insert into public.expenses (category, amount, bus_id, schedule_id, travel_date, vendor, litres, from_takings, takings_of) values ('fuel', 3000, 'bus-1','sch-cmb-2100', current_date-1,'Ceypetco', 8.2, true, '00000000-0000-0000-0000-0000000000d1');
insert into public.expenses (category, amount, bus_id, schedule_id, travel_date, description, from_takings, takings_of) values ('other', 500, 'bus-1','sch-cmb-2100', current_date-1,'puncture', true, '00000000-0000-0000-0000-0000000000d1');
select public.cash_summary(current_date-1, 'sch-cmb-2100', '00000000-0000-0000-0000-0000000000d1')->>'expected' as office_sees_for_conductor;
\echo office closes it for the conductor at 4400, balanced:
insert into public.cash_counts (count_date, schedule_id, expected, counted, notes, created_by) values (current_date-1, 'sch-cmb-2100', 0, 4400, '', '00000000-0000-0000-0000-0000000000d1')
  returning expected, counted, (select full_name from public.profiles where id = created_by) as whose, (select full_name from public.profiles where id = entered_by) as typed_by;
\echo office own cash for the day is untouched (0):
select public.cash_summary(current_date-1)->>'expected' as office_own;
-- the conductor can see it was closed, but cannot close for anyone else
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1', true) is not null as as_conductor;
select count(*) as conductor_sees_his_close from public.cash_counts;
\echo a conductor naming someone else just closes his own (whose = Suresh):
insert into public.cash_counts (count_date, schedule_id, expected, counted, notes, created_by) values (current_date-2, 'sch-cmb-2100', 0, 0, '', '00000000-0000-0000-0000-0000000000d3')
  returning (select full_name from public.profiles where id = created_by) as whose;
rollback;
