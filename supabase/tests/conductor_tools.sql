-- Migration 36: road reports, route drafts for conductors, optional stops.
-- Run after local_supabase_stub.sql and setup.sql (standalone).
\set QUIET on
\pset tuples_only on
\pset format unaligned
update app_settings set booking_otp = false, card_payments = true, payments_mode = 'payhere', booking_window_days = 0, optional_stop_cutoff_hours = 0,
  messaging = coalesce(messaging, '{}'::jsonb) || '{"sms": true}'::jsonb;
insert into auth.users (id, email, phone, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001', null, '94771111111', '{"full_name":"Alex A"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002', null, '94772222222', '{"full_name":"Bina B"}'),
 ('dddddddd-0000-0000-0000-000000000004', 'cond@siyan.lk', null, '{"full_name":"Conductor C"}'),
 ('cccccccc-0000-0000-0000-000000000003', 'cond2@siyan.lk', null, '{"full_name":"Conductor D"}'),
 ('eeeeeeee-0000-0000-0000-000000000005', 'office@siyan.lk', null, '{"full_name":"Office O"}');
update profiles set role = 'conductor' where id in ('dddddddd-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003');
update profiles set role = 'staff' where id = 'eeeeeeee-0000-0000-0000-000000000005';
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 110); end $$;

-- Kadawatha: on request, 3 seats needed. Nittambuwa: on request, 1 seat needed. The bus runs every day.
update routes set stops = jsonb_set(jsonb_set(stops, '{1,optional}', 'true'), '{1,minSeats}', '3') where id = 'route-48-east';
update routes set stops = jsonb_set(jsonb_set(stops, '{2,optional}', 'true'), '{2,minSeats}', '1') where id = 'route-48-east';
update schedules set days = array[0,1,2,3,4,5,6]::smallint[] where id = 'sch-cmb-2100';
create temp table t as select current_date + 1 as d;
grant select on t to anon, authenticated;

select '--- bookings to the optional stops before the cut-off';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
create temp table bk_a as select * from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Kadawatha","to":"Batticaloa","seats":["9A"],"payment":"card","passenger":{"name":"Alex","gender":"Male","phone":"0771111111"}}$q$, (select d from t))::jsonb);
grant select on bk_a to authenticated;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
create temp table bk_b as select * from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Nittambuwa","seats":["10A"],"payment":"card","passenger":{"name":"Bina","gender":"Female","phone":"0772222222"}}$q$, (select d from t))::jsonb);
reset role;
select 'status: ' || stop || ' ' || seats || '/' || min_seats || case when decided then ' decided' else ' waiting' end
from optional_stop_status('sch-cmb-2100', (select d from t)) order by stop;
select 'settle before the cut-off moves: ' || settle_optional_stops();

select '--- cut-off passes';
update app_settings set optional_stop_cutoff_hours = 72;
select 'settle moves: ' || settle_optional_stops();
select 'decision: ' || stop || case when runs then ' runs' else ' skipped, moved to ' || coalesce(moved_to, '-') end
from optional_stop_decisions where travel_date = (select d from t) order by stop;
select 'Alex now: ' || from_stop || ' → ' || to_stop from bookings where ref = (select ref from bk_a);
select 'Bina now: ' || from_stop || ' → ' || to_stop from bookings where ref = (select ref from bk_b);
select 'Alex told: ' || title || ' / ' || body from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and tag like 'optional-%';
select 'texts queued: ' || count(*) from message_queue where kind = 'optional_stop';
select 'settle again moves: ' || settle_optional_stops();

select '--- booking the optional stops after the cut-off';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('book to Kadawatha (skipped)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kadawatha","seats":["11A"],"payment":"card","passenger":{"name":"Alex","gender":"Male","phone":"0771111111"}}'::jsonb)$q$, (select d from t)));
select pg_temp.try('book to Nittambuwa (running)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Nittambuwa","seats":["11B"],"payment":"card","passenger":{"name":"Alex","gender":"Male","phone":"0771111111"}}'::jsonb)$q$, (select d from t)));
reset role;

select '--- road reports';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger reports police', $q$select report_road('police', 7.1, 80.1, 'at the bridge')$q$);
select 'passenger sees reports: ' || count(*) from road_reports;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('conductor reports police', $q$select report_road('police', 7.1, 80.1, 'at the bridge')$q$);
select pg_temp.try('conductor reports a bad kind', $q$select report_road('aliens', 7.1, 80.1)$q$);
select pg_temp.try('conductor writes a report directly', $q$insert into road_reports (kind, lat, lng) values ('police', 1, 1)$q$);
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'other conductor sees: ' || kind || ' by ' || reporter_name || ', confirmations ' || confirmations from road_reports;
select pg_temp.try('other conductor reports the same spot again', $q$select report_road('police', 7.1005, 80.1004)$q$);
select 'reports now: ' || count(*) || ', confirmations ' || max(confirmations) from road_reports;
select pg_temp.try('other conductor says gone', $q$select vote_road_report((select id from road_reports limit 1), false)$q$);
select 'after one "gone": ' || case when cleared_at is null then 'still live' else 'cleared' end from road_reports;
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('office says gone', $q$select vote_road_report((select id from road_reports limit 1), false)$q$);
select 'after office: ' || case when cleared_at is null then 'still live' else 'cleared' end from road_reports;
reset role;

select '--- route drafts';
insert into route_plans (name, route_id, stops, notes) values ('Via Kandy', 'route-48-east', '[]', '');
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select 'conductor sees drafts: ' || count(*) from route_plans;
select pg_temp.try('conductor edits a draft', $q$update route_plans set name = 'x'$q$);
select 'draft name: ' || name from route_plans;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'passenger sees drafts: ' || count(*) from route_plans;
reset role;

select '--- hidden shaping points';
update routes set stops = jsonb_set(stops, '{3,hidden}', 'true') where id = 'route-48-east';
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('book to a hidden point (Kurunegala)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Kurunegala","seats":["5A"],"payment":"card","passenger":{"name":"Bina","gender":"Female","phone":"0772222222"}}'::jsonb)$q$, (select d from t)));
select pg_temp.try('book past it (Colombo → Dambulla)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Dambulla","seats":["5B"],"payment":"card","passenger":{"name":"Bina","gender":"Female","phone":"0772222222"}}'::jsonb)$q$, (select d from t)));
reset role;
