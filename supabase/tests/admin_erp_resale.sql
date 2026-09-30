-- Run after security_and_booking.sql (reuses its users A, B, staff S).
\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 90); end $$;
insert into auth.users (id, email, raw_user_meta_data) values ('dddddddd-0000-0000-0000-000000000004','boss@x.lk','{"full_name":"Owner"}');
update profiles set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000004';
create temp table t2 as select (current_date + 21 + ((1 - extract(dow from current_date + 21)::int + 7) % 7)) as mon;
grant select on t2 to authenticated;

select '--- roles';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff lists users', 'select * from admin_list_users()');
select pg_temp.try('staff promotes self to admin', $q$select set_user_role(auth.uid(), 'admin')$q$);
select pg_temp.try('staff changes booking fee', 'update app_settings set booking_fee = 0') || ' (rows: ' || (select count(*) from app_settings where booking_fee = 0) || ')';
select pg_temp.try('staff logs fuel', $q$insert into expenses (category, amount, bus_id, litres, odometer_km) values ('fuel', 18500, 'bus-1', 52.5, 120400)$q$);
select pg_temp.try('staff logs a salary', $q$insert into expenses (category, amount) values ('salary', 90000)$q$);
select pg_temp.try('staff reads crew salaries', 'select monthly_salary from crew') || ' (rows visible: ' || (select count(*) from crew) || ')';
reset role; insert into crew (full_name, role, monthly_salary) values ('Driver D', 'driver', 85000);
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff sees crew rows: ' || count(*) from crew;
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger logs fuel', $q$insert into expenses (category, amount) values ('fuel', 100)$q$);
select 'passenger sees expenses: ' || count(*) from expenses;
reset role;

select '--- super admin';
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select 'admin lists users: ' || count(*) || ' (' || string_agg(role, ',' order by role) || ')' from admin_list_users();
select pg_temp.try('admin makes B staff', $q$select set_user_role('bbbbbbbb-0000-0000-0000-000000000002', 'staff')$q$);
select pg_temp.try('admin demotes self', $q$select set_user_role(auth.uid(), 'passenger')$q$);
select pg_temp.try('admin logs service with next due', $q$insert into expenses (category, amount, bus_id, odometer_km, next_due_km, next_due_date) values ('service', 45000, 'bus-1', 120000, 130000, current_date + 90)$q$);
select pg_temp.try('admin adds charter income', $q$insert into other_income (category, amount, bus_id) values ('charter', 120000, 'bus-1')$q$);
select pg_temp.try('admin adds insurance doc', $q$insert into bus_documents (bus_id, kind, number, expires_on) values ('bus-1', 'insurance', 'POL-1', current_date + 20)$q$);
select 'admin sees all expenses: ' || count(*) || ', total LKR ' || sum(amount) from expenses;
select pg_temp.try('admin turns resale ON', 'update app_settings set resale_enabled = true');
reset role;
update profiles set role = 'passenger' where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select '--- resale';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'A books 2 seats: total ' || total from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["8C","8D"],"passenger":{"name":"Alex A","gender":"Male"}}$q$, (select mon from t2))::jsonb);
reset role; create temp table rb as select id, total, fee from bookings where passenger_name='Alex A' and seats @> '{8C}'; grant select on rb to authenticated;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A lists above what they paid', format('select list_for_resale(%L, 999999)', (select id from rb)));
select pg_temp.try('A lists for LKR 4000', format('select list_for_resale(%L, 4000)', (select id from rb)));
select pg_temp.try('A lists it twice', format('select list_for_resale(%L, 3900)', (select id from rb)));
reset role;
set role anon; select pg_temp.as_user(null);
select 'public marketplace shows: ' || count(*) || ' listing(s), seats ' || string_agg(array_to_string(seats, ','), ';') from get_resale_listings();
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A buys own listing', format($q$select buy_resale((select id from resale_listings limit 1), '{"name":"A","gender":"Male"}', '{}')$q$));
reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select 'B buys it: new booking total LKR ' || total || ', seats ' || array_to_string(seats, ',') || ', owner is B: ' || (user_id = auth.uid()) from buy_resale((select id from get_resale_listings() limit 1), '{"name":"Fathima B","gender":"Female","phone":"077"}', '{"email":"b@x.lk"}');
select pg_temp.try('C tries to buy the sold listing', format($q$select buy_resale(%L, '{"name":"X","gender":"Male"}', '{}')$q$, (select id from resale_listings where status='sold' limit 1)));
reset role;
select 'seller booking now: ' || status || ', paid out LKR ' || refund_amount from bookings where id = (select id from rb);
select 'seats 8C/8D held by: ' || string_agg(distinct b.passenger_name, ',') from booking_seats s join bookings b on b.id = s.booking_id where s.seat in ('8C','8D') and s.active and s.travel_date = (select mon from t2);
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.try('admin turns resale OFF', 'update app_settings set resale_enabled = false');
reset role;
set role anon; select 'marketplace while OFF: ' || count(*) || ' listings' from get_resale_listings(); reset role;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B lists while resale is OFF', format('select list_for_resale(%L, 1000)', (select id from bookings where passenger_name='Fathima B' and seats @> '{8C}')));
reset role;
