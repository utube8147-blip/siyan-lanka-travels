'use client';
// A shorter stop order when on-request stops are skipped.
//
// A route's stop order is planned around its detours. When on-request stops
// don't fill, the stops after them may be quicker in another order (and the
// bus may end somewhere else). This works that order out from real road times
// and uses it only when it saves at least MIN_SAVING minutes. Two rules keep
// every ticket good:
//   - a passenger's drop-off never comes before their pick-up;
//   - the bus never reaches a stop where someone gets on before its timetable time.
// Passengers' phones and the conductor use the same inputs (seats per stop pair
// from trip_stop_pairs), so they show the same order.

import { useEffect, useState } from 'react';
import { fetchDriveTable, type LatLng } from './routing';
import { isSupabaseConfigured, supabase } from './supabase/client';
import type { Booking, Route, RouteStop } from './types';

export const MIN_SAVING = 10;
/** More stops than this after the skipped detour: keep the order (too many to try every way). */
const MAX_TRY = 9;

export interface Pair {
  from: string;
  to: string;
  seats: number;
}

export interface StopOrder {
  /** The stops the bus drives tonight, in the order it drives them (offsetMin = estimate when changed). */
  stops: RouteStop[];
  changed: boolean;
  /** Minutes saved against the timetable order (0 when unchanged). */
  savedMin: number;
  /** Visible stop names in the new order, from the first one that moved. */
  newOrder: string[];
}

const low = (s: string) => s.trim().toLowerCase();

/** Seats per stop pair for a departure. Demo mode: from the bookings on this device. */
export async function loadPairs(scheduleId: string, date: string, bookings: Booking[]): Promise<Pair[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase().rpc('trip_stop_pairs', { p_schedule: scheduleId, p_date: date });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!error && data) return (data as any[]).map((r) => ({ from: r.from_stop, to: r.to_stop, seats: r.seats }));
  }
  const out = new Map<string, Pair>();
  for (const b of bookings) {
    if (b.scheduleId !== scheduleId || b.date !== date || !['confirmed', 'held', 'boarded'].includes(b.status)) continue;
    const k = `${low(b.from)}|${low(b.to)}`;
    const p = out.get(k) ?? { from: b.from, to: b.to, seats: 0 };
    p.seats += b.seats.length;
    out.set(k, p);
  }
  return [...out.values()];
}

/**
 * The best order of `region` (stops after `anchor`), by drive minutes in
 * `minutes` (index 0 = anchor, i + 1 = region[i]). Returns the order (indices
 * into region) and the time the last stop is reached, or null if none is allowed.
 */
export function bestOrder(
  region: RouteStop[],
  minutes: number[][],
  startMin: number,
  opts: { busFactor: number; stopMin: number; before: [number, number][]; boards: boolean[]; keepLast: boolean },
) {
  const n = region.length;
  const mustBefore = region.map(() => [] as number[]); // mustBefore[j] = stops that have to come before j
  for (const [a, b] of opts.before) mustBefore[b].push(a);
  // Times along an order; a stop where someone gets on is never reached before its timetable time.
  const run = (order: number[]) => {
    let t = startMin;
    let at = 0;
    const times: number[] = [];
    order.forEach((j, k) => {
      t += minutes[at][j + 1] * opts.busFactor;
      if (opts.boards[j]) t = Math.max(t, region[j].offsetMin);
      times.push(t);
      if (k < order.length - 1) t += opts.stopMin;
      at = j + 1;
    });
    return { end: t, times };
  };
  let best: { order: number[]; end: number } | null = null;
  const used = new Array(n).fill(false);
  const order: number[] = [];
  const dfs = (at: number, t: number) => {
    if (best && t >= best.end) return;
    if (order.length === n) {
      if (opts.keepLast && order[n - 1] !== n - 1) return;
      best = { order: [...order], end: t };
      return;
    }
    for (let j = 0; j < n; j++) {
      if (used[j] || !mustBefore[j].every((a) => used[a])) continue;
      let next = t + (order.length ? opts.stopMin : 0) + minutes[at][j + 1] * opts.busFactor;
      if (opts.boards[j]) next = Math.max(next, region[j].offsetMin);
      used[j] = true;
      order.push(j);
      dfs(j + 1, next);
      order.pop();
      used[j] = false;
    }
  };
  dfs(0, startMin);
  if (!best) return null;
  const b = best as { order: number[]; end: number };
  return { order: b.order, ...run(b.order), current: run(region.map((_, i) => i)) };
}

/**
 * Tonight's stop order for a departure. `road` is the stops the bus drives
 * (roadStops); `route` the full route with its on-request stops.
 */
export function useStopOrder(route: Route | undefined, road: RouteStop[], scheduleId: string | undefined, date: string | undefined, bookings: Booking[]): StopOrder {
  const [result, setResult] = useState<StopOrder>({ stops: road, changed: false, savedMin: 0, newOrder: [] });
  // The first on-request stop that's skipped, and the last stop the bus still drives before it.
  const k = route ? route.stops.findIndex((s) => s.optional && !s.hidden && !road.includes(s)) : -1;
  let anchor = -1;
  if (route && k > 0) for (let i = k - 1; i >= 0; i--) if (road.includes(route.stops[i]) && !route.stops[i].hidden) { anchor = road.indexOf(route.stops[i]); break; }
  const region = anchor >= 0 ? road.slice(anchor + 1).filter((s) => !s.hidden) : [];
  const bookingKey = bookings.filter((b) => b.scheduleId === scheduleId && b.date === date).map((b) => `${b.id}${b.status}${b.from}${b.to}`).join();
  const key = `${route?.id}|${scheduleId}|${date}|${road.map((s) => s.name).join('>')}|${bookingKey}|${route?.busFactor}|${route?.stopMin}`;

  useEffect(() => {
    setResult({ stops: road, changed: false, savedMin: 0, newOrder: [] });
    if (!route || !scheduleId || !date || anchor < 0 || region.length < 2 || region.length > MAX_TRY) return;
    const start = road[anchor];
    const pts = [start, ...region];
    if (pts.some((s) => s.lat == null || s.lng == null)) return;
    const ctl = new AbortController();
    (async () => {
      const [minutes, pairs] = await Promise.all([
        fetchDriveTable(pts.map((s): LatLng => [s.lat!, s.lng!]), ctl.signal),
        loadPairs(scheduleId, date, bookings),
      ]);
      if (ctl.signal.aborted || !minutes) return;
      const idx = (name: string) => region.findIndex((s) => low(s.name) === low(name));
      const before: [number, number][] = [];
      const boards = region.map(() => false);
      for (const p of pairs) {
        const a = idx(p.from);
        const b = idx(p.to);
        if (a >= 0) boards[a] = true;
        if (a >= 0 && b >= 0) before.push([a, b]);
      }
      const r = bestOrder(region, minutes, start.offsetMin, { busFactor: route.busFactor ?? 1.1, stopMin: route.stopMin ?? 2, before, boards, keepLast: false });
      if (!r) return;
      // Measured the same way as the new order (drive times, not the timetable), so the saving is fair.
      const saved = Math.round(r.current.end - r.end);
      const same = r.order.every((j, i) => j === i);
      if (same || saved < MIN_SAVING) return;
      // The new order: the stops before stay as they are; the shaping points after
      // the skipped detour are dropped (they shaped the old order); times re-estimated.
      const moved = r.order.map((j, i) => ({ ...region[j], offsetMin: Math.round(r.times[i]) }));
      setResult({ stops: [...road.slice(0, anchor + 1), ...moved], changed: true, savedMin: saved, newOrder: moved.map((s) => s.name) });
    })();
    return () => ctl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}
