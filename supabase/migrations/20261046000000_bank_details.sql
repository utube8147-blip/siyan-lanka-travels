-- =============================================================================
-- 20261046000000_bank_details.sql
-- The account passengers pay into by bank transfer (shown at checkout, in My
-- trips and in the "seat held" text). Only filled in where none was set, or the
-- old placeholder account is still there; change it any time in
-- Staff area → Settings → Payments → Bank details.
-- =============================================================================
alter table public.app_settings alter column bank_details set default 'Bank of Ceylon (BOC) · A/C 95572680 · Siyan Lanka';
update public.app_settings
   set bank_details = 'Bank of Ceylon (BOC) · A/C 95572680 · Siyan Lanka'
 where coalesce(trim(bank_details), '') = '' or bank_details like '%0077411020%';
