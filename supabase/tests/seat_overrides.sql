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

select '--- flexible seat layout (the printed sheet: 51 seats, right side has 12 rows, left 11)';
create temp table bus_before as select seat_map, ladies_seats from buses where id = 'bus-1';
select pg_temp.try('layout with a seat number used twice', $q$update buses set seat_map = '{"left":2,"right":2,"cells":[["1","1",null,"2","3"]]}' where id = 'bus-1'$q$);
select pg_temp.try('layout with a bad seat number', $q$update buses set seat_map = '{"left":2,"right":2,"cells":[["1","2",null,"3","seat 4"]]}' where id = 'bus-1'$q$);
update buses set ladies_seats = '{1,2}', seat_map = jsonb_build_object('left', 2, 'right', 2, 'cells',
  (select jsonb_agg(jsonb_build_array((4*n)::text, (4*n-1)::text, null, (4*n-3)::text, (4*n-2)::text) order by n) from generate_series(1, 11) n)
  || '[[null,null,null,"45","46"],["48","47","49","50","51"]]'::jsonb) where id = 'bus-1';
select 'seats on the bus: ' || public.bus_capacity(b) || ', first row: ' || (b.seat_map -> 'cells' -> 0)::text || ', last: ' || (b.seat_map -> 'cells' -> 12)::text from buses b where id = 'bus-1';
create or replace function pg_temp.num(seat text, gender text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["%s"],"passenger":{"name":"Walk-in","gender":"%s"},"channel":"counter","payment":"cash"}')$q$, (select fri from t9) + 7, seat, gender) $$;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('book seat 17', pg_temp.num('17', 'Male'));
select pg_temp.try('book seat 51 (back bench)', pg_temp.num('51', 'Male'));
select pg_temp.try('book seat 17 again', pg_temp.num('17', 'Male'));
select pg_temp.try('book seat 52 (not on the bus)', pg_temp.num('52', 'Male'));
select pg_temp.try('book old-style seat 1A', pg_temp.num('1A', 'Male'));
select pg_temp.try('a man books ladies seat 1', pg_temp.num('1', 'Male'));
select pg_temp.try('a woman books ladies seat 1', pg_temp.num('1', 'Female'));
reset role;
delete from bookings where travel_date = (select fri from t9) + 7;
update buses set seat_map = (select seat_map from bus_before), ladies_seats = (select ladies_seats from bus_before) where id = 'bus-1';
select 'classic layout still works: 1A on the bus ' || public.seat_is_on_bus(b, '1A') || ', 17 on the bus ' || public.seat_is_on_bus(b, '17') || ', capacity ' || public.bus_capacity(b) from buses b where id = 'bus-1';

select '--- the seat beside a woman travelling alone';
update app_settings set ladies_adjacent = true, payments_mode = 'demo', booking_otp = false, card_payments = true;
update buses set ladies_seats = '{}' where id = 'bus-1';
create temp table tw as select (select fri from t9) + 14 as d; grant select on tw to anon, authenticated;
create or replace function pg_temp.on(seats text, gender text, extra text default '') returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":[%s],"passenger":{"name":"P","gender":"%s"},"payment":"bank"%s}')$q$, (select d from tw), seats, gender, extra) $$;
select 'neighbours (classic 2+2): 3A→' || array_to_string(public.seat_neighbours(b, '3A'), ',') || ', 3C→' || array_to_string(public.seat_neighbours(b, '3C'), ',') || ', back bench ' || (b.rows + 1) || 'C→' || array_to_string(public.seat_neighbours(b, (b.rows + 1) || 'C'), ',') from buses b where id = 'bus-1';
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('a woman books 3A alone', pg_temp.on('"3A"', 'Female'));
reset role;
select 'published as travelling alone: ' || solo from booking_seats where seat = '3A' and travel_date = (select d from tw);
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('a man books 3B, beside her', pg_temp.on('"3B"', 'Male'));
select pg_temp.try('a man books 3B and 4A together', pg_temp.on('"3B","4A"', 'Male'));
select pg_temp.try('a man books 3C, across the aisle', pg_temp.on('"3C"', 'Male'));
select pg_temp.try('a man books the pair 5A + 5B', pg_temp.on('"5A","5B"', 'Male'));
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-0000-0000-0000-000000000009','w2@x.lk','{"full_name":"Second woman"}') on conflict do nothing;
set role authenticated; select pg_temp.as_user('99999999-0000-0000-0000-000000000009');
select pg_temp.try('another woman books 3B, beside her', pg_temp.on('"3B"', 'Female'));
select pg_temp.try('a woman books 6A alone', pg_temp.on('"6A"', 'Female'));
select pg_temp.try('the same account then books 6B for a man', pg_temp.on('"6B"', 'Male'));
select pg_temp.try('a woman books 7A alone', pg_temp.on('"7A"', 'Female'));
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('a conductor sells 7B to a man', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["7B"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash"}')$q$, (select d from tw)));
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('office staff sell 7B to a man (manual override)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["7B"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash"}')$q$, (select d from tw)));
reset role;
set role authenticated; select pg_temp.as_user('99999999-0000-0000-0000-000000000009');
select pg_temp.try('a woman books 8A alone', pg_temp.on('"8A"', 'Female'));
reset role;
update app_settings set ladies_adjacent = false;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('a man books 8B with the rule switched off', pg_temp.on('"8B"', 'Male'));
reset role;
-- the 51-seat sheet layout: neighbours come from the stored grid
update buses set seat_map = jsonb_build_object('left', 2, 'right', 2, 'cells', '[["4","3",null,"1","2"],[null,null,null,"45","46"],["48","47","49","50","51"]]'::jsonb) where id = 'bus-1';
select 'neighbours (custom grid): 4→' || array_to_string(public.seat_neighbours(b, '4'), ',') || ', 3→' || array_to_string(public.seat_neighbours(b, '3'), ',') || ', 1→' || array_to_string(public.seat_neighbours(b, '1'), ',') || ', 49→' || array_to_string(public.seat_neighbours(b, '49'), ',') || ', 45→' || array_to_string(public.seat_neighbours(b, '45'), ',') from buses b where id = 'bus-1';
update buses set seat_map = null where id = 'bus-1';

select '--- seats held during checkout';
update app_settings set ladies_adjacent = false;
delete from seat_holds;
create or replace function pg_temp.buy(seat text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["%s"],"passenger":{"name":"P","gender":"Male"},"payment":"bank"}')$q$, (select d from tw), seat) $$;
set role anon; select pg_temp.as_user(null);
select pg_temp.try('a visitor holds a seat without signing in', format($q$select hold_seats('sch-cmb-2100', '%s', '{9C}')$q$, (select d from tw)));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A selects 9C and 9D → held for ' || round(extract(epoch from hold_seats('sch-cmb-2100', (select d from tw), '{9C,9D}') - now()) / 60) || ' minutes';
select pg_temp.try('A holds a seat that is already booked (3A)', format($q$select hold_seats('sch-cmb-2100', '%s', '{3A}')$q$, (select d from tw)));
select 'A changes the selection to 9C only → A now holds: ' || (hold_seats('sch-cmb-2100', (select d from tw), '{9C}') is not null)::text || ', ' || (select string_agg(seat, ',') from get_seat_holds((select d from tw), (select d from tw)) where mine);
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B sees: ' || string_agg(seat || ' held, mine=' || mine, '; ') from get_seat_holds((select d from tw), (select d from tw));
select pg_temp.try('B reads who is holding it', $q$select user_id from seat_holds$q$);
select pg_temp.try('B holds 9C too', format($q$select hold_seats('sch-cmb-2100', '%s', '{9C}')$q$, (select d from tw)));
select pg_temp.try('B books 9C while A is checking out', pg_temp.buy('9C'));
select pg_temp.try('B books 9D, which A let go', pg_temp.buy('9D'));
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('a conductor sells 9C at the door', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["9C"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash"}')$q$, (select d from tw)));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A completes the booking for 9C', pg_temp.buy('9C'));
reset role;
select 'holds left after A booked: ' || count(*) from seat_holds;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A selects 10C → held: ' || (hold_seats('sch-cmb-2100', (select d from tw), '{10C}') is not null);
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('office staff sell 10C over the hold (override)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["10C"],"passenger":{"name":"Walk-in","gender":"Male"},"channel":"counter","payment":"cash"}')$q$, (select d from tw)));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A selects 10D → held: ' || (hold_seats('sch-cmb-2100', (select d from tw), '{10D}') is not null);
reset role;
update seat_holds set expires_at = now() - interval '1 second';
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B books 10D after A''s hold ran out', pg_temp.buy('10D'));
reset role;
update app_settings set ladies_adjacent = true;
