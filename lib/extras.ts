'use client';
// lib/extras.ts — data for: rewards, waitlist, in-app notifications, saved
// passengers, live bus location + trip updates, conductor contact, parcel &
// charter requests, daily cash count, and public booking settings.
// Supabase when connected; otherwise kept in this browser (demo).

import { useCallback, useEffect, useState } from 'react';
import { OPERATOR } from '@/config/operator';
import { REWARDS_ENABLED } from './features';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';
import { useStore } from './store';
import { departureDate, genId, getTrip, todayISO, addDays } from './trips';
import type { Booking, Gender } from './types';

type Result = { ok: boolean; reason?: string };

// ------------------------------------------------------------- local table ---
function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  } catch {
    /* ignore */
  }
}
/** Re-render when another tab (or this one) changes a demo key. */
function useLocalKey<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(fallback);
  useEffect(() => {
    setV(readLocal(key, fallback));
    const on = (e: StorageEvent) => e.key === key && setV(readLocal(key, fallback));
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [v, (x: T) => { setV(x); writeLocal(key, x); }];
}

// ------------------------------------------------------- public settings ---
export interface PublicSettings {
  bookingFee: number;
  /** Current promo code (null = none) and its percent off the fare. */
  promoCode: string | null;
  promoPercent: number;
  /** A one-time code is asked for on every online booking. */
  bookingOtp: boolean;
  /** Card / mobile wallet can be chosen at checkout (off until the gateway is live). */
  cardPayments: boolean;
  /** "Pay on the bus" (cash to the conductor) can be chosen at checkout. */
  payOnBus: boolean;
  paymentsMode: 'demo' | 'payhere';
  bankDetails: string;
  holdMinutesCounter: number;
  holdMinutesBank: number;
  rewardEvery: number;
}
const DEFAULT_PUBLIC: PublicSettings = {
  bookingFee: OPERATOR.bookingFee,
  promoCode: OPERATOR.promo.code,
  promoPercent: OPERATOR.promo.percentOff,
  bookingOtp: false,
  cardPayments: false,
  payOnBus: true,
  paymentsMode: 'demo',
  bankDetails: 'Bank of Ceylon, Pettah branch · A/C 0077411020 · Siyan Lanka Travels',
  holdMinutesCounter: 120,
  holdMinutesBank: 1440,
  rewardEvery: 10,
};
export function usePublicSettings() {
  const [s, setS] = useState<PublicSettings>(DEFAULT_PUBLIC);
  useEffect(() => {
    if (!DB) return;
    supabase()
      .from('app_settings')
      .select('booking_fee, promo_code, promo_percent, booking_otp, card_payments, pay_on_bus, payments_mode, bank_details, hold_minutes_counter, hold_minutes_bank, reward_every')
      .maybeSingle()
      .then(({ data }) => {
        if (data)
          setS({
            bookingFee: data.booking_fee,
            promoCode: data.promo_code || null,
            promoPercent: data.promo_percent ?? 0,
            bookingOtp: data.booking_otp !== false,
            cardPayments: data.card_payments === true,
            payOnBus: data.pay_on_bus !== false,
            paymentsMode: data.payments_mode,
            bankDetails: data.bank_details || DEFAULT_PUBLIC.bankDetails,
            holdMinutesCounter: data.hold_minutes_counter,
            holdMinutesBank: data.hold_minutes_bank,
            rewardEvery: data.reward_every,
          });
      });
  }, []);
  return s;
}

// ----------------------------------------------------------------- rewards ---
export interface Loyalty { trips: number; every: number; available: number; nextIn: number }
const completed = (b: Booking) => b.status === 'boarded' || (b.status === 'confirmed' && b.date < todayISO());

export function useLoyalty(userId?: string | null): Loyalty | null {
  const { data, ready } = useStore();
  const [remote, setRemote] = useState<Loyalty | null>(null);
  useEffect(() => {
    if (!REWARDS_ENABLED || !DB || !userId) return;
    supabase()
      .rpc('loyalty_status')
      .then(({ data: rows }) => {
        const r = (rows as { trips: number; every: number; available: number; next_in: number }[] | null)?.[0];
        if (r) setRemote({ trips: r.trips, every: r.every, available: r.available, nextIn: r.next_in });
      });
  }, [userId, data.bookings.length]);
  if (!REWARDS_ENABLED || !userId) return null;
  if (DB) return remote;
  if (!ready) return null;
  const mine = data.bookings.filter((b) => b.userId === userId);
  const trips = mine.filter(completed).length;
  const every = 10;
  const used = mine.filter((b) => b.rewardUsed && b.status !== 'cancelled').length;
  return { trips, every, available: Math.max(0, Math.floor(trips / every) - used), nextIn: every - (trips % every) };
}

// ---------------------------------------------------------------- waitlist ---
export interface WaitlistEntry {
  id: string; scheduleId: string; date: string; from: string; to: string; seats: number; phone: string;
  status: 'waiting' | 'offered' | 'booked' | 'cancelled' | 'expired'; createdAt: string;
}
const WL_KEY = 'demo-waitlist';

export function useWaitlist(userId?: string | null) {
  const { data } = useStore();
  const [remote, setRemote] = useState<WaitlistEntry[]>([]);
  const [local, setLocal] = useLocalKey<WaitlistEntry[]>(WL_KEY, []);
  const load = useCallback(async () => {
    if (!DB || !userId) return;
    const { data: rows } = await supabase().from('waitlist').select('*').in('status', ['waiting', 'offered']).order('travel_date');
    setRemote(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((rows as any[]) ?? []).map((r) => ({ id: r.id, scheduleId: r.schedule_id, date: r.travel_date, from: r.from_stop, to: r.to_stop, seats: r.seats, phone: r.phone, status: r.status, createdAt: r.created_at })),
    );
  }, [userId]);
  useEffect(() => {
    load();
  }, [load, data.bookings.length]);

  // Demo: an entry becomes "offered" once enough seats are free.
  const entries = DB
    ? remote
    : local
        .filter((w) => w.status === 'waiting' || w.status === 'offered')
        .map((w) => {
          const t = getTrip(data, w.scheduleId, w.date, w.from, w.to);
          return t && t.seatsLeft >= w.seats ? { ...w, status: 'offered' as const } : w;
        });

  const join = async (e: Omit<WaitlistEntry, 'id' | 'status' | 'createdAt'>): Promise<Result> => {
    if (DB) {
      const { error } = await supabase().from('waitlist').insert({
        schedule_id: e.scheduleId, travel_date: e.date, from_stop: e.from, to_stop: e.to, seats: e.seats, phone: e.phone,
      });
      if (error) return { ok: false, reason: /duplicate|unique/.test(error.message) ? "You're already on the waitlist for this bus." : friendlyError(error) };
      await load();
      return { ok: true };
    }
    if (local.some((w) => w.scheduleId === e.scheduleId && w.date === e.date && (w.status === 'waiting' || w.status === 'offered')))
      return { ok: false, reason: "You're already on the waitlist for this bus." };
    setLocal([...local, { ...e, id: genId('wl'), status: 'waiting', createdAt: new Date().toISOString() }]);
    return { ok: true };
  };
  const leave = async (id: string, status: 'cancelled' | 'booked' = 'cancelled'): Promise<Result> => {
    if (DB) {
      const { error } = await supabase().from('waitlist').update({ status }).eq('id', id);
      if (error) return { ok: false, reason: friendlyError(error) };
      await load();
      return { ok: true };
    }
    setLocal(local.map((w) => (w.id === id ? { ...w, status } : w)));
    return { ok: true };
  };
  return { entries, join, leave };
}

// ----------------------------------------------------------- notifications ---
export interface AppNotification { id: string; title: string; body: string; url: string; createdAt: string; readAt?: string | null }
export function useNotifications(userId?: string | null) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const load = useCallback(async () => {
    if (!DB || !userId) return;
    const { data } = await supabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(30);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setItems(((data as any[]) ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, url: n.url, createdAt: n.created_at, readAt: n.read_at })));
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);
  const markRead = async (id: string) => {
    if (!DB) return;
    await supabase().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
    load();
  };
  return { items, unread: items.filter((n) => !n.readAt), markRead, reload: load };
}

// ---------------------------------------------------------- saved people ---
export interface SavedPassenger { name: string; gender: Gender; phone: string }
const SP_KEY = 'demo-saved-passengers';
export function useSavedPassengers(userId?: string | null) {
  const [list, setList] = useState<SavedPassenger[]>([]);
  useEffect(() => {
    if (!userId) return setList([]);
    if (!DB) return setList(readLocal(SP_KEY, [] as SavedPassenger[]));
    supabase()
      .from('profiles')
      .select('saved_passengers')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setList((data?.saved_passengers as SavedPassenger[]) ?? []));
  }, [userId]);
  /** Remember a passenger (newest first, max 6, no duplicates by name). */
  const remember = async (p: SavedPassenger) => {
    if (!userId || !p.name.trim()) return;
    const next = [p, ...list.filter((x) => x.name.trim().toLowerCase() !== p.name.trim().toLowerCase())].slice(0, 6);
    setList(next);
    if (DB) await supabase().from('profiles').update({ saved_passengers: next }).eq('id', userId);
    else writeLocal(SP_KEY, next);
  };
  const forget = async (name: string) => {
    const next = list.filter((x) => x.name !== name);
    setList(next);
    if (DB && userId) await supabase().from('profiles').update({ saved_passengers: next }).eq('id', userId);
    else writeLocal(SP_KEY, next);
  };
  return { list, remember, forget };
}

// --------------------------------------------------------------- live trip ---
export interface BusLocation { lat: number; lng: number; speedKmh?: number | null; heading?: number | null; updatedAt: string }
export interface TripEvent { id: string; kind: 'departed' | 'delayed' | 'arriving' | 'arrived' | 'note'; stop: string; minutes?: number | null; message: string; createdAt: string }
const liveKey = (s: string, d: string) => `demo-live:${s}:${d}`;

/** Where the bus is and its latest updates, live. */
export function useLiveTrip(scheduleId?: string, date?: string) {
  const [loc, setLoc] = useState<BusLocation | null>(null);
  const [events, setEvents] = useState<TripEvent[]>([]);
  useEffect(() => {
    if (!scheduleId || !date) return;
    if (!DB) {
      const read = () => {
        const v = readLocal<{ loc: BusLocation | null; events: TripEvent[] }>(liveKey(scheduleId, date), { loc: null, events: [] });
        setLoc(v.loc);
        setEvents(v.events);
      };
      read();
      const on = (e: StorageEvent) => e.key === liveKey(scheduleId, date) && read();
      window.addEventListener('storage', on);
      return () => window.removeEventListener('storage', on);
    }
    const sb = supabase();
    const load = async () => {
      const [l, e] = await Promise.all([
        sb.from('bus_locations').select('*').eq('schedule_id', scheduleId).eq('travel_date', date).maybeSingle(),
        sb.from('trip_events').select('*').eq('schedule_id', scheduleId).eq('travel_date', date).order('created_at', { ascending: false }).limit(10),
      ]);
      if (l.data) setLoc({ lat: l.data.lat, lng: l.data.lng, speedKmh: l.data.speed_kmh, heading: l.data.heading, updatedAt: l.data.updated_at });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setEvents(((e.data as any[]) ?? []).map((x) => ({ id: x.id, kind: x.kind, stop: x.stop, minutes: x.minutes, message: x.message, createdAt: x.created_at })));
    };
    load();
    const ch = sb
      .channel(`live-${scheduleId}-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bus_locations', filter: `schedule_id=eq.${scheduleId}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_events', filter: `schedule_id=eq.${scheduleId}` }, load)
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [scheduleId, date]);
  return { location: loc, events };
}

/** Staff: share this phone's location for a departure + post updates. */
export async function shareLocation(scheduleId: string, date: string, pos: GeolocationPosition): Promise<Result> {
  const row = { lat: pos.coords.latitude, lng: pos.coords.longitude, speedKmh: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : null, heading: pos.coords.heading, updatedAt: new Date().toISOString() };
  if (!DB) {
    const v = readLocal<{ loc: BusLocation | null; events: TripEvent[]; trail?: BusLocation[] }>(liveKey(scheduleId, date), { loc: null, events: [] });
    writeLocal(liveKey(scheduleId, date), { ...v, loc: row, trail: [row, ...(v.trail ?? [])].slice(0, 5) });
    return { ok: true };
  }
  const { error } = await supabase().from('bus_locations').upsert({
    schedule_id: scheduleId, travel_date: date, lat: row.lat, lng: row.lng, speed_kmh: row.speedKmh, heading: row.heading,
    accuracy_m: pos.coords.accuracy, updated_at: row.updatedAt,
  });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}

export async function postTripEvent(scheduleId: string, date: string, ev: Omit<TripEvent, 'id' | 'createdAt'>): Promise<Result> {
  if (!DB) {
    const v = readLocal<{ loc: BusLocation | null; events: TripEvent[] }>(liveKey(scheduleId, date), { loc: null, events: [] });
    writeLocal(liveKey(scheduleId, date), { ...v, events: [{ ...ev, id: genId('ev'), createdAt: new Date().toISOString() }, ...v.events].slice(0, 20) });
    return { ok: true };
  }
  const { error } = await supabase().from('trip_events').insert({ schedule_id: scheduleId, travel_date: date, kind: ev.kind, stop: ev.stop, minutes: ev.minutes ?? null, message: ev.message });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}

/** Rough distance in km between two points. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// -------------------------------------------------------- conductor contact ---
export function useTripContact(booking?: Booking | null) {
  const [c, setC] = useState<{ name: string; role: string; phone: string } | null>(null);
  useEffect(() => {
    if (!booking) return;
    const near = Math.abs(new Date(`${booking.date}T00:00`).getTime() - new Date(`${todayISO()}T00:00`).getTime()) <= 86_400_000;
    if (!near) return setC(null);
    if (!DB) return setC({ name: 'Suresh Kumar', role: 'conductor', phone: '+94 71 553 9087' });
    supabase()
      .rpc('get_trip_contact', { p_booking: booking.id })
      .then(({ data }) => setC(((data as { name: string; role: string; phone: string }[]) ?? [])[0] ?? null));
  }, [booking]);
  return c;
}

// ------------------------------------------------------ parcels & charters ---
export type RequestKind = 'parcel' | 'charter';
export interface ServiceRequest {
  id: string; kind: RequestKind; status: 'new' | 'quoted' | 'confirmed' | 'done' | 'cancelled'; name: string; phone: string; email: string;
  details: Record<string, string | number>; quoteAmount?: number | null; staffNotes: string; createdAt: string;
}
const RQ_KEY = 'demo-service-requests';
export async function submitRequest(kind: RequestKind, r: { name: string; phone: string; email: string; details: Record<string, string | number> }): Promise<Result> {
  if (!DB) {
    const list = readLocal<ServiceRequest[]>(RQ_KEY, []);
    writeLocal(RQ_KEY, [{ ...r, kind, id: genId('rq'), status: 'new', staffNotes: '', createdAt: new Date().toISOString() }, ...list]);
    return { ok: true };
  }
  const { data: s } = await supabase().auth.getSession();
  const { error } = await supabase().from('service_requests').insert({ kind, name: r.name, phone: r.phone, email: r.email, details: r.details, user_id: s.session?.user.id ?? null });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}
export function useServiceRequests() {
  const [remote, setRemote] = useState<ServiceRequest[]>([]);
  const [local, setLocal] = useLocalKey<ServiceRequest[]>(RQ_KEY, []);
  const load = useCallback(async () => {
    if (!DB) return;
    const { data } = await supabase().from('service_requests').select('*').order('created_at', { ascending: false }).limit(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRemote(((data as any[]) ?? []).map((r) => ({ id: r.id, kind: r.kind, status: r.status, name: r.name, phone: r.phone, email: r.email, details: r.details, quoteAmount: r.quote_amount, staffNotes: r.staff_notes, createdAt: r.created_at })));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const update = async (id: string, patch: Partial<Pick<ServiceRequest, 'status' | 'quoteAmount' | 'staffNotes'>>): Promise<Result> => {
    if (!DB) {
      setLocal(local.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return { ok: true };
    }
    const { error } = await supabase()
      .from('service_requests')
      .update({ ...(patch.status ? { status: patch.status } : {}), ...(patch.quoteAmount !== undefined ? { quote_amount: patch.quoteAmount } : {}), ...(patch.staffNotes !== undefined ? { staff_notes: patch.staffNotes } : {}), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, reason: friendlyError(error) };
    await load();
    return { ok: true };
  };
  return { requests: DB ? remote : local, update, reload: load };
}

// --------------------------------------------------------------- cash count ---
export interface CashCount { id: string; date: string; expected: number; counted: number; notes: string; createdAt: string; /** Who closed it (shown to the super admin). */ by?: string; mine?: boolean; /** Set when a conductor closed one departure and not a whole day. */ scheduleId?: string | null }

/** What one staff member should be holding for a day: cash they took, less cash refunds they paid out. Worked out by the database. */
export interface CashSummary {
  expected: number;
  taken: { ref: string; name: string; seats: string[]; from: string; to: string; amount: number; at: string; where: string }[];
  refunds: { ref: string; name: string; amount: number; at: string }[];
}
/** `scheduleId` given: the cash for that departure (travel date `date`). Otherwise: cash taken on `date`. */
export function useCashSummary(date: string, scheduleId: string | null, refreshKey: unknown) {
  const [summary, setSummary] = useState<CashSummary | null>(null);
  useEffect(() => {
    if (!DB) return;
    let live = true;
    supabase()
      .rpc('cash_summary', { p_date: date, p_schedule: scheduleId })
      .then(({ data }) => live && setSummary((data as CashSummary) ?? null));
    return () => {
      live = false;
    };
  }, [date, scheduleId, refreshKey]);
  return summary;
}
const CC_KEY = 'demo-cash-counts';
export function useCashCounts() {
  const [remote, setRemote] = useState<CashCount[]>([]);
  const [local, setLocal] = useLocalKey<CashCount[]>(CC_KEY, []);
  const load = useCallback(async () => {
    if (!DB) return;
    const { data: me } = await supabase().auth.getSession();
    const { data } = await supabase().from('cash_counts').select('*, profiles(full_name)').order('count_date', { ascending: false }).order('created_at', { ascending: false }).limit(120);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRemote(((data as any[]) ?? []).map((c) => ({ id: c.id, date: c.count_date, expected: c.expected, counted: c.counted, notes: c.notes, createdAt: c.created_at, by: c.profiles?.full_name || 'Staff', mine: c.created_by === me.session?.user.id, scheduleId: c.schedule_id ?? null })));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const save = async (c: Omit<CashCount, 'id' | 'createdAt'>): Promise<Result> => {
    if (!DB) {
      if (local.some((x) => x.date === c.date && (x.scheduleId ?? null) === (c.scheduleId ?? null))) return { ok: false, reason: 'You already closed this.' };
      setLocal([{ ...c, id: genId('cc'), createdAt: new Date().toISOString() }, ...local]);
      return { ok: true };
    }
    const { error } = await supabase().from('cash_counts').insert({ count_date: c.date, schedule_id: c.scheduleId ?? null, expected: c.expected, counted: c.counted, notes: c.notes });
    if (error) return { ok: false, reason: /duplicate|unique/.test(error.message) ? 'You already closed this.' : friendlyError(error) };
    await load();
    return { ok: true };
  };
  return { counts: DB ? remote : local, save };
}

// ---------------------------------------------------------------- helpers ---
/** Departure time at the passenger's stop for a booking (Date), or null. */
export function boardingTime(booking: Booking, data: ReturnType<typeof useStore>['data']) {
  const t = getTrip(data, booking.scheduleId, booking.date, booking.from, booking.to);
  return t ? departureDate(t.boardingDate, t.departure) : null;
}

/** WhatsApp share link with the ticket summary. */
export function whatsappShareUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export const SITE = OPERATOR.siteUrl;
export { addDays };
