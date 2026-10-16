'use client';
// lib/routePlan.ts — planning new stops from a trip's real GPS track
// (admin → GPS trip log → Plan & sample).
//
// - Sampling: points every N km along the road the bus actually drove,
//   with the distance from the start and the time the bus passed.
// - Candidate stops: for a place you might add, how far it is off the road,
//   where it falls along the route, between which existing stops, and roughly
//   how much time it would add.
// - Plans are saved in route_plans (migration 33); in demo mode, in the browser.

import { isSupabaseConfigured as DB, supabase } from './supabase/client';
import { km } from './extras';
import type { GpsPoint } from './gpsLog';
import type { RouteStop } from './types';

// ------------------------------------------------------------- geometry ----

export interface Track {
  pts: { lat: number; lng: number; t: number }[];
  /** Distance from the start (km) at each point. */
  cum: number[];
}

/** The driven road, without poor fixes and GPS jumps. */
export function buildTrack(points: GpsPoint[]): Track {
  const pts: Track['pts'] = [];
  const cum: number[] = [];
  for (const p of points) {
    if (p.accuracyM != null && p.accuracyM > 100) continue;
    const t = new Date(p.at).getTime();
    const prev = pts[pts.length - 1];
    if (prev) {
      const d = km(prev, p);
      const h = (t - prev.t) / 3_600_000;
      if (h > 0 && d / h > 150) continue; // impossible jump
      if (d < 0.005) continue; // standing still: same place
      cum.push(cum[cum.length - 1] + d);
    } else cum.push(0);
    pts.push({ lat: p.lat, lng: p.lng, t });
  }
  return { pts, cum };
}

export const trackLength = (tr: Track) => tr.cum[tr.cum.length - 1] ?? 0;

export interface Sample {
  n: number;
  km: number;
  lat: number;
  lng: number;
  at: string;
}

/** A point every `stepKm` along the track (plus the end). */
export function resample(tr: Track, stepKm: number): Sample[] {
  if (tr.pts.length < 2 || stepKm <= 0) return [];
  const out: Sample[] = [];
  const total = trackLength(tr);
  let j = 0;
  for (let d = 0; d <= total + 1e-9; d += stepKm) {
    while (j < tr.cum.length - 2 && tr.cum[j + 1] < d) j++;
    out.push(interp(tr, j, d, out.length + 1));
  }
  if (out.length && total - out[out.length - 1].km > stepKm * 0.25) out.push(interp(tr, tr.pts.length - 2, total, out.length + 1));
  return out;
}

function interp(tr: Track, j: number, d: number, n: number): Sample {
  const a = tr.pts[j];
  const b = tr.pts[j + 1];
  const span = tr.cum[j + 1] - tr.cum[j];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - tr.cum[j]) / span)) : 0;
  return { n, km: d, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, at: new Date(a.t + (b.t - a.t) * f).toISOString() };
}

export interface Projection {
  /** Straight-line distance from the place to the nearest point of the road (km). */
  offKm: number;
  /** Distance along the road from the start to that nearest point (km). */
  alongKm: number;
  /** When the bus passed that nearest point. */
  at: string;
  lat: number;
  lng: number;
}

/** The nearest point on the driven road to a place. */
export function project(tr: Track, p: { lat: number; lng: number }): Projection | null {
  if (tr.pts.length < 2) return null;
  let best: Projection | null = null;
  for (let i = 0; i < tr.pts.length - 1; i++) {
    const a = tr.pts[i];
    const b = tr.pts[i + 1];
    // Flat-earth maths is fine over one segment (tens of metres).
    const kx = 111.32 * Math.cos((a.lat * Math.PI) / 180);
    const ky = 110.57;
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (p.lng - a.lng) * kx;
    const py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const f = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
    const dx = px - f * bx;
    const dy = py - f * by;
    const off = Math.sqrt(dx * dx + dy * dy);
    if (!best || off < best.offKm) {
      best = {
        offKm: off,
        alongKm: tr.cum[i] + (tr.cum[i + 1] - tr.cum[i]) * f,
        at: new Date(a.t + (b.t - a.t) * f).toISOString(),
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
      };
    }
  }
  return best;
}

// ----------------------------------------------------------- candidates ----

export interface Candidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Minutes the bus would stand there. */
  dwellMin: number;
  note?: string;
}

export type Verdict = 'on-road' | 'small' | 'detour' | 'far';
export const VERDICT_LABEL: Record<Verdict, string> = {
  'on-road': 'On the road',
  small: 'Small detour',
  detour: 'Detour',
  far: 'Far off the route',
};

export interface Assessment {
  c: Candidate;
  proj: Projection;
  minutesFromStart: number;
  /** Existing route stops either side, by position along the road. */
  after: { name: string; km: number } | null;
  before: { name: string; km: number } | null;
  nearestStop: { name: string; km: number } | null;
  detourKm: number;
  extraMin: number;
  verdict: Verdict;
}

export function assess(tr: Track, candidates: Candidate[], routeStops: RouteStop[], detourSpeedKmh: number): Assessment[] {
  if (tr.pts.length < 2) return [];
  const start = tr.pts[0].t;
  const stopsAlong = routeStops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ s, p: project(tr, { lat: s.lat!, lng: s.lng! }) }))
    .filter((x): x is { s: RouteStop; p: Projection } => !!x.p && x.p.offKm < 3);
  const out: Assessment[] = [];
  for (const c of candidates) {
    const proj = project(tr, c);
    if (!proj) continue;
    const before = stopsAlong.filter((x) => x.p.alongKm <= proj.alongKm).sort((a, b) => b.p.alongKm - a.p.alongKm)[0];
    const after = stopsAlong.filter((x) => x.p.alongKm > proj.alongKm).sort((a, b) => a.p.alongKm - b.p.alongKm)[0];
    const nearest = routeStops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ name: s.name, km: km(c, { lat: s.lat!, lng: s.lng! }) }))
      .sort((a, b) => a.km - b.km)[0];
    // Off the road: there and back. Under 200 m counts as on the road.
    const detourKm = proj.offKm > 0.2 ? proj.offKm * 2 * 1.3 /* roads aren't straight */ : 0;
    const extraMin = c.dwellMin + (detourKm / Math.max(5, detourSpeedKmh)) * 60 + (proj.offKm > 0.2 ? 2 : 1); // + slowing down / turning
    out.push({
      c,
      proj,
      minutesFromStart: (new Date(proj.at).getTime() - start) / 60000,
      before: before ? { name: before.s.name, km: proj.alongKm - before.p.alongKm } : null,
      after: after ? { name: after.s.name, km: after.p.alongKm - proj.alongKm } : null,
      nearestStop: nearest ?? null,
      detourKm,
      extraMin,
      verdict: proj.offKm <= 0.2 ? 'on-road' : proj.offKm <= 2 ? 'small' : proj.offKm <= 5 ? 'detour' : 'far',
    });
  }
  return out.sort((a, b) => a.proj.alongKm - b.proj.alongKm);
}

/** "6.9271, 79.8612", or a Google Maps link with @lat,lng or ?q=lat,lng. */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// ---------------------------------------------------------------- plans ----

export interface RoutePlan {
  id: string;
  name: string;
  scheduleId: string;
  travelDate: string;
  candidates: Candidate[];
  detourSpeedKmh: number;
  sampleKm: number;
  notes: string;
  updatedAt: string;
}

const LOCAL = 'demo-route-plans';
const readLocal = (): RoutePlan[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) || '[]');
  } catch {
    return [];
  }
};

export async function loadPlans(): Promise<{ plans: RoutePlan[]; error?: string }> {
  if (!DB) return { plans: readLocal().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  const { data, error } = await supabase().from('route_plans').select('*').order('updated_at', { ascending: false });
  if (error) return { plans: [], error: error.message };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plans: ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      scheduleId: r.schedule_id ?? '',
      travelDate: r.travel_date ?? '',
      candidates: (r.stops ?? []) as Candidate[],
      detourSpeedKmh: Number(r.detour_speed_kmh ?? 25),
      sampleKm: Number(r.sample_km ?? 1),
      notes: r.notes ?? '',
      updatedAt: r.updated_at,
    })),
  };
}

export async function savePlan(plan: Omit<RoutePlan, 'id' | 'updatedAt'> & { id?: string }): Promise<{ ok: boolean; plan?: RoutePlan; reason?: string }> {
  const now = new Date().toISOString();
  if (!DB) {
    const all = readLocal();
    const saved: RoutePlan = { ...plan, id: plan.id || `plan-${Date.now().toString(36)}`, updatedAt: now };
    const next = [saved, ...all.filter((p) => p.id !== saved.id)];
    try {
      localStorage.setItem(LOCAL, JSON.stringify(next));
    } catch {
      return { ok: false, reason: 'Could not save in this browser' };
    }
    return { ok: true, plan: saved };
  }
  const row = {
    name: plan.name,
    schedule_id: plan.scheduleId || null,
    travel_date: plan.travelDate || null,
    stops: plan.candidates,
    detour_speed_kmh: plan.detourSpeedKmh,
    sample_km: plan.sampleKm,
    notes: plan.notes,
    updated_at: now,
  };
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

// --------------------------------------------------------------- export ----

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function downloadSamplesCsv(name: string, samples: Sample[]) {
  const rows = [['n', 'km_from_start', 'latitude', 'longitude', 'bus_passed_at']];
  for (const s of samples) rows.push([String(s.n), s.km.toFixed(2), s.lat.toFixed(6), s.lng.toFixed(6), s.at]);
  download(`${name}.csv`, 'text/csv', rows.map((r) => r.join(',')).join('\n'));
}

export function downloadPlanCsv(name: string, list: Assessment[]) {
  const rows = [['name', 'latitude', 'longitude', 'off_road_km', 'km_from_start', 'after_stop', 'before_stop', 'bus_passed_at', 'extra_min', 'verdict', 'note']];
  for (const a of list)
    rows.push([
      csvCell(a.c.name),
      a.c.lat.toFixed(6),
      a.c.lng.toFixed(6),
      a.proj.offKm.toFixed(2),
      a.proj.alongKm.toFixed(2),
      csvCell(a.before?.name ?? ''),
      csvCell(a.after?.name ?? ''),
      a.proj.at,
      a.extraMin.toFixed(0),
      VERDICT_LABEL[a.verdict],
      csvCell(a.c.note ?? ''),
    ]);
  download(`${name}.csv`, 'text/csv', rows.map((r) => r.join(',')).join('\n'));
}

/** Samples as waypoints and candidate stops as named waypoints, for Google Earth / My Maps. */
export function downloadPlanGpx(name: string, samples: Sample[], list: Assessment[]) {
  const wpt = (lat: number, lng: number, n: string, desc = '') => `  <wpt lat="${lat}" lon="${lng}"><name>${esc(n)}</name>${desc ? `<desc>${esc(desc)}</desc>` : ''}</wpt>`;
  const body = [
    ...list.map((a) => wpt(a.c.lat, a.c.lng, a.c.name, `${VERDICT_LABEL[a.verdict]} · ${a.proj.offKm.toFixed(1)} km off · +${Math.round(a.extraMin)} min`)),
    ...samples.map((s) => wpt(s.lat, s.lng, `km ${s.km.toFixed(1)}`)),
  ].join('\n');
  download(`${name}.gpx`, 'application/gpx+xml', `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Siyan Lanka" xmlns="http://www.topografix.com/GPX/1/1">\n${body}\n</gpx>\n`);
}
