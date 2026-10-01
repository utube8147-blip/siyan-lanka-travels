'use client';
// lib/store.tsx
// ---------------------------------------------------------------------------
// Demo data layer. Holds buses, routes, schedules and bookings in React state
// and saves them to localStorage, so the passenger site and the /admin
// dashboard share one "database" in this browser: add a bus or a departure in
// /admin and it shows up in search; book a seat and it shows in the manifest.
//
// When you move to a real backend (e.g. Supabase), keep the action names and
// swap each body for an API call — pages only talk to useStore().
// ---------------------------------------------------------------------------

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionResult, Booking, BookingResult, Bus, NewBooking, Route, Schedule, StoreData } from './types';
import { createSeedData, SEED_BUSES, SEED_ROUTES, SEED_SCHEDULES, STORE_VERSION } from './seed';
import { addDays, bikeSpacesFor, bikeSpacesUsed, genId, genRef, isLiveBooking, takenSeats, todayISO } from './trips';
import { friendlyError, isSupabaseConfigured, supabase } from './supabase/client';
import { bookingFromRow, busFromRow, busToRow, routeFromRow, routeToRow, scheduleFromRow, scheduleToRow } from './supabase/mappers';
import { isStaffRole, useAuth } from '@/contexts/AuthContext';
import { uuid } from '@/lib/uuid';

const STORAGE_KEY = 'vivid-demo-data';

interface StoreContextValue {
  data: StoreData;
  ready: boolean;
  /** 'supabase' when connected to the database, 'demo' when using local sample data. */
  mode: 'supabase' | 'demo';
  /** Set when the database can't be reached or isn't set up. */
  error: string | null;
  saveBus: (bus: Bus) => Promise<ActionResult>;
  deleteBus: (id: string) => Promise<ActionResult>;
  saveRoute: (route: Route) => Promise<ActionResult>;
  deleteRoute: (id: string) => Promise<ActionResult>;
  saveSchedule: (schedule: Schedule) => Promise<ActionResult>;
  deleteSchedule: (id: string) => Promise<ActionResult>;
  createBooking: (b: NewBooking) => Promise<BookingResult>;
  updateBooking: (id: string, patch: Partial<Booking>) => Promise<ActionResult>;
  /** Staff: take payment for a held (unpaid) booking. */
  confirmPayment: (id: string, method: 'cash' | 'bank' | 'card' | 'wallet', ref?: string) => Promise<ActionResult>;
  /** Demo mode only. */
  resetDemo: () => void;
  /** Re-read data (pull-to-refresh, after changes elsewhere). */
  reload: () => void;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

// First render (server + first client frame) uses the static timetable with no
// bookings, so search engines see real routes/stops; live data loads after.
const EMPTY: StoreData = { version: STORE_VERSION, buses: SEED_BUSES, routes: SEED_ROUTES, schedules: SEED_SCHEDULES, bookings: [] };

// ============================================================ demo storage ===
function loadLocal(): StoreData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed && parsed.version === STORE_VERSION && Array.isArray(parsed.buses)) {
        // Release unpaid holds whose time is up.
        const now = Date.now();
        parsed.bookings = parsed.bookings.map((b) =>
          b.status === 'held' && b.holdExpiresAt && new Date(b.holdExpiresAt).getTime() < now ? { ...b, status: 'cancelled' as const } : b,
        );
        return parsed;
      }
    }
  } catch {
    /* corrupted or blocked storage — fall through to seed */
  }
  return createSeedData();
}

// ================================================================ supabase ===
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Seat and bike availability for everyone, without personal data: the public
 * seat map (booking_seats) and bike usage are turned into anonymous
 * placeholder bookings so the trip maths in lib/trips.ts works unchanged.
 */
function availabilityBookings(seats: any[], bikeUsage: any[], visible: Booking[]): Booking[] {
  const out: Booking[] = [];
  const groups = new Map<string, { scheduleId: string; date: string; gender: string; seats: string[] }>();
  for (const r of seats ?? []) {
    const key = `${r.schedule_id}|${r.travel_date}|${r.gender}`;
    const g = groups.get(key) ?? { scheduleId: r.schedule_id, date: r.travel_date, gender: r.gender, seats: [] as string[] };
    g.seats.push(r.seat);
    groups.set(key, g);
  }
  const blank = { from: '', to: '', ref: '', contact: { email: '', phone: '' }, channel: 'online' as const, fare: 0, fee: 0, discount: 0, total: 0, status: 'confirmed' as const, createdAt: '' };
  for (const [key, g] of groups) {
    out.push({ ...blank, id: `avail-${key}`, scheduleId: g.scheduleId, date: g.date, seats: g.seats, passenger: { name: '', gender: g.gender as Booking['passenger']['gender'], phone: '' } });
  }
  for (const u of bikeUsage ?? []) {
    const mine = bikeSpacesUsed(visible, u.schedule_id, u.travel_date);
    const others = Math.max(0, (u.spaces ?? 0) - mine);
    if (!others) continue;
    out.push({
      ...blank,
      id: `avail-bikes-${u.schedule_id}|${u.travel_date}`,
      scheduleId: u.schedule_id,
      date: u.travel_date,
      seats: [],
      passenger: { name: '', gender: '', phone: '' },
      bikes: Array.from({ length: others }, (_, i) => ({ id: `b${i}`, kind: 'bicycle' as const, description: '', regNo: '', photo: '', fee: 0 })),
    });
  }
  return out;
}

async function fetchRemote(userId: string | null, staff: boolean): Promise<StoreData> {
  const sb = supabase();
  await sb.rpc('release_expired_holds'); // free seats from unpaid holds that ran out
  const today = todayISO();
  const from = addDays(today, -2);
  const to = addDays(today, 120);
  const [buses, routes, schedules, seats, bikes] = await Promise.all([
    sb.from('buses').select('*').order('created_at'),
    sb.from('routes').select('*').order('created_at'),
    sb.from('schedules').select('*').order('departure'),
    sb.from('booking_seats').select('schedule_id, travel_date, seat, gender').eq('active', true).gte('travel_date', from).lte('travel_date', to),
    sb.rpc('get_bike_usage', { p_from: from, p_to: to }),
  ]);
  const firstError = buses.error || routes.error || schedules.error || seats.error || bikes.error;
  if (firstError) throw firstError;

  let rows: any[] = [];
  if (userId) {
    let q = sb.from('bookings').select('*, booking_bikes(*)').order('travel_date');
    q = staff ? q.gte('travel_date', addDays(today, -180)) : q.eq('user_id', userId);
    const res = await q;
    if (res.error) throw res.error;
    rows = res.data ?? [];
  }
  // Bike photos are private: short-lived signed links for the owner / staff.
  const paths = rows.flatMap((r) => (r.booking_bikes ?? []).map((b: any) => b.photo_path).filter(Boolean));
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await sb.storage.from('bike-photos').createSignedUrls(paths, 60 * 60);
    data?.forEach((d) => {
      if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
    });
  }
  const visible = rows.map((r) => bookingFromRow(r, urls));
  return {
    version: STORE_VERSION,
    buses: (buses.data ?? []).map(busFromRow),
    routes: (routes.data ?? []).map(routeFromRow),
    schedules: (schedules.data ?? []).map(scheduleFromRow),
    // Staff already see every booking; passengers get anonymous availability.
    bookings: staff ? visible : [...visible, ...availabilityBookings(seats.data ?? [], bikes.data ?? [], visible)],
  };
}

async function uploadBikePhoto(userId: string, dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${uuid()}.jpg`;
  const { error } = await supabase().storage.from('bike-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

// ================================================================ provider ===
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const mode: 'supabase' | 'demo' = isSupabaseConfigured ? 'supabase' : 'demo';
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const staff = isStaffRole(user?.role);
  const [data, setData] = useState<StoreData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const refresh = useCallback(async () => {
    if (mode === 'demo') {
      setData(loadLocal());
      setReady(true);
      return;
    }
    try {
      const next = await fetchRemote(userId, staff);
      setData(next);
      setError(null);
    } catch (e) {
      setError(friendlyError(e as { message?: string }, "Couldn't reach the booking database."));
    } finally {
      setReady(true);
    }
  }, [mode, userId, staff]);

  // Load after mount (and again when the signed-in user changes).
  useEffect(() => {
    if (mode === 'supabase' && authLoading) return;
    refresh();
  }, [mode, authLoading, refresh]);

  // Demo: persist to this browser and sync between tabs.
  useEffect(() => {
    if (mode !== 'demo' || !ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage full or disabled */
    }
  }, [mode, data, ready]);
  useEffect(() => {
    if (mode !== 'demo') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setData(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [mode]);

  // Supabase: live seat map. Any seat change → refetch (debounced).
  useEffect(() => {
    if (mode !== 'supabase' || authLoading) return;
    const sb = supabase();
    let t: ReturnType<typeof setTimeout>;
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(refresh, 400);
    };
    const ch = sb.channel('live-seats').on('postgres_changes', { event: '*', schema: 'public', table: 'booking_seats' }, bump);
    if (staff) ch.on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, bump);
    ch.subscribe();
    return () => {
      clearTimeout(t);
      sb.removeChannel(ch);
    };
  }, [mode, authLoading, staff, refresh]);

  const upsert = <T extends { id: string }>(list: T[], item: T) =>
    list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

  // ---- timetable (staff) ----------------------------------------------------
  const remoteWrite = useCallback(
    async (op: () => PromiseLike<{ error: { message?: string } | null }>): Promise<ActionResult> => {
      const { error: err } = await op();
      if (err) return { ok: false, reason: friendlyError(err) };
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const saveBus = useCallback<StoreContextValue['saveBus']>(
    async (bus) => {
      if (mode === 'supabase') return remoteWrite(() => supabase().from('buses').upsert(busToRow(bus)));
      setData((d) => ({ ...d, buses: upsert(d.buses, bus) }));
      return { ok: true };
    },
    [mode, remoteWrite],
  );
  const saveRoute = useCallback<StoreContextValue['saveRoute']>(
    async (route) => {
      if (mode === 'supabase') return remoteWrite(() => supabase().from('routes').upsert(routeToRow(route)));
      setData((d) => ({ ...d, routes: upsert(d.routes, route) }));
      return { ok: true };
    },
    [mode, remoteWrite],
  );
  const saveSchedule = useCallback<StoreContextValue['saveSchedule']>(
    async (schedule) => {
      if (mode === 'supabase') return remoteWrite(() => supabase().from('schedules').upsert(scheduleToRow(schedule)));
      setData((d) => ({ ...d, schedules: upsert(d.schedules, schedule) }));
      return { ok: true };
    },
    [mode, remoteWrite],
  );

  const deleteBus = useCallback<StoreContextValue['deleteBus']>(
    async (id) => {
      const used = dataRef.current.schedules.filter((s) => s.busId === id);
      if (used.length) return { ok: false, reason: `This bus runs ${used.length} departure(s). Reassign or delete those first.` };
      if (mode === 'supabase') return remoteWrite(() => supabase().from('buses').delete().eq('id', id));
      setData((prev) => ({ ...prev, buses: prev.buses.filter((b) => b.id !== id) }));
      return { ok: true };
    },
    [mode, remoteWrite],
  );
  const deleteRoute = useCallback<StoreContextValue['deleteRoute']>(
    async (id) => {
      const used = dataRef.current.schedules.filter((s) => s.routeId === id);
      if (used.length) return { ok: false, reason: `This route has ${used.length} departure(s). Delete those first.` };
      if (mode === 'supabase') return remoteWrite(() => supabase().from('routes').delete().eq('id', id));
      setData((prev) => ({ ...prev, routes: prev.routes.filter((r) => r.id !== id) }));
      return { ok: true };
    },
    [mode, remoteWrite],
  );
  const deleteSchedule = useCallback<StoreContextValue['deleteSchedule']>(
    async (id) => {
      const today = todayISO();
      const upcoming = dataRef.current.bookings.filter((b) => b.scheduleId === id && b.status === 'confirmed' && b.date >= today && !b.id.startsWith('avail-'));
      if (upcoming.length)
        return { ok: false, reason: `${upcoming.length} upcoming booking(s) are on this departure. Pause it instead, or cancel those bookings first.` };
      if (mode === 'supabase') return remoteWrite(() => supabase().from('schedules').delete().eq('id', id));
      setData((prev) => ({ ...prev, schedules: prev.schedules.filter((s) => s.id !== id) }));
      return { ok: true };
    },
    [mode, remoteWrite],
  );

  // ---- bookings -------------------------------------------------------------
  const createBooking = useCallback<StoreContextValue['createBooking']>(
    async (input) => {
      if (mode === 'supabase') {
        const sb = supabase();
        const { data: sess } = await sb.auth.getSession();
        const uid = sess.session?.user.id;
        if (!uid) return { ok: false, reason: 'Please sign in to book.' };
        try {
          const bikes = await Promise.all(
            (input.bikes ?? []).map(async (b) => ({
              kind: b.kind,
              description: b.description,
              reg_no: b.regNo,
              photo_path: b.photo?.startsWith('data:') ? await uploadBikePhoto(uid, b.photo) : '',
            })),
          );
          const { data: row, error: err } = await sb.rpc('create_booking', {
            p: {
              schedule_id: input.scheduleId,
              date: input.date,
              from: input.from,
              to: input.to,
              seats: input.seats,
              passenger: input.passenger,
              contact: input.contact,
              promo: input.promo ?? '',
              channel: input.channel,
              payment: input.payment,
              use_reward: input.useReward ?? false,
              bikes,
            },
          });
          if (err) return { ok: false, reason: friendlyError(err) };
          await refresh();
          const saved = dataRef.current.bookings.find((b) => b.id === (row as any).id) ?? bookingFromRow(row);
          return { ok: true, booking: saved };
        } catch (e) {
          return { ok: false, reason: friendlyError(e as { message?: string }) };
        }
      }
      // demo
      const d = dataRef.current;
      const taken = takenSeats(d.bookings, input.scheduleId, input.date);
      const clash = input.seats.filter((s) => taken.has(s));
      if (clash.length) return { ok: false, reason: `Seat ${clash.join(', ')} was just booked by someone else.` };
      if (input.bikes?.length) {
        const schedule = d.schedules.find((s) => s.id === input.scheduleId);
        const bus = d.buses.find((b) => b.id === schedule?.busId);
        const need = input.bikes.reduce((n, b) => n + bikeSpacesFor(b.kind), 0);
        const left = (bus?.bikeSpaces ?? 0) - bikeSpacesUsed(d.bookings, input.scheduleId, input.date);
        if (need > left) return { ok: false, reason: 'The luggage compartment just filled up for this departure.' };
      }
      const { promo: _promo, payment, useReward: _reward, ...rest } = input;
      void _promo;
      void _reward;
      const held = input.channel === 'online' && (payment === 'bank' || payment === 'counter');
      const booking: Booking = {
        ...rest,
        id: genId('bk'),
        ref: genRef(),
        status: held ? 'held' : input.status ?? 'confirmed',
        paymentMethod: payment ?? (input.channel === 'online' ? 'card' : 'cash'),
        paymentStatus: held ? 'unpaid' : 'paid',
        holdExpiresAt: held ? new Date(Date.now() + (payment === 'bank' ? 24 * 60 : 120) * 60_000).toISOString() : null,
        createdAt: new Date().toISOString(),
      };
      const next = { ...d, bookings: [...d.bookings, booking] };
      dataRef.current = next;
      setData(next);
      return { ok: true, booking };
    },
    [mode, refresh],
  );

  const updateBooking = useCallback<StoreContextValue['updateBooking']>(
    async (id, patch) => {
      if (mode === 'supabase') {
        const sb = supabase();
        let res: { error: { message?: string } | null };
        if (patch.status === 'cancelled') res = await sb.rpc('cancel_booking', { p_id: id });
        else if (patch.seats || patch.date) res = await sb.rpc('modify_booking', { p_id: id, p_seats: patch.seats ?? null, p_date: patch.date ?? null });
        else if (patch.status) res = await sb.from('bookings').update({ status: patch.status }).eq('id', id);
        else return { ok: true };
        if (res.error) return { ok: false, reason: friendlyError(res.error) };
        await refresh();
        return { ok: true };
      }
      const d = dataRef.current;
      const current = d.bookings.find((b) => b.id === id);
      if (!current) return { ok: false, reason: 'Booking not found.' };
      const merged = { ...current, ...patch };
      if (patch.seats || patch.date || patch.scheduleId) {
        const taken = takenSeats(d.bookings, merged.scheduleId, merged.date, id);
        const clash = merged.seats.filter((s) => taken.has(s));
        if (clash.length) return { ok: false, reason: `Seat ${clash.join(', ')} is already taken on that departure.` };
      }
      const next = { ...d, bookings: d.bookings.map((b) => (b.id === id ? merged : b)) };
      dataRef.current = next;
      setData(next);
      return { ok: true };
    },
    [mode, refresh],
  );

  const confirmPayment = useCallback<StoreContextValue['confirmPayment']>(
    async (id, method, ref) => {
      if (mode === 'supabase') {
        const { error: err } = await supabase().rpc('confirm_payment', { p_id: id, p_method: method, p_ref: ref ?? null });
        if (err) return { ok: false, reason: friendlyError(err) };
        await refresh();
        return { ok: true };
      }
      const d = dataRef.current;
      const next = { ...d, bookings: d.bookings.map((b) => (b.id === id && b.status === 'held' ? { ...b, status: 'confirmed' as const, paymentStatus: 'paid' as const, paymentMethod: method, holdExpiresAt: null } : b)) };
      dataRef.current = next;
      setData(next);
      return { ok: true };
    },
    [mode, refresh],
  );

  const resetDemo = useCallback(() => {
    if (mode === 'demo') setData(createSeedData());
  }, [mode]);
  const reload = useCallback(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ data, ready, mode, error, saveBus, deleteBus, saveRoute, deleteRoute, saveSchedule, deleteSchedule, createBooking, updateBooking, confirmPayment, resetDemo, reload }),
    [data, ready, mode, error, saveBus, deleteBus, saveRoute, deleteRoute, saveSchedule, deleteSchedule, createBooking, updateBooking, confirmPayment, resetDemo, reload],
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
      {error && (
        <div role="alert" className="fixed z-[130] left-3 right-3 md:left-auto md:right-6 bottom-[calc(84px+env(safe-area-inset-bottom))] md:bottom-6 md:w-[380px] rounded-xl bg-[#ba1a1a] text-white text-[13px] font-medium px-4 py-3 shadow-lg">
          {error}{' '}
          <button onClick={() => refresh()} className="underline font-semibold">
            Retry
          </button>
        </div>
      )}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
}

// keep isLiveBooking imported for consumers of this module's types
void isLiveBooking;

/** Loading skeleton shown while saved data loads (looks like content, not a spinner). */
export function StoreLoading() {
  return <PageSkeleton />;
}

export function PageSkeleton() {
  const bar = 'rounded-lg skeleton';
  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-[64px] py-6 md:py-8 space-y-5" role="status" aria-label="Loading">
      <div className={`${bar} h-7 w-48`} />
      <div className={`${bar} h-4 w-72 max-w-full`} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-[#edeef0] bg-white p-5 space-y-3">
            <div className={`${bar} h-4 w-1/3`} />
            <div className={`${bar} h-6 w-2/3`} />
            <div className={`${bar} h-4 w-1/2`} />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
