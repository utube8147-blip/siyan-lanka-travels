-- Run after the other four test files (uses their users: A, B passengers; S staff; D admin; E conductor).
\set QUIET on
\pset tuples_only on
\pset format unaligned
update app_settings set booking_otp = false, card_payments = true; -- booking codes and the card lock have their own tests
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 95); end $$;
-- a Friday 5+ weeks out (bus runs Mon/Wed/Fri from Colombo), clear of the other tests' dates
create temp table t5 as select (current_date + 35 + ((5 - extract(dow from current_date + 35)::int + 7) % 7)) as fri;
grant select on t5 to anon, authenticated;
create temp table ids (k text primary key, v text); grant all on ids to anon, authenticated;
update app_settings set payments_mode = 'demo', resale_enabled = false, rewards_enabled = false;
delete from payouts;

select '--- rewards are off';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A loyalty with rewards off: every ' || every || ', available ' || available from loyalty_status();
select pg_temp.try('A books with use_reward', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["1C"],"passenger":{"name":"A","gender":"Male"},"use_reward":true}')$q$, (select fri from t5)));
select 'A peeks at B''s trips: ' || trips from loyalty_status('bbbbbbbb-0000-0000-0000-000000000002');
reset role;

select '--- refund payouts';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'a1', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["2C","2D"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"}}$q$, (select fri from t5))::jsonb);
select 'A drops a seat → total ' || total from modify_booking((select v::uuid from ids where k = 'a1'), array['2C']);
select 'payout for the dropped seat: ' || kind || ' LKR ' || amount || ' ' || status from payouts where booking_id = (select v::uuid from ids where k = 'a1');
select 'A cancels → refund ' || refund_amount from cancel_booking((select v::uuid from ids where k = 'a1'));
select 'A''s payouts: ' || string_agg(amount || ' ' || status, ', ' order by created_at) from payouts;
select pg_temp.try('A adds a bad account', $q$select set_payout_details((select id from payouts order by created_at desc limit 1), '{"bank":"B","account_no":"1"}')$q$);
select pg_temp.try('A adds bank account', $q$select set_payout_details((select id from payouts order by created_at desc limit 1), '{"bank":"Commercial Bank","branch":"Negombo","account_no":"8001234567","account_name":"Alex A"}')$q$);
select pg_temp.try('A marks own refund paid', $q$select mark_payout_paid((select id from payouts limit 1), 'bank', 'X')$q$);
select pg_temp.try('A edits payout directly', $q$update payouts set amount = 999999$q$);
select 'A still owed: ' || sum(amount) from payouts where status = 'pending';
reset role;
insert into ids select 'p1', id::text from payouts where status = 'pending' order by created_at limit 1;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B sees payouts: ' || count(*) from payouts;
select pg_temp.try('B sets A''s bank details', $q$select set_payout_details((select v::uuid from ids where k = 'p1'), '{"bank":"Evil Bank","account_no":"666666","account_name":"Fathima B"}')$q$);
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'conductor sees payouts (bank details): ' || count(*) from payouts;
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff sees payouts: ' || count(*) || ', with account ' || count(*) filter (where payee ->> 'account_no' = '8001234567') from payouts;
select 'staff pays → ' || status || ' by ' || method || ' ref ' || reference from mark_payout_paid((select id from payouts where payee ->> 'account_no' = '8001234567'), 'bank', 'TRF-0091');
select pg_temp.try('staff pays it twice', $q$select mark_payout_paid((select id from payouts where reference = 'TRF-0091'), 'bank', 'again')$q$);
reset role;
select 'A notified: ' || title || ' — ' || body from notifications where title like '%refund%paid%' order by created_at desc limit 1;

select '--- bank transfer slip';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'a2', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kalmunai","seats":["3C"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"bank"}$q$, (select fri from t5))::jsonb);
select pg_temp.try('A submits a slip from someone else''s folder', $q$select submit_payment_slip((select v::uuid from ids where k = 'a2'), 'bbbbbbbb-0000-0000-0000-000000000002/x.jpg', '')$q$);
select 'A uploads slip → still ' || status || ', slip on file: ' || (slip_path is not null) || ', ref ' || slip_reference from submit_payment_slip((select v::uuid from ids where k = 'a2'), 'aaaaaaaa-0000-0000-0000-000000000001/slip1.jpg', 'BOC 4471');
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B submits a slip on A''s booking', $q$select submit_payment_slip((select v::uuid from ids where k = 'a2'), 'bbbbbbbb-0000-0000-0000-000000000002/x.jpg', '')$q$);
select pg_temp.try('B rejects A''s slip', $q$select reject_payment_slip((select v::uuid from ids where k = 'a2'), 'no')$q$);
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff rejects slip → slip on file: ' || (slip_path is not null) || ', reason: ' || slip_rejected_reason from reject_payment_slip((select v::uuid from ids where k = 'a2'), 'Amount is short by LKR 500');
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A uploads again → reason cleared: ' || (slip_rejected_reason is null) from submit_payment_slip((select v::uuid from ids where k = 'a2'), 'aaaaaaaa-0000-0000-0000-000000000001/slip2.jpg', 'BOC 4471');
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff accepts → ' || status || ' / ' || payment_status || ' / ' || payment_method from confirm_payment((select v::uuid from ids where k = 'a2'), 'bank', 'BOC 4471');
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A submits a slip on a paid booking', $q$select submit_payment_slip((select v::uuid from ids where k = 'a2'), 'aaaaaaaa-0000-0000-0000-000000000001/slip3.jpg', '')$q$);
reset role;

select '--- resale obeys the admin switch';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A lists while resale is OFF', $q$select list_for_resale((select v::uuid from ids where k = 'a2'), 2000)$q$);
reset role;
update app_settings set resale_enabled = true;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'l1', id::text from list_for_resale((select v::uuid from ids where k = 'a2'), 2000);
reset role;
set role anon; select pg_temp.as_user(null);
select 'visitor sees listings while ON: ' || count(*) from get_resale_listings();
reset role;
update app_settings set resale_enabled = false;
set role anon; select pg_temp.as_user(null);
select 'visitor sees listings while OFF: ' || count(*) from get_resale_listings();
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B buys while resale is OFF', $q$select buy_resale((select v::uuid from ids where k = 'l1'), '{"name":"Fathima B","gender":"Female"}', '{}')$q$);
select pg_temp.try('B reserves while resale is OFF', $q$select reserve_resale((select v::uuid from ids where k = 'l1'), '{"name":"Fathima B","gender":"Female"}', '{}')$q$);
reset role;
select 'A still holds the seat while OFF: ' || status from bookings where id = (select v::uuid from ids where k = 'a2');
update app_settings set resale_enabled = true;

select '--- resale with a live gateway (pay first)';
update app_settings set payments_mode = 'payhere';
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B buys without paying (gateway is live)', $q$select buy_resale((select v::uuid from ids where k = 'l1'), '{"name":"Fathima B","gender":"Female"}', '{}')$q$);
insert into ids select 'o1', order_ref from reserve_resale((select v::uuid from ids where k = 'l1'), '{"name":"Fathima B","gender":"Female","phone":"0772222222"}', '{"email":"b@x.lk","phone":"0772222222"}');
select 'B reserved: pay LKR ' || amount || ', order ' || left(order_ref, 3) || '…' from resale_orders where order_ref = (select v from ids where k = 'o1');
select pg_temp.try('B completes own order without paying', $q$select complete_resale((select v from ids where k = 'o1'), 2050, 'FAKE', 'card')$q$);
reset role;
set role anon; select pg_temp.as_user(null);
select 'listing hidden from others while B pays: ' || (count(*) = 0) from get_resale_listings();
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('ffffffff-0000-0000-0000-000000000006','f@x.lk','{"full_name":"Late F"}') on conflict do nothing;
set role authenticated; select pg_temp.as_user('ffffffff-0000-0000-0000-000000000006');
select pg_temp.try('F reserves the same ticket meanwhile', $q$select reserve_resale((select v::uuid from ids where k = 'l1'), '{"name":"Late F","gender":"Male"}', '{}')$q$);
reset role;
select pg_temp.try('gateway reports the wrong amount', $q$select complete_resale((select v from ids where k = 'o1'), 100, 'PH-1', 'card')$q$);
select 'gateway confirms → order ' || status from complete_resale((select v from ids where k = 'o1'), 2050, 'PH-1', 'card');
select 'gateway confirms again (idempotent) → order ' || status from complete_resale((select v from ids where k = 'o1'), 2050, 'PH-1', 'card');
select 'seller booking: ' || status || '; buyer booking: ' || (select status || ' / ' || payment_status || ' / ref ' || payment_ref || ' / total ' || total from bookings where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and payment_ref = 'PH-1') from bookings where id = (select v::uuid from ids where k = 'a2');
select 'buyer bookings created: ' || count(*) from bookings where payment_ref = 'PH-1';
select 'seller payout: ' || kind || ' LKR ' || amount || ' ' || status || ', account prefilled: ' || (payee ->> 'account_no') from payouts where booking_id = (select v::uuid from ids where k = 'a2');
select 'seller notified: ' || title from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by created_at desc limit 1;

select '--- late payment for a ticket that has gone';
update app_settings set payments_mode = 'demo';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'a3', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kalmunai","seats":["4C"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"}}$q$, (select fri from t5))::jsonb);
insert into ids select 'l2', id::text from list_for_resale((select v::uuid from ids where k = 'a3'), 1500);
reset role;
update app_settings set payments_mode = 'payhere';
set role authenticated; select pg_temp.as_user('ffffffff-0000-0000-0000-000000000006');
insert into ids select 'o2', order_ref from reserve_resale((select v::uuid from ids where k = 'l2'), '{"name":"Late F","gender":"Male"}', '{}');
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A withdraws the listing while F is paying', $q$select withdraw_listing((select v::uuid from ids where k = 'l2'))$q$);
reset role;
select 'F''s payment arrives → order ' || status from complete_resale((select v from ids where k = 'o2'), 1550, 'PH-2', 'card');
select 'F is owed: ' || kind || ' LKR ' || amount || ' ' || status from payouts where user_id = 'ffffffff-0000-0000-0000-000000000006';
select 'A keeps the seat: ' || status from bookings where id = (select v::uuid from ids where k = 'a3');
update app_settings set payments_mode = 'demo', resale_enabled = false;

select '--- push subscriptions & reminders';
set role anon; select pg_temp.as_user(null);
select pg_temp.try('visitor saves a push subscription', $q$select save_push_subscription('https://push.example/abc', 'k', 'a')$q$);
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A saves a push subscription', $q$select save_push_subscription('https://push.example/abc', 'key1', 'auth1')$q$);
select pg_temp.try('A saves a bad endpoint', $q$select save_push_subscription('javascript:alert(1)', 'k', 'a')$q$);
select pg_temp.try('A queues reminders by hand', $q$select queue_trip_reminders(3)$q$);
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B sees A''s subscriptions: ' || count(*) from push_subscriptions;
select pg_temp.try('B signs in on the same browser', $q$select save_push_subscription('https://push.example/abc', 'key2', 'auth2')$q$);
reset role;
select 'that browser now belongs to: ' || (select full_name from profiles where id = user_id) || ' (' || count(*) over () || ' row)' from push_subscriptions;
-- A departure in the next 3 hours: put a confirmed booking on today's/yesterday's bus by moving the timetable under it.
insert into schedules (id, route_id, bus_id, departure, days, active) values ('sch-test-soon', 'route-48-east', 'bus-1', to_char((now() at time zone 'Asia/Colombo') + interval '90 minutes', 'HH24:MI'), '{0,1,2,3,4,5,6}', true);
insert into bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, user_id, fare, total, status)
values ('SOON-1', 'sch-test-soon', ((now() at time zone 'Asia/Colombo') + interval '90 minutes')::date, 'Colombo', 'Batticaloa', array['7A'], 'Alex A', 'aaaaaaaa-0000-0000-0000-000000000001', 2400, 2450, 'confirmed'),
       ('LATER-1', 'sch-cmb-2100', (select fri from t5), 'Colombo', 'Batticaloa', array['7B'], 'Alex A', 'aaaaaaaa-0000-0000-0000-000000000001', 2400, 2450, 'confirmed');
select 'reminders queued: ' || queue_trip_reminders(3);
select 'reminders queued on the next run: ' || queue_trip_reminders(3);
select 'reminder: ' || title || ' | ' || body || ' | tag ' || left(tag, 5) || '…, waiting to push: ' || (pushed_at is null) from notifications where tag like 'trip-%';

select '--- bus location history';
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
insert into bus_locations (schedule_id, travel_date, lat, lng, updated_at) values ('sch-test-soon', current_date, 6.9338, 79.8524, now() - interval '20 minutes');
update bus_locations set updated_at = now() - interval '19 minutes' where schedule_id = 'sch-test-soon'; -- heartbeat, parked
update bus_locations set lat = 6.9500, lng = 79.8800, updated_at = now() - interval '15 minutes' where schedule_id = 'sch-test-soon';
update bus_locations set lat = 7.0010, lng = 79.9534, updated_at = now() - interval '2 minutes' where schedule_id = 'sch-test-soon';
select pg_temp.try('conductor writes history directly', $q$insert into bus_location_history (schedule_id, travel_date, lat, lng) values ('sch-test-soon', current_date, 0, 0)$q$);
reset role;
set role anon; select pg_temp.as_user(null);
select 'visitor reads trail: ' || count(*) || ' points (4 updates, 1 was a parked heartbeat), newest lat ' || (select lat from bus_location_history where schedule_id = 'sch-test-soon' order by recorded_at desc limit 1) from bus_location_history where schedule_id = 'sch-test-soon';
reset role;
do $$ begin for i in 1..30 loop update bus_locations set lat = 7.0 + i * 0.01, updated_at = now() - interval '1 minute' + make_interval(secs => i) where schedule_id = 'sch-test-soon'; end loop; end $$;
select 'after 30 more moves the trail keeps: ' || count(*) from bus_location_history where schedule_id = 'sch-test-soon';
