// Figures for Staff area → Finance and Analytics. Pure functions over the
// data the app already has (bookings, timetable, expenses), so every chart
// uses the same date range and the same filters.
import { addDays, busCapacity, isLiveBooking, netRevenue, parseISODate, runsOn, todayISO } from './trips';
import type { Booking, StoreData } from './types';

export interface Range {
  from: string; // inclusive, "YYYY-MM-DD"
  to: string; // inclusive
  /** '' = all buses */
  busId: string;
  /** '' = all routes */
  routeId: string;
}
export type Preset = '7d' | 'month' | 'lastMonth' | '90d' | 'custom';
export const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'custom', label: 'Custom' },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function presetDates(p: Exclude<Preset, 'custom'>, today = todayISO()): { from: string; to: string } {
  const t = parseISODate(today);
  if (p === '7d') return { from: addDays(today, -6), to: today };
  if (p === '90d') return { from: addDays(today, -89), to: today };
  if (p === 'month') return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
  return { from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) };
}
export const daysIn = (r: Pick<Range, 'from' | 'to'>) => Math.round((parseISODate(r.to).getTime() - parseISODate(r.from).getTime()) / 86_400_000) + 1;
/** The period of the same length just before this one (for "vs previous"). */
export function previous(r: Range): Range {
  const n = daysIn(r);
  return { ...r, from: addDays(r.from, -n), to: addDays(r.from, -1) };
}
/** The range up to today: comparisons use this, so a month that isn't over yet is compared like for like. */
export function toDate<T extends Pick<Range, 'from' | 'to'>>(r: T, today = todayISO()): T {
  return r.to > today && r.from <= today ? { ...r, to: today } : r;
}
export const inRange = (date: string, r: Pick<Range, 'from' | 'to'>) => date >= r.from && date <= r.to;
/** Change against a previous figure, as a signed percentage; null when there is nothing to compare with. */
export const change = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100));

/** Real bookings (not availability placeholders) by TRAVEL date, with the bus / route filter applied. */
export function bookingsIn(data: StoreData, r: Range): Booking[] {
  const sched = new Map(data.schedules.map((s) => [s.id, s]));
  return data.bookings.filter((b) => {
    if (b.id.startsWith('avail-') || !inRange(b.date, r)) return false;
    const s = sched.get(b.scheduleId);
    return (!r.busId || s?.busId === r.busId) && (!r.routeId || s?.routeId === r.routeId);
  });
}

// ------------------------------------------------------------- time buckets
/** `label` is the short text under the bar group; `title` the full wording ("Sat 3 Oct", "Week of 28 Sept", "October 2026"). */
export type Bucket = { key: string; label: string; title: string; from: string; to: string };
/** Days for short ranges, weeks for medium, months for long: keeps every chart readable. */
export function buckets(r: Pick<Range, 'from' | 'to'>): Bucket[] {
  const n = daysIn(r);
  const out: Bucket[] = [];
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => parseISODate(d).toLocaleDateString('en-GB', o);
  if (n <= 31) {
    for (let i = 0; i < n; i++) {
      const d = addDays(r.from, i);
      out.push({ key: d, label: fmt(d, { day: 'numeric', month: n > 10 ? undefined : 'short' }), title: fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }), from: d, to: d });
    }
  } else if (n <= 120) {
    for (let d = r.from; d <= r.to; d = addDays(d, 7)) {
      const end = addDays(d, 6) > r.to ? r.to : addDays(d, 6);
      out.push({ key: d, label: fmt(d, { day: 'numeric', month: 'short' }), title: `Week of ${fmt(d, { day: 'numeric', month: 'short' })} (to ${fmt(end, { day: 'numeric', month: 'short' })})`, from: d, to: end });
    }
  } else {
    let d = parseISODate(r.from);
    while (iso(d) <= r.to) {
      const first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
      const last = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      out.push({ key: first, label: fmt(first, { month: 'short', year: '2-digit' }), title: fmt(first, { month: 'long', year: 'numeric' }), from: first < r.from ? r.from : first, to: last > r.to ? r.to : last });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return out;
}

// ------------------------------------------------------------------- runs
export interface RunFig { key: string; scheduleId: string; date: string; departure: string; routeId: string; busId: string; capacity: number; sold: number; income: number }
/** Every departure in the range that has left (or leaves today), with seats sold and ticket income. */
export function runsIn(data: StoreData, r: Range): RunFig[] {
  const today = todayISO();
  const out: RunFig[] = [];
  const end = r.to > today ? today : r.to;
  for (let d = r.from; d <= end; d = addDays(d, 1)) {
    for (const s of data.schedules) {
      if ((r.busId && s.busId !== r.busId) || (r.routeId && s.routeId !== r.routeId)) continue;
      const bks = data.bookings.filter((b) => b.scheduleId === s.id && b.date === d && !b.id.startsWith('avail-'));
      if (!(s.active && runsOn(s, d)) && bks.length === 0) continue;
      const bus = data.buses.find((b) => b.id === s.busId);
      if (!bus) continue;
      out.push({
        key: `${s.id}|${d}`, scheduleId: s.id, date: d, departure: s.departure, routeId: s.routeId, busId: s.busId,
        capacity: busCapacity(bus),
        sold: bks.filter(isLiveBooking).reduce((n, b) => n + b.seats.length, 0),
        income: bks.reduce((n, b) => n + netRevenue(b), 0),
      });
    }
  }
  return out;
}
export const fillPct = (runs: RunFig[]) => {
  const cap = runs.reduce((n, x) => n + x.capacity, 0);
  return cap ? Math.round((runs.reduce((n, x) => n + x.sold, 0) / cap) * 100) : 0;
};

/** Sum a list into named groups, largest first. */
export function groupSum<T>(list: T[], key: (x: T) => string, value: (x: T) => number) {
  const m = new Map<string, { value: number; count: number }>();
  for (const x of list) {
    const k = key(x);
    const cur = m.get(k) ?? { value: 0, count: 0 };
    m.set(k, { value: cur.value + value(x), count: cur.count + 1 });
  }
  return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.value - a.value);
}

/** How many days before departure a booking was made. */
export function leadDays(b: Booking) {
  return Math.max(0, Math.round((parseISODate(b.date).getTime() - parseISODate(b.createdAt.slice(0, 10)).getTime()) / 86_400_000));
}
export const LEAD_BANDS: { label: string; test: (d: number) => boolean }[] = [
  { label: 'Same day', test: (d) => d === 0 },
  { label: '1 day before', test: (d) => d === 1 },
  { label: '2 to 3 days', test: (d) => d >= 2 && d <= 3 },
  { label: '4 to 7 days', test: (d) => d >= 4 && d <= 7 },
  { label: '8 to 14 days', test: (d) => d >= 8 && d <= 14 },
  { label: '15 days or more', test: (d) => d >= 15 },
];

export const PAY_LABEL: Record<string, string> = { cash: 'Cash', bank: 'Bank transfer', card: 'Card', wallet: 'Mobile wallet', counter: 'Pay at counter', bus: 'Pay on the bus', free: 'Free trip' };
export const CHANNEL_LABEL: Record<string, string> = { online: 'Online', counter: 'Counter', phone: 'Phone' };
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** 0 = Monday … 6 = Sunday */
export const weekdayIndex = (date: string) => (parseISODate(date).getDay() + 6) % 7;

// ------------------------------------------------------------ income sources
/** Counts as money received: paid, or (older / demo records with no payment status) a live booking that isn't a hold. */
export const isPaidBooking = (b: Booking) => b.status !== 'cancelled' && (b.paymentStatus === 'paid' || (b.paymentStatus === undefined && b.status !== 'held'));

/**
 * How the money for a booking reached the company. `roleOf` gives the role of
 * the staff member who recorded a cash payment, which is how cash taken by a
 * conductor on the bus is told apart from cash taken at the office.
 */
export function incomeSource(b: Booking, roleOf: (userId: string) => string | undefined): string {
  const m = b.paymentMethod;
  if (m === 'bank') return 'Bank transfer';
  if (m === 'card' || m === 'wallet') return 'Card / wallet online';
  if (m === 'cash' || m === undefined) {
    if (b.channel === 'counter') return 'Counter sales (cash)';
    if (b.channel === 'phone') return 'Phone sales (cash)';
    if (m === undefined) return 'Online payment';
    const role = b.paidBy ? roleOf(b.paidBy) : undefined;
    if (role === 'conductor') return 'Collected on the bus (conductor)';
    if (role) return 'Paid at the counter for an online booking';
    return 'Cash for online bookings';
  }
  return PAY_LABEL[m] ?? 'Other';
}

/** Seat ids in a sensible order: 2 before 10, 3A before 3B. */
export const seatOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
