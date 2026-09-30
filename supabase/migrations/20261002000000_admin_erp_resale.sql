-- =============================================================================
-- Siyan Lanka Travels — migration 2
--  * Super admin role ('admin'): everything staff can do, plus business pages
--    (finance, expenses, crew, documents, user accounts, settings).
--  * ERP tables: expenses (fuel, service, repairs, salaries, …), other income,
--    bus documents (insurance, permits…), crew.
--  * Passenger seat resale on real data, switched off until an admin enables it.
-- Note: role checks compare role::text so this file can add the new enum value
-- and use it in the same run.
-- =============================================================================

alter type public.user_role add value if not exists 'admin';

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text in ('staff', 'admin'));
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'admin');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Settings are now edited by super admins only; add the resale switch.
drop policy if exists "staff settings" on public.app_settings;
create policy "admin settings" on public.app_settings for update using (public.is_admin()) with check (public.is_admin());
alter table public.app_settings add column if not exists resale_enabled boolean not null default false;

-- ------------------------------------------------------------- accounts ---
-- Super admins manage who is passenger / staff / admin.
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, phone text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role::text, p.created_at, u.last_sign_in_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.role::text desc, p.created_at desc;
end $$;

create function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED: Super admins only.'; end if;
  if p_role not in ('passenger', 'staff', 'admin') then raise exception 'BAD_ROLE: Unknown role.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'NOT_ALLOWED: You can''t remove your own super admin access.'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user;
end $$;

revoke execute on function public.admin_list_users(), public.set_user_role(uuid, text) from public, anon;
grant execute on function public.admin_list_users(), public.set_user_role(uuid, text) to authenticated;

-- ------------------------------------------------------------------ ERP ---
create type public.expense_category as enum (
  'fuel', 'service', 'repair', 'tyres', 'salary', 'toll', 'parking', 'cleaning',
  'insurance', 'license', 'permit', 'commission', 'office', 'other'
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  category public.expense_category not null,
  amount integer not null check (amount >= 0),
  bus_id text references public.buses (id) on delete set null,
  schedule_id text references public.schedules (id) on delete set null,
  travel_date date,
  description text not null default '',
  vendor text not null default '',
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'bank', 'cheque', 'other')),
  litres numeric(8, 2) check (litres is null or litres > 0),        -- fuel
  odometer_km integer check (odometer_km is null or odometer_km >= 0), -- fuel / service
  next_due_date date,                                                  -- service
  next_due_km integer,                                                 -- service
  receipt_path text,                                                   -- storage bucket "receipts"
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (spent_on);
create index expenses_bus_idx on public.expenses (bus_id, spent_on);

create table public.other_income (
  id uuid primary key default gen_random_uuid(),
  received_on date not null default current_date,
  category text not null check (category in ('charter', 'parcel', 'advertising', 'other')),
  amount integer not null check (amount >= 0),
  bus_id text references public.buses (id) on delete set null,
  description text not null default '',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.bus_documents (
  id uuid primary key default gen_random_uuid(),
  bus_id text not null references public.buses (id) on delete cascade,
  kind text not null check (kind in ('insurance', 'revenue_license', 'route_permit', 'emission_test', 'fitness_certificate', 'other')),
  number text not null default '',
  expires_on date not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table public.crew (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null check (role in ('driver', 'conductor', 'cleaner', 'mechanic', 'office')),
  phone text not null default '',
  license_no text not null default '',
  license_expires date,
  monthly_salary integer not null default 0 check (monthly_salary >= 0),
  bus_id text references public.buses (id) on delete set null,
  active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;
alter table public.other_income enable row level security;
alter table public.bus_documents enable row level security;
alter table public.crew enable row level security;

-- Super admins: everything.
create policy "admin expenses" on public.expenses for all using (public.is_admin()) with check (public.is_admin());
create policy "admin income" on public.other_income for all using (public.is_admin()) with check (public.is_admin());
create policy "admin documents" on public.bus_documents for all using (public.is_admin()) with check (public.is_admin());
create policy "admin crew" on public.crew for all using (public.is_admin()) with check (public.is_admin());
-- Staff on the road: log (and see) running costs only.
create policy "staff log running costs" on public.expenses for insert
  with check (public.is_staff() and category in ('fuel', 'toll', 'parking', 'cleaning') and created_by = auth.uid());
create policy "staff see running costs" on public.expenses for select
  using (public.is_staff() and category in ('fuel', 'toll', 'parking', 'cleaning'));
-- Staff can see bus paperwork (crew and salaries are super-admin only).
create policy "staff see documents" on public.bus_documents for select using (public.is_staff());

-- Receipts (photos of bills).
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
create policy "staff upload receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- --------------------------------------------------------------- resale ---
create table public.resale_listings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  price integer not null check (price > 0),
  status text not null default 'listed' check (status in ('listed', 'sold', 'withdrawn')),
  buyer_id uuid references public.profiles (id) on delete set null,
  new_booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at timestamptz
);
create unique index resale_one_open_listing on public.resale_listings (booking_id) where status = 'listed';
alter table public.resale_listings enable row level security;
create policy "own or staff listings" on public.resale_listings for select
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.is_staff());
revoke insert, update, delete on public.resale_listings from anon, authenticated;

-- Public marketplace: open listings for future departures, no personal data.
create function public.get_resale_listings()
returns table (id uuid, price integer, paid integer, schedule_id text, travel_date date, from_stop text, to_stop text, seats text[], listed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.price, (b.total - b.fee), b.schedule_id, b.travel_date, b.from_stop, b.to_stop, b.seats, l.created_at
  from public.resale_listings l join public.bookings b on b.id = l.booking_id
  where l.status = 'listed' and b.status = 'confirmed' and b.travel_date >= current_date
    and (select resale_enabled from public.app_settings)
  order by b.travel_date, l.created_at;
$$;
grant execute on function public.get_resale_listings() to anon, authenticated;

create function public.list_for_resale(p_booking uuid, p_price integer) returns public.resale_listings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; bk public.bookings; sch public.schedules; rt public.routes; leaves timestamptz; l public.resale_listings;
begin
  select * into cfg from public.app_settings;
  if not cfg.resale_enabled then raise exception 'RESALE_OFF: Seat resale isn''t available yet.'; end if;
  select * into bk from public.bookings where id = p_booking for update;
  if not found or bk.user_id is distinct from auth.uid() then raise exception 'NOT_FOUND: Booking not found.'; end if;
  if bk.status <> 'confirmed' then raise exception 'NOT_ALLOWED: Only confirmed bookings can be resold.'; end if;
  if bk.channel <> 'online' then raise exception 'NOT_ALLOWED: Counter tickets can''t be resold online.'; end if;
  if exists (select 1 from public.booking_bikes where booking_id = bk.id) then raise exception 'NOT_ALLOWED: Bookings with a bike can''t be resold. Cancel the bike first.'; end if;
  if p_price > bk.total - bk.fee then raise exception 'TOO_HIGH: You can''t sell for more than you paid (LKR %).', bk.total - bk.fee; end if;
  select * into sch from public.schedules where id = bk.schedule_id;
  select * into rt from public.routes where id = sch.route_id;
  leaves := ((bk.travel_date + sch.departure::time) + make_interval(mins => (rt.stops -> public.stop_index(rt.stops, bk.from_stop) ->> 'offsetMin')::int)) at time zone cfg.timezone;
  if now() > leaves - make_interval(hours => 2) then raise exception 'CLOSED: Too close to departure to resell.'; end if;
  insert into public.resale_listings (booking_id, seller_id, price) values (bk.id, auth.uid(), p_price) returning * into l;
  return l;
exception when unique_violation then
  raise exception 'ALREADY_LISTED: This booking is already listed.';
end $$;

create function public.withdraw_listing(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.resale_listings set status = 'withdrawn'
  where id = p_listing and status = 'listed' and (seller_id = auth.uid() or public.is_staff());
  if not found then raise exception 'NOT_FOUND: Listing not found.'; end if;
end $$;

-- Buying hands the seats over in one transaction: the seller's booking is
-- closed (they're paid the listing price) and the buyer gets a new booking
-- for the same seats; nobody else can grab them in between.
create function public.buy_resale(p_listing uuid, p_passenger jsonb, p_contact jsonb) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare cfg public.app_settings; l public.resale_listings; old public.bookings; nb public.bookings; bus public.buses; s text;
  gender text := coalesce(p_passenger ->> 'gender', ''); per_seat int;
begin
  select * into cfg from public.app_settings;
  if not cfg.resale_enabled then raise exception 'RESALE_OFF: Seat resale isn''t available yet.'; end if;
  if auth.uid() is null then raise exception 'SIGN_IN: Please sign in to buy.'; end if;
  select * into l from public.resale_listings where id = p_listing for update;
  if not found or l.status <> 'listed' then raise exception 'GONE: This ticket has just been sold.'; end if;
  if l.seller_id = auth.uid() then raise exception 'NOT_ALLOWED: That''s your own listing.'; end if;
  select * into old from public.bookings where id = l.booking_id for update;
  if old.status <> 'confirmed' then raise exception 'GONE: This ticket is no longer available.'; end if;
  select b.* into bus from public.buses b join public.schedules sc on sc.bus_id = b.id where sc.id = old.schedule_id;
  foreach s in array old.seats loop
    if s = any (bus.ladies_seats) and gender <> 'Female' then raise exception 'LADIES_SEAT: Seat % is for female passengers.', s; end if;
  end loop;
  update public.bookings set status = 'cancelled', refund_amount = l.price, refunded_at = now() where id = old.id;
  per_seat := ceil(l.price::numeric / cardinality(old.seats));
  insert into public.bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_gender,
    passenger_phone, contact_email, contact_phone, user_id, created_by, channel, fare, fee, discount, bike_fee, total)
  values (public.new_booking_ref(), old.schedule_id, old.travel_date, old.from_stop, old.to_stop, old.seats,
    left(coalesce(nullif(trim(p_passenger ->> 'name'), ''), 'Passenger'), 120), gender, left(coalesce(p_passenger ->> 'phone', ''), 40),
    left(coalesce(p_contact ->> 'email', ''), 200), left(coalesce(p_contact ->> 'phone', ''), 40),
    auth.uid(), auth.uid(), 'online', per_seat, cfg.booking_fee, per_seat * cardinality(old.seats) - l.price, 0, l.price + cfg.booking_fee)
  returning * into nb;
  update public.resale_listings set status = 'sold', buyer_id = auth.uid(), new_booking_id = nb.id, sold_at = now() where id = l.id;
  return nb;
end $$;

revoke execute on function public.list_for_resale(uuid, integer), public.withdraw_listing(uuid), public.buy_resale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.list_for_resale(uuid, integer), public.withdraw_listing(uuid), public.buy_resale(uuid, jsonb, jsonb) to authenticated;

-- If a listed booking is cancelled (by the passenger or staff), withdraw the
-- listing. buy_resale marks it 'sold' straight after, so sales are unaffected.
create function public.withdraw_listing_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.resale_listings set status = 'withdrawn' where booking_id = new.id and status = 'listed';
  end if;
  return new;
end $$;
create trigger bookings_withdraw_listing after update of status on public.bookings
  for each row execute function public.withdraw_listing_on_cancel();
