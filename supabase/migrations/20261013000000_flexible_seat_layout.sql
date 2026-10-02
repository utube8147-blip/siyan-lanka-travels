-- =============================================================================
-- Siyan Lanka Travels — migration 13: flexible seat layouts
-- A bus can have any arrangement and any seat numbers: 2+2, 2+3, a side with
-- one row fewer, gaps for doors, a back bench of any width, seats numbered
-- 1…51 like the printed booking sheet. The layout is edited in Staff area →
-- Buses → Edit and stored as a grid in buses.seat_map:
--   {"left":2,"right":2,"cells":[["4","3",null,"1","2"], …, ["48","47","49","50","51"]]}
-- (rows front to back, cells left to right, null = no seat there).
-- Buses without a seat_map keep the classic 2+2 layout from rows /
-- back_row_seats. Safe to run again.
-- =============================================================================
alter table public.buses add column if not exists seat_map jsonb;
alter table public.buses drop constraint if exists buses_seat_map_check;
alter table public.buses add constraint buses_seat_map_check
  check (seat_map is null or (jsonb_typeof(seat_map -> 'cells') = 'array' and pg_column_size(seat_map) < 20000));

-- Every seat number in a stored layout.
create or replace function public.seat_map_ids(p_map jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(cell #>> '{}'), '{}')
  from jsonb_array_elements(p_map -> 'cells') r, jsonb_array_elements(r) cell
  where jsonb_typeof(cell) = 'string' and cell #>> '{}' <> '';
$$;

-- Is this seat number on this bus? (Used by every booking and seat change.)
create or replace function public.seat_is_on_bus(p_bus public.buses, p_seat text) returns boolean
language plpgsql immutable as $$
declare r int; c text; m text[];
begin
  if p_bus.seat_map is not null then
    return p_seat = any (public.seat_map_ids(p_bus.seat_map));
  end if;
  -- classic layout: rows of A B | C D, then a back bench
  m := regexp_match(p_seat, '^([0-9]+)([A-F])$');
  if m is null then return false; end if;
  r := m[1]::int; c := m[2];
  if r between 1 and p_bus.rows then return c in ('A', 'B', 'C', 'D'); end if;
  if r = p_bus.rows + 1 then return position(c in 'ABCDEF') between 1 and p_bus.back_row_seats; end if;
  return false;
end $$;

create or replace function public.bus_capacity(p_bus public.buses) returns integer
language sql immutable as $$
  select case when p_bus.seat_map is not null then cardinality(public.seat_map_ids(p_bus.seat_map))
              else p_bus.rows * 4 + p_bus.back_row_seats end;
$$;

-- A layout can't be saved with the same seat number twice.
create or replace function public.check_seat_map() returns trigger
language plpgsql as $$
declare ids text[];
begin
  if new.seat_map is null then return new; end if;
  ids := public.seat_map_ids(new.seat_map);
  if cardinality(ids) = 0 then raise exception 'BAD_LAYOUT: The layout has no seats.'; end if;
  if cardinality(ids) > 80 then raise exception 'BAD_LAYOUT: A bus can have at most 80 seats.'; end if;
  if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) then raise exception 'BAD_LAYOUT: Each seat needs its own number.'; end if;
  if exists (select 1 from unnest(ids) x where x !~ '^[A-Z0-9]{1,4}$') then raise exception 'BAD_LAYOUT: Seat numbers can use letters and digits only, up to 4 characters.'; end if;
  return new;
end $$;
drop trigger if exists buses_check_seat_map on public.buses;
create trigger buses_check_seat_map before insert or update of seat_map on public.buses
  for each row execute function public.check_seat_map();

-- Waitlist offers: capacity now comes from the bus's layout.
create or replace function public.offer_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; cap int; taken int; site text := (select site_url from public.app_settings);
begin
  if not (new.status::text = 'cancelled' and old.status::text in ('confirmed', 'held')) then return new; end if;
  select public.bus_capacity(b) into cap from public.buses b join public.schedules s on s.bus_id = b.id where s.id = new.schedule_id;
  select count(*) into taken from public.booking_seats where schedule_id = new.schedule_id and travel_date = new.travel_date and active;
  for w in select * from public.waitlist where schedule_id = new.schedule_id and travel_date = new.travel_date and status = 'waiting' order by created_at loop
    exit when cap - taken < w.seats;
    update public.waitlist set status = 'offered', offered_at = now() where id = w.id;
    insert into public.notifications (user_id, title, body, url)
    values (w.user_id, 'A seat is free on your bus', w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book it before someone else does.',
            '/seats/' || w.schedule_id || '?date=' || w.travel_date || '&from=' || w.from_stop || '&to=' || w.to_stop);
    perform public.enqueue_message(w.phone, 'Siyan Lanka: A seat is free on ' || w.from_stop || ' → ' || w.to_stop || ', ' || to_char(w.travel_date, 'Dy DD Mon') || '. Book now: ' || site || '/my-bookings', 'waitlist_offer');
    taken := taken + w.seats; -- offer to as many as the free seats cover
  end loop;
  return new;
end $$;
