\set ON_ERROR_STOP 1
\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1','office@x.lk'),('00000000-0000-0000-0000-0000000000f2','con@x.lk');
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000f1','Office','admin'),('00000000-0000-0000-0000-0000000000f2','Conductor','conductor')
  on conflict (id) do update set role=excluded.role, full_name=excluded.full_name;
alter table public.bookings disable trigger user; alter table public.bookings enable trigger bookings_stamp_payment;
-- the office sells seats 7,8 and 13 for cash at the counter (your screenshot)
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1', true) is not null as as_office;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel, status, payment_method, payment_status)
values ('TC-78','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['7','8'],'S',3000,6050,'counter','confirmed','cash','paid'),
       ('TC-13','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['13'],'S',3000,3050,'counter','confirmed','cash','paid'),
       ('TC-CARD','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['14'],'S',3000,3050,'online','confirmed','card','paid');
\echo office account on the conductor page, trip cash (was 9100, now 0):
select public.cash_summary(current_date+1, 'sch-akp-2000')->>'expected' as trip_cash_for_office;
\echo the office day count still has the counter money (9100):
select public.cash_summary((now() at time zone 'Asia/Colombo')::date)->>'expected' as office_day;
-- seat 5 pays on the bus; the conductor collects it
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, fare, total, channel, status, payment_method, payment_status)
values ('TC-5','sch-akp-2000', current_date+1,'Akkaraipattu','Colombo',array['5'],'S',3000,3050,'online','held','bus','unpaid');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f2', true) is not null as as_conductor;
update public.bookings set status='boarded', payment_status='paid', payment_method='cash' where ref='TC-5';
\echo conductor trip cash (3050: only the fare collected on the bus):
select public.cash_summary(current_date+1, 'sch-akp-2000')->>'expected' as trip_cash_for_conductor;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1', true) is not null as as_office;
select x->>'name' as name, x->>'took_cash' as took_cash, x->>'expected' as expected from jsonb_array_elements(public.trip_cash_people('sch-akp-2000', current_date+1)) x;
rollback;
