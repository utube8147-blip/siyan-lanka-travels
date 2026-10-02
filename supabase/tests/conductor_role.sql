-- Run after the other test files.
\set QUIET on
\pset tuples_only on
\pset format unaligned
update app_settings set booking_otp = false, card_payments = true; -- booking codes and the card lock have their own tests
update routes set flat_fare = false; -- these tests check per-stop fares; one-price routes are tested in seat_overrides.sql
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 90); end $$;
insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000005', 'conductor@x.lk');
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('admin makes E a conductor', $q$select set_user_role('eeeeeeee-0000-0000-0000-000000000005', 'conductor')$q$);
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'conductor reads passenger lists: ' || count(*) || ' bookings' from bookings;
select pg_temp.try('conductor marks a passenger boarded', $q$update bookings set status = 'boarded' where id = (select id from bookings where status = 'confirmed' limit 1)$q$);
select pg_temp.try('conductor sells a seat on board (cash)', $q$select create_booking(jsonb_build_object('channel','counter','schedule_id','sch-cmb-2100','date',(current_date + 35 + ((1 - extract(dow from current_date + 35)::int + 7) % 7))::text,'from','Colombo','to','Kurunegala','seats',jsonb_build_array('11E'),'passenger',jsonb_build_object('name','Walk-in','gender','Male')))$q$);
select pg_temp.try('conductor posts a trip update', $q$insert into trip_events (schedule_id, travel_date, kind, stop) values ('sch-cmb-2100', current_date, 'departed', 'Colombo')$q$);
select pg_temp.try('conductor logs fuel', $q$insert into expenses (category, amount, litres) values ('fuel', 20000, 55)$q$);
select pg_temp.try('conductor edits a bus', $q$update buses set name = 'X' where id = 'bus-1'$q$) || ' (rows changed: ' || (select count(*) from buses where name = 'X') || ')';
select pg_temp.try('conductor changes the timetable', $q$insert into schedules (route_id, bus_id, departure, days) values ('route-48-east','bus-1','05:00','{1}')$q$);
select 'conductor sees paperwork: ' || count(*) || ' rows, parcel requests: ' || (select count(*) from service_requests) from bus_documents;
select pg_temp.try('conductor promotes self', $q$select set_user_role(auth.uid(), 'admin')$q$);
reset role;
