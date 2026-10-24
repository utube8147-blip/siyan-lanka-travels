-- =============================================================================
-- 20261037000000_bus_photos.sql
-- Bus photos.
-- Each bus can have a few photos (the first is the cover). They're public,
-- like stop photos, so passengers can see the bus they're booking.
-- =============================================================================

alter table public.buses add column if not exists photos text[] not null default '{}';

insert into storage.buckets (id, name, public) values ('bus-photos', 'bus-photos', true) on conflict (id) do nothing;
drop policy if exists "office upload bus photos" on storage.objects;
create policy "office upload bus photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'bus-photos' and public.is_office_staff());
drop policy if exists "office delete bus photos" on storage.objects;
create policy "office delete bus photos" on storage.objects for delete to authenticated
  using (bucket_id = 'bus-photos' and public.is_office_staff());
drop policy if exists "read bus photos" on storage.objects;
create policy "read bus photos" on storage.objects for select using (bucket_id = 'bus-photos');

-- Starting cover for Siyan Gold (the photo ships with the website). Only fills
-- an empty gallery, so photos added in the staff area are never replaced.
update public.buses set photos = array['/buses/siyan-gold.jpg']
 where photos = '{}' and regexp_replace(reg_no, '[^0-9]', '', 'g') = '2323';

notify pgrst, 'reload schema';
