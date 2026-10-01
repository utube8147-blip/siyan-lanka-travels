'use client';
// lib/tracking.ts — the bus's recent positions for passenger tracking.
//
// TODAY: the database keeps only the latest position (bus_locations), so the
// trail is built in the browser from live updates while the page is open
// (up to TRAIL_SIZE points).
// LATER: when you store the last 5 positions (see README → "Bus location
// history"), change only loadRecentPositions() to read that table; the
// map and page already handle a list of points.

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
  // Future: .from('bus_location_history').select('*').eq(...).order('recorded_at', { ascending: false }).limit(TRAIL_SIZE)
  const { data } = await supabase().from('bus_locations').select('*').eq('schedule_id', scheduleId).eq('travel_date', date).maybeSingle();
  return data ? [{ lat: data.lat, lng: data.lng, speedKmh: data.speed_kmh, heading: data.heading, updatedAt: data.updated_at }] : [];
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
  const all = [...incoming, ...current].filter((p, i, a) => a.findIndex((q) => q.updatedAt === p.updatedAt) === i);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, TRAIL_SIZE);
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
