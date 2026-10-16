'use client';
// lib/routeEditor.ts — helpers for the route editor (admin → Routes & timetable → Edit route):
// place search (geocoding), where a new stop fits in the order, reading a GPS
// file (CSV / GPX from the GPS trip log, or any GPX), and saved draft plans.

import { isSupabaseConfigured as DB, supabase } from './supabase/client';
import { km } from './extras';
import type { RouteStop } from './types';

export type LatLng = [number, number];

// ------------------------------------------------------------ geocoding ----
// OpenStreetMap's Nominatim by default (free, max 1 request a second, so we only
// search when asked). NEXT_PUBLIC_GEOCODING_URL can point to another Nominatim.

const GEO = (process.env.NEXT_PUBLIC_GEOCODING_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shortName = (a: any, fallback: string) =>
  a?.village || a?.town || a?.city || a?.suburb || a?.hamlet || a?.neighbourhood || a?.road || fallback.split(',')[0];

export async function searchPlaces(q: string): Promise<{ places: Place[]; error?: string }> {
  if (!q.trim()) return { places: [] };
  try {
    const res = await fetch(`${GEO}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=lk&q=${encodeURIComponent(q.trim())}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { places: [], error: `Place search answered ${res.status}. Try again in a moment.` };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await res.json()) as any[];
    return {
      places: rows.map((r) => ({ name: r.name || shortName(r.address, r.display_name), detail: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })),
    };
  } catch {
    return { places: [], error: 'Could not reach the place search (offline?).' };
  }
}

/** A short name for a spot on the map (village / town / road), or null. */
export async function placeName(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`${GEO}/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const r = await res.json();
    return r?.address ? shortName(r.address, r.display_name ?? '') || null : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- ordering ----

/** Where a new stop fits best: the gap between two stops it adds the least distance to. */
export function bestInsertIndex(stops: RouteStop[], p: { lat: number; lng: number }): number {
  let best = stops.length - 1;
  let bestCost = Infinity;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (a.lat == null || b.lat == null) continue;
    const A = { lat: a.lat, lng: a.lng! };
    const B = { lat: b.lat, lng: b.lng! };
    const cost = km(A, p) + km(p, B) - km(A, B);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}

/** Distance (km) from a point to the nearest part of a line. */
export function distanceToLine(line: LatLng[], p: { lat: number; lng: number }): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [aLat, aLng] = line[i];
    const [bLat, bLng] = line[i + 1];
    const kx = 111.32 * Math.cos((aLat * Math.PI) / 180);
    const ky = 110.57;
    const bx = (bLng - aLng) * kx;
    const by = (bLat - aLat) * ky;
    const px = (p.lng - aLng) * kx;
    const py = (p.lat - aLat) * ky;
    const len2 = bx * bx + by * by;
    const f = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - f * bx, py - f * by));
  }
  return best;
}

export function lineLengthKm(line: LatLng[]) {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += km({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] });
  return d;
}

/**
 * Timetable minutes for each stop from road legs: car minutes × bus factor,
 * plus the stop time at every stop in between, rounded to 5 minutes.
 */
export function offsetsFromLegs(legs: { min: number }[], busFactor: number, dwellMin: number): number[] {
  const out = [0];
  let t = 0;
  legs.forEach((l, i) => {
    t += l.min * busFactor + (i > 0 ? dwellMin : 0);
    out.push(Math.max(out[out.length - 1] + 5, Math.round(t / 5) * 5));
  });
  return out;
}

// ------------------------------------------------------------- GPS file ----

export interface GpsFile {
  name: string;
  line: LatLng[];
  /** First and last time in the file, if it has times. */
  from?: string;
  to?: string;
}

/** Reads a GPX (track, route or waypoints) or a CSV with latitude/longitude columns. */
export function parseGpsFile(fileName: string, text: string): GpsFile | null {
  const pts: LatLng[] = [];
  const times: string[] = [];
  if (/^\s*<\?xml|<gpx[\s>]/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    let nodes = Array.from(doc.getElementsByTagName('trkpt'));
    if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('rtept'));
    if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('wpt'));
    for (const n of nodes) {
      const lat = Number(n.getAttribute('lat'));
      const lng = Number(n.getAttribute('lon'));
      if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng]);
      const t = n.getElementsByTagName('time')[0]?.textContent;
      if (t) times.push(t);
    }
  } else {
    const rows = text.split(/\r?\n/).filter((r) => r.trim());
    const head = (rows[0] ?? '').toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
    const iLat = head.findIndex((h) => h === 'lat' || h === 'latitude');
    const iLng = head.findIndex((h) => h === 'lng' || h === 'lon' || h === 'long' || h === 'longitude');
    const iTime = head.findIndex((h) => h === 'time' || h === 'timestamp' || h === 'recorded_at');
    const hasHead = iLat >= 0 && iLng >= 0;
    for (const r of rows.slice(hasHead ? 1 : 0)) {
      const c = r.split(',').map((x) => x.trim().replace(/"/g, ''));
      const lat = Number(c[hasHead ? iLat : 0]);
      const lng = Number(c[hasHead ? iLng : 1]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) pts.push([lat, lng]);
      if (hasHead && iTime >= 0 && c[iTime]) times.push(c[iTime]);
    }
  }
  if (pts.length < 2) return null;
  // Very long logs: keep the shape, drop the rest (a map line of a few thousand points is plenty).
  const step = Math.ceil(pts.length / 4000);
  const line = step > 1 ? pts.filter((_, i) => i % step === 0 || i === pts.length - 1) : pts;
  return { name: fileName, line, from: times[0], to: times[times.length - 1] };
}

// ---------------------------------------------------------- draft plans ----
// A plan is a saved copy of a route's stops that is NOT live: try ideas,
// keep them, and make one live later with "Save route".

export interface RoutePlan {
  id: string;
  name: string;
  routeId: string;
  stops: RouteStop[];
  notes: string;
  updatedAt: string;
}

const LOCAL = 'demo-route-plans-v2';
const readLocal = (): RoutePlan[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) || '[]');
  } catch {
    return [];
  }
};

export async function loadPlans(routeId: string): Promise<{ plans: RoutePlan[]; error?: string }> {
  if (!DB) return { plans: readLocal().filter((p) => p.routeId === routeId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  const { data, error } = await supabase().from('route_plans').select('id, name, route_id, stops, notes, updated_at').eq('route_id', routeId).order('updated_at', { ascending: false });
  if (error) return { plans: [], error: /route_plans|route_id|schema cache/.test(error.message) ? 'Draft plans need the latest database update: run migration 33 again.' : error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { plans: ((data as any[]) ?? []).map((r) => ({ id: r.id, name: r.name, routeId: r.route_id, stops: r.stops ?? [], notes: r.notes ?? '', updatedAt: r.updated_at })) };
}

export async function savePlan(plan: Omit<RoutePlan, 'id' | 'updatedAt'> & { id?: string }): Promise<{ ok: boolean; plan?: RoutePlan; reason?: string }> {
  const now = new Date().toISOString();
  if (!DB) {
    const saved: RoutePlan = { ...plan, id: plan.id || `plan-${Date.now().toString(36)}`, updatedAt: now };
    try {
      localStorage.setItem(LOCAL, JSON.stringify([saved, ...readLocal().filter((p) => p.id !== saved.id)]));
    } catch {
      return { ok: false, reason: 'Could not save in this browser' };
    }
    return { ok: true, plan: saved };
  }
  const row = { name: plan.name, route_id: plan.routeId, stops: plan.stops, notes: plan.notes, updated_at: now };
  const q = plan.id ? supabase().from('route_plans').update(row).eq('id', plan.id) : supabase().from('route_plans').insert(row);
  const { data, error } = await q.select('id, updated_at').single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, plan: { ...plan, id: data.id, updatedAt: data.updated_at } };
}

export async function deletePlan(id: string): Promise<{ ok: boolean; reason?: string }> {
  if (!DB) {
    try {
      localStorage.setItem(LOCAL, JSON.stringify(readLocal().filter((p) => p.id !== id)));
    } catch {
      /* ignore */
    }
    return { ok: true };
  }
  const { error } = await supabase().from('route_plans').delete().eq('id', id);
  return error ? { ok: false, reason: error.message } : { ok: true };
}
