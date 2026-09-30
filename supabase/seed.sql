-- Starting data: settings, coach ND-2323, Route 48 both ways, timetable.
-- Same as lib/seed.ts (minus the sample bookings). Safe to re-run.

insert into public.app_settings (id, booking_fee, promo_code, promo_percent, max_seats_per_booking, booking_cutoff_minutes)
values (true, 50, 'SIYAN10', 10, 6, 30)
on conflict (id) do nothing;

insert into public.buses (id, name, reg_no, type, rows, back_row_seats, ladies_seats, amenities, status, bike_spaces)
values ('bus-1', 'Siyan Gold', 'ND-2323', 'AC', 10, 5, array['1A','1B'],
        array['Air conditioning','Reclining seats','USB charging','Reading lights'], 'active', 4)
on conflict (id) do nothing;

insert into public.routes (id, stops, active) values
  ('route-48-east', '[{"name": "Colombo", "offsetMin": 0, "fareFromStart": 0}, {"name": "Kadawatha", "offsetMin": 30, "fareFromStart": 250}, {"name": "Nittambuwa", "offsetMin": 60, "fareFromStart": 450}, {"name": "Kurunegala", "offsetMin": 125, "fareFromStart": 850}, {"name": "Dambulla", "offsetMin": 205, "fareFromStart": 1300}, {"name": "Habarana", "offsetMin": 240, "fareFromStart": 1500}, {"name": "Polonnaruwa", "offsetMin": 295, "fareFromStart": 1800}, {"name": "Welikanda", "offsetMin": 340, "fareFromStart": 2000}, {"name": "Valaichchenai", "offsetMin": 395, "fareFromStart": 2200}, {"name": "Batticaloa", "offsetMin": 440, "fareFromStart": 2400}, {"name": "Kalmunai", "offsetMin": 495, "fareFromStart": 2600}, {"name": "Akkaraipattu", "offsetMin": 530, "fareFromStart": 2800}]'::jsonb, true),
  ('route-48-west', '[{"name": "Akkaraipattu", "offsetMin": 0, "fareFromStart": 0}, {"name": "Kalmunai", "offsetMin": 35, "fareFromStart": 200}, {"name": "Batticaloa", "offsetMin": 90, "fareFromStart": 400}, {"name": "Valaichchenai", "offsetMin": 135, "fareFromStart": 600}, {"name": "Welikanda", "offsetMin": 190, "fareFromStart": 800}, {"name": "Polonnaruwa", "offsetMin": 235, "fareFromStart": 1000}, {"name": "Habarana", "offsetMin": 290, "fareFromStart": 1300}, {"name": "Dambulla", "offsetMin": 325, "fareFromStart": 1500}, {"name": "Kurunegala", "offsetMin": 405, "fareFromStart": 1950}, {"name": "Nittambuwa", "offsetMin": 470, "fareFromStart": 2350}, {"name": "Kadawatha", "offsetMin": 500, "fareFromStart": 2550}, {"name": "Colombo", "offsetMin": 530, "fareFromStart": 2800}]'::jsonb, true)
on conflict (id) do nothing;

-- Out Mon/Wed/Fri 9:00 PM from Colombo; back Tue/Thu/Sat 8:00 PM from Akkaraipattu.
insert into public.schedules (id, route_id, bus_id, departure, days, active) values
  ('sch-cmb-2100', 'route-48-east', 'bus-1', '21:00', array[1,3,5]::smallint[], true),
  ('sch-akp-2000', 'route-48-west', 'bus-1', '20:00', array[2,4,6]::smallint[], true)
on conflict (id) do nothing;
