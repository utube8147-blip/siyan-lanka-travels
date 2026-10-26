-- Migration 35. Run after local_supabase_stub.sql and setup.sql (standalone).
-- Every "BLOCKED" line here is meant to be blocked.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\ir _autopay.inc
update app_settings set booking_otp = false, card_payments = true, payments_mode = 'payhere', booking_window_days = 0;
insert into auth.users (id, email, phone, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001', null, '94771111111', '{"full_name":"Alex A","email":"Alex@Example.lk"}'),
 ('dddddddd-0000-0000-0000-000000000004', 'cond@siyan.lk', null, '{"full_name":"Conductor C"}'),
 ('eeeeeeee-0000-0000-0000-000000000005', 'office@siyan.lk', null, '{"full_name":"Office O"}'),
 ('ffffffff-0000-0000-0000-000000000006', 'owner@siyan.lk', null, '{"full_name":"Owner"}');
update profiles set role = 'conductor' where id = 'dddddddd-0000-0000-0000-000000000004';
update profiles set role = 'staff' where id = 'eeeeeeee-0000-0000-0000-000000000005';
update profiles set role = 'admin' where id = 'ffffffff-0000-0000-0000-000000000006';
create temp table t as select (current_date + 14 + ((1 - extract(dow from current_date + 14)::int + 7) % 7)) as mon;
grant select on t to anon, authenticated;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 90); end $$;

select '--- phone sign-up keeps the optional email on the profile';
select 'profile: phone ' || phone || ', email ' || email from profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select '--- passenger pays for 1 seat, then tries to grow it';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
create temp table bk as select * from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9A"],"payment":"card","passenger":{"name":"Alex","gender":"Male","phone":"0771111111"}}$q$, (select mon from t))::jsonb);
grant select on bk to authenticated;
reset role;
select 'gateway paid: ' || payment_status from mark_paid_by_gateway((select ref from bk), (select total from bk), 'PH1', 'card');
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger adds 5 seats without paying', $q$select modify_booking((select id from bk), array['9A','9B','9C','9D','10A','10B'], null)$q$);
select pg_temp.try('passenger swaps to seat 11A', $q$select modify_booking((select id from bk), array['11A'], null)$q$);
select pg_temp.try('passenger changes own email', $q$update profiles set email = 'alex@new.lk' where id = auth.uid()$q$);
select pg_temp.try('passenger saves a bad email', $q$update profiles set email = 'not an email' where id = auth.uid()$q$);
reset role;
select 'payouts created: ' || count(*) from payouts;

select '--- conductor writes to bookings directly';
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('conductor sets refund_amount', $q$update bookings set refund_amount = 99999 where id = (select id from bk)$q$);
select pg_temp.try('conductor sets payment_status', $q$update bookings set payment_status = 'paid' where id = (select id from bk)$q$);
select pg_temp.try('conductor cancels directly', $q$update bookings set status = 'cancelled' where id = (select id from bk)$q$);
select pg_temp.try('conductor boards', $q$update bookings set status = 'boarded' where id = (select id from bk)$q$);
select pg_temp.try('conductor undoes boarding', $q$update bookings set status = 'confirmed' where id = (select id from bk)$q$);
select pg_temp.try('conductor marks no-show', $q$update bookings set status = 'no-show' where id = (select id from bk)$q$);
reset role;
select 'payouts created: ' || count(*) from payouts;

select '--- seat holds';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('hold a seat that doesn''t exist', format($q$select hold_seats('sch-cmb-2100', '%s', array['99Z'])$q$, (select mon from t)));
select pg_temp.try('hold on a day the bus doesn''t run', format($q$select hold_seats('sch-cmb-2100', '%s', array['12A'])$q$, (select mon + 1 from t)));
select pg_temp.try('hold a whole bus', format($q$select hold_seats('sch-cmb-2100', '%s', array['12A','12B','12C','12D','13A','13B','13C'])$q$, (select mon from t)));
select pg_temp.try('hold a departure that doesn''t exist', format($q$select hold_seats('nope', '%s', array['12A'])$q$, (select mon from t)));
select pg_temp.try('hold 2 real seats', format($q$select hold_seats('sch-cmb-2100', '%s', array['5A','5B'])$q$, (select mon from t)));
reset role;

select '--- card payments need PayHere';
update app_settings set card_payments = false, payments_mode = 'demo';
set role authenticated; select pg_temp.as_user('ffffffff-0000-0000-0000-000000000006');
select pg_temp.try('admin opens card payments on demo', $q$update app_settings set card_payments = true$q$);
select pg_temp.try('admin changes the booking fee', $q$update app_settings set booking_fee = 60$q$);
select pg_temp.try('admin switches to PayHere, then opens card', $q$update app_settings set payments_mode = 'payhere', card_payments = true$q$);
select 'admin sees: ' || count(*) || ' accounts, passenger email ' || max(email) filter (where full_name = 'Alex A') from admin_list_users();
reset role;
