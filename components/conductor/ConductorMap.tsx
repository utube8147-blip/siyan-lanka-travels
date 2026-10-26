'use client';
// The conductor's map: tonight's stops in the order the bus will take them, the
// road between them, this phone's position, road reports from every conductor,
// and (optionally) another route or draft from the office for comparison.
// Dark tiles: it is used at night.

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, LayerGroup } from 'leaflet';
import { kindOf, type Here, type PlanStop, type RoadReport } from '@/lib/conductor';
import { tx } from '@/lib/i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function ConductorMap({
  stops,
  path,
  here,
  reports,
  compare,
  follow,
  placing,
  onPlace,
  onReport,
  onStop,
  onUserMove,
  className = '',
}: {
  stops: PlanStop[];
  path: [number, number][] | null;
  here: Here | null;
  reports: RoadReport[];
  /** Another route to show faintly (an office route or draft). */
  compare: { name: string; lat: number; lng: number }[] | null;
  /** Keep the bus in view. */
  follow: boolean;
  /** Waiting for a tap on the map to place a report. */
  placing: boolean;
  onPlace: (p: { lat: number; lng: number }) => void;
  onReport: (r: RoadReport) => void;
  onStop: (i: number) => void;
  /** The person dragged the map (stop following). */
  onUserMove: () => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layers = useRef<{ route: LayerGroup; compare: LayerGroup; reports: LayerGroup; bus: LayerGroup } | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const cbs = useRef({ onPlace, onReport, onStop, onUserMove, placing });
  cbs.current = { onPlace, onReport, onStop, onUserMove, placing };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.5 }).setView([7.6, 80.9], 8);
      L.control.zoom({ position: 'bottomleft' }).addTo(m);
      // Esri's dark grey map needs no key (CARTO's dark tiles now ask for one).
      const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
      L.tileLayer(`${esri}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
        maxNativeZoom: 16,
        maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      // Place names above the road line, but never in the way of taps.
      const labels = m.createPane('labels');
      labels.style.zIndex = '450';
      labels.style.pointerEvents = 'none';
      L.tileLayer(`${esri}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19, pane: 'labels' }).addTo(m);
      layers.current = { compare: L.layerGroup().addTo(m), route: L.layerGroup().addTo(m), reports: L.layerGroup().addTo(m), bus: L.layerGroup().addTo(m) };
      m.on('click', (e) => cbs.current.placing && cbs.current.onPlace({ lat: e.latlng.lat, lng: e.latlng.lng }));
      m.on('dragstart', () => cbs.current.onUserMove());
      map.current = m;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      fitted.current = false;
    };
  }, []);

  // Tonight's stops and the road.
  useEffect(() => {
    (async () => {
      if (!ready || !map.current || !layers.current) return;
      const L = (await import('leaflet')).default;
      const g = layers.current.route;
      g.clearLayers();
      const pinned = stops.map((s, i) => ({ s, i })).filter((x) => x.s.lat != null && x.s.lng != null);
      const line = path && path.length > 1 ? path : pinned.map((x) => [x.s.lat!, x.s.lng!] as [number, number]);
      if (line.length > 1) {
        L.polyline(line, { color: '#000', weight: 9, opacity: 0.45, interactive: false }).addTo(g);
        L.polyline(line, { color: '#feb700', weight: 5, opacity: 0.95, dashArray: path ? undefined : '6 8', interactive: false }).addTo(g);
      }
      const last = stops.length - 1;
      for (const { s, i } of pinned) {
        const end = i === 0 || i === last;
        const counts = [s.on ? `↑${s.on}` : '', s.off ? `↓${s.off}` : ''].filter(Boolean).join(' ');
        const bg = end ? '#ffffff' : s.optional ? '#a78bfa' : '#feb700';
        const icon = L.divIcon({
          className: '',
          html: `<div style="display:flex;align-items:center;gap:5px;width:max-content"><div style="flex:none;width:26px;height:26px;border-radius:50%;background:${bg};color:#0d0e11;border:2px solid #0d0e11;box-shadow:0 2px 8px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:800 12px system-ui,sans-serif">${i + 1}</div><span style="font:700 11px system-ui,sans-serif;color:#fff;background:rgba(13,14,17,.85);padding:2px 6px;border-radius:6px;white-space:nowrap">${esc(s.name)}${counts ? ` <span style="color:#feb700">${counts}</span>` : ''}</span></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([s.lat!, s.lng!], { icon, zIndexOffset: 1000 - i, keyboard: false }).on('click', () => cbs.current.onStop(i)).addTo(g);
      }
      if (!fitted.current && line.length) {
        map.current.fitBounds(L.latLngBounds(line), { paddingTopLeft: [30, 30], paddingBottomRight: [130, 70] });
        fitted.current = true;
      }
    })();
  }, [ready, stops, path]);

  // The office route being compared.
  useEffect(() => {
    (async () => {
      if (!ready || !map.current || !layers.current) return;
      const L = (await import('leaflet')).default;
      const g = layers.current.compare;
      g.clearLayers();
      if (!compare || compare.length < 2) return;
      const line = compare.map((s) => [s.lat, s.lng] as [number, number]);
      L.polyline(line, { color: '#93c5fd', weight: 4, opacity: 0.8, dashArray: '2 8', interactive: false }).addTo(g);
      for (const s of compare) L.circleMarker([s.lat, s.lng], { radius: 5, color: '#93c5fd', weight: 2, fillColor: '#0d0e11', fillOpacity: 1 }).bindTooltip(esc(s.name)).addTo(g);
      map.current.fitBounds(L.latLngBounds(line), { paddingTopLeft: [30, 30], paddingBottomRight: [130, 70] });
    })();
  }, [ready, compare]);

  // Road reports.
  useEffect(() => {
    (async () => {
      if (!ready || !map.current || !layers.current) return;
      const L = (await import('leaflet')).default;
      const g = layers.current.reports;
      g.clearLayers();
      for (const r of reports) {
        const k = kindOf(r.kind);
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:36px;height:36px;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:${k.color};border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);font-size:18px;line-height:1">${k.icon}</span></div>`,
          iconSize: [36, 36],
          iconAnchor: [4, 36],
        });
        L.marker([r.lat, r.lng], { icon, zIndexOffset: 3000, title: tx(k.label) }).on('click', () => cbs.current.onReport(r)).addTo(g);
      }
    })();
  }, [ready, reports]);

  // The bus (this phone).
  useEffect(() => {
    (async () => {
      if (!ready || !map.current || !layers.current) return;
      const L = (await import('leaflet')).default;
      const g = layers.current.bus;
      g.clearLayers();
      if (!here) return;
      L.circle([here.lat, here.lng], { radius: Math.min(here.accuracy, 500), color: '#60a5fa', weight: 1, fillColor: '#60a5fa', fillOpacity: 0.12, interactive: false }).addTo(g);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.3)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([here.lat, here.lng], { icon, zIndexOffset: 4000, keyboard: false, interactive: false }).addTo(g);
      if (follow) map.current.panTo([here.lat, here.lng], { animate: true });
    })();
  }, [ready, here, follow]);

  useEffect(() => {
    if (map.current) map.current.getContainer().style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  return <div ref={el} className={`relative z-0 w-full overflow-hidden bg-[#1a1b1f] ${className}`} role="application" aria-label={tx('Map of tonight’s stops and road reports')} />;
}
