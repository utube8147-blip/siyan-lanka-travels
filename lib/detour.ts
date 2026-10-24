'use client';
// Where the bus would turn off the usual road for an on-request stop.
//
// A passenger who booked an on-request stop that hasn't filled yet doesn't get
// moved to "the previous stop": they get off (or on) where the detour would
// leave the usual road, the point on the bus's way closest to where they
// wanted to go. That point is found from the road itself: the usual road
// (the stops either side, joined directly) and the detour road (through the
// office's shaping points to the stop) run together until the turn-off.

import { useEffect, useState } from 'react';
import { fetchRoadRoute, type LatLng } from './routing';
import type { RouteStop } from './types';

export interface Junction {
  lat: number;
  lng: number;
  /** Minutes from the route's first departure, between the stops either side. */
  offsetMin: number;
  /** Straight-line km from the junction to the stop that was booked. */
  kmToStop: number;
  /** The stop on the usual road just before the junction (index in route.stops). */
  after: number;
}

const kmBetween = (a: LatLng, b: LatLng) => {
  const r = Math.PI / 180;
  const x = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};

/** Distance (km) from p to segment a–b, and where along it (0–1); flat-earth, fine at road scale. */
function toSegment(p: LatLng, a: LatLng, b: LatLng) {
  const k = Math.cos((p[0] * Math.PI) / 180);
  const ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0], px = p[1] * k, py = p[0];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const q: LatLng = [ay + t * dy, (ax + t * dx) / k];
  return { d: kmBetween(p, q), t };
}

/**
 * The last point of `detour` that still lies on `usual` (within `tolKm`), and
 * how far along `usual` it is (0–1). Both paths start at the same stop.
 */
export function splitPoint(usual: LatLng[], detour: LatLng[], tolKm = 0.12): { point: LatLng; along: number } {
  const segKm = usual.slice(1).map((u, i) => kmBetween(usual[i], u));
  const total = segKm.reduce((a, b) => a + b, 0);
  const onUsual = (p: LatLng) => {
    let best = { d: Infinity, km: 0 };
    let before = 0;
    for (let i = 0; i < segKm.length; i++) {
      const { d, t } = toSegment(p, usual[i], usual[i + 1]);
      if (d < best.d) best = { d, km: before + t * segKm[i] };
      before += segKm[i];
    }
    return best;
  };
  let point = detour[0];
  let km = 0;
  for (const p of detour) {
    const n = onUsual(p);
    if (n.d > tolKm) break;
    point = p;
    km = n.km;
  }
  return { point, along: total > 0 ? km / total : 0 };
}

const has = (s: RouteStop): s is RouteStop & { lat: number; lng: number } => s.lat != null && s.lng != null;

/**
 * The turn-off for `name` on this trip, given the stops the bus is driving
 * (`road`, from roadStops). `part` says whether the passenger gets off there
 * (so the detour is the way in) or on (the way back out). Null while loading,
 * when the stop is on the road anyway, or when the road can't be fetched;
 * `fallback` is then the stop on the usual road to use instead.
 */
export function useJunction(stops: RouteStop[] | undefined, road: RouteStop[], name: string | null, part: 'board' | 'alight') {
  const [junction, setJunction] = useState<Junction | null>(null);
  const k = stops && name ? stops.findIndex((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) : -1;
  const target = k >= 0 && stops ? stops[k] : null;
  // By name: the way tonight may be a variant, with its own copies of the stops.
  const low = (x: string) => x.trim().toLowerCase();
  const onRoad = (s: RouteStop) => !s.hidden && road.some((r) => !r.hidden && low(r.name) === low(s.name));
  const roadAt = (s: RouteStop) => road.findIndex((r) => !r.hidden && low(r.name) === low(s.name));
  const skipped = !!target && !onRoad(target);
  // The stops on the usual road either side of it.
  let p = -1;
  let n = -1;
  if (skipped && stops) {
    for (let i = k - 1; i >= 0; i--) if (onRoad(stops[i])) { p = i; break; }
    for (let i = k + 1; i < stops.length; i++) if (onRoad(stops[i])) { n = i; break; }
  }
  const fallback = !skipped || !stops ? null : part === 'alight' ? (p >= 0 ? p : n) : n >= 0 ? n : p;
  const key = skipped && stops && p >= 0 && n >= 0 && target && has(target) ? `${part}|${k}|${p}|${n}|${stops.map((s) => `${s.lat},${s.lng}`).join(';')}|${road.map((s) => `${s.lat},${s.lng}`).join(';')}` : '';

  useEffect(() => {
    setJunction(null);
    if (!key || !stops) return;
    const ctl = new AbortController();
    const a = roadAt(stops[p]);
    const b = roadAt(stops[n]);
    if (a < 0 || b <= a) return;
    const usualPts = road.slice(a, b + 1).filter(has).map((s): LatLng => [s.lat, s.lng]);
    // The detour: from the stop before, through the shaping points, to the stop (or back out to the stop after).
    const way = part === 'alight' ? stops.slice(p, k + 1) : stops.slice(k, n + 1);
    const detourPts = way.filter((s, i) => (i === 0 || i === way.length - 1 || s.hidden) && has(s)).map((s): LatLng => [s.lat!, s.lng!]);
    Promise.all([fetchRoadRoute(usualPts, ctl.signal), fetchRoadRoute(detourPts, ctl.signal)]).then(([u, d]) => {
      if (ctl.signal.aborted || !u.route || !d.route) return;
      const usual = u.route.path;
      // Getting on: follow both roads backwards from the stop after, so they start together.
      const det = part === 'alight' ? d.route.path : [...d.route.path].reverse();
      const base = part === 'alight' ? usual : [...usual].reverse();
      const { point, along } = splitPoint(base, det);
      const frac = part === 'alight' ? along : 1 - along;
      const t = stops[k];
      setJunction({
        lat: point[0],
        lng: point[1],
        offsetMin: Math.round(road[a].offsetMin + frac * (road[b].offsetMin - road[a].offsetMin)),
        kmToStop: t.lat != null && t.lng != null ? kmBetween(point, [t.lat, t.lng]) : 0,
        after: p,
      });
    });
    return () => ctl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { junction, fallback, skipped };
}
