'use client';
// lib/routeEditor.ts — helpers for the route editor (admin → Routes & timetable → Edit route):
// place search (geocoding), where a new stop fits in the order, reading a GPS
// file (CSV / GPX from the GPS trip log, or any GPX), and saved draft plans.

import { isSupabaseConfigured as DB, supabase } from './supabase/client';
import { km } from './extras';
import { fetchRoadRoute } from './routing';
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
 * Estimated minutes after departure for every stop, from the road legs between
 * the stops that have a map pin (car minutes × bus factor, plus the stop time
 * at every stop on the way). Stops without a pin are spread evenly between
 * their pinned neighbours. Null when the first or last stop has no pin, or the
 * legs don't match the pinned stops.
 */
export function arrivalEstimates(stops: RouteStop[], legs: { km: number; min: number }[], busFactor: number, dwellMin: number): number[] | null {
  const pinned = stops.map((s, i) => (s.lat != null && s.lng != null ? i : -1)).filter((i) => i >= 0);
  if (pinned.length < 2 || pinned[0] !== 0 || pinned[pinned.length - 1] !== stops.length - 1 || legs.length !== pinned.length - 1) return null;
  const out: number[] = new Array(stops.length).fill(0);
  for (let k = 1; k < pinned.length; k++) {
    const a = pinned[k - 1];
    const b = pinned[k];
    const leave = out[a] + (a > 0 ? dwellMin : 0); // leaves stop a after its stop time (not at the start)
    const between = b - a - 1; // stops without a pin in between: each adds its stop time
    const arrive = leave + legs[k - 1].min * busFactor + between * dwellMin;
    out[b] = arrive;
    for (let j = 1; j <= between; j++) out[a + j] = leave + ((arrive - leave) * j) / (between + 1);
  }
  return out;
}

/** Timetable minutes from estimates: rounded to 5 minutes, each stop at least 5 minutes after the one before. */
export function roundedOffsets(est: number[]): number[] {
  const out: number[] = [];
  est.forEach((m, i) => out.push(i === 0 ? 0 : Math.max(out[i - 1] + 5, Math.round(m / 5) * 5)));
  return out;
}

// ------------------------------------------------------------- GPS file ----

export interface GpsFile {
  name: string;
  line: LatLng[];
  /** Same length as `line`: true where the point is an estimated road (a filled gap), not a GPS fix. */
  est: boolean[];
  /** First and last time in the file, if it has times. */
  from?: string;
  to?: string;
}

/** Reads a GPX (track, route or waypoints) or a CSV with latitude/longitude columns. */
export function parseGpsFile(fileName: string, text: string): GpsFile | null {
  const pts: LatLng[] = [];
  const est: boolean[] = [];
  const times: string[] = [];
  if (/^\s*<\?xml|<gpx[\s>]/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    let nodes = Array.from(doc.getElementsByTagName('trkpt'));
    if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('rtept'));
    if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('wpt'));
    for (const n of nodes) {
      const lat = Number(n.getAttribute('lat'));
      const lng = Number(n.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      pts.push([lat, lng]);
      // Points our GPS log export added to fill a gap are marked "estimated".
      est.push(/estimated/i.test(n.getElementsByTagName('desc')[0]?.textContent ?? ''));
      const t = n.getElementsByTagName('time')[0]?.textContent;
      if (t) times.push(t);
    }
  } else {
    const rows = text.split(/\r?\n/).filter((r) => r.trim());
    const head = (rows[0] ?? '').toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
    const iLat = head.findIndex((h) => h === 'lat' || h === 'latitude');
    const iLng = head.findIndex((h) => h === 'lng' || h === 'lon' || h === 'long' || h === 'longitude');
    const iTime = head.findIndex((h) => h === 'time' || h === 'timestamp' || h === 'recorded_at');
    const iSource = head.findIndex((h) => h === 'source');
    const hasHead = iLat >= 0 && iLng >= 0;
    for (const r of rows.slice(hasHead ? 1 : 0)) {
      const c = r.split(',').map((x) => x.trim().replace(/"/g, ''));
      const lat = Number(c[hasHead ? iLat : 0]);
      const lng = Number(c[hasHead ? iLng : 1]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
        pts.push([lat, lng]);
        est.push(iSource >= 0 && /estimated/i.test(c[iSource] ?? ''));
      }
      if (hasHead && iTime >= 0 && c[iTime]) times.push(c[iTime]);
    }
  }
  if (pts.length < 2) return null;
  // Very long logs: keep the shape, drop the rest (a map line of a few thousand points is plenty).
  const step = Math.ceil(pts.length / 4000);
  const keep = (i: number) => step === 1 || i % step === 0 || i === pts.length - 1;
  return { name: fileName, line: pts.filter((_, i) => keep(i)), est: est.filter((_, i) => keep(i)), from: times[0], to: times[times.length - 1] };
}

/** How many jumps of more than `minKm` between real GPS points the file still has. */
export function countJumps(f: GpsFile, minKm = 2) {
  let n = 0;
  for (let i = 1; i < f.line.length; i++) if (!f.est[i - 1] && !f.est[i] && km(pt(f.line[i - 1]), pt(f.line[i])) > minKm) n++;
  return n;
}
const pt = ([lat, lng]: LatLng) => ({ lat, lng });

/**
 * Fills jumps of more than `minKm` between real GPS points with the likely road
 * (routing server), one at a time (the free server allows about one request a
 * second). Works for any file: an older export, or a GPX from another app.
 * `onProgress` gets the file with the gaps filled so far.
 */
export async function fillGpsGaps(f: GpsFile, onProgress: (f: GpsFile, done: number, total: number) => void, signal?: AbortSignal, minKm = 2): Promise<GpsFile> {
  const jumps: number[] = [];
  for (let i = 1; i < f.line.length; i++) if (!f.est[i - 1] && !f.est[i] && km(pt(f.line[i - 1]), pt(f.line[i])) > minKm) jumps.push(i);
  const roads = new Map<number, LatLng[]>();
  const build = (): GpsFile => {
    const line: LatLng[] = [];
    const est: boolean[] = [];
    f.line.forEach((p, i) => {
      for (const q of roads.get(i) ?? []) {
        line.push(q);
        est.push(true);
      }
      line.push(p);
      est.push(f.est[i]);
    });
    return { ...f, line, est };
  };
  for (let k = 0; k < jumps.length && k < 40; k++) {
    if (signal?.aborted) break;
    const i = jumps[k];
    const a = f.line[i - 1];
    const b = f.line[i];
    const straight = km(pt(a), pt(b));
    const t0 = Date.now();
    const r = await fetchRoadRoute([a, b], signal);
    // A road far longer than the straight line is probably a wrong guess: keep the straight line.
    if (r.route && r.route.distanceKm <= straight * 3 + 2) roads.set(i, r.route.path.slice(1, -1));
    onProgress(build(), k + 1, jumps.length);
    const waited = Date.now() - t0;
    if (waited >= 300 && k < jumps.length - 1) await new Promise((res) => setTimeout(res, Math.max(0, 1100 - waited)));
  }
  return build();
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
