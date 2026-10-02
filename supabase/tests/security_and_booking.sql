-- Runs against plain Postgres with local_supabase_stub.sql + the migration + seed.
-- psql -d test -f local_supabase_stub.sql -f ../migrations/*.sql -f ../seed.sql -f security_and_booking.sql
\set QUIET on
\pset tuples_only on
\pset format unaligned
update app_settings set booking_otp = false, card_payments = true; -- booking codes and the card lock have their own tests
update routes set flat_fare = false; -- these tests check per-stop fares; one-price routes are tested in seat_overrides.sql
-- users: A, B passengers; S staff
insert into auth.users (id, email, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@x.lk','{"full_name":"Alex A","phone":"0771111111"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@x.lk','{"full_name":"Fathima B"}'),
 ('cccccccc-0000-0000-0000-000000000003','s@x.lk','{"full_name":"Staff S"}');
update profiles set role='staff' where id='cccccccc-0000-0000-0000-000000000003';
-- a Monday two+ weeks out (bus runs Mon/Wed/Fri from Colombo)
create temp table t as select (current_date + 14 + ((1 - extract(dow from current_date + 14)::int + 7) % 7)) as mon;
grant select on t to anon, authenticated;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 90); end $$;

select '--- visitor (not signed in)';
set role anon; select pg_temp.as_user(null);
select 'reads timetable: ' || (select count(*) from schedules) || ' departures';
select 'sees bookings: ' || (select count(*) from bookings);
select pg_temp.try('visitor books', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9A"],"passenger":{"name":"X","gender":"Male"}}')$q$, (select mon from t)));
reset role;

select '--- passenger A books 2 seats, browser tries to send a fake price';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A booking total = LKR ' || total || ' (fare ' || fare || ' x2 + fee ' || fee || ')' from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["3a","3B"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"total":1,"fare":1}$q$, (select mon from t))::jsonb);
select pg_temp.try('A takes ladies seat 1A as Male', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["1A"],"passenger":{"name":"A","gender":"Male"}}')$q$, (select mon from t)));
select pg_temp.try('A books seat 99Z', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["99Z"],"passenger":{"name":"A","gender":"Male"}}')$q$, (select mon from t)));
select pg_temp.try('A books on a Tuesday (no bus)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9A"],"passenger":{"name":"A","gender":"Male"}}')$q$, (select mon+1 from t)));
select pg_temp.try('A books a bus that already left', $q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"2026-01-05","from":"Colombo","to":"Batticaloa","seats":["9A"],"passenger":{"name":"A","gender":"Male"}}')$q$);
select pg_temp.try('A sells a counter ticket', format($q$select create_booking('{"channel":"counter","schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9A"],"passenger":{"name":"A","gender":"Male"}}')$q$, (select mon from t)));
select pg_temp.try('A edits own booking total directly', $q$update bookings set total = 1$q$) || '  (rows changed: ' || (select count(*) from bookings where total = 1) || ')';
select pg_temp.try('A makes self staff', $q$update profiles set role = 'staff' where id = auth.uid()$q$);
select pg_temp.try('A inserts a booking row directly', $q$insert into bookings (ref,schedule_id,travel_date,from_stop,to_stop,seats,passenger_name,fare,total) values ('X','sch-cmb-2100','2027-01-04','Colombo','Kandy','{9A}','x',0,0)$q$);
reset role;

select '--- passenger B';
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B grabs seat 3B (A has it)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["3B"],"passenger":{"name":"B","gender":"Female"}}')$q$, (select mon from t)));
select 'B Kurunegala→Kalmunai with promo: total LKR ' || total || ' (fare ' || fare || ', discount ' || discount || ')' from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Kurunegala","to":"Kalmunai","seats":["1A"],"promo":"siyan10","passenger":{"name":"Fathima B","gender":"Female"}}$q$, (select mon from t))::jsonb);
select 'B + 2 motorbikes: bike fee LKR ' || bike_fee || ', total ' || total from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Kurunegala","to":"Kalmunai","seats":["6A"],"passenger":{"name":"Fathima B","gender":"Female"},"bikes":[{"kind":"motorbike","description":"Honda Dio red","reg_no":"EP BHC-1","photo_path":"bbbbbbbb-0000-0000-0000-000000000002/1.jpg"},{"kind":"motorbike","description":"Pulsar black","reg_no":"EP BHC-2","photo_path":"bbbbbbbb-0000-0000-0000-000000000002/2.jpg"}]}$q$, (select mon from t))::jsonb);
select pg_temp.try('B adds a bicycle (compartment full)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["7A"],"passenger":{"name":"B","gender":"Female"},"bikes":[{"kind":"bicycle","description":"green MTB","photo_path":"x/1.jpg"}]}')$q$, (select mon from t)));
reset role; create temp table a_id as select id from bookings where passenger_name='Alex A'; grant select on a_id to authenticated;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B sees bookings: ' || count(*) || ' (all B''s own)' from bookings;
select pg_temp.try('B cancels A''s booking', format($q$select cancel_booking('%s')$q$, (select id from a_id)));
select pg_temp.try('B changes A''s seats', format($q$select modify_booking('%s', array['9D'])$q$, (select id from a_id)));
select 'B sees taken seats (no names): ' || string_agg(seat, ',' order by seat) from booking_seats where travel_date = (select mon from t);
select pg_temp.try('B reads whose booking a seat is', $q$select booking_id from booking_seats$q$);
select pg_temp.try('B uploads to own photo folder', $q$insert into storage.objects (bucket_id, name) values ('bike-photos','bbbbbbbb-0000-0000-0000-000000000002/3.jpg')$q$);
select pg_temp.try('B uploads into A''s folder', $q$insert into storage.objects (bucket_id, name) values ('bike-photos','aaaaaaaa-0000-0000-0000-000000000001/evil.jpg')$q$);
reset role;

select '--- A changes seats, then cancels';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A moves to seat 1A (B has it)', format($q$select modify_booking('%s', array['1A','8B'])$q$, (select id from bookings where passenger_name='Alex A')));
select 'A moves to 4A,4B,4C: total LKR ' || total from modify_booking((select id from bookings where passenger_name='Alex A'), array['4A','4B','4C']);
select 'A cancels 2+ weeks ahead: refund LKR ' || refund_amount || ' of ' || total from cancel_booking((select id from bookings where passenger_name='Alex A'));
reset role;
set role anon; select pg_temp.as_user(null);
select 'seats free again after cancel: ' || (select count(*) from booking_seats where seat like '4_' and travel_date=(select mon from t)) || ' of 4A-4C still taken';
reset role;

select '--- staff';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'counter sale (no online fee): total LKR ' || total || ', channel ' || channel from create_booking(format($q${"channel":"counter","schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9C"],"passenger":{"name":"Walk-in","gender":"Male"}}$q$, (select mon from t))::jsonb);
select 'staff sees all bookings: ' || count(*) from bookings;
select pg_temp.try('staff marks B boarded', $q$update bookings set status='boarded' where passenger_name='Fathima B' and bike_fee=0$q$);
select pg_temp.try('staff adds a bus', $q$insert into buses (name, reg_no, rows) values ('Coach 2','NE-1111',10)$q$);
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('passenger adds a bus', $q$insert into buses (name, reg_no, rows) values ('Pirate','XX-1',10)$q$);
reset role;
