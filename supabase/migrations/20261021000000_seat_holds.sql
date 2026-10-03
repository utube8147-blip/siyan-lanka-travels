-- =============================================================================
-- Siyan Lanka Travels — migration 21: seats held during checkout are real
-- The "Seats are held for 9:51" countdown used to be a timer in the
-- passenger's browser only: nothing was held, staff couldn't see it, and
-- someone else could take the seat meanwhile. Now choosing seats places a
-- real hold (10 minutes) that:
--   * other passengers see as "held by another passenger" and can't book;
--   * staff see on the Departures seat map, with the time it runs out;
--   * office staff can override by selling the seat (conductors can't);
--   * turns into the booking when the passenger completes it, or lapses.
-- Safe to run again.
-- =============================================================================
create table if not exists public.seat_holds (
  schedule_id text not null references public.schedules (id) on delete cascade,
  travel_date date not null,
  seat text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (schedule_id, travel_date, seat)
);
create index if not exists seat_holds_user_idx on public.seat_holds (user_id);
alter table public.seat_holds enable row level security;
-- Anyone can see THAT a seat is held and until when (needed for live seat maps); never by whom.
drop policy if exists "see seat holds" on public.seat_holds;
create policy "see seat holds" on public.seat_holds for select using (true);
revoke all on public.seat_holds from anon, authenticated;
grant select (schedule_id, travel_date, seat, expires_at) on public.seat_holds to anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seat_holds') then
    alter publication supabase_realtime add table public.seat_holds;
  end if;
exception when others then null; -- no realtime publication (local test database)
end $$;

-- Passenger: hold these seats for me while I check out. Replaces whatever I
-- was holding before (one selection at a time). Returns when the hold ends.
create or replace function public.hold_seats(p_schedule text, p_date date, p_seats text[]) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz := now() + interval '10 minutes'; v_seats text[]; taken text;
begin
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in.'; end if;
  delete from public.seat_holds where expires_at < now() or user_id = auth.uid();
  select array_agg(distinct upper(x)) into v_seats from unnest(coalesce(p_seats, '{}')) x where x <> '';
  if v_seats is null then return null; end if; -- nothing selected: holds released
  if cardinality(v_seats) > 10 then raise exception 'TOO_MANY: Too many seats.'; end if;
  select bs.seat into taken from public.booking_seats bs where bs.schedule_id = p_schedule and bs.travel_date = p_date and bs.active and bs.seat = any (v_seats) limit 1;
  if found then raise exception 'SEAT_TAKEN: Seat % was just booked by someone else. Please pick another.', taken; end if;
  begin
    insert into public.seat_holds (schedule_id, travel_date, seat, user_id, expires_at)
    select p_schedule, p_date, s, auth.uid(), v_until from unnest(v_seats) s;
  exception when unique_violation then
    raise exception 'SEAT_HELD: One of those seats is being booked by someone else right now. Pick another, or try again in a few minutes.';
  end;
  return v_until;
end $$;

create or replace function public.release_seat_holds() returns void
language sql security definer set search_path = public as $$
  delete from public.seat_holds where user_id = auth.uid();
$$;

-- Current holds for a range of dates; "mine" marks the caller's own.
create or replace function public.get_seat_holds(p_from date, p_to date)
returns table (schedule_id text, travel_date date, seat text, expires_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select h.schedule_id, h.travel_date, h.seat, h.expires_at, h.user_id is not distinct from auth.uid()
  from public.seat_holds h where h.travel_date between p_from and p_to and h.expires_at > now();
$$;
revoke execute on function public.hold_seats(text, date, text[]), public.release_seat_holds() from public, anon;
grant execute on function public.hold_seats(text, date, text[]), public.release_seat_holds() to authenticated;
grant execute on function public.get_seat_holds(date, date) to anon, authenticated;

-- A seat someone else is holding can't be booked, except by office staff
-- (their override at the counter). Checked on every booking and seat change.
create or replace function public.respect_seat_holds() returns trigger
language plpgsql security definer set search_path = public as $$
declare held text;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if public.is_office_staff() then return new; end if;
  select h.seat into held from public.seat_holds h
  where h.schedule_id = new.schedule_id and h.travel_date = new.travel_date and h.seat = any (new.seats)
    and h.expires_at > now() and h.user_id is distinct from coalesce(new.user_id, auth.uid())
    and not (tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and h.seat = any (old.seats))
  limit 1;
  if found then
    raise exception 'SEAT_HELD: Seat % is being booked by someone else right now. Pick another, or try again in a few minutes.', held;
  end if;
  return new;
end $$;
drop trigger if exists bookings_respect_holds on public.bookings;
create trigger bookings_respect_holds before insert or update of seats, schedule_id, travel_date on public.bookings
  for each row execute function public.respect_seat_holds();

-- Once a seat is booked (by the holder, or by office staff overriding), its hold is gone.
create or replace function public.clear_seat_holds() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('confirmed', 'boarded', 'held') then
    delete from public.seat_holds where schedule_id = new.schedule_id and travel_date = new.travel_date and seat = any (new.seats);
  end if;
  return new;
end $$;
drop trigger if exists bookings_clear_holds on public.bookings;
create trigger bookings_clear_holds after insert or update of seats, schedule_id, travel_date, status on public.bookings
  for each row execute function public.clear_seat_holds();
