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

export async function fetchRoadRoute(stops: LatLng[], signal?: AbortSignal): Promise<{ route: RoadRoute | null; error?: string }> {
  if (stops.length < 2) return { route: null };
  const key = stops.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
  const hit = cache.get(key);
  if (hit) return { route: hit };
  try {
    const res = await fetch(`${ROUTING_URL.replace(/\/$/, '')}/${key}?overview=full&geometries=geojson&steps=false`, { signal });
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

const tableCache = new Map<string, number[][]>();

/**
 * Car minutes between every pair of points (OSRM "table" service, same server
 * as the routes). matrix[i][j] = minutes from point i to point j. Null when
 * the server can't be reached or doesn't offer it.
 */
export async function fetchDriveTable(points: LatLng[], signal?: AbortSignal): Promise<number[][] | null> {
  if (points.length < 2) return null;
  const key = points.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
  const hit = tableCache.get(key);
  if (hit) return hit;
  try {
    const base = ROUTING_URL.replace(/\/$/, '').replace('/route/', '/table/');
    const res = await fetch(`${base}/${key}?annotations=duration`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const m = data?.durations as (number | null)[][] | undefined;
    if (!m || m.length !== points.length) return null;
    const minutes = m.map((row) => row.map((s) => (s == null ? Infinity : s / 60)));
    tableCache.set(key, minutes);
    return minutes;
  } catch {
    return null;
  }
}
