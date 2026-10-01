'use client';
// Live map (Leaflet + OpenStreetMap, no API key): the bus, its recent trail,
// your boarding stop and the other stops on the route.

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, LayerGroup } from 'leaflet';
import type { BusLocation } from '@/lib/extras';
import type { RouteStop } from '@/lib/types';

export function BusMap({ trail, stops, boardingIndex, className = '' }: { trail: BusLocation[]; stops: RouteStop[]; boardingIndex: number; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([7.6, 80.9], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      draw(L);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      fitted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!map.current) return;
      draw((await import('leaflet')).default);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail, stops, boardingIndex]);

  function draw(L: typeof import('leaflet')) {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const routePts = stops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lng!] as [number, number]);
    if (routePts.length > 1) L.polyline(routePts, { color: '#050a44', weight: 3, opacity: 0.25, dashArray: '6 8' }).addTo(layer.current);
    stops.forEach((s, i) => {
      if (s.lat == null) return;
      const mine = i === boardingIndex;
      L.circleMarker([s.lat, s.lng!], { radius: mine ? 9 : 4, color: '#050a44', weight: mine ? 3 : 1, fillColor: mine ? '#ffffff' : '#050a44', fillOpacity: mine ? 1 : 0.5 })
        .bindTooltip(mine ? `Your stop: ${s.name}` : s.name, { permanent: mine, direction: 'top', offset: [0, -8] })
        .addTo(layer.current!);
    });
    if (trail.length > 1) {
      L.polyline(trail.map((p) => [p.lat, p.lng] as [number, number]), { color: '#feb700', weight: 4, opacity: 0.9 }).addTo(layer.current);
      trail.slice(1).forEach((p) =>
        L.circleMarker([p.lat, p.lng], { radius: 4, color: '#7c5800', weight: 1, fillColor: '#feb700', fillOpacity: 0.9 })
          .bindTooltip(new Date(p.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
          .addTo(layer.current!),
      );
    }
    const bus = trail[0];
    if (bus) {
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:36px;height:36px;border-radius:50%;background:#feb700;border:3px solid #050a44;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.35)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#050a44" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6M15 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="2"/></svg></div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      L.marker([bus.lat, bus.lng], { icon, zIndexOffset: 1000 }).bindTooltip('Your bus', { direction: 'top', offset: [0, -16] }).addTo(layer.current);
    }
    // Frame the bus and your stop the first time we have both.
    const stop = stops[boardingIndex];
    if (!fitted.current) {
      const pts: [number, number][] = [];
      if (bus) pts.push([bus.lat, bus.lng]);
      if (stop?.lat != null) pts.push([stop.lat, stop.lng!]);
      if (pts.length === 2) map.current.fitBounds(L.latLngBounds(pts).pad(0.35));
      else if (pts.length === 1) map.current.setView(pts[0], 11);
      else if (routePts.length) map.current.fitBounds(L.latLngBounds(routePts).pad(0.1));
      fitted.current = !!bus;
    }
  }

  return <div ref={el} className={`relative z-0 w-full rounded-2xl overflow-hidden border border-[#e1e2e4] bg-[#e8ecef] ${className}`} role="img" aria-label="Map showing where your bus is" />;
}
