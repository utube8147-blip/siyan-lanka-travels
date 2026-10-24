'use client';
// Read-only map for a shared route (/share/route/<token>): the road and the numbered stops.

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, LayerGroup } from 'leaflet';
import { touchpadFriendlyWheel } from './admin/mapWheel';
import { tx } from '@/lib/i18n';

export function RouteShareMap({
  stops,
  path,
  selected,
  onSelect,
  compactLabels = false,
  className = '',
}: {
  stops: { name: string; lat: number; lng: number }[];
  path: [number, number][] | null;
  selected: number | null;
  onSelect: (i: number) => void;
  /** Name only the first and last stops (and the one tapped), so a small map stays readable. */
  compactLabels?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const cb = useRef(onSelect);
  cb.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    let unWheel: (() => void) | null = null;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      map.current = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, zoomSnap: 0.5 }).setView([7.6, 80.9], 7);
      unWheel = touchpadFriendlyWheel(map.current);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      unWheel?.();
      map.current?.remove();
      map.current = null;
      fitted.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (!ready || !map.current || !layer.current) return;
      const L = (await import('leaflet')).default;
      layer.current.clearLayers();
      const line = path && path.length > 1 ? path : stops.map((s) => [s.lat, s.lng] as [number, number]);
      L.polyline(line, { color: '#ffffff', weight: 9, opacity: 0.7, interactive: false }).addTo(layer.current);
      L.polyline(line, { color: '#050a44', weight: 5, opacity: 0.9, dashArray: path ? undefined : '6 8', interactive: false }).addTo(layer.current);
      const last = stops.length - 1;
      stops.forEach((s, i) => {
        const end = i === 0 || i === last;
        const on = i === selected;
        const size = on ? 30 : 24;
        const icon = L.divIcon({
          className: '',
          html: `<div style="display:flex;align-items:center;gap:5px;width:max-content"><div style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${end ? '#050a44' : '#feb700'};color:${end ? '#fff' : '#050a44'};border:3px solid ${on ? '#feb700' : '#050a44'};box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:800 11px system-ui,sans-serif">${i + 1}</div>${!compactLabels || end || on ? `<span style="font:700 11px system-ui,sans-serif;color:#050a44;background:rgba(255,255,255,.92);padding:1px 6px;border-radius:6px;white-space:nowrap">${s.name.replace(/</g, '&lt;')}</span>` : ''}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        L.marker([s.lat, s.lng], { icon, zIndexOffset: on ? 2000 : 1000 - i, keyboard: false })
          .on('click', () => cb.current(i))
          .addTo(layer.current!);
      });
      if (!fitted.current && line.length) {
        map.current.fitBounds(L.latLngBounds(line), { paddingTopLeft: [30, 30], paddingBottomRight: [120, 30] }); // room for the stop names on the right
        fitted.current = true;
      }
    })();
  }, [ready, stops, path, selected, compactLabels]);

  useEffect(() => {
    const s = selected != null ? stops[selected] : null;
    if (!ready || !map.current || !s) return;
    if (!map.current.getBounds().pad(-0.15).contains([s.lat, s.lng])) map.current.panTo([s.lat, s.lng]);
  }, [selected, ready, stops]);

  return <div ref={el} className={`relative z-0 w-full rounded-2xl overflow-hidden border border-[#e1e2e4] bg-[#e8ecef] ${className}`} role="img" aria-label={tx('Map of the route')} />;
}
