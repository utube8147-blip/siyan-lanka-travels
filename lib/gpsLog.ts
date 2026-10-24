'use client';
// lib/gpsLog.ts — the full GPS log of a trip, for the office (admin → GPS trip log).
//
// Every position the conductor's phone sends is kept in bus_location_log
// (filled by a trigger on bus_locations; see migration 33). Unlike
// bus_locations (latest only) and bus_location_history (last 20), nothing is
// overwritten, so a whole journey can be replayed.

import { isSupabaseConfigured as DB, supabase } from './supabase/client';
import { km } from './extras';
import { fetchRoadRoute } from './routing';
import { tx } from '@/lib/i18n';

export interface GpsPoint {
  /** Row id (database); the time in demo mode. */
  id: number | string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyM: number | null;
  at: string;
  /** Last time the bus was still within 100 m of this point (it stood or crawled there). */
  until: string | null;
}

export interface GpsTripSummary {
  scheduleId: string;
  points: number;
  firstAt: string;
  lastAt: string;
}

const PAGE = 1000; // Supabase returns at most 1000 rows per request

/** Which trips have GPS points on a day. */
export async function loadGpsTrips(date: string): Promise<{ trips: GpsTripSummary[]; error?: string }> {
  if (!DB) {
    const trips: GpsTripSummary[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? '';
        const m = k.match(/^demo-gpslog:(.+):(\d{4}-\d{2}-\d{2})$/);
        if (!m || m[2] !== date) continue;
        const pts = JSON.parse(localStorage.getItem(k) || '[]') as { updatedAt: string }[];
        if (pts.length) trips.push({ scheduleId: m[1], points: pts.length, firstAt: pts[0].updatedAt, lastAt: pts[pts.length - 1].updatedAt });
      }
    } catch {
      /* storage unavailable */
    }
    return { trips };
  }
  const { data, error } = await supabase().rpc('gps_log_trips', { p_date: date });
  if (error) return { trips: [], error: missingTable(error.message) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { trips: ((data as any[]) ?? []).map((r) => ({ scheduleId: r.schedule_id, points: Number(r.points), firstAt: r.first_at, lastAt: r.last_at })) };
}

/** Every point of one trip, oldest first. */
export async function loadGpsPoints(scheduleId: string, date: string): Promise<{ points: GpsPoint[]; error?: string }> {
  if (!DB) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = JSON.parse(localStorage.getItem(`demo-gpslog:${scheduleId}:${date}`) || '[]') as any[];
      return { points: raw.map((p) => ({ id: p.updatedAt, lat: p.lat, lng: p.lng, speedKmh: p.speedKmh ?? null, heading: p.heading ?? null, accuracyM: p.accuracyM ?? null, at: p.updatedAt, until: p.until ?? null })) };
    } catch {
      return { points: [] };
    }
  }
  const sb = supabase();
  const points: GpsPoint[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('bus_location_log')
      .select('id, lat, lng, speed_kmh, heading, accuracy_m, recorded_at, last_seen_at')
      .eq('schedule_id', scheduleId)
      .eq('travel_date', date)
      .order('recorded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { points, error: missingTable(error.message) };
    for (const r of data ?? []) {
      points.push({
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        speedKmh: r.speed_kmh == null ? null : Number(r.speed_kmh),
        heading: r.heading == null ? null : Number(r.heading),
        accuracyM: r.accuracy_m == null ? null : Number(r.accuracy_m),
        at: r.recorded_at,
        until: r.last_seen_at ?? null,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return { points };
}

/** Admins only. With `ids`: just those points; without: the whole trip's log. */
export async function deleteGpsPoints(scheduleId: string, date: string, ids?: (number | string)[]): Promise<{ ok: boolean; deleted?: number; reason?: string }> {
  if (!DB) {
    const key = `demo-gpslog:${scheduleId}:${date}`;
    try {
      if (!ids) {
        const n = (JSON.parse(localStorage.getItem(key) || '[]') as unknown[]).length;
        localStorage.removeItem(key);
        return { ok: true, deleted: n };
      }
      const all = JSON.parse(localStorage.getItem(key) || '[]') as { updatedAt: string }[];
      const keep = all.filter((p) => !ids.includes(p.updatedAt));
      localStorage.setItem(key, JSON.stringify(keep));
      return { ok: true, deleted: all.length - keep.length };
    } catch {
      return { ok: false, reason: tx('Could not delete') };
    }
  }
  const { data, error } = await supabase().rpc('delete_gps_log', { p_schedule: scheduleId, p_date: date, p_ids: ids ? ids.map(Number) : null });
  if (error) return { ok: false, reason: error.message.replace(/^NOT_ALLOWED:\s*/, '') };
  return { ok: true, deleted: Number(data ?? 0) };
}

function missingTable(msg: string) {
  return /bus_location_log|gps_log_trips|schema cache|does not exist/i.test(msg)
    ? tx('The GPS log isn’t set up in the database yet. Run supabase/migrations/20261033000000_gps_trip_log.sql in Supabase → SQL Editor.')
    : msg;
}

// ------------------------------------------------------------- analysis ----

export interface Stop {
  lat: number;
  lng: number;
  from: string;
  to: string;
  minutes: number;
}
export interface Gap {
  from: string;
  to: string;
  minutes: number;
}

const mins = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
/** When the bus left a point (its last-seen time, or the time it was logged). */
export const leftAt = (p: GpsPoint) => p.until ?? p.at;

// ------------------------------------------------------ filling big gaps ----
// Where two logged points are far apart (no signal, phone locked, sharing
// off), the road between them is estimated with the routing server, so the
// map, the distance and the exports follow the road instead of a straight line.

export interface Fill {
  /** The point after the jump: the jump is points[to - 1] → points[to]. */
  to: number;
  straightKm: number;
  /** The likely road (null: the routing server gave nothing usable). */
  path: [number, number][] | null;
  roadKm: number | null;
  minutes: number;
}

/** Consecutive points more than `minKm` apart, as Fills not yet routed. */
export function findJumps(points: GpsPoint[], minKm = 2): Fill[] {
  const out: Fill[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = km(points[i - 1], points[i]);
    if (d > minKm) out.push({ to: i, straightKm: d, path: null, roadKm: null, minutes: Math.round(mins(leftAt(points[i - 1]), points[i].at)) });
  }
  return out;
}

/**
 * Asks the routing server for the road across each jump, one at a time (the
 * free server allows about one request a second; repeats come from its cache).
 * `onProgress` gets the list as each one is filled.
 */
export async function fillJumps(points: GpsPoint[], jumps: Fill[], onProgress: (f: Fill[]) => void, signal?: AbortSignal): Promise<Fill[]> {
  const out = jumps.map((j) => ({ ...j }));
  for (let k = 0; k < out.length && k < 40; k++) {
    if (signal?.aborted) break;
    const a = points[out[k].to - 1];
    const b = points[out[k].to];
    const t0 = Date.now();
    const r = await fetchRoadRoute([[a.lat, a.lng], [b.lat, b.lng]], signal);
    // A road far longer than the straight line is probably a wrong guess (other side of a river…): keep the straight line.
    if (r.route && r.route.distanceKm <= out[k].straightKm * 3 + 2) {
      out[k].path = r.route.path;
      out[k].roadKm = r.route.distanceKm;
    }
    onProgress([...out]);
    const waited = Date.now() - t0;
    if (waited < 300 && k < out.length - 1) continue; // came from the cache: no need to wait
    if (k < out.length - 1) await new Promise((res) => setTimeout(res, Math.max(0, 1100 - waited)));
  }
  return out;
}

/** Distance, time and speed for the whole log. Poor fixes (>100 m accuracy) don't count towards distance. Filled jumps count their road distance. */
export function summarise(points: GpsPoint[], fills: Fill[] = []) {
  let distance = 0;
  let filledKm = 0;
  let maxSpeed = 0;
  let movingMin = 0;
  let prev: GpsPoint | null = null;
  const byTo = new Map(fills.filter((f) => f.roadKm != null).map((f) => [f.to, f]));
  for (const [i, p] of points.entries()) {
    if (p.speedKmh != null && p.speedKmh > maxSpeed && p.speedKmh < 160) maxSpeed = p.speedKmh;
    const fill = byTo.get(i);
    if (fill && prev) {
      distance += fill.roadKm!;
      filledKm += fill.roadKm!;
      movingMin += Math.max(0, mins(leftAt(prev), p.at));
      prev = p;
      continue;
    }
    if (p.accuracyM != null && p.accuracyM > 100) continue;
    if (prev) {
      const d = km(prev, p);
      const t = mins(leftAt(prev), p.at);
      // Ignore GPS jumps that would need an impossible speed.
      if (t > 0 && d / (t / 60) < 150) {
        distance += d;
        if (d > 0.03) movingMin += t;
      }
    }
    prev = p;
  }
  const total = points.length ? mins(points[0].at, leftAt(points[points.length - 1])) : 0;
  return { distance, filledKm, totalMin: total, movingMin, maxSpeed, avgMoving: movingMin > 0 ? distance / (movingMin / 60) : 0 };
}

/** Places the bus stayed within `radiusKm` for at least `minMin` minutes. */
export function findStops(points: GpsPoint[], minMin = 3, radiusKm = 0.12): Stop[] {
  const stops: Stop[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && km(points[i], points[j + 1]) <= radiusKm) j++;
    const m = mins(points[i].at, leftAt(points[j]));
    if (m >= minMin) {
      stops.push({ lat: points[i].lat, lng: points[i].lng, from: points[i].at, to: leftAt(points[j]), minutes: Math.round(m) });
      i = j + 1;
    } else i++;
  }
  return stops;
}

/** Times the phone sent nothing for `minMin` minutes or more (no signal, app closed, sharing off). */
export function findGaps(points: GpsPoint[], minMin = 3): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < points.length; i++) {
    const m = mins(leftAt(points[i - 1]), points[i].at);
    if (m >= minMin) gaps.push({ from: points[i - 1].at, to: points[i].at, minutes: Math.round(m) });
  }
  return gaps;
}

// --------------------------------------------------------------- export ----

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The points of a filled jump, without its two ends (those are real points). */
const fillPoints = (f: Fill | undefined) => (f?.path ? f.path.slice(1, -1) : []);

/** CSV of every point. Filled jumps add rows with source "estimated" and no time. */
export function downloadCsv(name: string, points: GpsPoint[], fills: Fill[] = []) {
  const byTo = new Map(fills.map((f) => [f.to, f]));
  const rows = [['time', 'latitude', 'longitude', 'speed_kmh', 'heading', 'accuracy_m', 'still_there_until', 'source']];
  points.forEach((p, i) => {
    for (const [lat, lng] of fillPoints(byTo.get(i))) rows.push(['', lat.toFixed(6), lng.toFixed(6), '', '', '', '', 'estimated']);
    rows.push([p.at, String(p.lat), String(p.lng), p.speedKmh?.toString() ?? '', p.heading?.toString() ?? '', p.accuracyM?.toString() ?? '', p.until ?? '', 'gps']);
  });
  download(`${name}.csv`, 'text/csv', rows.map((r) => r.join(',')).join('\n'));
}

/** GPX opens in Google Earth, Google My Maps and most GPS apps. Filled jumps add points marked "estimated", without a time. */
export function downloadGpx(name: string, points: GpsPoint[], fills: Fill[] = []) {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const byTo = new Map(fills.map((f) => [f.to, f]));
  const pts = points
    .flatMap((p, i) => [
      ...fillPoints(byTo.get(i)).map(([lat, lng]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><desc>estimated</desc></trkpt>`),
      `      <trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.at).toISOString()}</time></trkpt>`,
    ])
    .join('\n');
  download(
    `${name}.gpx`,
    'application/gpx+xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Siyan Lanka" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${esc(name)}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`,
  );
}
