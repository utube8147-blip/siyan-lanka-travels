-- Migration 47: who sits in each seat.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\ir _autopay.inc
update app_settings set booking_otp = false, booking_window_days = 0, ladies_adjacent = true, card_payments = true;
insert into auth.users (id, email, phone, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001', null, '94771111111', '{"full_name":"Asha"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002', null, '94772222222', '{"full_name":"Bandu"}'),
 ('cccccccc-0000-0000-0000-000000000003', null, '94773333333', '{"full_name":"Chathu"}');
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.book(label text, seats text, genders text, lead text) returns text language plpgsql as $$
declare r public.bookings;
begin
  select * into r from create_booking(format('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":%s,"seat_genders":%s,"payment":"card","passenger":{"name":"P","gender":"%s","phone":"0771111111"}}', current_date + 1, seats, genders, lead)::jsonb);
  return 'OK      ' || label || ' → ' || r.seat_genders::text;
exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 120); end $$;
update schedules set days = array[0,1,2,3,4,5,6]::smallint[] where id = 'sch-cmb-2100';
select 'ladies seats: ' || array_to_string(ladies_seats, ',') from buses where id = (select bus_id from schedules where id = 'sch-cmb-2100');

set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select '--- one seat: gender needed';
select pg_temp.book('one seat, no gender', '["5A"]', '{"5A":""}', '');
select '--- two seats side by side: may skip';
select pg_temp.book('5A+5B together, no genders', '["5A","5B"]', '{"5A":"","5B":""}', '');
select '--- two seats apart: each needs one';
select pg_temp.book('6A + 9C apart, 9C blank', '["6A","9C"]', '{"6A":"Female","9C":""}', 'Female');
select pg_temp.book('6A woman + 9C man (apart)', '["6A","9C"]', '{"6A":"Female","9C":"Male"}', 'Female');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select '--- beside her: 6A is a woman alone even though her booking has two seats';
select pg_temp.book('Bandu (man) takes 6B', '["6B"]', '{"6B":"Male"}', 'Male');
select pg_temp.book('Bandu takes 9D beside her companion (a man)', '["9D"]', '{"9D":"Male"}', 'Male');
select '--- women-only seat is about the seat, not the lead passenger';
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.book('1A man in a ladies seat', '["1A","1B"]', '{"1A":"Male","1B":"Female"}', 'Male');
select pg_temp.book('1A + 1B women, lead (who pays) a man', '["1A","1B"]', '{"1A":"Female","1B":"Female"}', 'Male');
reset role;
select '--- public seat map';
select seat || ' ' || coalesce(nullif(gender, ''), '-') || case when solo then ' alone' else ' with own party' end from booking_seats order by seat;
