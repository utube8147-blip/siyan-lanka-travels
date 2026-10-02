-- Run after the other test files. Every online booking is confirmed with a code texted to a mobile number.
\set QUIET on
\pset tuples_only on
\pset format unaligned
update routes set flat_fare = false;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 100); end $$;
create temp table t6 as select (current_date + 49 + ((5 - extract(dow from current_date + 49)::int + 7) % 7)) as fri;
grant select on t6 to anon, authenticated;
create temp table ids (k text primary key, v text); grant all on ids to anon, authenticated;
create or replace function pg_temp.book(seat text, phone text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["%s"],"passenger":{"name":"A","gender":"Male"},"contact":{"phone":"%s"},"payment":"bank"}')$q$, (select fri from t6), seat, phone) $$;
update app_settings set payments_mode = 'demo', booking_otp = true, booking_otp_minutes = 20, card_payments = true;
delete from booking_codes;

select '--- phone numbers';
select 'normalised: ' || coalesce(public.lk_mobile('077 123 4567'), 'null') || ', ' || coalesce(public.lk_mobile('+94771234567'), 'null') || ', landline: ' || coalesce(public.lk_mobile('0112345678'), 'refused') || ', an email: ' || coalesce(public.lk_mobile('a@b.lk'), 'refused');

select '--- a code on a mobile for every online booking (this account signed in with email)';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A books without a code', pg_temp.book('5A', '0771234567'));
select pg_temp.try('A asks for a code to an email address', $q$select request_booking_code('a@x.lk')$q$);
insert into ids select 'c1', request_booking_code('077 123 4567')::text;
select pg_temp.try('A asks again straight away', $q$select request_booking_code('0771234567')$q$);
select pg_temp.try('A reads the codes', $q$select code from booking_codes$q$);
select pg_temp.try('A books before entering the code', pg_temp.book('5A', '0771234567'));
select 'A guesses → accepted: ' || verify_booking_code((select v::uuid from ids where k = 'c1'), '000000');
reset role;
insert into ids select 'code1', code from booking_codes where id = (select v::uuid from ids where k = 'c1'); -- what the text message says
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B uses A''s code', $q$select verify_booking_code((select v::uuid from ids where k = 'c1'), (select v from ids where k = 'code1'))$q$);
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A enters the code → accepted: ' || verify_booking_code((select v::uuid from ids where k = 'c1'), (select v from ids where k = 'code1'));
select pg_temp.try('A books with a different contact number', pg_temp.book('5A', '0719999999'));
select pg_temp.try('A books with the verified number', pg_temp.book('5A', '+94 77 123 4567'));
select pg_temp.try('A books again with the same code', pg_temp.book('5B', '0771234567'));
reset role;
update booking_codes set created_at = now() - interval '2 minutes';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'c2', request_booking_code('0771234567')::text;
reset role;
update booking_codes set expires_at = now() - interval '1 minute' where id = (select v::uuid from ids where k = 'c2');
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A enters a code after it ran out', $q$select verify_booking_code((select v::uuid from ids where k = 'c2'), '123456')$q$);
reset role;
update booking_codes set created_at = now() - interval '2 minutes';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'c3', request_booking_code('0771234567')::text;
reset role;
update booking_codes set status = 'verified', verified_at = now() - interval '25 minutes' where id = (select v::uuid from ids where k = 'c3');
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A books with a code verified 25 minutes ago', pg_temp.book('5B', '0771234567'));
reset role;

select '--- who is not asked';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff sells at the counter (no code)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["6A"],"passenger":{"name":"Walk-in"},"channel":"counter","payment":"cash"}')$q$, (select fri from t6)));
reset role;
update app_settings set booking_otp = false;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A books with the rule switched off by the admin', pg_temp.book('5D', '0771234567'));
reset role;
