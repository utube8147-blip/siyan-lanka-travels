'use client';
// Map for the route editor: numbered stop pins you can drag, the road route
// through them, the saved route for comparison, and an uploaded GPS track.

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, LayerGroup } from 'leaflet';
import type { LatLng } from '@/lib/routeEditor';

export interface EditorStop {
  name: string;
  lat?: number;
  lng?: number;
}

export function RouteEditorMap({
  stops,
  selected,
  editedRoad,
  savedRoad,
  gps,
  picking,
  onMoveStop,
  onSelect,
  onMapClick,
  fitKey,
  className = '',
}: {
  stops: EditorStop[];
  selected: number | null;
  /** Road route through the stops as they are now. */
  editedRoad?: LatLng[] | null;
  /** Road route of the saved (live) route, for comparison. */
  savedRoad?: LatLng[] | null;
  /** An uploaded GPS track (the road a bus really drove). */
  gps?: LatLng[] | null;
  /** The map is waiting for a click to place a stop. */
  picking: boolean;
  onMoveStop: (i: number, lat: number, lng: number) => void;
  onSelect: (i: number) => void;
  onMapClick: (lat: number, lng: number) => void;
  /** The map frames everything again when this changes. */
  fitKey: string;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef('');
  const [ready, setReady] = useState(false);
  const cb = useRef({ onMoveStop, onSelect, onMapClick });
  cb.current = { onMoveStop, onSelect, onMapClick };

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
      map.current.on('click', (e) => cb.current.onMapClick(e.latlng.lat, e.latlng.lng));
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      fitted.current = '';
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (el.current) el.current.style.cursor = picking ? 'crosshair' : '';
    const pane = el.current?.querySelector('.leaflet-container') as HTMLElement | null;
    if (pane) pane.style.cursor = picking ? 'crosshair' : '';
  }, [picking]);

  useEffect(() => {
    (async () => {
      if (!ready || !map.current) return;
      draw((await import('leaflet')).default);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stops, selected, editedRoad, savedRoad, gps, fitKey]);

  // Bring the picked stop into view.
  useEffect(() => {
    const s = selected != null ? stops[selected] : null;
    if (!ready || !map.current || s?.lat == null) return;
    if (!map.current.getBounds().pad(-0.15).contains([s.lat, s.lng!])) map.current.panTo([s.lat, s.lng!]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ready]);

  function draw(L: typeof import('leaflet')) {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();

    if (gps && gps.length > 1) {
      L.polyline(gps, { color: '#7c5800', weight: 7, opacity: 0.25, interactive: false }).addTo(layer.current);
      L.polyline(gps, { color: '#feb700', weight: 3, opacity: 0.95 }).bindTooltip('Road driven (GPS file)', { sticky: true }).addTo(layer.current);
    }
    if (savedRoad && savedRoad.length > 1) L.polyline(savedRoad, { color: '#050a44', weight: 4, opacity: 0.45, dashArray: '8 8' }).bindTooltip('Saved route', { sticky: true }).addTo(layer.current);
    if (editedRoad && editedRoad.length > 1) {
      L.polyline(editedRoad, { color: '#ffffff', weight: 8, opacity: 0.7, interactive: false }).addTo(layer.current);
      L.polyline(editedRoad, { color: '#1f7a3a', weight: 5, opacity: 0.9 }).bindTooltip('Route as edited', { sticky: true }).addTo(layer.current);
    }

    const last = stops.length - 1;
    stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      const end = i === 0 || i === last;
      const on = i === selected;
      const bg = end ? '#050a44' : '#ffffff';
      const fg = end ? '#ffffff' : '#050a44';
      const size = on ? 30 : 24;
      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;gap:5px;width:max-content"><div style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${fg};border:${on ? 4 : 3}px solid ${on ? '#feb700' : '#050a44'};box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:800 11px system-ui,sans-serif">${i + 1}</div><span style="font:700 11px system-ui,sans-serif;color:#050a44;background:rgba(255,255,255,.92);padding:1px 6px;border-radius:6px;white-space:nowrap">${(s.name || `Stop ${i + 1}`).replace(/</g, '&lt;')}</span></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const m = L.marker([s.lat, s.lng], { icon, draggable: true, zIndexOffset: on ? 2000 : 1000 - i }).addTo(layer.current!);
      m.on('click', () => cb.current.onSelect(i));
      m.on('dragend', () => {
        const ll = m.getLatLng();
        cb.current.onMoveStop(i, ll.lat, ll.lng);
      });
    });

    if (fitted.current !== fitKey) {
      const pts: LatLng[] = [...stops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lng!] as LatLng), ...(gps ?? [])];
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts).pad(0.08));
      else if (pts.length === 1) map.current.setView(pts[0], 12);
      if (pts.length) fitted.current = fitKey;
    }
  }

  return <div ref={el} className={`relative z-0 w-full rounded-2xl overflow-hidden border border-[#e1e2e4] bg-[#e8ecef] ${className}`} role="application" aria-label="Route map: drag stops to move them, click the map to add one" />;
}
