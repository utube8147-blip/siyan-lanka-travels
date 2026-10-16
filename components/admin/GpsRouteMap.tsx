'use client';
// The whole road a bus took on a trip, from the full GPS log (admin → GPS trip log).
// Leaflet + OpenStreetMap, like the passenger map (components/trip/BusMap.tsx).

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, LayerGroup, CircleMarker } from 'leaflet';
import type { Gap, GpsPoint, Stop } from '@/lib/gpsLog';
import type { Assessment, Candidate, Sample } from '@/lib/routePlan';
import type { RouteStop } from '@/lib/types';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function GpsRouteMap({
  points,
  routeStops,
  stops,
  gaps,
  focus,
  samples = [],
  candidates = [],
  assessments = [],
  showPoints = true,
  onMapClick,
  onMoveCandidate,
  className = '',
}: {
  points: GpsPoint[];
  routeStops: RouteStop[];
  stops: Stop[];
  gaps: Gap[];
  /** Index into `points` to highlight (time slider / table click). */
  focus: number | null;
  /** Planning: points every N km along the road. */
  samples?: Sample[];
  /** Planning: places that might become new stops (draggable). */
  candidates?: Candidate[];
  assessments?: Assessment[];
  /** Draw every raw GPS fix as a dot. */
  showPoints?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  onMoveCandidate?: (id: string, lat: number, lng: number) => void;
  className?: string;
}) {
  // Latest callbacks, so Leaflet handlers registered once still call the current ones.
  const cb = useRef({ onMapClick, onMoveCandidate });
  cb.current = { onMapClick, onMoveCandidate };
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const focusMarker = useRef<CircleMarker | null>(null);
  const fittedFor = useRef<string>('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      map.current = L.map(el.current, { zoomControl: true, scrollWheelZoom: true }).setView([7.6, 80.9], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      map.current.on('click', (e) => cb.current.onMapClick?.(e.latlng.lat, e.latlng.lng));
      setReady(true); // the effects below draw with the latest data
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      focusMarker.current = null;
      fittedFor.current = '';
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!ready || !map.current) return;
      draw((await import('leaflet')).default);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, points, routeStops, stops, gaps, samples, candidates, assessments, showPoints]);

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

    // The planned route, faint.
    const planned = routeStops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lng!] as [number, number]);
    if (planned.length > 1) L.polyline(planned, { color: '#050a44', weight: 2, opacity: 0.2, dashArray: '6 8' }).addTo(layer.current);
    routeStops.forEach((s) => {
      if (s.lat == null) return;
      L.circleMarker([s.lat, s.lng!], { radius: 4, color: '#050a44', weight: 1, fillColor: '#050a44', fillOpacity: 0.35 }).bindTooltip(s.name, { direction: 'top' }).addTo(layer.current!);
    });

    if (points.length === 0) {
      if (planned.length) map.current.fitBounds(L.latLngBounds(planned).pad(0.1));
      return;
    }

    // The road actually driven, split where the phone went quiet (gaps are drawn dashed).
    const gapStarts = new Set(gaps.map((g) => g.from));
    let seg: [number, number][] = [];
    const flush = () => {
      if (seg.length > 1) {
        L.polyline(seg, { color: '#050a44', weight: 7, opacity: 0.25 }).addTo(layer.current!);
        L.polyline(seg, { color: '#feb700', weight: 4, opacity: 0.95 }).addTo(layer.current!);
      }
    };
    points.forEach((p, i) => {
      seg.push([p.lat, p.lng]);
      if (gapStarts.has(p.at) && points[i + 1]) {
        flush();
        L.polyline([[p.lat, p.lng], [points[i + 1].lat, points[i + 1].lng]], { color: '#ba1a1a', weight: 3, opacity: 0.8, dashArray: '4 8' })
          .bindTooltip(`No GPS for ${gaps.find((g) => g.from === p.at)?.minutes ?? '?'} min`)
          .addTo(layer.current!);
        seg = [];
      }
    });
    flush();

    // Every recorded point, small, so the exact fixes can be checked.
    const r = map.current.getZoom() >= 14 ? 3 : 2;
    if (showPoints)
      points.forEach((p) =>
        L.circleMarker([p.lat, p.lng], { radius: r, color: '#7c5800', weight: 1, fillColor: '#feb700', fillOpacity: 1 })
          .bindTooltip(`${time(p.at)}${p.until ? `–${time(p.until)}` : ''}${p.speedKmh != null ? ` · ${Math.round(p.speedKmh)} km/h` : ''}${p.accuracyM != null ? ` · ±${Math.round(p.accuracyM)} m` : ''}`)
          .addTo(layer.current!),
      );

    // Planning: samples along the road.
    samples.forEach((s) =>
      L.circleMarker([s.lat, s.lng], { radius: 5, color: '#ffffff', weight: 2, fillColor: '#050a44', fillOpacity: 1 })
        .bindTooltip(`km ${s.km.toFixed(1)} · bus passed ${time(s.at).slice(0, 5)}`, { direction: 'top' })
        .addTo(layer.current!),
    );

    // Planning: candidate stops, with a line to where they meet the road.
    candidates.forEach((c, i) => {
      const a = assessments.find((x) => x.c.id === c.id);
      const colour = !a ? '#6b6d78' : a.verdict === 'on-road' ? '#1f7a3a' : a.verdict === 'small' ? '#7c5800' : '#ba1a1a';
      if (a && a.proj.offKm > 0.02)
        L.polyline([[c.lat, c.lng], [a.proj.lat, a.proj.lng]], { color: colour, weight: 2, dashArray: '3 5', interactive: false }).addTo(layer.current!);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${colour};border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:800 12px system-ui,sans-serif">${i + 1}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      const m = L.marker([c.lat, c.lng], { icon, draggable: true, zIndexOffset: 1200 })
        .bindTooltip(`${c.name}${a ? ` · ${a.proj.offKm.toFixed(1)} km off the road · +${Math.round(a.extraMin)} min` : ''}`, { direction: 'top', offset: [0, -26] })
        .addTo(layer.current!);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        cb.current.onMoveCandidate?.(c.id, ll.lat, ll.lng);
      });
    });

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
