-- Migration 45: what passengers pay (fare + card fee + platform fee), paid-only online booking, first-trip app promo.
\set QUIET on
\pset tuples_only on
\pset format unaligned
update app_settings set booking_otp = false, card_payments = true, payments_mode = 'payhere', booking_window_days = 0, gateway_fee_percent = 3;
insert into auth.users (id, email, phone, raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001', null, '94771111111', '{"full_name":"Alex A"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002', null, '94772222222', '{"full_name":"Bina B"}'),
 ('ffffffff-0000-0000-0000-000000000006', 'boss@siyan.lk', null, '{"full_name":"Boss"}');
update profiles set role = 'admin' where id = 'ffffffff-0000-0000-0000-000000000006';
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create or replace function pg_temp.book(seat text, pay text, extra text default '') returns text language plpgsql as $$
declare r public.bookings;
begin
  select * into r from create_booking(format('{"schedule_id":"sch-cmb-2100","date":"%s","from":"Colombo","to":"Akkaraipattu","seats":["%s"],"payment":"%s","passenger":{"name":"P","gender":"Male","phone":"0771111111"}%s}', current_date + 1, seat, pay, extra)::jsonb);
  return format('OK      %s %s → %s %s · fare %s, platform %s, card fee %s, discount %s, total %s', seat, pay, r.status, r.payment_status, r.fare, r.fee, r.gateway_fee, r.discount, r.total);
exception when others then return 'BLOCKED ' || seat || ' ' || pay || '  → ' || left(sqlerrm, 100); end $$;
update schedules set days = array[0,1,2,3,4,5,6]::smallint[] where id = 'sch-cmb-2100';
select 'settings: platform fee ' || booking_fee || ', card fee ' || gateway_fee_percent || '%, promo ' || promo_code || ' ' || promo_percent || '%, first trip ' || promo_first_order || ', app only ' || promo_app_only || ', pay on bus ' || pay_on_bus from app_settings;

set role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select '--- promo';
select pg_temp.book('9A', 'card', ',"promo":"SIYAN10"');
select pg_temp.book('9A', 'card', ',"promo":"WRONG","in_app":true');
select pg_temp.book('9A', 'card', ',"promo":"siyan10","in_app":true');
select pg_temp.book('9B', 'card', ',"promo":"SIYAN10","in_app":true');
select '--- ways to pay';
select pg_temp.book('9C', 'bus');
select pg_temp.book('9C', 'counter');
select pg_temp.book('9C', 'bank');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.book('10A', 'wallet');
reset role;

select '--- paid through the gateway, then the month adds up';
select 'paid: ' || status || ' ' || payment_status from mark_paid_by_gateway((select ref from bookings where seats = array['9A']), (select total from bookings where seats = array['9A']), 'PH-1', 'card');
select 'paid: ' || status || ' ' || payment_status from mark_paid_by_gateway((select ref from bookings where seats = array['10A']), (select total from bookings where seats = array['10A']), 'PH-2', 'wallet');
update bookings set status = 'confirmed', payment_status = 'paid', paid_at = now(), hold_expires_at = null where seats = array['9C'];
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'passenger sees breakdown rows: ' || count(*) from money_breakdown(current_date - 31, current_date);
select pg_temp.as_user('ffffffff-0000-0000-0000-000000000006');
select format('month: %s bookings, tickets %s, gateway %s, platform %s, collected %s', bookings, tickets, gateway_fees, platform_fees, collected) from money_breakdown(current_date - 31, current_date);
select '--- refund keeps the fees';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select 'refund: ' || refund_amount || ' of ' || total from cancel_booking((select id from bookings where seats = array['9A']));
reset role;
