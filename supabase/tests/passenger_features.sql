-- Run after security_and_booking.sql and admin_erp_resale.sql.
\set QUIET on
\pset tuples_only on
\pset format unaligned
update app_settings set booking_otp = false, card_payments = true; -- booking codes and the card lock have their own tests
update routes set flat_fare = false; -- these tests check per-stop fares; one-price routes are tested in seat_overrides.sql
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 95); end $$;
create temp table t3 as select (current_date + 28 + ((3 - extract(dow from current_date + 28)::int + 7) % 7)) as wed;
grant select on t3 to anon, authenticated;
insert into crew (full_name, role, phone, bus_id) values ('Suresh Kumar', 'conductor', '+94 71 553 9087', 'bus-1');
update app_settings set bank_details = 'BOC Pettah 7741102 (Siyan Lanka Travels)';

select '--- payments & holds';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'demo card payment → ' || status || ' / ' || payment_status from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kalmunai","seats":["9A"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"card"}$q$, (select wed from t3))::jsonb);
select 'bank transfer → ' || status || ' / ' || payment_status || ', hold ~' || round(extract(epoch from hold_expires_at - now())/3600) || 'h' from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kalmunai","seats":["9B"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"bank"}$q$, (select wed from t3))::jsonb);
select 'pay at counter → ' || status || ', hold ' || round(extract(epoch from hold_expires_at - now())/60) || ' min' from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kalmunai","seats":["9C"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"counter"}$q$, (select wed from t3))::jsonb);
select pg_temp.try('passenger confirms own hold as paid', $q$select confirm_payment((select id from bookings where seats = '{9C}' and travel_date = (select wed from t3)), 'cash')$q$);
reset role;
select 'messages queued: ' || string_agg(kind, ', ' order by created_at) from message_queue;
select 'bank message: ' || left(body, 140) from message_queue where kind = 'booking_held' limit 1;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff takes cash at counter → ' || status || ' / ' || payment_status || ' / ' || payment_method from confirm_payment((select id from bookings where seats = '{9C}' and travel_date = (select wed from t3)), 'cash');
reset role;
update bookings set hold_expires_at = now() - interval '1 minute' where seats = '{9B}' and travel_date = (select wed from t3);
select 'expired holds released: ' || release_expired_holds() || ', seat 9B free again: ' || not exists (select 1 from booking_seats where seat = '9B' and active and travel_date = (select wed from t3));
update app_settings set payments_mode = 'payhere';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'PayHere live: card → ' || status || ' / ' || payment_status || ', total ' || total from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kalmunai","seats":["9D"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"card"}$q$, (select wed from t3))::jsonb);
select pg_temp.try('passenger calls gateway confirm', $q$select mark_paid_by_gateway((select ref from bookings where seats = '{9D}' and travel_date = (select wed from t3)), 2650, 'x', 'card')$q$);
reset role;
select pg_temp.try('gateway confirm, wrong amount', $q$select mark_paid_by_gateway((select ref from bookings where seats = '{9D}' and travel_date = (select wed from t3)), 1, 'PH1', 'card')$q$);
select 'gateway confirm (server key) → ' || status || ' / ' || payment_status || ' ref ' || payment_ref from mark_paid_by_gateway((select ref from bookings where seats = '{9D}' and travel_date = (select wed from t3)), (select total from bookings where seats = '{9D}' and travel_date = (select wed from t3)), 'PH-320011', 'card');
update app_settings set payments_mode = 'demo';

select '--- rewards (every 10 trips)';
reset role; update app_settings set rewards_enabled = true; -- off by default since migration 5
alter table bookings disable trigger bookings_running_day; -- test data: these past dates need not be running days
insert into bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, user_id, fare, total, status)
select 'OLD-' || g, 'sch-cmb-2100', current_date - 7*g, 'Colombo', 'Batticaloa', array['5A'], 'Alex A', 'aaaaaaaa-0000-0000-0000-000000000001', 2400, 2450, 'boarded'
from generate_series(1, 10) g;
alter table bookings enable trigger bookings_running_day;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A loyalty: ' || trips || ' trips, ' || available || ' free trip available' from loyalty_status();
select 'A books with free trip: fare ' || fare || ' x2, discount ' || discount || ', total ' || total from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["10A","10B"],"passenger":{"name":"Alex A","gender":"Male"},"use_reward":true}$q$, (select wed from t3))::jsonb);
select pg_temp.try('A uses the reward again', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["10C"],"passenger":{"name":"A","gender":"Male"},"use_reward":true}')$q$, (select wed from t3)));
reset role;

select '--- waitlist';
update buses set rows = 2, back_row_seats = 0 where id = 'bus-1';  -- tiny bus so it fills up
create temp table t4 as select (select wed from t3) + 7 as d; grant select on t4 to authenticated;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A fills the bus: ' || array_to_string(seats, ',') from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["1C","1D","2A","2B","2C","2D"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"}}$q$, (select d from t4))::jsonb);
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B joins waitlist', format($q$insert into waitlist (schedule_id, travel_date, from_stop, to_stop, seats, phone) values ('sch-cmb-2100', %L, 'Colombo', 'Batticaloa', 1, '0772222222')$q$, (select d from t4)));
select pg_temp.try('B joins twice', format($q$insert into waitlist (schedule_id, travel_date, from_stop, to_stop) values ('sch-cmb-2100', %L, 'Colombo', 'Batticaloa')$q$, (select d from t4)));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A cancels → refund ' || refund_amount from cancel_booking((select id from bookings where seats @> '{2A}' and travel_date = (select d from t4)));
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B waitlist now: ' || status from waitlist;
select 'B notification: ' || title from notifications;
reset role;
select 'waitlist SMS queued: ' || count(*) from message_queue where kind = 'waitlist_offer';
update buses set rows = 10, back_row_seats = 5 where id = 'bus-1';

select '--- live trip, conductor contact';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff shares bus location', format($q$insert into bus_locations (schedule_id, travel_date, lat, lng, speed_kmh) values ('sch-cmb-2100', %L, 7.4863, 80.3647, 62)$q$, (select wed from t3)));
select pg_temp.try('staff posts "departed Colombo"', format($q$insert into trip_events (schedule_id, travel_date, kind, stop) values ('sch-cmb-2100', %L, 'departed', 'Colombo')$q$, (select wed from t3)));
reset role;
select 'trip update SMS queued to passengers: ' || count(*) from message_queue where kind = 'trip_departed';
set role anon; select pg_temp.as_user(null);
select 'public sees bus at ' || lat || ',' || lng || ' doing ' || speed_kmh || ' km/h' from bus_locations;
select pg_temp.try('visitor posts fake update', $q$insert into trip_events (schedule_id, travel_date, kind) values ('sch-cmb-2100', current_date, 'arrived')$q$);
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'conductor for a trip 4 weeks away: ' || coalesce((select name from get_trip_contact((select id from bookings where seats = '{9A}' and passenger_name = 'Alex A' order by created_at desc limit 1))), '(hidden until the day)');
reset role;
alter table bookings disable trigger bookings_running_day; -- test data: today need not be a running day
update bookings set travel_date = current_date where seats = '{9A}' and travel_date = (select wed from t3) and passenger_name = 'Alex A';
alter table bookings enable trigger bookings_running_day;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'conductor on travel day: ' || name || ' ' || phone from get_trip_contact((select id from bookings where seats = '{9A}' and passenger_name = 'Alex A' order by created_at desc limit 1));
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B asks for conductor on A''s booking: ' || count(*) || ' rows' from get_trip_contact((select id from bookings where seats = '{9A}' limit 1));
reset role;

select '--- parcels, charters, cash';
set role anon; select pg_temp.as_user(null);
select pg_temp.try('visitor requests a charter', $q$insert into service_requests (kind, name, phone, details) values ('charter', 'Wedding party', '0773333333', '{"from":"Kalmunai","to":"Kandy","date":"2026-12-01","people":45}')$q$);
select pg_temp.try('visitor sets own quote', $q$insert into service_requests (kind, name, phone, quote_amount) values ('parcel', 'Cheat', '0774444444', 1)$q$);
select 'visitor reads requests: ' || count(*) from service_requests;
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff quotes the charter', $q$update service_requests set status = 'quoted', quote_amount = 115000 where kind = 'charter'$q$);
select pg_temp.try('staff closes the day', $q$insert into cash_counts (expected, counted, notes) values (12000, 11950, 'LKR 50 short')$q$);
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger records cash count', $q$insert into cash_counts (expected, counted) values (1, 1)$q$);
select pg_temp.try('passenger saves passengers', $q$update profiles set saved_passengers = '[{"name":"Mum","gender":"Female","phone":"0775555555"}]' where id = auth.uid()$q$);
select pg_temp.try('passenger makes self admin', $q$update profiles set role = 'admin' where id = auth.uid()$q$);
reset role;
