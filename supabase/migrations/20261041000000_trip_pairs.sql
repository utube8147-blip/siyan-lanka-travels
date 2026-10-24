-- =============================================================================
-- 20261041000000_trip_pairs.sql
-- Seats booked between each pair of stops on one departure (no names, no
-- contact details): when on-request stops are skipped, passengers' phones and
-- the conductor work out the same shorter stop order from it. It never puts a
-- drop-off before its pick-up, and never brings the bus early to a stop where
-- someone gets on.
-- =============================================================================

create or replace function public.trip_stop_pairs(p_schedule text, p_date date)
returns table (from_stop text, to_stop text, seats integer)
language sql stable security definer set search_path = public as $$
  select b.from_stop, b.to_stop, sum(coalesce(array_length(b.seats, 1), 0))::integer
    from public.bookings b
   where b.schedule_id = p_schedule and b.travel_date = p_date
     and b.status::text in ('confirmed', 'held', 'boarded')
   group by b.from_stop, b.to_stop;
$$;
revoke execute on function public.trip_stop_pairs(text, date) from public;
grant execute on function public.trip_stop_pairs(text, date) to anon, authenticated;

notify pgrst, 'reload schema';
