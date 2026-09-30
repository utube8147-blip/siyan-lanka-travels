// lib/seed.ts
// Starting data for the demo: coach ND 2323 on Route 48, Colombo (Bastian
// Mawatha) ⇄ Akkaraipattu via Kurunegala, Dambulla, Habarana, Polonnaruwa
// (Kaduruwela), Batticaloa and Kalmunai, as a night service. Times and fares
// are estimates: correct them in /admin → Routes (changes are saved in the
// browser; "Reset demo data" restores this file).

import { OPERATOR } from '@/config/operator';
import type { Booking, Bus, Gender, Route, Schedule, StoreData } from './types';
import { addDays, busCapacity, departureDate, parseISODate, seatIds, todayISO } from './trips';

export const STORE_VERSION = 3;
export const MOCK_USER_ID = 'mock-user-1';

export const SEED_BUSES: Bus[] = [
  {
    id: 'bus-1',
    name: 'Siyan Gold',
    regNo: 'ND-2323',
    type: 'AC',
    rows: 10,
    backRowSeats: 5,
    ladiesSeats: ['1A', '1B'],
    amenities: ['Air conditioning', 'Reclining seats', 'USB charging', 'Reading lights'],
    status: 'active',
    bikeSpaces: 4,
  },
];

// Outbound stops with minutes from Colombo and fare from Colombo (LKR).
const EAST: Array<[string, number, number]> = [
  ['Colombo', 0, 0],
  ['Kadawatha', 30, 250],
  ['Nittambuwa', 60, 450],
  ['Kurunegala', 125, 850],
  ['Dambulla', 205, 1300],
  ['Habarana', 240, 1500],
  ['Polonnaruwa', 295, 1800],
  ['Welikanda', 340, 2000],
  ['Valaichchenai', 395, 2200],
  ['Batticaloa', 440, 2400],
  ['Kalmunai', 495, 2600],
  ['Akkaraipattu', 530, 2800],
];

const total = EAST[EAST.length - 1];

export const SEED_ROUTES: Route[] = [
  {
    id: 'route-48-east',
    active: true,
    stops: EAST.map(([name, offsetMin, fareFromStart]) => ({ name, offsetMin, fareFromStart })),
  },
  {
    id: 'route-48-west',
    active: true,
    // Same stops reversed: time/fare measured from Akkaraipattu.
    stops: [...EAST].reverse().map(([name, offsetMin, fareFromStart]) => ({
      name,
      offsetMin: total[1] - offsetMin,
      fareFromStart: total[2] - fareFromStart,
    })),
  },
];

// One coach can do three round trips a week: out Mon/Wed/Fri night, back
// Tue/Thu/Sat night, Sunday off. Add bus #2 in /admin to run the other days.
export const SEED_SCHEDULES: Schedule[] = [
  { id: 'sch-cmb-2100', routeId: 'route-48-east', busId: 'bus-1', departure: '21:00', days: [1, 3, 5], active: true },
  { id: 'sch-akp-2000', routeId: 'route-48-west', busId: 'bus-1', departure: '20:00', days: [2, 4, 6], active: true },
];

// ------------------------------------------------------------------------
// Sample bookings — deterministic per date so reloading looks the same.
// ------------------------------------------------------------------------
const FIRST = ['Mohamed', 'Fathima', 'Ahamed', 'Rizana', 'Nimal', 'Kasun', 'Tharushi', 'Suresh', 'Priya', 'Arjun', 'Sajith', 'Nuskiya', 'Irfan', 'Shifana', 'Kavitha', 'Ramesh', 'Dilani', 'Fazeel', 'Hiruni', 'Mathan'];
const LAST = ['Rizvi', 'Hameed', 'Farook', 'Jaleel', 'Perera', 'Kumar', 'Sivakumar', 'Fernando', 'Ismail', 'Rahman', 'Bandara', 'Nazeer'];
const FEMALE = new Set(['Fathima', 'Rizana', 'Tharushi', 'Priya', 'Nuskiya', 'Shifana', 'Kavitha', 'Dilani', 'Hiruni']);

function rng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function refFrom(r: () => number) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(r() * chars.length)];
  return `${OPERATOR.refPrefix}-${s}`;
}

function makeBooking(
  partial: Omit<Booking, 'fee' | 'discount' | 'total' | 'createdAt' | 'contact' | 'channel'> &
    Partial<Pick<Booking, 'contact' | 'channel' | 'createdAt'>>,
): Booking {
  const fee = OPERATOR.bookingFee;
  return {
    channel: 'online',
    contact: { email: '', phone: partial.passenger.phone },
    createdAt: new Date().toISOString(),
    ...partial,
    fee,
    discount: 0,
    total: partial.fare * partial.seats.length + fee,
  };
}

function seedBookings(): Booking[] {
  const today = todayISO();
  const now = new Date();
  const bus = SEED_BUSES[0];
  const allSeats = seatIds(bus);
  const out: Booking[] = [];

  for (let dayOffset = -14; dayOffset <= 10; dayOffset++) {
    const date = addDays(today, dayOffset);
    for (const sch of SEED_SCHEDULES) {
      if (!sch.days.includes(parseISODate(date).getDay() as Schedule['days'][number])) continue;
      const route = SEED_ROUTES.find((r) => r.id === sch.routeId)!;
      const r = rng(`${sch.id}:${date}`);
      const past = departureDate(date, sch.departure).getTime() < now.getTime();
      // Fuller buses in the past and near-term; lighter further out.
      const target = Math.floor(busCapacity(bus) * (past ? 0.55 + r() * 0.35 : Math.max(0.12, 0.6 - dayOffset * 0.05) * (0.6 + r() * 0.6)));
      const free = allSeats.filter((s) => !bus.ladiesSeats.includes(s));
      let filled = 0;
      while (filled < target && free.length > 0) {
        const first = FIRST[Math.floor(r() * FIRST.length)];
        const gender: Gender = FEMALE.has(first) ? 'Female' : 'Male';
        const groupSize = Math.min(free.length, r() < 0.65 ? 1 : r() < 0.8 ? 2 : 3);
        const start = Math.floor(r() * free.length);
        const seats = free.splice(start, groupSize);
        // Most ride end to end; some get on/off at the big towns on the way.
        const fi = r() < 0.7 ? 0 : 1 + Math.floor(r() * 3);
        const ti = r() < 0.5 ? route.stops.length - 1 : route.stops.length - 1 - (1 + Math.floor(r() * 3));
        const fare = route.stops[ti].fareFromStart - route.stops[fi].fareFromStart;
        const chan = r();
        out.push(
          makeBooking({
            id: `seed-${sch.id}-${date}-${filled}`,
            ref: refFrom(r),
            scheduleId: sch.id,
            date,
            from: route.stops[fi].name,
            to: route.stops[ti].name,
            seats,
            passenger: {
              name: `${first} ${LAST[Math.floor(r() * LAST.length)]}`,
              gender,
              phone: `+94 7${Math.floor(r() * 8)} ${String(Math.floor(r() * 9000000) + 1000000).replace(/(\d{3})(\d{4})/, '$1 $2')}`,
            },
            channel: chan < 0.7 ? 'online' : chan < 0.9 ? 'counter' : 'phone',
            fare,
            status: past ? (r() < 0.94 ? 'boarded' : 'no-show') : 'confirmed',
            createdAt: departureDate(addDays(date, -1 - Math.floor(r() * 6)), '10:00').toISOString(),
          }),
        );
        // Now and then a passenger brings a bike, while there's space.
        const used = out.filter((x) => x.scheduleId === sch.id && x.date === date).reduce((n, x) => n + (x.bikes?.length ?? 0) * 2, 0);
        if (r() < 0.12 && used + 2 <= SEED_BUSES[0].bikeSpaces) {
          const kind = r() < 0.6 ? 'motorbike' : 'bicycle';
          const share = fare / route.stops[route.stops.length - 1].fareFromStart;
          const fee = Math.max(OPERATOR.bikes.minFee, Math.round((OPERATOR.bikes.kinds[kind].fullRouteFee * share) / 50) * 50);
          const last = out[out.length - 1];
          last.bikes = [
            {
              id: `bike-${last.id}`,
              kind,
              description: kind === 'motorbike' ? ['Honda Dio, red', 'Bajaj Pulsar 150, black', 'TVS Apache, blue'][Math.floor(r() * 3)] : 'Mountain bike, green',
              regNo: kind === 'motorbike' ? `EP ${['BGK', 'BHC', 'BFT'][Math.floor(r() * 3)]}-${1000 + Math.floor(r() * 8999)}` : '',
              photo: '',
              fee,
            },
          ];
          last.bikeFee = fee;
          last.total += fee;
        }
        filled += seats.length;
      }
    }
  }

  // The demo passenger's own trips (shown on /my-bookings and /dashboard).
  // Each entry: [approx days from today, schedule, seats, status] — snapped
  // to the next day that schedule actually runs.
  const mine: Array<[number, string, string[], Booking['status']]> = [
    [2, 'sch-cmb-2100', ['3B'], 'confirmed'],
    [9, 'sch-akp-2000', ['5C', '5D'], 'confirmed'],
    [-12, 'sch-cmb-2100', ['4A'], 'boarded'],
    [-24, 'sch-akp-2000', ['7C'], 'cancelled'],
  ];
  const refs = ['SLT-7K2Q1P', 'SLT-XM4QZ8', 'SLT-9H3D7L', 'SLT-1QF82R'];
  mine.forEach(([offset, schId, seats, status], i) => {
    const sch = SEED_SCHEDULES.find((s) => s.id === schId)!;
    const route = SEED_ROUTES.find((r) => r.id === sch.routeId)!;
    let date = addDays(today, offset);
    while (!sch.days.includes(parseISODate(date).getDay() as Schedule['days'][number])) date = addDays(date, 1);
    const fare = route.stops[route.stops.length - 1].fareFromStart;
    for (const b of out) {
      if (b.scheduleId === schId && b.date === date) b.seats = b.seats.filter((s) => !seats.includes(s));
    }
    const booking = makeBooking({
      id: `mine-${i}`,
      ref: refs[i],
      scheduleId: schId,
      date,
      from: route.stops[0].name,
      to: route.stops[route.stops.length - 1].name,
      seats,
      passenger: { name: 'Alex Ham', gender: 'Male', phone: '+94 77 123 4567' },
      contact: { email: 'alex.ham@example.com', phone: '+94 77 123 4567' },
      userId: MOCK_USER_ID,
      fare,
      status,
      createdAt: departureDate(addDays(date, -5), '19:12').toISOString(),
    });
    if (status === 'cancelled') booking.refund = { amount: Math.round((booking.total - booking.fee) * 0.9), at: booking.createdAt };
    out.push(booking);
  });

  return out.filter((b) => b.seats.length > 0);
}

export function createSeedData(): StoreData {
  return {
    version: STORE_VERSION,
    buses: structuredClone(SEED_BUSES),
    routes: structuredClone(SEED_ROUTES),
    schedules: structuredClone(SEED_SCHEDULES),
    bookings: seedBookings(),
  };
}
