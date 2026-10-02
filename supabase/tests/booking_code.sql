-- Run after the other test files. A one-time code is needed for every online booking.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
-- how the session was verified, and how many seconds ago (null = no claim at all)
create or replace function pg_temp.verified(method text, secs_ago int) returns void language sql as $$
  select set_config('request.jwt.claims', case when method is null then '' else
    json_build_object('amr', json_build_array(json_build_object('method', method, 'timestamp', floor(extract(epoch from clock_timestamp()))::bigint - secs_ago)))::text end, false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 95); end $$;
create temp table t6 as select (current_date + 49 + ((5 - extract(dow from current_date + 49)::int + 7) % 7)) as fri;
grant select on t6 to anon, authenticated;
create or replace function pg_temp.book(seat text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["%s"],"passenger":{"name":"A","gender":"Male"}}')$q$, (select fri from t6), seat) $$;
update app_settings set payments_mode = 'demo', booking_otp = true, booking_otp_minutes = 20, card_payments = true;

select '--- a code for every online booking';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.verified(null, 0);
select pg_temp.try('A books, signed in days ago (no code)', pg_temp.book('5A'));
select pg_temp.verified('password', 5);
select pg_temp.try('A books right after a password sign-in', pg_temp.book('5A'));
select pg_temp.verified('otp', 3600);
select pg_temp.try('A books with a code from an hour ago', pg_temp.book('5A'));
select pg_sleep(1.1); -- the other test files booked for A a moment ago
select pg_temp.verified('otp', 0);
select pg_temp.try('A books with a fresh code', pg_temp.book('5A'));
select pg_sleep(1.1);
select pg_temp.try('A books again with the same code', pg_temp.book('5B'));
select pg_sleep(1.1);
select pg_temp.verified('otp', 0);
select pg_temp.try('A books again with a new code', pg_temp.book('5B'));
select set_config('request.jwt.claims', '{"amr":"otp"}', false) is not null;
select pg_temp.try('A sends a malformed claim', pg_temp.book('5C'));
reset role;

select '--- who is not asked';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003'); select pg_temp.verified(null, 0);
select pg_temp.try('staff sells at the counter (no code)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["6A"],"passenger":{"name":"Walk-in"},"channel":"counter","payment":"cash"}')$q$, (select fri from t6)));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001'); select pg_temp.verified(null, 0);
select pg_temp.try('A turns the rule off', $q$update app_settings set booking_otp = false$q$);
select 'rule still on after A''s attempt: ' || booking_otp from app_settings;
reset role;
update app_settings set booking_otp = false;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001'); select pg_temp.verified(null, 0);
select pg_temp.try('A books with the rule switched off by the admin', pg_temp.book('5D'));
reset role;
