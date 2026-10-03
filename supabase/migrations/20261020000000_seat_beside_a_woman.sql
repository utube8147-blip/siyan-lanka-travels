-- =============================================================================
-- Siyan Lanka Travels — migration 20: the seat beside a woman travelling alone
-- When a woman has booked ONE seat, the seat(s) right beside hers (same side
-- of the aisle) are kept for women. A man can't book there online, unless:
--   * it is the same account as hers (she is adding a seat for a companion);
--   * the booking is made by office staff (a manual override at the counter).
-- A booking of two or more seats together is never restricted: whoever books
-- a pair decides who sits in it.
-- Switch: Staff area → Settings → "Seat beside a woman travelling alone"
-- (app_settings.ladies_adjacent). Enforced here, so it can't be skipped by
-- calling the API. Safe to run again.
-- =============================================================================
alter table public.app_settings add column if not exists ladies_adjacent boolean not null default true;

-- Passengers' seat maps need to know which booked seats belong to someone
-- travelling alone (nothing else about the booking is published).
alter table public.booking_seats add column if not exists solo boolean not null default false;
grant select (solo) on public.booking_seats to anon, authenticated;

create or replace function public.sync_booking_seats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.booking_seats where booking_id = new.id;
  if new.status::text in ('confirmed', 'boarded', 'held') then
    insert into public.booking_seats (booking_id, schedule_id, travel_date, seat, gender, solo)
    select new.id, new.schedule_id, new.travel_date, s, new.passenger_gender, cardinality(new.seats) = 1 from unnest(new.seats) s;
  end if;
  return new;
exception when unique_violation then
  raise exception 'SEAT_TAKEN: One of those seats was just booked by someone else. Please pick another.' using errcode = 'P0001';
end $$;
update public.booking_seats bs set solo = (cardinality(b.seats) = 1) from public.bookings b where b.id = bs.booking_id and bs.solo is distinct from (cardinality(b.seats) = 1);

-- The seat(s) right beside a seat: next to it in the same row with no aisle
-- or gap between. Works for a stored layout and for the classic 2+2 one.
create or replace function public.seat_neighbours(p_bus public.buses, p_seat text) returns text[]
language plpgsql immutable as $$
declare r jsonb; i int; n int; out text[] := '{}'; m text[]; rw int; pos int; back text;
begin
  if p_bus.seat_map is not null then
    for r in select value from jsonb_array_elements(p_bus.seat_map -> 'cells') loop
      n := jsonb_array_length(r);
      for i in 0 .. n - 1 loop
        if jsonb_typeof(r -> i) = 'string' and r ->> i = p_seat then
          if i > 0 and jsonb_typeof(r -> (i - 1)) = 'string' and r ->> (i - 1) <> '' then out := out || (r ->> (i - 1)); end if;
          if i < n - 1 and jsonb_typeof(r -> (i + 1)) = 'string' and r ->> (i + 1) <> '' then out := out || (r ->> (i + 1)); end if;
          return out;
        end if;
      end loop;
    end loop;
    return out;
  end if;
  -- classic layout: A B | C D in each row; a back bench of 4 is A B | C D too, 5 or 6 sit side by side
  m := regexp_match(p_seat, '^([0-9]+)([A-F])$');
  if m is null then return out; end if;
  rw := m[1]::int; pos := position(m[2] in 'ABCDEF');
  if rw <= p_bus.rows or p_bus.back_row_seats = 4 then
    return array[rw || case m[2] when 'A' then 'B' when 'B' then 'A' when 'C' then 'D' else 'C' end];
  end if;
  back := left('ABCDEF', p_bus.back_row_seats);
  if pos > 1 then out := out || (rw || substr(back, pos - 1, 1)); end if;
  if pos < p_bus.back_row_seats then out := out || (rw || substr(back, pos + 1, 1)); end if;
  return out;
end $$;

create or replace function public.enforce_seat_beside_woman() returns trigger
language plpgsql security definer set search_path = public as $$
declare bus public.buses; s text; nb text; other public.bookings;
begin
  if new.status::text in ('cancelled', 'no-show') then return new; end if;
  if not (select ladies_adjacent from public.app_settings) then return new; end if;
  if auth.uid() is null or public.is_office_staff() then return new; end if; -- gateway / office override
  if new.passenger_gender = 'Female' then return new; end if;
  select b.* into bus from public.schedules sc join public.buses b on b.id = sc.bus_id where sc.id = new.schedule_id;
  if not found then return new; end if;
  foreach s in array new.seats loop
    -- on a seat change, only the seats being moved into are checked
    continue when tg_op = 'UPDATE' and old.schedule_id = new.schedule_id and old.travel_date = new.travel_date and s = any (old.seats);
    foreach nb in array public.seat_neighbours(bus, s) loop
      continue when nb = any (new.seats);
      select b.* into other from public.bookings b
      where b.schedule_id = new.schedule_id and b.travel_date = new.travel_date and b.id <> new.id
        and b.status::text in ('confirmed', 'boarded', 'held') and nb = any (b.seats) limit 1;
      if found and other.passenger_gender = 'Female' and cardinality(other.seats) = 1
         and (new.user_id is null or other.user_id is distinct from new.user_id) then
        raise exception 'LADIES_NEIGHBOUR: Seat % is beside a woman travelling alone, so it is kept for women passengers. Please choose another seat.', s;
      end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists bookings_seat_beside_woman on public.bookings;
create trigger bookings_seat_beside_woman before insert or update of seats, schedule_id, travel_date, passenger_gender on public.bookings
  for each row execute function public.enforce_seat_beside_woman();
