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
update app_settings set card_payments = true;
