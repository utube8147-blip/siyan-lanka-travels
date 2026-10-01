// lib/trips.ts
// Pure helpers: money/date formatting and turning buses + routes + schedules
// + bookings into bookable trips. No React here, so the same functions can
// move to a server/API route unchanged when a real backend is added.

import { OPERATOR } from '@/config/operator';
import type { BikeKind, Booking, Bus, Gender, Route, Schedule, StoreData, Trip } from './types';

// ---------------------------------------------------------------- money ----
const lkr = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** 1200 → "LKR 1,200" */
export function formatLKR(amount: number) {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${OPERATOR.currency} ${lkr.format(Math.abs(Math.round(amount * 100) / 100))}`;
}

// ---------------------------------------------------------------- dates ----
export function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso: string, days: number) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function todayISO() {
  return toISODate(new Date());
}

let DATE_LOCALE = 'en-GB';
/** Set by the language switcher (en-GB / ta-LK / si-LK). */
export function setDateLocale(locale: string) {
  DATE_LOCALE = locale;
}

/** "2026-07-12" → "Sun, 12 Jul 2026" */
export function formatDateLabel(iso: string | null | undefined, withYear = true) {
  if (!iso) return '';
  const d = parseISODate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(DATE_LOCALE, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(total: number) {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** "14:05" → "02:05 PM" */
export function formatTime12(hhmm: string) {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** 185 → "3h 05m" */
export function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// ----------------------------------------------------------------- misc ----
const CITY_CODES: Record<string, string> = {
  Akkaraipattu: 'AKP',
  Kalmunai: 'KLM',
  Batticaloa: 'BTC',
  Valaichchenai: 'VLC',
  Welikanda: 'WLK',
  Polonnaruwa: 'PLN',
  Habarana: 'HBR',
  Dambulla: 'DBL',
  Colombo: 'CMB',
  Pettah: 'PTH',
  Kandy: 'KDY',
  Kadawatha: 'KDW',
  Nittambuwa: 'NTB',
  Kegalle: 'KGL',
  Mawanella: 'MWL',
  Peradeniya: 'PDN',
  Kurunegala: 'KNG',
  Galle: 'GAL',
  Matara: 'MTR',
  Negombo: 'NEG',
  Jaffna: 'JAF',
  'Nuwara Eliya': 'NUE',
  Trincomalee: 'TRR',
  Anuradhapura: 'ANU',
};

export function cityCode(city: string) {
  return CITY_CODES[city] ?? city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

export function genRef(prefix: string = OPERATOR.refPrefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

export function genId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function routeLabel(route: Route | undefined) {
  if (!route || route.stops.length === 0) return 'Unnamed route';
  return `${route.stops[0].name} → ${route.stops[route.stops.length - 1].name}`;
}

// ---------------------------------------------------------------- seats ----
const SIDE_COLS = ['A', 'B', 'C', 'D'];
const BACK_COLS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function busCapacity(bus: Pick<Bus, 'rows' | 'backRowSeats'>) {
  return bus.rows * 4 + bus.backRowSeats;
}

/** Every seat id on the bus, front to back. */
export function seatIds(bus: Pick<Bus, 'rows' | 'backRowSeats'>) {
  const ids: string[] = [];
  for (let r = 1; r <= bus.rows; r++) SIDE_COLS.forEach((c) => ids.push(`${r}${c}`));
  for (let i = 0; i < bus.backRowSeats; i++) ids.push(`${bus.rows + 1}${BACK_COLS[i]}`);
  return ids;
}

export function isLiveBooking(b: Booking) {
  return b.status === 'confirmed' || b.status === 'boarded' || b.status === 'held';
}

/**
 * Seats taken on a departure, with the gender of the passenger who holds them.
 * Simplification for v1: a seat booked for any part of the route is taken for
 * the whole run (no re-selling Colombo→Kegalle seats for Kegalle→Kandy).
 */
export function takenSeats(bookings: Booking[], scheduleId: string, date: string, ignoreBookingId?: string) {
  const map = new Map<string, Gender>();
  for (const b of bookings) {
    if (b.scheduleId !== scheduleId || b.date !== date || !isLiveBooking(b)) continue;
    if (ignoreBookingId && b.id === ignoreBookingId) continue;
    b.seats.forEach((s) => map.set(s, b.passenger.gender));
  }
  return map;
}

// ---------------------------------------------------------------- trips ----
export function allStopNames(data: Pick<StoreData, 'routes'>) {
  const names = new Set<string>();
  data.routes.filter((r) => r.active).forEach((r) => r.stops.forEach((s) => names.add(s.name)));
  return Array.from(names);
}

function sameStop(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function stopIndex(route: Route, name: string) {
  return route.stops.findIndex((s) => sameStop(s.name, name));
}

/** Departure datetime (local) for a schedule on a date, at a given stop offset. */
export function departureDate(date: string, departure: string, offsetMin = 0) {
  const d = parseISODate(date);
  d.setMinutes(toMinutes(departure) + offsetMin);
  return d;
}

function buildTrip(
  data: StoreData,
  schedule: Schedule,
  route: Route,
  bus: Bus,
  date: string,
  fromIdx: number,
  toIdx: number,
  now: Date,
): Trip {
  const from = route.stops[fromIdx];
  const to = route.stops[toIdx];
  const depMin = toMinutes(schedule.departure);
  const taken = takenSeats(data.bookings, schedule.id, date);
  const capacity = busCapacity(bus);
  const usedSpaces = bikeSpacesUsed(data.bookings, schedule.id, date);
  const fullFare = route.stops[route.stops.length - 1].fareFromStart || 1;
  const leaves = departureDate(date, schedule.departure, from.offsetMin);
  const closed = leaves.getTime() - OPERATOR.bookingCutoffMinutes * 60_000 < now.getTime();
  return {
    scheduleId: schedule.id,
    routeId: route.id,
    bus,
    date,
    from: from.name,
    to: to.name,
    boardingDate: addDays(date, Math.floor((depMin + from.offsetMin) / 1440)),
    arrivalDayOffset: Math.floor((depMin + to.offsetMin) / 1440) - Math.floor((depMin + from.offsetMin) / 1440),
    departure: fromMinutes(depMin + from.offsetMin),
    arrival: fromMinutes(depMin + to.offsetMin),
    durationMin: to.offsetMin - from.offsetMin,
    via: route.stops.slice(fromIdx + 1, toIdx).map((s) => s.name),
    fare: Math.max(0, to.fareFromStart - from.fareFromStart),
    capacity,
    seatsBooked: taken.size,
    seatsLeft: Math.max(0, capacity - taken.size),
    bikeSpaces: bus.bikeSpaces ?? 0,
    bikeSpacesLeft: Math.max(0, (bus.bikeSpaces ?? 0) - usedSpaces),
    routeShare: Math.min(1, Math.max(0, (to.fareFromStart - from.fareFromStart) / fullFare)),
    closed,
  };
}

/**
 * All departures a passenger can board on `date` (their local travel date)
 * for from → to, earliest first. Night services that left their first stop
 * the previous evening are included when the boarding stop is after midnight.
 */
export function findTrips(data: StoreData, from: string, to: string, date: string, now = new Date()): Trip[] {
  const trips: Trip[] = [];
  for (const schedule of data.schedules) {
    if (!schedule.active) continue;
    const route = data.routes.find((r) => r.id === schedule.routeId && r.active);
    const bus = data.buses.find((b) => b.id === schedule.busId && b.status === 'active');
    if (!route || !bus) continue;
    const fi = stopIndex(route, from);
    const ti = stopIndex(route, to);
    if (fi < 0 || ti < 0 || fi >= ti) continue;
    const dayShift = Math.floor((toMinutes(schedule.departure) + route.stops[fi].offsetMin) / 1440);
    const runDate = addDays(date, -dayShift);
    if (!schedule.days.includes(parseISODate(runDate).getDay() as Schedule['days'][number])) continue;
    trips.push(buildTrip(data, schedule, route, bus, runDate, fi, ti, now));
  }
  return trips.sort((a, b) => a.departure.localeCompare(b.departure));
}

/** A single trip, e.g. for the seat page. Falls back to the full route if from/to don't match. */
export function getTrip(
  data: StoreData,
  scheduleId: string,
  date: string,
  from?: string | null,
  to?: string | null,
  now = new Date(),
): Trip | null {
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  if (!schedule) return null;
  const route = data.routes.find((r) => r.id === schedule.routeId);
  const bus = data.buses.find((b) => b.id === schedule.busId);
  if (!route || !bus) return null;
  let fi = from ? stopIndex(route, from) : 0;
  let ti = to ? stopIndex(route, to) : route.stops.length - 1;
  if (fi < 0 || ti < 0 || fi >= ti) {
    fi = 0;
    ti = route.stops.length - 1;
  }
  return buildTrip(data, schedule, route, bus, date, fi, ti, now);
}

/** Refund due if the passenger cancels now, per OPERATOR.refundPolicy. */
export function refundQuote(booking: Booking, trip: Pick<Trip, 'boardingDate' | 'departure'> | null, now = new Date()) {
  if (!trip) return { percent: 0, amount: 0 };
  const leaves = departureDate(trip.boardingDate, trip.departure);
  const hoursBefore = (leaves.getTime() - now.getTime()) / 3_600_000;
  const tier = OPERATOR.refundPolicy.find((t) => hoursBefore >= t.hoursBefore);
  const percent = tier ? tier.percent : 0;
  // The booking fee is not refundable.
  const refundable = booking.total - booking.fee;
  return { percent, amount: Math.round((refundable * percent) / 100) };
}

/**
 * Other departures of the same bus that overlap this one anywhere in the week
 * (including runs that cross midnight), allowing a turnaround gap.
 */
export function scheduleConflicts(data: Pick<StoreData, 'schedules' | 'routes'>, candidate: Schedule, turnaround = 60) {
  const WEEK = 7 * 1440;
  const routeLen = (id: string) => {
    const r = data.routes.find((x) => x.id === id);
    return r && r.stops.length ? r.stops[r.stops.length - 1].offsetMin : 0;
  };
  const windows = (s: Schedule) =>
    s.days.map((d) => {
      const start = d * 1440 + toMinutes(s.departure);
      return [start, start + routeLen(s.routeId) + turnaround] as const;
    });
  const overlaps = (a: readonly [number, number], b: readonly [number, number]) =>
    [-WEEK, 0, WEEK].some((shift) => a[0] < b[1] + shift && b[0] + shift < a[1]);
  const mine = windows(candidate);
  return data.schedules.filter((s) => {
    if (s.id === candidate.id || !s.active || s.busId !== candidate.busId) return false;
    const theirs = windows(s);
    return mine.some((a) => theirs.some((b) => overlaps(a, b)));
  });
}

// ------------------------------------------------------------- operator ----
export interface Run {
  schedule: Schedule;
  route: Route;
  bus: Bus;
  /** Date the bus leaves its first stop. */
  date: string;
  capacity: number;
  sold: number;
  revenue: number;
  departsAt: Date;
}

/** Every departure (schedule × date) from `startDate` for `days` days. */
export function listRuns(data: StoreData, startDate: string, days: number): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const weekday = parseISODate(date).getDay();
    for (const schedule of data.schedules) {
      if (!schedule.active || !schedule.days.includes(weekday as Schedule['days'][number])) continue;
      const route = data.routes.find((r) => r.id === schedule.routeId);
      const bus = data.buses.find((b) => b.id === schedule.busId);
      if (!route || !bus) continue;
      const live = data.bookings.filter((b) => b.scheduleId === schedule.id && b.date === date && isLiveBooking(b));
      runs.push({
        schedule,
        route,
        bus,
        date,
        capacity: busCapacity(bus),
        sold: live.reduce((n, b) => n + b.seats.length, 0),
        revenue: live.reduce((n, b) => n + b.total, 0),
        departsAt: departureDate(date, schedule.departure),
      });
    }
  }
  return runs.sort((a, b) => a.departsAt.getTime() - b.departsAt.getTime());
}

/** Money actually kept for a booking (total minus any refund). */
export function netRevenue(b: Booking) {
  if (b.status === 'cancelled') return b.total - (b.refund?.amount ?? b.total);
  return b.total;
}

// ---------------------------------------------------------------- bikes ----
export function bikeSpacesFor(kind: BikeKind) {
  return OPERATOR.bikes.kinds[kind].spaces;
}

/** Luggage-compartment spaces already booked on a departure. */
export function bikeSpacesUsed(bookings: Booking[], scheduleId: string, date: string, ignoreBookingId?: string) {
  let used = 0;
  for (const b of bookings) {
    if (b.scheduleId !== scheduleId || b.date !== date || !isLiveBooking(b) || b.id === ignoreBookingId) continue;
    for (const bike of b.bikes ?? []) used += bikeSpacesFor(bike.kind);
  }
  return used;
}

/** Fee for one bike on a trip: full-route fee scaled by distance, rounded to LKR 50. */
export function bikeFee(kind: BikeKind, routeShare: number) {
  const full = OPERATOR.bikes.kinds[kind].fullRouteFee;
  return Math.max(OPERATOR.bikes.minFee, Math.round((full * routeShare) / 50) * 50);
}

export function bikeLabel(kind: BikeKind) {
  return OPERATOR.bikes.kinds[kind].label;
}

/**
 * Shrinks an uploaded photo in the browser (max 720px, JPEG) so it can be
 * kept with the booking. Rejects non-images and files over the size limit.
 */
export function compressPhoto(file: File, maxSide = 720): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('That file isn’t a photo. Upload a JPG, PNG or HEIC image.'));
    if (file.size > OPERATOR.bikes.maxPhotoMB * 1024 * 1024) return reject(new Error(`Photo is over ${OPERATOR.bikes.maxPhotoMB} MB. Try a smaller one.`));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Couldn’t read that photo. Try taking it again or use a JPG.'));
    };
    img.src = url;
  });
}
