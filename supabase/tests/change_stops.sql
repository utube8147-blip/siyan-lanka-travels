-- Migration 44: the conductor changes a passenger's stops (after asking them).
\set QUIET on
\pset tuples_only on
\pset format unaligned
\ir _autopay.inc
update app_settings set booking_otp = false, card_payments = true, payments_mode = 'payhere', booking_window_days = 0,
  messaging = coalesce(messaging, '{}'::jsonb) || '{"sms": true}'::jsonb;
insert into auth.users (id, email, phone, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001', null, '94771111111', '{"full_name":"Alex A"}'),
 ('dddddddd-0000-0000-0000-000000000004', 'cond@siyan.lk', null, '{"full_name":"Conductor C"}');
update profiles set role = 'conductor' where id = 'dddddddd-0000-0000-0000-000000000004';
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
declare r jsonb;
begin execute q into r; return 'OK      ' || label || coalesce('  → ' || r::text, ''); exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 110); end $$;
update schedules set days = array[0,1,2,3,4,5,6]::smallint[] where id = 'sch-cmb-2100';
create temp table t as select current_date + 1 as d;
grant select on t to anon, authenticated;

set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
create temp table bk as select * from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Dambulla","seats":["9A"],"payment":"card","passenger":{"name":"Alex","gender":"Male","phone":"0771111111"}}$q$, (select d from t))::jsonb);
grant select on bk to authenticated;
select pg_temp.try('passenger changes own stops', format('select change_booking_stops(%L, ''Colombo'', ''Kurunegala'')', (select id from bk)));

select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('backwards', format('select change_booking_stops(%L, ''Dambulla'', ''Colombo'')', (select id from bk)));
select pg_temp.try('not a stop', format('select change_booking_stops(%L, ''Colombo'', ''Jaffna'')', (select id from bk)));
select pg_temp.try('get off at Kurunegala', format('select change_booking_stops(%L, ''colombo'', ''kurunegala'', ''asked on the phone'')', (select id from bk)));
reset role;
select 'now: ' || from_stop || ' → ' || to_stop || ' (booked ' || coalesce(booked_from, '-') || ' → ' || coalesce(booked_to, '-') || ')' from bookings where id = (select id from bk);
select 'log: ' || old_to || ' → ' || new_to || ' · ' || coalesce(note, '') from booking_stop_changes;
select 'told: ' || title || ' · ' || body from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and title = 'Your stop has changed';
select 'text: ' || body from message_queue where kind = 'stop_change';

-- on board: only the drop-off can change
update bookings set status = 'boarded' where id = (select id from bk);
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('on board, new pick-up', format('select change_booking_stops(%L, ''Kadawatha'', ''Kurunegala'')', (select id from bk)));
select pg_temp.try('on board, new drop-off', format('select change_booking_stops(%L, ''Colombo'', ''Habarana'')', (select id from bk)));
reset role;
select 'now: ' || from_stop || ' → ' || to_stop || ' (booked ' || coalesce(booked_from, '-') || ' → ' || coalesce(booked_to, '-') || ')' from bookings where id = (select id from bk);

-- pay by distance, not paid yet: the fare follows
update routes set flat_fare = false where id = 'route-48-east';
update bookings set status = 'confirmed', payment_status = 'unpaid' where id = (select id from bk);
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('distance fare, unpaid', format('select change_booking_stops(%L, ''Colombo'', ''Dambulla'')', (select id from bk)));
reset role;
select 'fare now: ' || fare || ', total ' || total from bookings where id = (select id from bk);
