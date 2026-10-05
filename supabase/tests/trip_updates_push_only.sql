\pset pager off
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b7','p@x.lk');
insert into public.profiles (id, full_name) values ('00000000-0000-0000-0000-0000000000b7','P') on conflict do nothing;
alter table public.bookings disable trigger user;
insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, user_id, fare, total, status, payment_method, payment_status)
values ('PO-1','sch-cmb-2100', current_date+2,'Colombo','Kalmunai',array['1C'],'With account','0771111111','00000000-0000-0000-0000-0000000000b7',1,1,'confirmed','card','paid'),
       ('PO-2','sch-cmb-2100', current_date+2,'Colombo','Kalmunai',array['1D'],'Counter passenger','0772222222',null,1,1,'confirmed','cash','paid');
insert into public.trip_events (schedule_id, travel_date, kind, minutes) values ('sch-cmb-2100', current_date+2, 'delayed', 20);
select (select count(*) from public.message_queue where kind like 'trip_%') as texts_queued, (select count(*) from public.notifications where title = 'Your bus is running late') as pushes;
rollback;
