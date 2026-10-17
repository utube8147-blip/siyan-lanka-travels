'use client';
// lib/routeShare.ts — share a route plan by link, and Google Maps directions.
//
// A share is a snapshot (stops, road line, times, note) saved in route_shares
// (migration 34) under a random token. /share/route/<token> shows it to anyone
// with the link, read-only, until it is turned off. In demo mode shares are
// kept in this browser only.

import { isSupabaseConfigured as DB, supabase } from './supabase/client';

export interface SharedStop {
  name: string;
  lat: number;
  lng: number;
  /** Minutes after leaving the first stop. */
  offsetMin: number;
  landmark?: string;
}

export interface RouteShare {
  token: string;
  routeId: string | null;
  title: string;
  note: string;
  stops: SharedStop[];
  path: [number, number][] | null;
  distanceKm: number | null;
  departure: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const LOCAL = 'demo-route-shares';
const readLocal = (): RouteShare[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) || '[]');
  } catch {
    return [];
  }
};
const writeLocal = (all: RouteShare[]) => {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
};

/** 22 random letters and digits (about 130 bits): impossible to guess. */
function newToken() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export const shareUrl = (token: string) => `${window.location.origin}/share/route/${token}`;

/** Fewer points for the road line: enough to look right, small enough to store. */
function thin(path: [number, number][], max = 1500): [number, number][] {
  if (path.length <= max) return path.map(([a, b]) => [round5(a), round5(b)]);
  const step = path.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(path[Math.floor(i * step)]);
  out.push(path[path.length - 1]);
  return out.map(([a, b]) => [round5(a), round5(b)]);
}
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

export async function createShare(s: Omit<RouteShare, 'token' | 'createdAt' | 'revokedAt'>): Promise<{ ok: boolean; share?: RouteShare; reason?: string }> {
  const share: RouteShare = { ...s, path: s.path ? thin(s.path) : null, token: newToken(), createdAt: new Date().toISOString(), revokedAt: null };
  if (!DB) return writeLocal([share, ...readLocal()]) ? { ok: true, share } : { ok: false, reason: 'Could not save in this browser' };
  const { error } = await supabase()
    .from('route_shares')
    .insert({ token: share.token, route_id: share.routeId, title: share.title, note: share.note, stops: share.stops, path: share.path, distance_km: share.distanceKm, departure: share.departure });
  if (error) return { ok: false, reason: /route_shares|schema cache/.test(error.message) ? 'Sharing needs the database update: run migration 34 (route share links).' : error.message };
  return { ok: true, share };
}

/** This route's links that are still on, newest first. */
export async function listShares(routeId: string): Promise<{ shares: RouteShare[]; error?: string }> {
  if (!DB) return { shares: readLocal().filter((x) => x.routeId === routeId && !x.revokedAt) };
  const { data, error } = await supabase().from('route_shares').select('*').eq('route_id', routeId).is('revoked_at', null).order('created_at', { ascending: false });
  if (error) return { shares: [], error: /route_shares|schema cache/.test(error.message) ? 'Sharing needs the database update: run migration 34 (route share links).' : error.message };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { shares: ((data as any[]) ?? []).map(fromRow) };
}

export async function revokeShare(token: string): Promise<{ ok: boolean; reason?: string }> {
  if (!DB) return { ok: writeLocal(readLocal().map((x) => (x.token === token ? { ...x, revokedAt: new Date().toISOString() } : x))) };
  const { error } = await supabase().from('route_shares').update({ revoked_at: new Date().toISOString() }).eq('token', token);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** For the public page: the link's snapshot, or null if it doesn't exist or was turned off. */
export async function getShare(token: string): Promise<RouteShare | null> {
  if (!DB) return readLocal().find((x) => x.token === token && !x.revokedAt) ?? null;
  const { data, error } = await supabase().rpc('get_route_share', { p_token: token });
  if (error || !data) return null;
  return fromRow({ ...data, token });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): RouteShare {
  return {
    token: r.token,
    routeId: r.route_id ?? null,
    title: r.title,
    note: r.note ?? '',
    stops: r.stops ?? [],
    path: r.path ?? null,
    distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
    departure: r.departure ?? null,
    createdAt: r.created_at,
    revokedAt: r.revoked_at ?? null,
  };
}

// --------------------------------------------------------- Google Maps ----
// A Google Maps directions link holds a start, an end and up to 9 stops in
// between (fewer on some phones), so longer routes are split into parts that
// follow on from each other: part 2 starts where part 1 ends.

export interface MapsPart {
  url: string;
  from: string;
  to: string;
  stops: number;
}

export function googleMapsParts(stops: { name: string; lat?: number; lng?: number }[], perLink = 10): MapsPart[] {
  const pts = stops.filter((s) => s.lat != null && s.lng != null) as { name: string; lat: number; lng: number }[];
  if (pts.length < 2) return [];
  const ll = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
  const parts: MapsPart[] = [];
  // Even parts (12 stops → 7 + 6, not 10 + 3); each part starts where the last one ended.
  const count = Math.ceil((pts.length - 1) / (perLink - 1));
  const span = Math.ceil((pts.length - 1) / count);
  for (let start = 0; start < pts.length - 1; start += span) {
    const chunk = pts.slice(start, start + span + 1);
    const origin = chunk[0];
    const dest = chunk[chunk.length - 1];
    const mid = chunk.slice(1, -1);
    const q = new URLSearchParams({ api: '1', origin: ll(origin), destination: ll(dest), travelmode: 'driving' });
    if (mid.length) q.set('waypoints', mid.map(ll).join('|'));
    parts.push({ url: `https://www.google.com/maps/dir/?${q.toString()}`, from: origin.name, to: dest.name, stops: chunk.length });
  }
  return parts;
}
