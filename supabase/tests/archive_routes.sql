\ir _autopay.inc
-- Deleting a departure with old tickets archives it; the route then archives too.
\set ON_ERROR_STOP 0
insert into routes (id, stops) values ('route-t', '[{"name":"A","offsetMin":0,"fareFromStart":0},{"name":"B","offsetMin":60,"fareFromStart":500}]');
insert into schedules (id, route_id, bus_id, departure, days) select 'sch-t', 'route-t', id, '10:00', '{1}' from buses limit 1;
set session_replication_role = replica;  -- skip day checks for this old ticket
insert into bookings (ref, schedule_id, travel_date, from_stop, to_stop, seats, passenger_name, passenger_phone, fare, total, status, payment_method)
  values ('SLT-OLD001', 'sch-t', current_date - 3, 'A', 'B', '{1A}', 'Old', '+94770000000', 500, 500, 'boarded', 'cash');
set session_replication_role = origin;
delete from schedules where id = 'sch-t';  -- refused: an old ticket points to it
update schedules set archived = true, active = true where id = 'sch-t';
select id, archived, active as "active (must be f)" from schedules where id = 'sch-t';
delete from routes where id = 'route-t';   -- refused: the archived departure points to it
update routes set archived = true where id = 'route-t';
select id, archived, active as "active (must be f)" from routes where id = 'route-t';
select count(*) as "old ticket kept" from bookings where schedule_id = 'sch-t';
