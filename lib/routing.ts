'use client';
import { tx } from '@/lib/i18n';
// lib/routing.ts — road route through a list of stops, from an OSRM server.
//
// Uses NEXT_PUBLIC_ROUTING_URL (the older spelling NEXT_PUBLIC_ROUING_URL also
// works). The default is the free public OSRM demo server: fine for planning,
// but it is rate-limited (about 1 request a second) and has no bus profile,
// so times are car times. The planner multiplies them by a bus factor.

export type LatLng = [number, number];

export interface RoadRoute {
  path: LatLng[];
  distanceKm: number;
  durationMin: number;
  /** One per pair of consecutive stops. */
  legs: { km: number; min: number }[];
}

const ROUTING_URL =
  process.env.NEXT_PUBLIC_ROUTING_URL || process.env.NEXT_PUBLIC_ROUING_URL || 'https://router.project-osrm.org/route/v1/driving';

const cache = new Map<string, RoadRoute>();
const pending = new Map<string, Promise<{ route: RoadRoute | null; error?: string }>>();

/**
 * The free public server allows about one request a second: requests to it
 * wait their turn (a short queue), and a "busy" answer is retried once.
 * Your own server (NEXT_PUBLIC_ROUTING_URL) isn't queued.
 */
const PUBLIC = /router\.project-osrm\.org/.test(ROUTING_URL);
let nextSlot = 0;
async function turn(signal?: AbortSignal) {
  if (!PUBLIC) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1100;
  if (at > now) await new Promise<void>((ok, no) => {
    const t = setTimeout(ok, at - now);
    signal?.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

export async function fetchRoadRoute(stops: LatLng[], signal?: AbortSignal): Promise<{ route: RoadRoute | null; error?: string }> {
  if (stops.length < 2) return { route: null };
  const key = stops.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
  const hit = cache.get(key);
  if (hit) return { route: hit };
  // The same road asked for twice at once (two maps on a page): one request.
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const p = request(key, signal).finally(() => pending.delete(key));
  if (!signal) pending.set(key, p);
  return p;
}

async function request(key: string, signal?: AbortSignal, retried = false): Promise<{ route: RoadRoute | null; error?: string }> {
  try {
    await turn(signal);
    const res = await fetch(`${ROUTING_URL.replace(/\/$/, '')}/${key}?overview=full&geometries=geojson&steps=false`, { signal });
    if (res.status === 429 && !retried) {
      nextSlot = Date.now() + 2500;
      return request(key, signal, true);
    }
    if (res.status === 429) return { route: null, error: tx('The routing server is busy (too many requests). Try again in a moment.') };
    if (!res.ok) return { route: null, error: tx('The routing server answered {status}.', { status: res.status }) };
    const data = await res.json();
    const r = data?.routes?.[0];
    const coords = r?.geometry?.coordinates as [number, number][] | undefined;
    if (!r || !coords?.length) return { route: null, error: data?.message || tx('No road route found between these stops.') };
    const route: RoadRoute = {
      path: coords.map(([lng, lat]): LatLng => [lat, lng]),
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      legs: (r.legs ?? []).map((l: any) => ({ km: l.distance / 1000, min: l.duration / 60 })),
    };
    cache.set(key, route);
    return { route };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return { route: null };
    return { route: null, error: tx('Could not reach the routing server (offline?).') };
  }
}

