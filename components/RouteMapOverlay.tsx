'use client';
import { useEffect, useRef, useState } from 'react';
import { X, MapPin, Bus, Clock, Navigation } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { fetchRoadRoute } from '@/lib/routing';
import { tx } from '@/lib/i18n';

// Route map for a departure: the stops (from their map pins in Staff area →
// Routes & timetable), the timetable, and the bus itself when the conductor
// is sharing its location.

export interface RouteStop {
  id: string;
  name: string;
  time: string;
  /** 0 = start of route, 100 = end of route */
  progress: number;
  /** Required for the stop to appear on the map; stops without coordinates are skipped. */
  lat?: number;
  lng?: number;
  status?: 'passed' | 'current' | 'upcoming';
  /** Only shapes the road: no pin, not in the list. */
  hidden?: boolean;
  /** Small line under the name, e.g. on-request progress. */
  note?: string;
  /**
   * Where the passenger is on this stretch: gets on, rides through, gets off,
   * or not on their ticket (before boarding / after the drop-off). Missing = all of it is theirs.
   */
  part?: 'board' | 'ride' | 'alight' | 'outside';
}

export interface RouteData {
  busNumber: string;
  /** The bus's own route ("Colombo → Akkaraipattu"), when it differs from the ticket. */
  routeName?: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  distance: string;
  /** 0–100, how far along these stops the bus is; null when its position isn't known (no bus is drawn). */
  busProgress: number | null;
  /** Live GPS position [lat, lng] from the conductor's phone, when it's being shared. */
  busPosition?: [number, number];
  /** e.g. "2 min ago"; shown next to LIVE. */
  busSeen?: string;
  stops: RouteStop[];
}

interface RouteMapOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  route: RouteData;
}

type LatLng = [number, number];
type LocatedStop = RouteStop & { lat: number; lng: number };

const hasCoords = (s: RouteStop): s is LocatedStop =>
  typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng);

// ---- Road routing (OSRM) ----
// Draws the route along actual roads rather than straight lines between stops.
// Shares lib/routing.ts (and its NEXT_PUBLIC_ROUTING_URL setting) with the route editor.
async function fetchRoadPath(stops: LatLng[], signal: AbortSignal): Promise<LatLng[] | null> {
  const { route } = await fetchRoadRoute(stops, signal).catch(() => ({ route: null }));
  return route?.path ?? null; // aborted or offline → keep the straight-line fallback
}

/** Squared distance (equirectangular approximation, fine at city/country scale). */
const sqDist = (a: LatLng, b: LatLng) =>
  (a[0] - b[0]) ** 2 + ((a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180)) ** 2;

/** Index of the path vertex closest to `p`, searching only within [from, to]. */
function nearestIndex(path: LatLng[], p: LatLng, from = 0, to = path.length - 1): number {
  let best = from;
  let bestD = Infinity;
  for (let i = from; i <= to; i++) {
    const d = sqDist(path[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Point a fraction `t` (0–1) of the way along path[i0..i1], measured by distance. */
function pointAlongPath(path: LatLng[], i0: number, i1: number, t: number): LatLng {
  if (i1 <= i0) return path[i0];
  const seg: number[] = [];
  let total = 0;
  for (let i = i0; i < i1; i++) {
    const d = Math.sqrt(sqDist(path[i], path[i + 1]));
    seg.push(d);
    total += d;
  }
  let target = total * Math.min(1, Math.max(0, t));
  for (let k = 0; k < seg.length; k++) {
    if (target <= seg[k]) {
      const f = seg[k] === 0 ? 0 : target / seg[k];
      const a = path[i0 + k];
      const b = path[i0 + k + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    target -= seg[k];
  }
  return path[i1];
}

const SNAP_THRESHOLD = 60; // px of drag needed to change snap point
const CLOSE_THRESHOLD = 140; // px of downward drag from the half state to dismiss

export function RouteMapOverlay({ isOpen, onClose, route }: RouteMapOverlayProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [viewportH, setViewportH] = useState(0);
  const [snap, setSnap] = useState<'half' | 'full'>('half');
  const [dragDelta, setDragDelta] = useState<number | null>(null);
  const startY = useRef(0);

  // Track viewport (desktop vs mobile, and pixel height for the sheet)
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      setIsDesktop(window.matchMedia('(min-width: 768px)').matches);
      setViewportH(window.innerHeight);
    };
    update();
    setSnap('half');
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen]);

  // Escape key + lock page scroll behind the sheet
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Real map (Leaflet + OpenStreetMap tiles), route drawn along actual roads
  useEffect(() => {
    const located = route.stops.filter(hasCoords);
    if (!isOpen || !mapEl.current || located.length === 0) return;
    let cancelled = false;
    let cleanup = () => {};
    const abort = new AbortController();

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapEl.current) return;

      const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true });
      L.control.zoom({ position: 'topright' }).addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const stopCoords: LatLng[] = located.map((s) => [s.lat, s.lng]);
      const progress = route.busProgress;

      // Stops (drawn once)
      located.filter((s) => !s.hidden).forEach((s) => {
        const done = s.status === 'passed' || s.status === 'current';
        const mine = s.part === 'board' || s.part === 'alight';
        const outside = s.part === 'outside';
        const size = mine ? 20 : s.status === 'current' ? 18 : outside ? 10 : 14;
        const ring = outside ? '#9a99a8' : '#050a44';
        const fill = mine ? (s.part === 'board' ? '#feb700' : '#050a44') : done ? '#050a44' : '#fff';
        const m = L.marker([s.lat, s.lng], {
          zIndexOffset: mine ? 500 : 0,
          icon: L.divIcon({
            className: '',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;border:${outside ? 2 : 3}px solid ${ring};background:${fill}"></div>`,
          }),
        });
        if (mine) m.bindTooltip(`${s.part === 'board' ? tx('Get on') : tx('Get off')}: ${s.name} · ${s.time}`, { permanent: true, direction: 'top', offset: [0, -12] });
        else m.bindTooltip(`${s.name} · ${s.time}`, { direction: 'top', offset: [0, -8] });
        m.addTo(map);
      });

      // Route line + bus: redrawn when the road geometry arrives
      const routeLayer = L.layerGroup().addTo(map);

      const drawRoute = (road: LatLng[] | null) => {
        routeLayer.clearLayers();
        const path = road ?? stopCoords;

        // Where each stop sits along the path (searching forward so loops don't confuse it)
        let cursor = 0;
        const stopIdx = road
          ? stopCoords.map((c) => (cursor = nearestIndex(path, c, cursor)))
          : stopCoords.map((_, i) => i);

        // Bus position: live GPS if shared, otherwise estimated along the route from progress
        let busPos: LatLng | null = route.busPosition ?? null;
        if (!busPos && progress != null) {
          busPos = path[path.length - 1];
          for (let i = 0; i < located.length - 1; i++) {
            const a = located[i];
            const b = located[i + 1];
            if (progress >= a.progress && progress <= b.progress) {
              const t = b.progress === a.progress ? 0 : (progress - a.progress) / (b.progress - a.progress);
              busPos = pointAlongPath(path, stopIdx[i], stopIdx[i + 1], t);
              break;
            }
          }
        }

        // The whole road the bus drives, light; the passenger's stretch in navy on top.
        const bi = located.findIndex((s) => s.part === 'board');
        const ai = located.findIndex((s) => s.part === 'alight');
        const marked = bi >= 0 && ai > bi;
        L.polyline(path, {
          color: marked || busPos ? '#b9b8c6' : '#050a44',
          weight: marked ? 4 : busPos ? 6 : 5,
          opacity: marked ? 0.9 : busPos ? 1 : 0.75,
          dashArray: marked ? '2 8' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(routeLayer);
        if (marked) {
          L.polyline(path.slice(stopIdx[bi], stopIdx[ai] + 1), {
            color: '#050a44',
            weight: busPos ? 6 : 5,
            opacity: busPos ? 0.45 : 0.85,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(routeLayer);
        }

        if (busPos && progress != null) {
          let travelled: LatLng[];
          if (road) {
            let lastPassed = -1;
            located.forEach((s, i) => {
              if (s.progress < progress) lastPassed = i;
            });
            const lo = lastPassed >= 0 ? stopIdx[lastPassed] : 0;
            const hi = stopIdx[Math.min(lastPassed + 1, located.length - 1)];
            const k = nearestIndex(path, busPos, lo, Math.max(lo, hi));
            travelled = [...path.slice(0, k + 1), busPos];
          } else {
            travelled = [...located.filter((s) => s.progress < progress).map((s): LatLng => [s.lat, s.lng]), busPos];
          }
          if (travelled.length > 1) {
            L.polyline(travelled, { color: '#050a44', weight: 6, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
          }
        }

        // Bus (only when we actually know where it is)
        if (busPos) {
          L.marker(busPos, {
            zIndexOffset: 1000,
            icon: L.divIcon({
              className: '',
              iconSize: [34, 34],
              iconAnchor: [17, 17],
              html: `<div style="width:34px;height:34px;border-radius:9999px;background:#feb700;border:3px solid #050a44;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 0 6px rgba(254,183,0,.3)">🚌</div>`,
            }),
          })
            .bindTooltip(route.busSeen ? tx('{busNumber} is here ({seen})', { busNumber: route.busNumber, seen: route.busSeen }) : tx('{busNumber} is here', { busNumber: route.busNumber }), { direction: 'top', offset: [0, -14] })
            .addTo(routeLayer);
        }
      };

      const fit = (pts: LatLng[]) => {
        if (pts.length === 1) map.setView(pts[0], 15);
        else map.fitBounds(L.latLngBounds(pts), { padding: [32, 32] });
      };

      // 1) Show something immediately (straight lines between stops)…
      drawRoute(null);
      fit(stopCoords);

      // 2) …then swap in the real road geometry once it loads
      fetchRoadPath(stopCoords, abort.signal).then((road) => {
        if (cancelled || !road) return;
        drawRoute(road);
        fit(road);
      });

      // Keep tiles correct while the sheet resizes (drag / snap / rotate / layout switch)
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(mapEl.current);

      cleanup = () => {
        ro.disconnect();
        map.remove();
      };
    })();

    return () => {
      cancelled = true;
      abort.abort();
      cleanup();
    };
  }, [isOpen, route]);

  if (!isOpen) return null;

  const hasMap = route.stops.some(hasCoords);

  // ---- Drag handling (mobile only) ----
  const baseH = snap === 'full' ? viewportH : viewportH * 0.8;
  const liveH =
    dragDelta === null ? baseH : Math.min(viewportH, Math.max(viewportH * 0.4, baseH - dragDelta));
  const isFull = !isDesktop && snap === 'full' && dragDelta === null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    setDragDelta(0);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragDelta === null) return;
    setDragDelta(e.clientY - startY.current);
  };
  const onPointerUp = () => {
    if (dragDelta === null) return;
    if (dragDelta < -SNAP_THRESHOLD) setSnap('full');
    else if (dragDelta > CLOSE_THRESHOLD && snap === 'half') onClose();
    else if (dragDelta > SNAP_THRESHOLD) setSnap('half');
    setDragDelta(null);
  };

  const mapHeightClass = snap === 'full' ? 'h-[38dvh]' : 'h-[200px]';

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#050a44]/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={isDesktop ? undefined : { height: liveH }}
        className={`relative w-full md:h-[640px] md:max-h-[88vh] md:max-w-5xl md:mx-4 bg-white md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-[slideUp_0.25s_ease-out] ${
          isFull ? 'rounded-t-none' : 'rounded-t-3xl'
        } ${dragDelta === null ? 'transition-[height,border-radius] duration-200 ease-out' : ''}`}
      >
        {/* Drag handle (mobile) */}
        <div
          className="md:hidden shrink-0 flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="button"
          aria-label={tx('Drag up to expand, down to collapse')}
        >
          <span className="block w-11 h-1.5 rounded-full bg-[#c7c5d1]" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-4 pb-3 pt-1 md:px-6 md:py-5 border-b border-[#edeef0] shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 bg-[#050a44] text-white text-[11px] font-bold tracking-[0.04em] px-2.5 py-1 rounded-full">
                <Bus className="w-3 h-3" />
                {route.busNumber}
              </span>
              <span className={`text-[11px] font-semibold tracking-[0.02em] ${route.busPosition ? 'text-[#006e1c]' : 'text-[#46464f]'}`}>
                {route.busPosition ? route.busSeen ? tx('LIVE · {seen}', { seen: route.busSeen }) : tx('LIVE') : tx('ROUTE & STOPS')}
              </span>
            </div>
            <h2 className="text-[17px] md:text-[20px] leading-[1.3] font-black text-[#050a44] tracking-tight">
              {route.origin} <span className="text-[#c7c5d1] mx-1">→</span> {route.destination}
            </h2>
            {route.routeName && route.stops.some((s) => s.part === 'outside') && (
              <p className="text-[12px] md:text-[13px] text-[#46464f] mt-0.5">{tx('On the {route} bus', { route: route.routeName })}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 -mt-1 hover:bg-[#f2f4f6] rounded-full transition-colors"
            aria-label={tx('Close route map')}
          >
            <X className="w-5 h-5 text-[#191c1e]" />
          </button>
        </div>

        {/* Body: stacked on mobile (map, then details); side by side on desktop (details left, map right) */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Map — mobile: fixed band on top; desktop: fills the right column */}
          <div
            className={`relative shrink-0 mx-4 mt-3 md:order-2 md:flex-1 md:min-w-0 md:h-auto md:mx-0 md:mt-0 md:m-6 md:ml-0 rounded-2xl overflow-hidden border border-[#edeef0] ${mapHeightClass} transition-[height] duration-200`}
          >
            {hasMap ? (
              <div ref={mapEl} className="absolute inset-0 bg-[#f2f4f6] z-0" />
            ) : (
              <div className="absolute inset-0 bg-[#f2f4f6] flex flex-col items-center justify-center gap-1 text-center px-6">
                <MapPin className="w-5 h-5 text-[#46464f]" />
                <p className="text-[12px] md:text-[13px] font-semibold text-[#46464f]">{tx('Map unavailable for this route')}</p>
                <p className="text-[11px] text-[#46464f]/80">{tx('Stop locations haven\'t been added yet.')}</p>
              </div>
            )}
          </div>

          {/* Scrollable content — desktop: left column with its own scroll */}
          <div className="flex-1 min-h-0 md:flex-none md:order-1 md:w-[42%] md:shrink-0 md:border-r md:border-[#edeef0] overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]">
            {/* Trip summary */}
            <div className="grid grid-cols-3 gap-2 md:gap-3 px-4 mt-3 md:px-6 md:mt-5">
              <div className="bg-[#f2f4f6] rounded-xl px-2 py-2 md:px-3 md:py-3 text-center">
                <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#050a44] mx-auto mb-0.5 md:mb-1" />
                <p className="text-[12px] md:text-[13px] font-bold text-[#050a44]">{route.duration}</p>
                <p className="text-[9px] md:text-[10px] text-[#46464f] font-medium">{tx('Duration')}</p>
              </div>
              <div className="bg-[#f2f4f6] rounded-xl px-2 py-2 md:px-3 md:py-3 text-center">
                <Navigation className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#050a44] mx-auto mb-0.5 md:mb-1" />
                <p className="text-[12px] md:text-[13px] font-bold text-[#050a44]">{route.distance}</p>
                <p className="text-[9px] md:text-[10px] text-[#46464f] font-medium">{tx('Distance')}</p>
              </div>
              <div className="bg-[#f2f4f6] rounded-xl px-2 py-2 md:px-3 md:py-3 text-center">
                <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#050a44] mx-auto mb-0.5 md:mb-1" />
                <p className="text-[12px] md:text-[13px] font-bold text-[#050a44]">{tx('{length} stops', { length: route.stops.filter((s) => !s.hidden && s.part !== 'outside').length })}</p>
                <p className="text-[9px] md:text-[10px] text-[#46464f] font-medium">{tx('Along route')}</p>
              </div>
            </div>

            {/* Stop list */}
            <div className="px-4 py-4 md:px-6 md:py-5">
              <p className="text-[10px] md:text-[11px] font-bold text-[#46464f] tracking-[0.06em] mb-3">{tx('STOP SCHEDULE')}</p>
              <div>
                {route.stops.filter((s) => !s.hidden).map((stop, i, list) => (
                  <div key={stop.id} className={`flex items-start gap-3 ${stop.part === 'outside' ? 'opacity-55' : ''}`}>
                    <div className="flex flex-col items-center">
                      <div
                        className={`rounded-full border-2 shrink-0 ${stop.part === 'board' || stop.part === 'alight' ? 'w-3.5 h-3.5 -mx-0.5' : 'w-2.5 h-2.5'} ${
                          stop.part === 'board'
                            ? 'bg-[#feb700] border-[#050a44]'
                            : stop.part === 'alight'
                            ? 'bg-[#050a44] border-[#050a44]'
                            : stop.status === 'current'
                            ? 'bg-[#feb700] border-[#feb700]'
                            : stop.status === 'passed'
                            ? 'bg-[#050a44] border-[#050a44]'
                            : 'bg-white border-[#c7c5d1]'
                        }`}
                      />
                      {i < list.length - 1 && (
                        <div
                          className={`w-[2px] h-7 md:h-9 ${
                            stop.status === 'passed' || stop.part === 'board' || stop.part === 'ride' ? 'bg-[#050a44]' : 'bg-[#edeef0]'
                          }`}
                        />
                      )}
                    </div>
                    <div className="pb-3 md:pb-6 -mt-0.5 flex-1 flex items-center justify-between">
                      <p
                        className={`text-[13px] md:text-[14px] ${
                          stop.status === 'current' || stop.part === 'board' || stop.part === 'alight' ? 'font-bold text-[#050a44]' : 'font-medium text-[#191c1e]'
                        }`}
                      >
                        {stop.name}
                        {(stop.part === 'board' || stop.part === 'alight') && (
                          <span className={`ml-2 text-[9px] md:text-[10px] font-bold px-2 py-0.5 rounded-full align-middle ${stop.part === 'board' ? 'bg-[#feb700] text-[#14120a]' : 'bg-[#050a44] text-white'}`}>
                            {stop.part === 'board' ? tx('GET ON') : tx('GET OFF')}
                          </span>
                        )}
                        {stop.status === 'current' && (
                          <span className="ml-2 text-[9px] md:text-[10px] font-bold text-[#feb700] bg-[#050a44] px-2 py-0.5 rounded-full align-middle">{tx('BUS HERE')}</span>
                        )}
                        {stop.note && <span className="block text-[11px] font-semibold text-[#6d28d9]">{stop.note}</span>}
                      </p>
                      <p className={`text-[12px] md:text-[13px] ${stop.part === 'board' || stop.part === 'alight' ? 'font-bold text-[#050a44]' : 'font-semibold text-[#46464f]'}`}>{stop.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 md:px-6 md:py-4 border-t border-[#edeef0] flex items-center justify-between bg-white shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div>
            <p className="text-[10px] md:text-[11px] text-[#46464f] font-medium">{tx('Departs {departureTime}', { departureTime: route.departureTime })}</p>
            <p className="text-[10px] md:text-[11px] text-[#46464f] font-medium">{tx('Arrives {arrivalTime}', { arrivalTime: route.arrivalTime })}</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 md:px-5 md:py-2.5 bg-[#050a44] text-white rounded-xl text-[13px] md:text-[14px] font-bold hover:opacity-90 transition-all"
          >{tx('Close')}</button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(24px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .leaflet-container { font-family: inherit; }
      `}</style>
    </div>
  );
}