-- =============================================================================
-- Siyan Lanka Travels — migration 18: reminders to renew documents
-- Bus paperwork (insurance, revenue licence, route permit, emission test,
-- fitness certificate) and crew driving licences are chased automatically:
-- a reminder 30, 14, 7, 3 and 1 days before the expiry date, on the day, and
-- every 3 days after it has expired, until the date is updated.
-- Each reminder goes to every super admin (in the app, and as a push
-- notification) and, by text, to the owner's number (OWNER_PHONE in .env).
-- Sent by the every-minute cron (/api/messages/dispatch). Safe to run again.
-- =============================================================================
alter table public.bus_documents
  add column if not exists reminded_for date,      -- the expiry date the last reminder was about
  add column if not exists reminded_stage integer; -- how far along that reminder was (30, 14, 7, 3, 1, 0, -1, -2 …)
alter table public.crew
  add column if not exists reminded_for date,
  add column if not exists reminded_stage integer;

-- Which reminder a number of days-left belongs to. Falls as time passes.
create or replace function public.renewal_stage(days_left integer) returns integer
language sql immutable as $$
  select case when days_left > 30 then null
              when days_left > 14 then 30 when days_left > 7 then 14 when days_left > 3 then 7
              when days_left > 1 then 3 when days_left > 0 then 1 when days_left = 0 then 0
              else -1 - ((-days_left - 1) / 3) end; -- expired: a new stage every 3 days
$$;

-- Queues the reminders that are due and returns their wording (for the text
-- to the owner). A reminder is due when the stage has moved on since the last
-- one, or the expiry date has changed. Called by the server only.
create or replace function public.queue_renewal_reminders() returns text[]
language plpgsql security definer set search_path = public as $$
declare tz text := (select timezone from public.app_settings);
  today date := (now() at time zone tz)::date;
  r record; lines text[] := '{}'; line text; title text; d int; st int;
  labels jsonb := '{"insurance":"Insurance","revenue_license":"Revenue licence","route_permit":"Route permit","emission_test":"Emission test","fitness_certificate":"Fitness certificate","other":"Document"}';
begin
  for r in
    select 'doc' as src, bd.id::text as id, coalesce(labels ->> bd.kind, 'Document') || ' for ' || b.reg_no as what, bd.expires_on, bd.reminded_for, bd.reminded_stage, '/admin/fleet-health' as url
    from public.bus_documents bd join public.buses b on b.id = bd.bus_id
    union all
    select 'crew', c.id::text, 'Driving licence of ' || c.full_name, c.license_expires, c.reminded_for, c.reminded_stage, '/admin/crew'
    from public.crew c where c.license_expires is not null and coalesce(c.active, true)
  loop
    d := r.expires_on - today;
    st := public.renewal_stage(d);
    continue when st is null;
    continue when r.reminded_for is not distinct from r.expires_on and r.reminded_stage is not null and r.reminded_stage <= st;
    line := r.what || case when d > 1 then ' expires in ' || d || ' days' when d = 1 then ' expires tomorrow' when d = 0 then ' expires today'
                           when d = -1 then ' expired yesterday' else ' expired ' || (-d) || ' days ago' end
            || ' (' || to_char(r.expires_on, 'Dy DD Mon YYYY') || ')';
    title := case when d < 0 then 'Expired: ' when d <= 3 then 'Renew now: ' else 'Renew soon: ' end || r.what;
    insert into public.notifications (user_id, title, body, url)
    select p.id, title, line || '. Update it once it is renewed.', r.url from public.profiles p where p.role::text = 'admin';
    if r.src = 'doc' then update public.bus_documents set reminded_for = r.expires_on, reminded_stage = st where id::text = r.id;
    else update public.crew set reminded_for = r.expires_on, reminded_stage = st where id::text = r.id; end if;
    lines := lines || line;
  end loop;
  return lines;
end $$;
revoke execute on function public.queue_renewal_reminders() from public, anon, authenticated;
