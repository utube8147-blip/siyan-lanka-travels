'use client';
// lib/tracking.ts — the bus's recent positions for passenger tracking.
//
// The database keeps the latest position (bus_locations) plus a short history
// (bus_location_history: a point each time the bus has moved ~50 m, last 20
// kept). The page loads the last TRAIL_SIZE points, then adds live updates,
// so the trail is there straight away and survives a reload.

import { useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured as DB, supabase } from './supabase/client';
import { km, useLiveTrip, type BusLocation } from './extras';
import type { RouteStop } from './types';

export const TRAIL_SIZE = 5;

/** Most recent first. */
async function loadRecentPositions(scheduleId: string, date: string): Promise<BusLocation[]> {
  if (!DB) {
    try {
      const v = JSON.parse(localStorage.getItem(`demo-live:${scheduleId}:${date}`) || '{}');
      return (v.trail as BusLocation[] | undefined) ?? (v.loc ? [v.loc] : []);
    } catch {
      return [];
    }
  }
  const sb = supabase();
  const [hist, now] = await Promise.all([
    sb.from('bus_location_history').select('lat, lng, speed_kmh, heading, recorded_at').eq('schedule_id', scheduleId).eq('travel_date', date).order('recorded_at', { ascending: false }).limit(TRAIL_SIZE),
    sb.from('bus_locations').select('*').eq('schedule_id', scheduleId).eq('travel_date', date).maybeSingle(),
  ]);
  const points: BusLocation[] = (hist.data ?? []).map((p) => ({ lat: p.lat, lng: p.lng, speedKmh: p.speed_kmh, heading: p.heading, updatedAt: p.recorded_at }));
  // The live row is the freshest (history skips heartbeats while parked).
  if (now.data) points.unshift({ lat: now.data.lat, lng: now.data.lng, speedKmh: now.data.speed_kmh, heading: now.data.heading, updatedAt: now.data.updated_at });
  return points;
}

/** Latest position + the last few, kept live. */
export function useBusTrail(scheduleId?: string, date?: string) {
  const { location, events } = useLiveTrip(scheduleId, date);
  const [trail, setTrail] = useState<BusLocation[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    loaded.current = false;
    setTrail([]);
    if (!scheduleId || !date) return;
    loadRecentPositions(scheduleId, date).then((pts) => {
      loaded.current = true;
      setTrail((cur) => merge(pts, cur));
    });
  }, [scheduleId, date]);

  useEffect(() => {
    if (location) setTrail((cur) => merge([location], cur));
  }, [location]);

  return { latest: trail[0] ?? location ?? null, trail, events };
}

function merge(incoming: BusLocation[], current: BusLocation[]) {
  // Compare as instants: the same moment can arrive as "…Z" or "…+00:00".
  const at = (p: BusLocation) => new Date(p.updatedAt).getTime();
  const all = [...incoming, ...current].filter((p, i, a) => a.findIndex((q) => at(q) === at(p)) === i);
  return all.sort((a, b) => at(b) - at(a)).slice(0, TRAIL_SIZE);
}

/** Rough arrival estimate at the passenger's stop from the bus position. */
export function estimateArrival(stops: RouteStop[], boardingIndex: number, bus: BusLocation | null) {
  const stop = stops[boardingIndex];
  if (!bus || stop?.lat == null || stop.lng == null) return null;
  const ranked = stops
    .map((s, i) => ({ i, d: s.lat != null && s.lng != null ? km(bus, { lat: s.lat, lng: s.lng }) : Infinity }))
    .sort((a, b) => a.d - b.d);
  const near = ranked[0];
  const toStop = km(bus, { lat: stop.lat, lng: stop.lng });
  if (near.i > boardingIndex && toStop > 3) return { state: 'passed' as const, minutes: 0, near: stops[near.i].name, km: toStop };
  if (toStop <= 1) return { state: 'here' as const, minutes: 0, near: stop.name, km: toStop };
  const minutes = Math.max(2, stops[boardingIndex].offsetMin - stops[near.i].offsetMin + Math.round((near.d / 45) * 60));
  return { state: 'coming' as const, minutes, near: stops[near.i].name, km: toStop };
}
