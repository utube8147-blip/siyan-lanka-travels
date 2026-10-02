'use client';
import { useEffect, useRef, useState } from 'react';
import { X, MapPin, Bus, Clock, Navigation } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// npm i leaflet && npm i -D @types/leaflet

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
}

export interface RouteData {
  busNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  distance: string;
  /** 0–100, how far along the route the bus is. Used when busPosition is not given. */
  busProgress: number;
  /** Real GPS position [lat, lng]. Overrides busProgress when provided. */
  busPosition?: [number, number];
  stops: RouteStop[];
}

interface RouteMapOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  route: RouteData;
}

export const MOCK_ROUTE: RouteData = {
  busNumber: 'VD-204',
  origin: 'Colombo Fort',
  destination: 'Negombo Bus Stand',
  departureTime: '08:15 AM',
  arrivalTime: '09:40 AM',
  duration: '1h 25m',
  distance: '37 km',
  busProgress: 42,
  stops: [
    { id: 's1', name: 'Colombo Fort', time: '08:15 AM', progress: 0, lat: 6.9344, lng: 79.85, status: 'passed' },
    { id: 's2', name: 'Wattala', time: '08:35 AM', progress: 28, lat: 6.9894, lng: 79.8913, status: 'passed' },
    { id: 's3', name: 'Ja-Ela', time: '08:52 AM', progress: 42, lat: 7.0744, lng: 79.8919, status: 'current' },
    { id: 's4', name: 'Seeduwa', time: '09:08 AM', progress: 61, lat: 7.1236, lng: 79.8841, status: 'upcoming' },
    { id: 's5', name: 'Katunayake', time: '09:22 AM', progress: 78, lat: 7.1697, lng: 79.8706, status: 'upcoming' },
    { id: 's6', name: 'Negombo Bus Stand', time: '09:40 AM', progress: 100, lat: 7.2083, lng: 79.8358, status: 'upcoming' },
  ],
};

type LatLng = [number, number];
type LocatedStop = RouteStop & { lat: number; lng: number };

const hasCoords = (s: RouteStop): s is LocatedStop =>
  typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/** Interpolates the bus position between the two stops surrounding `progress`. */
function interpolateBus(stops: LocatedStop[], progress: number): LatLng {
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (progress >= a.progress && progress <= b.progress) {
      const t = b.progress === a.progress ? 0 : (progress - a.progress) / (b.progress - a.progress);
      return [a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t];
    }
  }
  const last = stops[stops.length - 1];
  return [last.lat, last.lng];
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

  // Real map (Leaflet + OpenStreetMap tiles)
  useEffect(() => {
    const located = route.stops.filter(hasCoords);
    if (!isOpen || !mapEl.current || located.length === 0) return;
    let cancelled = false;
    let cleanup = () => {};

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
      const busPos = route.busPosition ?? interpolateBus(located, route.busProgress);

      // Full route (faded) + travelled portion
      L.polyline(stopCoords, { color: '#c7c5d1', weight: 6, lineCap: 'round' }).addTo(map);
      const travelled: LatLng[] = [
        ...located.filter((s) => s.progress < route.busProgress).map((s): LatLng => [s.lat, s.lng]),
        busPos,
      ];
      L.polyline(travelled, { color: '#050a44', weight: 6, lineCap: 'round' }).addTo(map);

      // Stops
      located.forEach((s) => {
        const done = s.status === 'passed' || s.status === 'current';
        const size = s.status === 'current' ? 18 : 14;
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: '',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;border:3px solid #050a44;background:${
              done ? '#050a44' : '#fff'
            }"></div>`,
          }),
        })
          .bindTooltip(s.name, { direction: 'top', offset: [0, -8] })
          .addTo(map);
      });

      // Bus
      L.marker(busPos, {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: '',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          html: `<div style="width:34px;height:34px;border-radius:9999px;background:#feb700;border:3px solid #050a44;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 0 6px rgba(254,183,0,.3)">🚌</div>`,
        }),
      })
        .bindTooltip(`${route.busNumber} is here`, { direction: 'top', offset: [0, -14] })
        .addTo(map);

      if (stopCoords.length === 1) map.setView(stopCoords[0], 15);
      else map.fitBounds(L.latLngBounds(stopCoords), { padding: [32, 32] });

      // Keep tiles correct while the sheet resizes (drag / snap / rotate)
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(mapEl.current);

      cleanup = () => {
        ro.disconnect();
        map.remove();
      };
    })();

    return () => {
      cancelled = true;
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
        className={`relative w-full md:h-auto md:max-h-[85vh] md:max-w-3xl md:mx-4 bg-white md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-[slideUp_0.25s_ease-out] ${
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
          aria-label="Drag up to expand, down to collapse"
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
              <span className="text-[11px] font-semibold text-[#46464f] tracking-[0.02em]">
                LIVE ROUTE
              </span>
            </div>
            <h2 className="text-[17px] md:text-[20px] leading-[1.3] font-black text-[#050a44] tracking-tight">
              {route.origin} <span className="text-[#c7c5d1] mx-1">→</span> {route.destination}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 -mr-2 -mt-1 hover:bg-[#f2f4f6] rounded-full transition-colors"
            aria-label="Close route map"
          >
            <X className="w-5 h-5 text-[#191c1e]" />
          </button>
        </div>

        {/* Map — fixed band, so touching it pans the map while the area below scrolls */}
        <div
          className={`relative shrink-0 mx-4 mt-3 md:mx-6 md:mt-5 md:h-[280px] rounded-2xl overflow-hidden border border-[#edeef0] ${mapHeightClass} transition-[height] duration-200`}
        >
          {hasMap ? (
            <div ref={mapEl} className="absolute inset-0 bg-[#f2f4f6] z-0" />
          ) : (
            <div className="absolute inset-0 bg-[#f2f4f6] flex flex-col items-center justify-center gap-1 text-center px-6">
              <MapPin className="w-5 h-5 text-[#46464f]" />
              <p className="text-[12px] md:text-[13px] font-semibold text-[#46464f]">
                Map unavailable for this route
              </p>
              <p className="text-[11px] text-[#46464f]/80">Stop locations haven&apos;t been added yet.</p>
            </div>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]">
          {/* Trip summary */}
          <div className="grid grid-cols-3 gap-2 md:gap-3 px-4 mt-3 md:px-6 md:mt-5">
            <div className="bg-[#f2f4f6] rounded-xl px-2 py-2 md:px-3 md:py-3 text-center">
              <Clock className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#050a44] mx-auto mb-0.5 md:mb-1" />
              <p className="text-[12px] md:text-[13px] font-bold text-[#050a44]">{route.duration}</p>
              <p className="text-[9px] md:text-[10px] text-[#46464f] font-medium">Duration</p>
            </div>
            <div className="bg-[#f2f4f6] rounded-xl px-2 py-2 md:px-3 md:py-3 text-center">
              <Navigation className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#050a44] mx-auto mb-0.5 md:mb-1" />
              <p className="text-[12px] md:text-[13px] font-bold text-[#050a44]">{route.distance}</p>
              <p className="text-[9px] md:text-[10px] text-[#46464f] font-medium">Distance</p>
            </div>
            <div className="bg-[#f2f4f6] rounded-xl px-2 py-2 md:px-3 md:py-3 text-center">
              <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#050a44] mx-auto mb-0.5 md:mb-1" />
              <p className="text-[12px] md:text-[13px] font-bold text-[#050a44]">{route.stops.length} stops</p>
              <p className="text-[9px] md:text-[10px] text-[#46464f] font-medium">Along route</p>
            </div>
          </div>

          {/* Stop list */}
          <div className="px-4 py-4 md:px-6 md:py-5">
            <p className="text-[10px] md:text-[11px] font-bold text-[#46464f] tracking-[0.06em] mb-3">
              STOP SCHEDULE
            </p>
            <div>
              {route.stops.map((stop, i) => (
                <div key={stop.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 ${
                        stop.status === 'current'
                          ? 'bg-[#feb700] border-[#feb700]'
                          : stop.status === 'passed'
                          ? 'bg-[#050a44] border-[#050a44]'
                          : 'bg-white border-[#c7c5d1]'
                      }`}
                    />
                    {i < route.stops.length - 1 && (
                      <div
                        className={`w-[2px] h-7 md:h-9 ${
                          stop.status === 'passed' ? 'bg-[#050a44]' : 'bg-[#edeef0]'
                        }`}
                      />
                    )}
                  </div>
                  <div className="pb-3 md:pb-6 -mt-0.5 flex-1 flex items-center justify-between">
                    <p
                      className={`text-[13px] md:text-[14px] ${
                        stop.status === 'current' ? 'font-bold text-[#050a44]' : 'font-medium text-[#191c1e]'
                      }`}
                    >
                      {stop.name}
                      {stop.status === 'current' && (
                        <span className="ml-2 text-[9px] md:text-[10px] font-bold text-[#feb700] bg-[#050a44] px-2 py-0.5 rounded-full align-middle">
                          BUS HERE
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] md:text-[13px] font-semibold text-[#46464f]">{stop.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 md:px-6 md:py-4 border-t border-[#edeef0] flex items-center justify-between bg-white shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div>
            <p className="text-[10px] md:text-[11px] text-[#46464f] font-medium">Departs {route.departureTime}</p>
            <p className="text-[10px] md:text-[11px] text-[#46464f] font-medium">Arrives {route.arrivalTime}</p>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 md:px-5 md:py-2.5 bg-[#050a44] text-white rounded-xl text-[13px] md:text-[14px] font-bold hover:opacity-90 transition-all"
          >
            Close
          </button>
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