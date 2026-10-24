'use client';
// lib/conductor.ts — what the conductor app's Map tab needs:
//   - road reports (police, checkpoints, accidents…) shared by every conductor
//   - this phone's position
//   - optional ("on request") stops: how many have booked and what was decided
//   - tonight's stop list in drop-off order, which the conductor can rearrange

import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';
import { departureDate } from './trips';
import type { Booking, Route, RouteStop } from './types';
import { N_, tx } from '@/lib/i18n';

// ---------------------------------------------------------------- reports ---
export type ReportKind = 'police' | 'checkpoint' | 'accident' | 'roadworks' | 'flood' | 'breakdown' | 'other';
export const REPORT_KINDS: { id: ReportKind; label: string; icon: string; color: string }[] = [
  { id: 'police', label: N_('Traffic police'), icon: '👮', color: '#1d4ed8' },
  { id: 'checkpoint', label: N_('Checkpoint'), icon: '🚧', color: '#7c3aed' },
  { id: 'accident', label: N_('Accident'), icon: '💥', color: '#dc2626' },
  { id: 'roadworks', label: N_('Roadworks'), icon: '🦺', color: '#ea580c' },
  { id: 'flood', label: N_('Flooding'), icon: '🌊', color: '#0891b2' },
  { id: 'breakdown', label: N_('Vehicle stopped on road'), icon: '🚗', color: '#ca8a04' },
  { id: 'other', label: N_('Other'), icon: '⚠️', color: '#475569' },
];
export const kindOf = (k: string) => REPORT_KINDS.find((x) => x.id === k) ?? REPORT_KINDS[REPORT_KINDS.length - 1];

export interface RoadReport {
  id: string;
  kind: ReportKind;
  lat: number;
  lng: number;
  note: string;
  reporterName: string;
  reportedBy: string | null;
  createdAt: string;
  expiresAt: string;
  confirmations: number;
  clearedAt: string | null;
}

const LOCAL = 'demo-road-reports';
const readLocal = (): RoadReport[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) || '[]');
  } catch {
    return [];
  }
};
const writeLocal = (list: RoadReport[]) => {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* ignore */
  }
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): RoadReport => ({
  id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, note: r.note ?? '', reporterName: r.reporter_name ?? '', reportedBy: r.reported_by,
  createdAt: r.created_at, expiresAt: r.expires_at, confirmations: r.confirmations ?? 0, clearedAt: r.cleared_at,
});

export const isLive = (r: RoadReport, now = Date.now()) => !r.clearedAt && new Date(r.expiresAt).getTime() > now;

/** Road reports, refreshed every 30 s. `all` also returns cleared and expired ones from the last 2 days (office list). */
export function useRoadReports({ all = false }: { all?: boolean } = {}) {
  const [reports, setReports] = useState<RoadReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!DB) {
      const list = readLocal();
      setReports(all ? list : list.filter((r) => isLive(r)));
      return;
    }
    let q = supabase().from('road_reports').select('*').order('created_at', { ascending: false }).limit(300);
    q = all ? q.gte('created_at', new Date(Date.now() - 2 * 86400e3).toISOString()) : q.is('cleared_at', null).gt('expires_at', new Date().toISOString());
    const { data, error } = await q;
    if (error) return setError(/road_reports|schema cache/.test(error.message) ? tx('Road reports need the latest database update: run migration 36.') : friendlyError(error));
    setError(null);
    setReports((data ?? []).map(fromRow));
  }, [all]);
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
  return { reports, error, reload: load };
}

export async function reportRoad(r: { kind: ReportKind; lat: number; lng: number; note: string; scheduleId?: string | null; reporterName: string }): Promise<{ ok: boolean; reason?: string }> {
  if (!DB) {
    const now = Date.now();
    const list = readLocal();
    const near = list.find((x) => isLive(x) && x.kind === r.kind && Math.abs(x.lat - r.lat) < 0.003 && Math.abs(x.lng - r.lng) < 0.003);
    if (near) {
      near.confirmations += 1;
      near.expiresAt = new Date(Math.max(new Date(near.expiresAt).getTime(), now + 3600e3)).toISOString();
      writeLocal(list);
      return { ok: true };
    }
    writeLocal([{ id: `rr-${now.toString(36)}`, kind: r.kind, lat: r.lat, lng: r.lng, note: r.note.trim().slice(0, 200), reporterName: r.reporterName, reportedBy: 'me', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 2 * 3600e3).toISOString(), confirmations: 0, clearedAt: null }, ...list]);
    return { ok: true };
  }
  const { error } = await supabase().rpc('report_road', { p_kind: r.kind, p_lat: r.lat, p_lng: r.lng, p_note: r.note, p_schedule: r.scheduleId ?? null });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}

/** "Still there" keeps it for another hour; "Gone" clears it (yours, the office's, or two people's). */
export async function voteReport(id: string, stillThere: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (!DB) {
    const list = readLocal();
    const r = list.find((x) => x.id === id);
    if (r) {
      if (stillThere) {
        r.confirmations += 1;
        r.expiresAt = new Date(Math.max(new Date(r.expiresAt).getTime(), Date.now() + 3600e3)).toISOString();
      } else r.clearedAt = new Date().toISOString();
      writeLocal(list);
    }
    return { ok: true };
  }
  const { error } = await supabase().rpc('vote_road_report', { p_id: id, p_still_there: stillThere });
  return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
}

// ---------------------------------------------------------------- position ---
export interface Here {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  at: number;
}

/** This phone's position while `on`. */
export function useMyPosition(on: boolean) {
  const [here, setHere] = useState<Here | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!on || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setProblem(null);
        setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), heading: p.coords.heading ?? null, at: p.timestamp });
      },
      (e) => setProblem(e.code === 1 ? tx('Location permission is off for this site') : tx('Looking for GPS signal…')),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);
  return { here, problem };
}

/** Straight-line distance in km. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Warns once per report when the bus comes within `radiusKm` of it: vibration,
 * a system notification when the page is in the background, and the returned
 * list for an on-screen banner.
 */
export function useNearbyAlerts(here: Here | null, reports: RoadReport[], radiusKm = 3) {
  const warned = useRef<Set<string>>(new Set());
  const [near, setNear] = useState<{ report: RoadReport; km: number }[]>([]);
  useEffect(() => {
    if (!here) return setNear([]);
    const list = reports
      .filter((r) => isLive(r))
      .map((r) => ({ report: r, km: kmBetween(here, r) }))
      .filter((x) => x.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
    setNear(list);
    for (const { report, km } of list) {
      if (warned.current.has(report.id)) continue;
      warned.current.add(report.id);
      navigator.vibrate?.([200, 100, 200]);
      const title = tx('{kind} ahead', { kind: tx(kindOf(report.kind).label) });
      const body = tx('About {km} km from the bus.', { km: km.toFixed(1) }) + (report.note ? ` ${report.note}` : '');
      try {
        if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
          navigator.serviceWorker?.ready.then((sw) => sw.showNotification(title, { body, tag: `road-${report.id}` })).catch(() => new Notification(title, { body }));
        }
      } catch {
        /* optional */
      }
    }
  }, [here, reports, radiusKm]);
  return near;
}

// ---------------------------------------------------------- optional stops ---
export interface OptionalStopStatus {
  stop: string;
  minSeats: number;
  seats: number;
  decided: boolean;
  runs: boolean;
  movedTo: string | null;
  cutoff: string | null;
}

export const isOptionalStop = (s: RouteStop) => !!s.optional;

/** Seats booked to or from each optional stop of a departure (works in demo mode from local bookings). */
export async function loadOptionalStatus(route: Route, scheduleId: string, date: string, bookings: Booking[]): Promise<OptionalStopStatus[]> {
  const opt = route.stops.filter(isOptionalStop);
  if (!opt.length) return [];
  if (DB) {
    const { data, error } = await supabase().rpc('optional_stop_status', { p_schedule: scheduleId, p_date: date });
    if (!error && data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map((r) => ({ stop: r.stop, minSeats: r.min_seats, seats: r.seats, decided: r.decided, runs: r.runs, movedTo: r.moved_to, cutoff: r.cutoff }));
    }
  }
  const live = bookings.filter((b) => b.scheduleId === scheduleId && b.date === date && ['confirmed', 'held', 'boarded'].includes(b.status));
  return opt.map((s) => {
    const name = s.name.toLowerCase();
    const seats = live.filter((b) => b.from.toLowerCase() === name || b.to.toLowerCase() === name).reduce((n, b) => n + b.seats.length, 0);
    return { stop: s.name, minSeats: Math.max(1, s.minSeats ?? 1), seats, decided: false, runs: false, movedTo: null, cutoff: null };
  });
}

/**
 * Optional-stop status for one departure, as a hook. Re-checked every minute
 * (other passengers' bookings aren't on this phone), and at once when this
 * phone's own bookings change.
 */
export function useOptionalStatus(route: Route | undefined, scheduleId: string | undefined, date: string | undefined, bookings: Booking[]) {
  const [list, setList] = useState<OptionalStopStatus[]>([]);
  const [tick, setTick] = useState(0);
  const key = bookings.filter((b) => b.scheduleId === scheduleId && b.date === date).map((b) => `${b.id}${b.status}${b.from}${b.to}`).join();
  const hasOptional = !!route?.stops.some(isOptionalStop);
  useEffect(() => {
    if (!hasOptional) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [hasOptional]);
  useEffect(() => {
    if (!route || !scheduleId || !date) return setList([]);
    let gone = false;
    loadOptionalStatus(route, scheduleId, date, bookings).then((l) => !gone && setList((prev) => (JSON.stringify(prev) === JSON.stringify(l) ? prev : l)));
    return () => {
      gone = true;
    };
  }, [route, scheduleId, date, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

/** Whether the road goes to this stop on this trip (main stops always; on-request ones once enough seats are booked). */
export function goesTo(status: OptionalStopStatus[]) {
  return (name: string) => {
    const s = status.find((o) => o.stop.toLowerCase() === name.toLowerCase());
    if (!s) return false;
    const d = detourState(s);
    return d === 'runs' || d === 'likely';
  };
}

/** Whether the bus goes to an optional stop: decided, or (before the cut-off) enough seats so far. */
export function detourState(s: OptionalStopStatus): 'runs' | 'skipped' | 'likely' | 'unlikely' {
  if (s.decided) return s.runs ? 'runs' : 'skipped';
  return s.seats >= s.minSeats ? 'likely' : 'unlikely';
}

// ------------------------------------------------------- tonight's stops ---
export interface PlanStop {
  name: string;
  lat?: number;
  lng?: number;
  offsetMin: number;
  on: number; // seats getting on here
  off: number; // seats getting off here
  optional: boolean;
  detour: ReturnType<typeof detourState> | null;
}

/**
 * The stops the bus actually needs tonight, in route order: where someone gets
 * on or off, plus the first and last stop. Optional stops that are not running
 * are left out.
 */
export function tonightsStops(route: Route, bookings: Booking[], optional: OptionalStopStatus[]): PlanStop[] {
  const live = bookings.filter((b) => ['confirmed', 'held', 'boarded'].includes(b.status));
  return route.stops
    .map((s, i) => {
      const n = s.name.toLowerCase();
      const on = live.filter((b) => b.from.toLowerCase() === n).reduce((k, b) => k + b.seats.length, 0);
      const off = live.filter((b) => b.to.toLowerCase() === n).reduce((k, b) => k + b.seats.length, 0);
      const st = optional.find((o) => o.stop.toLowerCase() === n);
      return { stop: { name: s.name, lat: s.lat, lng: s.lng, offsetMin: s.offsetMin, on, off, optional: !!s.optional, detour: st ? detourState(st) : null }, keep: i === 0 || i === route.stops.length - 1 || on > 0 || off > 0 };
    })
    .filter((x) => x.keep && x.stop.detour !== 'skipped' && x.stop.detour !== 'unlikely')
    .map((x) => x.stop);
}

/** Order saved on this phone for one trip (stop names), or null for route order. */
const orderKey = (scheduleId: string, date: string) => `stop-order:${scheduleId}|${date}`;
export function savedOrder(scheduleId: string, date: string): string[] | null {
  try {
    const v = localStorage.getItem(orderKey(scheduleId, date));
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
export function saveOrder(scheduleId: string, date: string, names: string[] | null) {
  try {
    if (names) localStorage.setItem(orderKey(scheduleId, date), JSON.stringify(names));
    else localStorage.removeItem(orderKey(scheduleId, date));
  } catch {
    /* ignore */
  }
}
export function applyOrder(stops: PlanStop[], names: string[] | null): PlanStop[] {
  if (!names) return stops;
  const pos = new Map(names.map((n, i) => [n.toLowerCase(), i]));
  return [...stops].sort((a, b) => (pos.get(a.name.toLowerCase()) ?? 999) - (pos.get(b.name.toLowerCase()) ?? 999));
}

/**
 * Shortest-looking order for the drop-offs still ahead: from where the bus is,
 * always go to the nearest remaining stop, keeping the last stop last.
 * Stops without a map pin keep their place at the end, in route order.
 */
export function nearestFirst(stops: PlanStop[], from: { lat: number; lng: number } | null): PlanStop[] {
  if (stops.length < 3) return stops;
  const last = stops[stops.length - 1];
  const pinned = stops.slice(0, -1).filter((s) => s.lat != null && s.lng != null);
  const unpinned = stops.slice(0, -1).filter((s) => s.lat == null || s.lng == null);
  const out: PlanStop[] = [];
  let at = from ?? (pinned[0] ? { lat: pinned[0].lat!, lng: pinned[0].lng! } : null);
  const left = [...pinned];
  while (left.length && at) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (kmBetween(at, left[i] as { lat: number; lng: number }) < kmBetween(at, left[best] as { lat: number; lng: number })) best = i;
    const next = left.splice(best, 1)[0];
    out.push(next);
    at = { lat: next.lat!, lng: next.lng! };
  }
  return [...out, ...unpinned, last];
}

/** Minutes until the bus is due at a stop (negative = should have been there). */
export function minutesToStop(date: string, departure: string, offsetMin: number) {
  return Math.round((departureDate(date, departure).getTime() + offsetMin * 60000 - Date.now()) / 60000);
}
