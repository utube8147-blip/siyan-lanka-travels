-- =============================================================================
-- Siyan Lanka Travels — migration 19: salary settlement
-- Each crew member's pay for a month is settled person by person:
--   earned  = monthly salary + (pay per trip × trips their bus ran) + bonuses − deductions
--   balance = earned − advances already given − salary already paid
-- crew_pay holds every advance, salary payment, bonus and deduction. Advances
-- and salary payments are money leaving the company, so each also has a row
-- in expenses (category "salary") and shows in Finance. Super admin only.
-- Safe to run again.
-- =============================================================================
alter table public.crew add column if not exists per_trip_pay integer not null default 0;
alter table public.crew drop constraint if exists crew_per_trip_pay_check;
alter table public.crew add constraint crew_per_trip_pay_check check (per_trip_pay >= 0);

create table if not exists public.crew_pay (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), -- the month the pay is FOR
  kind text not null check (kind in ('advance', 'salary', 'bonus', 'deduction')),
  amount integer not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'cash' check (method in ('cash', 'bank', 'cheque', 'other')),
  notes text not null default '',
  expense_id uuid references public.expenses (id) on delete set null, -- for advances and salary payments
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists crew_pay_month_idx on public.crew_pay (month, crew_id);
alter table public.crew_pay enable row level security;
drop policy if exists "admin crew pay" on public.crew_pay;
create policy "admin crew pay" on public.crew_pay for all using (public.is_admin()) with check (public.is_admin());

-- Removing an advance or a salary payment removes its expense too, so Finance stays right.
create or replace function public.crew_pay_remove_expense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.expense_id is not null then delete from public.expenses where id = old.expense_id; end if;
  return old;
end $$;
drop trigger if exists crew_pay_expense on public.crew_pay;
create trigger crew_pay_expense after delete on public.crew_pay
  for each row execute function public.crew_pay_remove_expense();
