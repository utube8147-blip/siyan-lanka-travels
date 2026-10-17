'use client';
// The whole road a bus took on a trip, from the full GPS log (admin → GPS trip log).
// Leaflet + OpenStreetMap, like the passenger map (components/trip/BusMap.tsx).

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { touchpadFriendlyWheel } from './mapWheel';
import type { Map as LMap, LayerGroup, CircleMarker } from 'leaflet';
import type { Fill, Gap, GpsPoint, Stop } from '@/lib/gpsLog';
import type { RouteStop } from '@/lib/types';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function GpsRouteMap({
  points,
  routeStops,
  stops,
  gaps,
  focus,
  fills = [],
  className = '',
}: {
  points: GpsPoint[];
  routeStops: RouteStop[];
  stops: Stop[];
  gaps: Gap[];
  /** Index into `points` to highlight (time slider / table click). */
  focus: number | null;
  /** Big jumps between points, with the likely road between them. */
  fills?: Fill[];
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const focusMarker = useRef<CircleMarker | null>(null);
  const fittedFor = useRef<string>('');
  const [ready, setReady] = useState(false);
  const unWheel = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      map.current = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, zoomSnap: 0.5 }).setView([7.6, 80.9], 7);
      unWheel.current = touchpadFriendlyWheel(map.current);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true); // the effects below draw with the latest data
    })();
    return () => {
      cancelled = true;
      unWheel.current?.();
      map.current?.remove();
      map.current = null;
      focusMarker.current = null;
      fittedFor.current = '';
      setReady(false);
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (!ready || !map.current) return;
      draw((await import('leaflet')).default);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, points, routeStops, stops, gaps, fills]);

  useEffect(() => {
    (async () => {
      if (!ready || !map.current) return;
      drawFocus((await import('leaflet')).default, true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus, points]);

  function drawFocus(L: typeof import('leaflet'), pan = false) {
    if (!map.current) return;
    focusMarker.current?.remove();
    focusMarker.current = null;
    const p = focus != null ? points[focus] : null;
    if (!p) return;
    focusMarker.current = L.circleMarker([p.lat, p.lng], { radius: 10, color: '#050a44', weight: 3, fillColor: '#ffffff', fillOpacity: 1 })
      .bindTooltip(`${time(p.at)}${p.speedKmh != null ? ` · ${Math.round(p.speedKmh)} km/h` : ''}`, { permanent: true, direction: 'top', offset: [0, -10] })
      .addTo(map.current);
    if (pan && !map.current.getBounds().pad(-0.1).contains([p.lat, p.lng])) map.current.panTo([p.lat, p.lng]);
  }

  function draw(L: typeof import('leaflet')) {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();

    // The route's stops, faint.
    const planned = routeStops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lng!] as [number, number]);
    if (planned.length > 1) L.polyline(planned, { color: '#050a44', weight: 2, opacity: 0.2, dashArray: '6 8' }).addTo(layer.current);
    routeStops.forEach((s) => {
      if (s.lat == null) return;
      L.circleMarker([s.lat, s.lng!], { radius: 4, color: '#050a44', weight: 1, fillColor: '#050a44', fillOpacity: 0.35 }).bindTooltip(s.name, { direction: 'top' }).addTo(layer.current!);
    });

    if (points.length === 0) {
      if (planned.length && fittedFor.current !== 'planned') {
        map.current.fitBounds(L.latLngBounds(planned).pad(0.1));
        fittedFor.current = 'planned';
      }
      return;
    }

    // The road actually driven. Where the phone went quiet, the line breaks:
    // - a big jump with a likely road from the routing server: that road, dotted red ("estimated");
    // - otherwise a straight dashed red line.
    const gapStarts = new Set(gaps.map((g) => g.from));
    const fillTo = new Map(fills.map((f) => [f.to, f]));
    let seg: [number, number][] = [];
    const flush = () => {
      if (seg.length > 1) {
        L.polyline(seg, { color: '#050a44', weight: 7, opacity: 0.25 }).addTo(layer.current!);
        L.polyline(seg, { color: '#feb700', weight: 4, opacity: 0.95 }).addTo(layer.current!);
      }
    };
    points.forEach((p, i) => {
      seg.push([p.lat, p.lng]);
      const next = points[i + 1];
      if (!next) return;
      const fill = fillTo.get(i + 1);
      const gap = gaps.find((g) => g.from === p.at);
      const quiet = gap ? `No GPS for ${gap.minutes} min` : fill ? `No GPS for ${fill.minutes} min` : '';
      if (fill?.path) {
        flush();
        L.polyline(fill.path, { color: '#ffffff', weight: 7, opacity: 0.6, interactive: false }).addTo(layer.current!);
        L.polyline(fill.path, { color: '#ba1a1a', weight: 4, opacity: 0.9, dashArray: '1 8', lineCap: 'round' })
          .bindTooltip(`${quiet}: likely road ${fill.roadKm!.toFixed(1)} km (estimated, ${fill.straightKm.toFixed(1)} km straight)`, { sticky: true })
          .addTo(layer.current!);
        seg = [];
      } else if (fill || gapStarts.has(p.at)) {
        flush();
        L.polyline([[p.lat, p.lng], [next.lat, next.lng]], { color: '#ba1a1a', weight: 3, opacity: 0.8, dashArray: '4 8' })
          .bindTooltip(fill ? `${quiet}: ${fill.straightKm.toFixed(1)} km straight (no road found yet)` : quiet, { sticky: true })
          .addTo(layer.current!);
        seg = [];
      }
    });
    flush();

    // Every recorded point, small, so the exact fixes can be checked.
    const r = map.current.getZoom() >= 14 ? 3 : 2;
    points.forEach((p) =>
      L.circleMarker([p.lat, p.lng], { radius: r, color: '#7c5800', weight: 1, fillColor: '#feb700', fillOpacity: 1 })
        .bindTooltip(`${time(p.at)}${p.until ? `–${time(p.until)}` : ''}${p.speedKmh != null ? ` · ${Math.round(p.speedKmh)} km/h` : ''}${p.accuracyM != null ? ` · ±${Math.round(p.accuracyM)} m` : ''}`)
        .addTo(layer.current!),
    );

    // Where it stood still.
    stops.forEach((s) =>
      L.circleMarker([s.lat, s.lng], { radius: 8, color: '#050a44', weight: 2, fillColor: '#feb700', fillOpacity: 0.6 })
        .bindTooltip(`Stopped ${s.minutes} min (${time(s.from).slice(0, 5)}–${time(s.to).slice(0, 5)})`, { direction: 'top' })
        .addTo(layer.current!),
    );

    const pin = (label: string, bg: string, fg: string) =>
      L.divIcon({
        className: '',
        html: `<div style="min-width:28px;height:28px;padding:0 6px;border-radius:14px;background:${bg};color:${fg};border:2px solid #050a44;font:700 11px/24px system-ui,sans-serif;text-align:center;box-shadow:0 3px 10px rgba(0,0,0,.3)">${label}</div>`,
        iconSize: [36, 28],
        iconAnchor: [18, 14],
      });
    const first = points[0];
    const last = points[points.length - 1];
    L.marker([first.lat, first.lng], { icon: pin('Start', '#ffffff', '#050a44'), zIndexOffset: 900 }).bindTooltip(`First point ${time(first.at)}`).addTo(layer.current);
    if (points.length > 1) L.marker([last.lat, last.lng], { icon: pin('End', '#feb700', '#050a44'), zIndexOffset: 1000 }).bindTooltip(`Last point ${time(last.at)}`).addTo(layer.current);

    // Frame the whole journey once per trip (not on every refresh, so zooming in stays put).
    const key = `${first.at}`;
    if (fittedFor.current !== key) {
      map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.08));
      fittedFor.current = key;
    }
  }

  return <div ref={el} className={`relative z-0 w-full rounded-2xl overflow-hidden border border-[#e1e2e4] bg-[#e8ecef] ${className}`} role="img" aria-label="Map of the road the bus took" />;
}
