'use client';
// Map for the route editor: numbered stop pins you can drag, the road route
// through them, the saved route for comparison, and an uploaded GPS track.

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { touchpadFriendlyWheel } from './mapWheel';
import type { Map as LMap, LayerGroup } from 'leaflet';
import type { LatLng } from '@/lib/routeEditor';
import { tx } from '@/lib/i18n';

export interface EditorStop {
  name: string;
  lat?: number;
  lng?: number;
  /** A shaping point, not shown to passengers. */
  hidden?: boolean;
}

export function RouteEditorMap({
  stops,
  selected,
  editedRoad,
  savedRoad,
  gps,
  picking,
  follow = null,
  pending = null,
  onMovePending,
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
  gps?: { line: LatLng[]; est: boolean[] } | null;
  /** The map is waiting for a click to place a stop. */
  picking: boolean;
  /** The stop in view in the list: the map pans to it (and rings it). */
  follow?: number | null;
  /** A place waiting to be added, with the stops it would go between. */
  pending?: { lat: number; lng: number; prev: LatLng | null; next: LatLng | null } | null;
  onMovePending?: (lat: number, lng: number) => void;
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
  const unWheel = useRef<(() => void) | null>(null);
  const cb = useRef({ onMoveStop, onSelect, onMapClick, onMovePending });
  cb.current = { onMoveStop, onSelect, onMapClick, onMovePending };

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
      map.current.on('click', (e) => cb.current.onMapClick(e.latlng.lat, e.latlng.lng));
      setReady(true);
    })();
    return () => {
      cancelled = true;
      unWheel.current?.();
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
  }, [ready, stops, selected, editedRoad, savedRoad, gps, fitKey, follow, pending]);

  // Follow the list: pan (not zoom) to the stop in view when it's off the map.
  useEffect(() => {
    const s = follow != null ? stops[follow] : null;
    if (!ready || !map.current || s?.lat == null) return;
    if (!map.current.getBounds().pad(-0.15).contains([s.lat, s.lng!])) map.current.panTo([s.lat, s.lng!], { animate: true, duration: 0.4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, ready]);

  // A new place to add: make sure it's in view.
  useEffect(() => {
    if (!ready || !map.current || !pending) return;
    if (!map.current.getBounds().pad(-0.1).contains([pending.lat, pending.lng])) map.current.panTo([pending.lat, pending.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.lat, pending?.lng, ready]);

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

    if (gps && gps.line.length > 1) {
      // Runs of real GPS (gold) and of estimated road filling a gap (dotted red).
      let run: LatLng[] = [gps.line[0]];
      let runEst = !!gps.est[1] && !!gps.est[0];
      const flush = () => {
        if (run.length < 2) return;
        if (runEst) {
          L.polyline(run, { color: '#ffffff', weight: 6, opacity: 0.6, interactive: false }).addTo(layer.current!);
          L.polyline(run, { color: '#ba1a1a', weight: 4, opacity: 0.9, dashArray: '1 8', lineCap: 'round' }).bindTooltip(tx('No GPS here: likely road (estimated)'), { sticky: true }).addTo(layer.current!);
        } else {
          L.polyline(run, { color: '#7c5800', weight: 7, opacity: 0.25, interactive: false }).addTo(layer.current!);
          L.polyline(run, { color: '#feb700', weight: 3, opacity: 0.95 }).bindTooltip(tx('Road driven (GPS file)'), { sticky: true }).addTo(layer.current!);
        }
      };
      for (let i = 1; i < gps.line.length; i++) {
        // A segment is estimated if either end is an estimated point.
        const segEst = !!gps.est[i] || !!gps.est[i - 1];
        if (segEst !== runEst) {
          flush();
          run = [gps.line[i - 1]];
          runEst = segEst;
        }
        run.push(gps.line[i]);
      }
      flush();
    }
    if (savedRoad && savedRoad.length > 1) L.polyline(savedRoad, { color: '#050a44', weight: 4, opacity: 0.45, dashArray: '8 8' }).bindTooltip(tx('Saved route'), { sticky: true }).addTo(layer.current);
    if (editedRoad && editedRoad.length > 1) {
      L.polyline(editedRoad, { color: '#ffffff', weight: 8, opacity: 0.7, interactive: false }).addTo(layer.current);
      L.polyline(editedRoad, { color: '#1f7a3a', weight: 5, opacity: 0.9 }).bindTooltip(tx('Route as edited'), { sticky: true }).addTo(layer.current);
    }

    const last = stops.length - 1;
    stops.forEach((s, i) => {
      if (s.lat == null || s.lng == null) return;
      const end = i === 0 || i === last;
      const on = i === selected;
      const seen = !on && i === follow;
      const ghost = !!s.hidden && !end; // shaping point: small, grey, no name unless selected
      const bg = end ? '#050a44' : ghost ? '#e5e7eb' : '#ffffff';
      const fg = end ? '#ffffff' : ghost ? '#6b6d78' : '#050a44';
      const size = on ? 30 : ghost ? 18 : 24;
      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;gap:5px;width:max-content"><div style="flex:none;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${fg};border:${on ? 4 : 3}px solid ${on ? '#feb700' : '#050a44'};box-shadow:${seen ? '0 0 0 6px rgba(254,183,0,.45),' : ''}0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:800 ${ghost && !on ? 9 : 11}px system-ui,sans-serif">${i + 1}</div>${ghost && !on ? '' : `<span style="font:700 11px system-ui,sans-serif;color:#050a44;background:rgba(255,255,255,.92);padding:1px 6px;border-radius:6px;white-space:nowrap">${(s.name || `Stop ${i + 1}`).replace(/</g, '&lt;')}${ghost ? ' (hidden)' : ''}</span>`}</div>`,
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

    // The place waiting to be added: a gold pin, dotted lines to the stops it would go between.
    if (pending) {
      for (const end of [pending.prev, pending.next]) {
        if (end) L.polyline([end, [pending.lat, pending.lng]], { color: '#7c5800', weight: 3, dashArray: '2 7', opacity: 0.9, interactive: false }).addTo(layer.current);
      }
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#feb700;border:3px solid #050a44;box-shadow:0 3px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#050a44;font:900 16px/1 system-ui,sans-serif">+</span></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      });
      const m = L.marker([pending.lat, pending.lng], { icon, draggable: true, zIndexOffset: 3000 }).bindTooltip(tx('New stop: drag to adjust'), { direction: 'top', offset: [0, -28] }).addTo(layer.current);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        cb.current.onMovePending?.(ll.lat, ll.lng);
      });
    }

    if (fitted.current !== fitKey) {
      const pts: LatLng[] = [...stops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lng!] as LatLng), ...(gps?.line ?? [])];
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [30, 30], paddingBottomRight: [120, 30] }); // room for the stop names on the right
      else if (pts.length === 1) map.current.setView(pts[0], 12);
      if (pts.length) fitted.current = fitKey;
    }
  }

  return <div ref={el} className={`relative z-0 w-full rounded-2xl overflow-hidden border border-[#e1e2e4] bg-[#e8ecef] ${className}`} role="application" aria-label={tx('Route map: drag stops to move them, click the map to add one')} />;
}
