-- Run after the other test files. Reserved seats (owner's code) and the ladies-only override.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 105); end $$;
create temp table t9 as select (current_date + 77 + ((5 - extract(dow from current_date + 77)::int + 7) % 7)) as fri;
grant select on t9 to anon, authenticated;
create temp table ids (k text primary key, v text); grant all on ids to anon, authenticated;
create or replace function pg_temp.sell(seat text, who text, gender text, extra text default '') returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["%s"],"passenger":{"name":"%s","gender":"%s","phone":"0770000000"},"channel":"counter","payment":"cash"%s}')$q$, (select fri from t9), seat, who, gender, extra) $$;
update app_settings set payments_mode = 'demo', booking_otp = false, card_payments = true;
update buses set reserved_seats = '{1C,1D}' where id = (select bus_id from schedules where id = 'sch-cmb-2100');
delete from seat_approvals;

select '--- reserved seats';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger books a reserved seat online', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["1C"],"passenger":{"name":"A","gender":"Male"},"payment":"bank"}')$q$, (select fri from t9)));
select pg_temp.try('passenger asks the owner for a code', format($q$select request_seat_approval('sch-cmb-2100', '%s', '{1C}')$q$, (select fri from t9)));
select pg_temp.try('passenger reads the codes', $q$select code from seat_approvals$q$);
insert into ids select 'pa', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["3C"],"passenger":{"name":"A","gender":"Male"},"payment":"bank"}$q$, (select fri from t9))::jsonb);
select pg_temp.try('passenger moves own booking into a reserved seat', $q$select modify_booking((select v::uuid from ids where k = 'pa'), array['1D'])$q$);
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff sells a reserved seat without asking the owner', pg_temp.sell('1C', 'VIP guest', 'Male'));
select pg_temp.try('staff asks for a seat that isn''t reserved', format($q$select request_seat_approval('sch-cmb-2100', '%s', '{4C}')$q$, (select fri from t9)));
insert into ids select 'ap1', request_seat_approval('sch-cmb-2100', (select fri from t9), '{1C}', 'VIP guest')::text;
select pg_temp.try('staff asks again straight away', format($q$select request_seat_approval('sch-cmb-2100', '%s', '{1C}')$q$, (select fri from t9)));
select pg_temp.try('staff reads the code from the table', $q$select code from seat_approvals$q$);
select 'staff guesses the code → accepted: ' || verify_seat_approval((select v::uuid from ids where k = 'ap1'), '000000');
select pg_temp.try('staff sells after a wrong guess', pg_temp.sell('1C', 'VIP guest', 'Male'));
reset role;
select 'code is 6 digits: ' || (code ~ '^[0-9]{6}$') || ', wrong tries recorded: ' || attempts from seat_approvals where id = (select v::uuid from ids where k = 'ap1');
insert into ids select 'code1', code from seat_approvals where id = (select v::uuid from ids where k = 'ap1'); -- what the owner receives by text
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('another staff member uses that code', $q$select verify_seat_approval((select v::uuid from ids where k = 'ap1'), (select v from ids where k = 'code1'))$q$);
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff enters the owner''s code → accepted: ' || verify_seat_approval((select v::uuid from ids where k = 'ap1'), (select v from ids where k = 'code1'));
select pg_temp.try('staff sells a different reserved seat with it', pg_temp.sell('1D', 'Someone else', 'Male'));
select pg_temp.try('staff sells the approved seat', pg_temp.sell('1C', 'VIP guest', 'Male'));
reset role;
select 'approval is now: ' || status from seat_approvals where id = (select v::uuid from ids where k = 'ap1');
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff reuses the approval for the other seat', pg_temp.sell('1D', 'Someone else', 'Male'));
reset role;
update seat_approvals set requested_at = now() - interval '5 minutes';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
insert into ids select 'ap2', request_seat_approval('sch-cmb-2100', (select fri from t9), '{1D}')::text;
reset role;
update seat_approvals set expires_at = now() - interval '1 minute' where id = (select v::uuid from ids where k = 'ap2');
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff enters a code after it ran out', $q$select verify_seat_approval((select v::uuid from ids where k = 'ap2'), '123456')$q$);
reset role;

select '--- ladies-only override';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff sells ladies seat 1A to a man', pg_temp.sell('1A', 'Mr Perera', 'Male'));
select pg_temp.try('staff sells it with the override', pg_temp.sell('1A', 'Mr Perera', 'Male', ',"override_ladies":true'));
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('conductor uses the override', pg_temp.sell('1B', 'Mr Silva', 'Male', ',"override_ladies":true'));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger sends the override flag online', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["1B"],"passenger":{"name":"A","gender":"Male"},"payment":"bank","override_ladies":true}')$q$, (select fri from t9)));
reset role;
update buses set reserved_seats = '{}' where id = (select bus_id from schedules where id = 'sch-cmb-2100');

select '--- alternate-day timetable';
insert into schedules (id, route_id, bus_id, departure, days, active, repeat_every, repeat_from)
values ('sch-alt-out', 'route-48-east', 'bus-1', '22:30', '{0,1,2,3,4,5,6}', true, 2, current_date + 90);
select pg_temp.try('admin saves every-2-days without a start date', $q$update schedules set repeat_from = null where id = 'sch-alt-out'$q$);
create or replace function pg_temp.alt(day_offset int) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-alt-out","date":"%s","from":"Colombo","to":"Batticaloa","seats":["5C"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash"}')$q$, current_date + 90 + day_offset) $$;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('book the first run (day 0)', pg_temp.alt(0));
select pg_temp.try('book the off day (day 1)', pg_temp.alt(1));
select pg_temp.try('book day 2', pg_temp.alt(2));
select pg_temp.try('book day 7 (same weekday as day 0, but an off day)', pg_temp.alt(7));
select pg_temp.try('book day 8', pg_temp.alt(8));
select pg_temp.try('book the day before the pattern starts', pg_temp.alt(-2));
reset role;
select 'weekday departures still follow their weekdays: ' || (public.schedule_runs_on(s, (select fri from t9)) and not public.schedule_runs_on(s, (select fri from t9) + 1)) from schedules s where id = 'sch-cmb-2100';
delete from bookings where schedule_id = 'sch-alt-out'; delete from schedules where id = 'sch-alt-out';

select '--- bike categories set by the admin';
create temp table bikes_before as select bikes from app_settings; 
update app_settings set bikes = '{"minFee":300,"maxPerBooking":2,"kinds":{"scooter":{"label":"Scooter","spaces":2,"fullRouteFee":1200,"active":false},"three-wheeler":{"label":"Three-wheeler","spaces":4,"fullRouteFee":4000,"needsPlate":true,"active":true},"bicycle":{"label":"Bicycle","spaces":1,"fullRouteFee":600,"needsPlate":false,"active":true}}}';
update buses set bike_spaces = 6 where id = 'bus-1';
create or replace function pg_temp.bike(seat text, kind text, plate text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["%s"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash","bikes":[{"kind":"%s","description":"Bajaj RE, green","reg_no":"%s"}]}')$q$, (select fri from t9), seat, kind, plate) $$;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('a new category the admin added (three-wheeler)', pg_temp.bike('6C', 'three-wheeler', 'EP ABC-1234'));
select pg_temp.try('three-wheeler without a plate', pg_temp.bike('6D', 'three-wheeler', ''));
select pg_temp.try('bicycle without a plate (not required)', pg_temp.bike('6D', 'bicycle', ''));
select pg_temp.try('a category that is switched off (scooter)', pg_temp.bike('7C', 'scooter', 'EP XY-1111'));
select pg_temp.try('a category that does not exist', pg_temp.bike('7C', 'helicopter', 'EP XY-1111'));
select pg_temp.try('a second three-wheeler when only 1 space is left', pg_temp.bike('7C', 'three-wheeler', 'EP ABD-9999'));
reset role;
select 'charged: ' || string_agg(k.kind || ' LKR ' || k.fee, ', ' order by k.fee desc) || '; spaces used: ' || public.bike_spaces_used('sch-cmb-2100', (select fri from t9)) from booking_bikes k join bookings b on b.id = k.booking_id where b.travel_date = (select fri from t9) and b.status::text <> 'cancelled';
update app_settings set bikes = (select bikes from bikes_before);

select '--- one price per route';
create or replace function pg_temp.fare(seat text, f text, t text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"%s","to":"%s","seats":["%s"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash"}')$q$, (select fri from t9), f, t, seat) $$;
update routes set flat_fare = true where id = 'route-48-east';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('whole route', pg_temp.fare('8C', 'Colombo', 'Akkaraipattu'));
select pg_temp.try('gets off in the middle', pg_temp.fare('8D', 'Colombo', 'Dambulla'));
select pg_temp.try('gets on in the middle', pg_temp.fare('9C', 'Polonnaruwa', 'Batticaloa'));
reset role;
select 'one price: ' || string_agg(from_stop || ' → ' || to_stop || ' LKR ' || fare, ' | ' order by seats) from bookings where travel_date = (select fri from t9) and seats && '{8C,8D,9C}';
update routes set flat_fare = false where id = 'route-48-east';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('per-stop mode, gets off in the middle', pg_temp.fare('9D', 'Colombo', 'Dambulla'));
reset role;
select 'per-stop price: ' || from_stop || ' → ' || to_stop || ' LKR ' || fare from bookings where travel_date = (select fri from t9) and seats = '{9D}';
