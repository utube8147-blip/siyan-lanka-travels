'use client';
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
    if (res.status === 429) return { route: null, error: 'The routing server is busy (too many requests). Try again in a moment.' };
    if (!res.ok) return { route: null, error: `The routing server answered ${res.status}.` };
    const data = await res.json();
    const r = data?.routes?.[0];
    const coords = r?.geometry?.coordinates as [number, number][] | undefined;
    if (!r || !coords?.length) return { route: null, error: data?.message || 'No road route found between these stops.' };
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
    return { route: null, error: 'Could not reach the routing server (offline?).' };
  }
}
