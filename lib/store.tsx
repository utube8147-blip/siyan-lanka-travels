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
import type { Booking, Bus, Route, Schedule, StoreData } from './types';
import { createSeedData, SEED_BUSES, SEED_ROUTES, SEED_SCHEDULES, STORE_VERSION } from './seed';
import { bikeSpacesFor, bikeSpacesUsed, genId, genRef, takenSeats } from './trips';

const STORAGE_KEY = 'vivid-demo-data';

type NewBooking = Omit<Booking, 'id' | 'ref' | 'createdAt' | 'status'> & Partial<Pick<Booking, 'status'>>;

interface StoreContextValue {
  data: StoreData;
  ready: boolean;
  // buses
  saveBus: (bus: Bus) => void;
  deleteBus: (id: string) => { ok: boolean; reason?: string };
  // routes
  saveRoute: (route: Route) => void;
  deleteRoute: (id: string) => { ok: boolean; reason?: string };
  // schedules
  saveSchedule: (schedule: Schedule) => void;
  deleteSchedule: (id: string) => { ok: boolean; reason?: string };
  // bookings
  createBooking: (b: NewBooking) => { ok: true; booking: Booking } | { ok: false; reason: string };
  updateBooking: (id: string, patch: Partial<Booking>) => { ok: boolean; reason?: string };
  resetDemo: () => void;
}

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

function load(): StoreData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed && parsed.version === STORE_VERSION && Array.isArray(parsed.buses)) return parsed;
    }
  } catch {
    /* corrupted or blocked storage — fall through to seed */
  }
  return createSeedData();
}

// First render (server + first client frame) uses the static timetable with no
// bookings, so search engines see real routes/stops; saved data loads after.
const EMPTY: StoreData = { version: STORE_VERSION, buses: SEED_BUSES, routes: SEED_ROUTES, schedules: SEED_SCHEDULES, bookings: [] };

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<StoreData>(EMPTY);
  const [ready, setReady] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Load after mount so server and client render the same first frame.
  useEffect(() => {
    setData(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage full or disabled — demo keeps working in memory */
    }
  }, [data, ready]);

  // Keep several open tabs (passenger + admin) in sync.
  useEffect(() => {
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
  }, []);

  const upsert = <T extends { id: string }>(list: T[], item: T) =>
    list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

  const saveBus = useCallback((bus: Bus) => setData((d) => ({ ...d, buses: upsert(d.buses, bus) })), []);
  const saveRoute = useCallback((route: Route) => setData((d) => ({ ...d, routes: upsert(d.routes, route) })), []);
  const saveSchedule = useCallback(
    (schedule: Schedule) => setData((d) => ({ ...d, schedules: upsert(d.schedules, schedule) })),
    [],
  );

  const deleteBus = useCallback((id: string) => {
    const d = dataRef.current;
    const used = d.schedules.filter((s) => s.busId === id);
    if (used.length) return { ok: false, reason: `This bus runs ${used.length} departure(s). Reassign or delete those first.` };
    setData((prev) => ({ ...prev, buses: prev.buses.filter((b) => b.id !== id) }));
    return { ok: true };
  }, []);

  const deleteRoute = useCallback((id: string) => {
    const d = dataRef.current;
    const used = d.schedules.filter((s) => s.routeId === id);
    if (used.length) return { ok: false, reason: `This route has ${used.length} departure(s). Delete those first.` };
    setData((prev) => ({ ...prev, routes: prev.routes.filter((r) => r.id !== id) }));
    return { ok: true };
  }, []);

  const deleteSchedule = useCallback((id: string) => {
    const d = dataRef.current;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = d.bookings.filter((b) => b.scheduleId === id && b.status === 'confirmed' && b.date >= today);
    if (upcoming.length)
      return { ok: false, reason: `${upcoming.length} upcoming booking(s) are on this departure. Pause it instead, or cancel those bookings first.` };
    setData((prev) => ({ ...prev, schedules: prev.schedules.filter((s) => s.id !== id) }));
    return { ok: true };
  }, []);

  const createBooking = useCallback<StoreContextValue['createBooking']>((input) => {
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
    const booking: Booking = {
      ...input,
      id: genId('bk'),
      ref: genRef(),
      status: input.status ?? 'confirmed',
      createdAt: new Date().toISOString(),
    };
    const next = { ...d, bookings: [...d.bookings, booking] };
    dataRef.current = next;
    setData(next);
    return { ok: true, booking };
  }, []);

  const updateBooking = useCallback((id: string, patch: Partial<Booking>) => {
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
  }, []);

  const resetDemo = useCallback(() => setData(createSeedData()), []);

  const value = useMemo(
    () => ({
      data,
      ready,
      saveBus,
      deleteBus,
      saveRoute,
      deleteRoute,
      saveSchedule,
      deleteSchedule,
      createBooking,
      updateBooking,
      resetDemo,
    }),
    [data, ready, saveBus, deleteBus, saveRoute, deleteRoute, saveSchedule, deleteSchedule, createBooking, updateBooking, resetDemo],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within a StoreProvider');
  return ctx;
}

/** Small full-area spinner used while the store loads from localStorage. */
export function StoreLoading() {
  return (
    <div className="flex items-center justify-center py-32" role="status" aria-label="Loading">
      <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#edeef0] border-t-[#050a44]" />
    </div>
  );
}
