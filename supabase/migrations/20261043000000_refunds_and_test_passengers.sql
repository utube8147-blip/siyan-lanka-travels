-- =============================================================================
-- 20261043000000_refunds_and_test_passengers.sql
--   1. Refunds: cancelling 4 hours or more before the bus leaves the
--      passenger's stop → 90% of the fare back (10% service charge for
--      admin and payment processing); less than 4 hours, or not turning up →
--      nothing (the booking is forfeited). Changeable in Staff area → Settings.
--   2. Test passengers: bookings made from Staff area → Test passengers (to try
--      the conductor app) are marked, so they can be listed and deleted
--      together and left out of reports.
-- =============================================================================

alter table public.app_settings alter column refund_policy set default '[{"hoursBefore":4,"percent":90},{"hoursBefore":0,"percent":0}]';
update public.app_settings set refund_policy = '[{"hoursBefore":4,"percent":90},{"hoursBefore":0,"percent":0}]';

alter table public.bookings add column if not exists is_test boolean not null default false;
create index if not exists bookings_test_idx on public.bookings (schedule_id, travel_date) where is_test;

notify pgrst, 'reload schema';
