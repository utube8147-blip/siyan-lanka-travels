-- =============================================================================
-- Siyan Lanka Travels — migration 22: live updates for staff screens
-- The seat map (booking_seats) and seat holds already publish their changes,
-- which is what keeps every open seat picker in step. This adds bookings, so
-- staff screens also update at once when a payment is recorded, a slip is
-- uploaded or a passenger is boarded on another device. Each person still
-- only receives the rows they are allowed to read. Safe to run again.
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings') then
    alter publication supabase_realtime add table public.bookings;
  end if;
exception when others then null; -- no realtime publication (local test database)
end $$;
