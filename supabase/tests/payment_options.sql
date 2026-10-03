-- Run after the other test files. Card lock, pay on the bus, payment notices, staff alerts.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.try(label text, q text) returns text language plpgsql as $$
begin execute q; return 'OK      ' || label; exception when others then return 'BLOCKED ' || label || '  → ' || left(sqlerrm, 110); end $$;
create temp table t7 as select (current_date + 63 + ((5 - extract(dow from current_date + 63)::int + 7) % 7)) as fri;
grant select on t7 to anon, authenticated;
create temp table ids (k text primary key, v text); grant all on ids to anon, authenticated;
create or replace function pg_temp.book(seat text, pay text) returns text language sql as $$
  select format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["%s"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"%s"}')$q$, (select fri from t7), seat, pay) $$;
update app_settings set payments_mode = 'demo', booking_otp = false, card_payments = false, pay_on_bus = true;
delete from notifications; delete from message_queue;

select '--- card and wallet are locked';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A pays by card', pg_temp.book('8A', 'card'));
select pg_temp.try('A pays by wallet', pg_temp.book('8A', 'wallet'));
select pg_temp.try('A sends no payment method (defaults to card)', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["8A"],"passenger":{"name":"A","gender":"Male"}}')$q$, (select fri from t7)));
select pg_temp.try('A switches card payments on', $q$update app_settings set card_payments = true$q$);
select 'card payments still locked after A''s attempt: ' || (not card_payments) from app_settings;
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff sells at the counter for cash', format($q$select create_booking('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["8B"],"passenger":{"name":"Walk-in"},"channel":"counter","payment":"cash"}')$q$, (select fri from t7)));
reset role;

select '--- pay on the bus';
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'bus1', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9A"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"bus"}$q$, (select fri from t7))::jsonb);
insert into ids select 'bus2', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["9B"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"bus"}$q$, (select fri from t7))::jsonb);
select 'A reserves, pay on bus → ' || status || ' / ' || payment_status || ' / ' || payment_method || ', kept until after departure: ' || (hold_expires_at > (travel_date + time '21:00') at time zone 'Asia/Colombo') from bookings where id = (select v::uuid from ids where k = 'bus1');
select pg_temp.try('A marks own booking paid', $q$select confirm_payment((select v::uuid from ids where k = 'bus1'), 'cash')$q$);
reset role;
select 'still held after hold clean-up: ' || (release_expired_holds() >= 0 and (select status::text from bookings where id = (select v::uuid from ids where k = 'bus1')) = 'held');
select 'text to A: ' || left(body, 28) || ' … ' || substring(body from 'Pay LKR.*bus') from message_queue where kind = 'booking_held' order by created_at limit 1;
set role authenticated; select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.try('B takes the seat A reserved', pg_temp.book('9A', 'bus'));
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'conductor takes cash at the door → ' || status || ' / ' || payment_status || ' / ' || payment_method from confirm_payment((select v::uuid from ids where k = 'bus1'), 'cash');
update bookings set status = 'boarded' where id = (select v::uuid from ids where k = 'bus1');
update bookings set status = 'boarded' where id = (select v::uuid from ids where k = 'bus2'); -- boards first, pays later
select 'second passenger on board, not paid yet → ' || status || ' / ' || payment_status from bookings where id = (select v::uuid from ids where k = 'bus2');
select 'conductor collects in transit → ' || status || ' / ' || payment_status || ' / ' || payment_method from confirm_payment((select v::uuid from ids where k = 'bus2'), 'cash');
select pg_temp.try('conductor collects twice', $q$select confirm_payment((select v::uuid from ids where k = 'bus2'), 'cash')$q$);
reset role;
select 'A told each time: ' || count(*) || ' texts, ' || (select count(*) from notifications where title = 'Payment received') || ' notifications' from message_queue where body like '%Payment of LKR%received%';
update app_settings set pay_on_bus = false;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('A picks pay on bus while the admin has it off', pg_temp.book('9C', 'bus'));
reset role;
update app_settings set pay_on_bus = true;

select '--- pay at the counter';
delete from notifications;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'ctr', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["10A"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"counter"}$q$, (select fri from t7))::jsonb);
reset role;
select 'office staff alerted: ' || count(*) || ' (staff + admin), conductor alerted: ' || count(*) filter (where user_id = 'eeeeeeee-0000-0000-0000-000000000005') || ', title: ' || min(title) from notifications where title like 'Seat held%';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff takes the money → ' || status || ' / ' || payment_status from confirm_payment((select v::uuid from ids where k = 'ctr'), 'cash');
reset role;
select 'A notified: ' || title || ' — ' || body from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by created_at desc limit 1;

select '--- bank transfer';
delete from notifications;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into ids select 'bnk', id::text from create_booking(format($q${"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Batticaloa","seats":["10B"],"passenger":{"name":"Alex A","gender":"Male","phone":"0771111111"},"payment":"bank"}$q$, (select fri from t7))::jsonb);
select 'A uploads the slip → ' || status from submit_payment_slip((select v::uuid from ids where k = 'bnk'), 'aaaaaaaa-0000-0000-0000-000000000001/s.jpg', 'BOC 9912');
reset role;
select 'office staff alerted: ' || count(*) || ', ' || min(title) || ' — ' || min(body) from notifications where title = 'Bank slip to check';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'staff marks it paid → ' || status || ' / ' || payment_status || ' / ' || payment_method from confirm_payment((select v::uuid from ids where k = 'bnk'), 'bank', 'BOC 9912');
reset role;
select 'A notified: ' || title from notifications where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by created_at desc limit 1;

select '--- conductor sends the bus location to one passenger';
delete from message_queue; delete from notifications; delete from bus_locations where schedule_id = 'sch-cmb-2100' and travel_date = (select fri from t7);
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger sends it', $q$select send_bus_location((select v::uuid from ids where k = 'bus1'))$q$);
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('conductor sends before sharing location', $q$select send_bus_location((select v::uuid from ids where k = 'bus1'))$q$);
insert into bus_locations (schedule_id, travel_date, lat, lng, updated_at) values ('sch-cmb-2100', (select fri from t7), 6.933812, 79.852431, now());
select 'conductor sends (WhatsApp off) → goes by ' || send_bus_location((select v::uuid from ids where k = 'bus1'));
select pg_temp.try('conductor double-taps', $q$select send_bus_location((select v::uuid from ids where k = 'bus1'))$q$);
reset role;
update app_settings set messaging = messaging || '{"whatsapp": true}';
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'conductor sends to another passenger (WhatsApp on) → goes by ' || send_bus_location((select v::uuid from ids where k = 'bus2'));
reset role;
update app_settings set messaging = messaging || '{"whatsapp": false}';
select 'queued: ' || channel || ', SMS fallback ' || fallback_sms || ' | ' || substring(body from 'https://maps[^ ]+') || ' | ' || substring(body from 'Live: .*$') from message_queue where kind = 'bus_location' order by created_at;
select 'passenger also notified in the app: ' || count(*) from notifications where title = 'Your bus is on the way';

select '--- closing the day';
delete from cash_counts; delete from notifications;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'conductor should hold: LKR ' || (cash_summary((now() at time zone 'Asia/Colombo')::date) ->> 'expected') || ' from ' || jsonb_array_length(cash_summary((now() at time zone 'Asia/Colombo')::date) -> 'taken') || ' cash payments taken on the bus';
select pg_temp.try('conductor closes short with no note', $q$insert into cash_counts (count_date, expected, counted, notes) values ((now() at time zone 'Asia/Colombo')::date, 0, 4000, '')$q$);
select pg_temp.try('conductor closes short, claiming it balanced (sends a false expected)', $q$insert into cash_counts (count_date, expected, counted, notes) values ((now() at time zone 'Asia/Colombo')::date, 4000, 4000, 'ok, short by change given')$q$);
select 'saved as: should have ' || expected || ', counted ' || counted || ', note: ' || notes from cash_counts;
select pg_temp.try('conductor closes the same day twice', $q$insert into cash_counts (count_date, expected, counted, notes) values ((now() at time zone 'Asia/Colombo')::date, 0, 4900, 'again')$q$);
reset role;
select 'admin told: ' || title || ' — ' || body from notifications where title like 'Cash %' limit 1;
select 'who was told: ' || string_agg(distinct (select role::text from profiles where id = user_id), ', ') from notifications where title like 'Cash %';
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'office staff should hold: LKR ' || (cash_summary((now() at time zone 'Asia/Colombo')::date) ->> 'expected') || ' (their own takings, not the conductor''s)';
select 'office staff see other people''s counts: ' || count(*) from cash_counts;
select pg_temp.try('office staff close balanced with no note', format($q$insert into cash_counts (count_date, expected, counted, notes) values ((now() at time zone 'Asia/Colombo')::date, 0, %s, '')$q$, (cash_summary((now() at time zone 'Asia/Colombo')::date) ->> 'expected')));
reset role;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('passenger opens the cash summary', $q$select cash_summary(current_date)$q$);
reset role;
select '--- conductor closes a trip (the departure chosen on the conductor screen)';
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'trip on ' || to_char((select fri from t7), 'Dy') || ': should hold LKR ' || (cash_summary((select fri from t7), 'sch-cmb-2100') ->> 'expected') || ' from ' || jsonb_array_length(cash_summary((select fri from t7), 'sch-cmb-2100') -> 'taken') || ' payments';
select 'another departure date: LKR ' || (cash_summary((select fri from t7) + 7, 'sch-cmb-2100') ->> 'expected');
select pg_temp.try('conductor closes the trip balanced', format($q$insert into cash_counts (count_date, schedule_id, expected, counted, notes) values ('%s', 'sch-cmb-2100', 0, %s, '')$q$, (select fri from t7), (cash_summary((select fri from t7), 'sch-cmb-2100') ->> 'expected')));
select pg_temp.try('conductor closes the same trip again', format($q$insert into cash_counts (count_date, schedule_id, expected, counted, notes) values ('%s', 'sch-cmb-2100', 0, 1, 'again')$q$, (select fri from t7)));
select pg_temp.try('conductor closes a day that hasn''t happened', $q$insert into cash_counts (count_date, expected, counted, notes) values (current_date + 3, 0, 0, '')$q$);
reset role;
select '--- unfinished closes and the admin overview';
delete from cash_counts;
-- pretend the conductor's cash for that Friday trip was taken on an earlier trip date, and the office cash two days ago
alter table bookings disable trigger bookings_running_day; -- test data only: that weekday may not be a running day
update bookings set travel_date = (now() at time zone 'Asia/Colombo')::date - 2, paid_at = now() - interval '2 days' where paid_by = 'eeeeeeee-0000-0000-0000-000000000005' and schedule_id = 'sch-cmb-2100' and travel_date = (select fri from t7) and seats <@ '{9A,9B}';
alter table bookings enable trigger bookings_running_day;
update bookings set paid_at = now() - interval '2 days' where paid_by = 'cccccccc-0000-0000-0000-000000000003' and seats = '{10A}';
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select 'conductor reminded of: ' || coalesce((select string_agg((x ->> 'kind') || ' ' || to_char((x ->> 'date')::date, 'Dy') || ' LKR ' || (x ->> 'amount') || ' (' || (x ->> 'payments') || ' payments)', ', ') from jsonb_array_elements(cash_unclosed()) x), 'nothing');
insert into cash_counts (count_date, schedule_id, expected, counted, notes) values ((now() at time zone 'Asia/Colombo')::date - 2, 'sch-cmb-2100', 0, 4900, '');
select 'after closing that trip, reminded of: ' || coalesce((select string_agg(x ->> 'kind', ', ') from jsonb_array_elements(cash_unclosed()) x), 'nothing');
select pg_temp.try('conductor opens the admin overview', $q$select cash_overview(current_date)$q$);
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select 'office staff reminded of: ' || coalesce((select string_agg((x ->> 'kind') || ' LKR ' || (x ->> 'amount'), ', ') from jsonb_array_elements(cash_unclosed()) x), 'nothing');
reset role;
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select 'admin overview, 2 days ago: ' || jsonb_array_length(o -> 'trips') || ' trips; trip cash LKR ' || (select sum((t ->> 'cash')::int) from jsonb_array_elements(o -> 'trips') t)
  || '; ' || (select string_agg((p ->> 'name') || ' ' || case when (p ->> 'closed')::boolean then 'closed, counted ' || (p ->> 'counted') else 'NOT closed, should have ' || (p ->> 'expected') end, ' | ') from jsonb_array_elements(o -> 'trips') t, jsonb_array_elements(t -> 'people') p)
  from (select cash_overview((now() at time zone 'Asia/Colombo')::date - 2) as o) q;
select 'office cash that day: ' || (select string_agg((p ->> 'name') || ' ' || case when (p ->> 'closed')::boolean then 'closed' else 'NOT closed, should have ' || (p ->> 'expected') end, ' | ') from jsonb_array_elements(cash_overview((now() at time zone 'Asia/Colombo')::date - 2) -> 'days') p);
reset role;
delete from notifications where title like 'Cash %' and body not like '%short by change%';
select 'balanced days are not reported: ' || (count(*) = 1) from (select distinct body from notifications where title like 'Cash %') x;

select '--- reminders to renew documents';
delete from notifications; delete from bus_documents; update crew set license_expires = null;
insert into bus_documents (id, bus_id, kind, number, expires_on) values
  ('11111111-0000-0000-0000-000000000001', 'bus-1', 'insurance', 'INS-1', (now() at time zone 'Asia/Colombo')::date + 45),
  ('11111111-0000-0000-0000-000000000002', 'bus-1', 'revenue_license', 'RL-1', (now() at time zone 'Asia/Colombo')::date + 10),
  ('11111111-0000-0000-0000-000000000003', 'bus-1', 'emission_test', 'ET-1', (now() at time zone 'Asia/Colombo')::date - 2);
select 'first run: ' || array_to_string(queue_renewal_reminders(), ' | ');
select 'run again a minute later: ' || coalesce(nullif(array_to_string(queue_renewal_reminders(), ' | '), ''), 'nothing');
update bus_documents set expires_on = expires_on - 4 where kind = 'revenue_license'; -- four days pass: 6 days left, a new stage
select 'four days later: ' || coalesce(nullif(array_to_string(queue_renewal_reminders(), ' | '), ''), 'nothing');
update bus_documents set expires_on = (now() at time zone 'Asia/Colombo')::date + 365 where kind = 'emission_test'; -- renewed
update bus_documents set expires_on = (now() at time zone 'Asia/Colombo')::date + 30 where kind = 'insurance'; -- now inside the 30 days
select 'after renewing the emission test: ' || coalesce(nullif(array_to_string(queue_renewal_reminders(), ' | '), ''), 'nothing');
select 'told: ' || string_agg(distinct (select role::text from profiles where id = user_id), ', ') || ' · ' || count(*) || ' notifications · e.g. ' || min(title) from notifications;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('staff run the reminder job by hand', $q$select queue_renewal_reminders()$q$);
reset role;
select 'stages: ' || string_agg(d || '→' || coalesce(public.renewal_stage(d)::text, 'none'), ', ' order by d desc) from unnest(array[45, 30, 15, 14, 8, 7, 4, 3, 2, 1, 0, -1, -3, -4, -7]) d;

select '--- salary settlement';
insert into crew (id, full_name, role, monthly_salary, per_trip_pay, bus_id) values ('22222222-0000-0000-0000-000000000001', 'Test Driver', 'driver', 60000, 1500, 'bus-1');
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('office staff record an advance', $q$insert into crew_pay (crew_id, month, kind, amount) values ('22222222-0000-0000-0000-000000000001', '2026-10', 'advance', 10000)$q$);
select 'office staff see pay records: ' || count(*) from crew_pay;
reset role;
set role authenticated; select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
insert into expenses (id, spent_on, category, amount, description) values ('33333333-0000-0000-0000-000000000001', current_date, 'salary', 10000, 'Advance: Test Driver');
select pg_temp.try('admin records an advance', $q$insert into crew_pay (crew_id, month, kind, amount, expense_id) values ('22222222-0000-0000-0000-000000000001', '2026-10', 'advance', 10000, '33333333-0000-0000-0000-000000000001')$q$);
select pg_temp.try('admin records a deduction', $q$insert into crew_pay (crew_id, month, kind, amount, notes) values ('22222222-0000-0000-0000-000000000001', '2026-10', 'deduction', 1750, 'cash short on 3 Oct')$q$);
select pg_temp.try('admin records a bad month', $q$insert into crew_pay (crew_id, month, kind, amount) values ('22222222-0000-0000-0000-000000000001', '2026-13', 'bonus', 500)$q$);
select 'salary expenses before removing the advance: ' || count(*) from expenses where id = '33333333-0000-0000-0000-000000000001';
delete from crew_pay where kind = 'advance';
select 'after removing it: ' || count(*) || ' (its expense went too)' from expenses where id = '33333333-0000-0000-0000-000000000001';
reset role;

select '--- daily odometer readings';
delete from odometer_logs;
set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.try('a passenger logs a reading', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', current_date - 3, 145000)$q$);
select 'a passenger sees readings: ' || count(*) from odometer_logs;
reset role;
set role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.try('counter staff log 145,000 three days ago', $q$insert into odometer_logs (bus_id, log_date, reading_km, notes) values ('bus-1', current_date - 3, 145000, 'told by the conductor')$q$);
select pg_temp.try('counter staff log 145,380 two days ago', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', current_date - 2, 145380)$q$);
reset role;
set role authenticated; select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.try('the conductor logs today: 146,120', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', (now() at time zone 'Asia/Colombo')::date, 146120)$q$);
select pg_temp.try('a reading lower than an earlier day', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', current_date - 1, 144000)$q$);
select pg_temp.try('a reading higher than a later day', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', current_date - 1, 150000)$q$);
select pg_temp.try('a reading dated next week', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', current_date + 7, 150000)$q$);
select pg_temp.try('yesterday filled in afterwards: 145,750', $q$insert into odometer_logs (bus_id, log_date, reading_km) values ('bus-1', current_date - 1, 145750)$q$);
select pg_temp.try('the conductor deletes a reading', $q$delete from odometer_logs where reading_km = 145380$q$);
select 'still there after the conductor''s delete: ' || count(*) from odometer_logs where reading_km = 145380;
reset role;
select 'distance per day: ' || string_agg(km::text || ' km', ', ' order by d) from (select log_date d, reading_km - lag(reading_km) over (order by log_date, reading_km) km from odometer_logs where bus_id = 'bus-1') x where km is not null;
update app_settings set card_payments = true;
