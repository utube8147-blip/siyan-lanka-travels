'use client';
import { useEffect } from 'react';
import { X, MapPin, Bus, Clock, Navigation, Circle } from 'lucide-react';

export interface RouteStop {
  id: string;
  name: string;
  time: string;
  /** 0 = start of route, 100 = end of route — used to place the pin along the mock path */
  progress: number;
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
  /** 0–100, how far along the route the bus currently is (mock/live position) */
  busProgress: number;
  stops: RouteStop[];
}

interface RouteMapOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  route: RouteData;
}

// Sample data so this component can be dropped in and previewed immediately.
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
    { id: 's1', name: 'Colombo Fort', time: '08:15 AM', progress: 0, status: 'passed' },
    { id: 's2', name: 'Wattala', time: '08:35 AM', progress: 28, status: 'passed' },
    { id: 's3', name: 'Ja-Ela', time: '08:52 AM', progress: 42, status: 'current' },
    { id: 's4', name: 'Seeduwa', time: '09:08 AM', progress: 61, status: 'upcoming' },
    { id: 's5', name: 'Katunayake', time: '09:22 AM', progress: 78, status: 'upcoming' },
    { id: 's6', name: 'Negombo Bus Stand', time: '09:40 AM', progress: 100, status: 'upcoming' },
  ],
};

// Builds a gentle S-curve path across the mock map viewBox (700 x 380) so
// stops don't sit on a straight boring line. Purely decorative — not a real geo path.
function pathPoint(progress: number) {
  const t = progress / 100;
  const x = 60 + t * 580;
  const y = 190 + Math.sin(t * Math.PI * 1.4) * 110;
  return { x, y };
}

function buildSvgPath(steps = 40) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const { x, y } = pathPoint((i / steps) * 100);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

export function RouteMapOverlay({ isOpen, onClose, route }: RouteMapOverlayProps) {
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

  if (!isOpen) return null;

  const busPos = pathPoint(route.busProgress);
  const pathD = buildSvgPath();

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[#050a44]/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]"
        onClick={onClose}
      />

      {/* Panel — fixed to 80% of viewport height on mobile so the sheet never
          exceeds the screen and never needs a page-level scroll; desktop keeps
          its own natural cap and internal scroll for longer content. */}
      <div className="relative w-full h-[80vh] h-[80dvh] md:h-auto md:max-h-[85vh] md:max-w-3xl md:mx-4 bg-white rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-[slideUp_0.25s_ease-out]">
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 md:px-6 md:py-5 border-b border-[#edeef0] shrink-0">
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

        <div className="flex-1 min-h-0 overflow-hidden md:overflow-y-auto flex flex-col">
          {/* Mock map — grows to fill whatever vertical space the stats/stop
              list don't use, instead of leaving a dead gap above the footer. */}
          <div className="relative bg-[#f2f4f6] mx-4 mt-3 md:mx-6 md:mt-5 rounded-2xl overflow-hidden border border-[#edeef0] flex-1 min-h-[110px] md:flex-none">
            <svg viewBox="0 0 700 380" className="w-full h-full md:h-[280px]" preserveAspectRatio="xMidYMid slice">
              <defs>
                <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
                  <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#e1e2e4" strokeWidth="1" />
                </pattern>
                <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#050a44" />
                  <stop offset="100%" stopColor="#3d4bb8" />
                </linearGradient>
              </defs>
              <rect width="700" height="380" fill="url(#grid)" />

              {/* Full route (faded) */}
              <path d={pathD} fill="none" stroke="#c7c5d1" strokeWidth="5" strokeLinecap="round" />

              {/* Travelled portion */}
              <path
                d={buildSvgPath(40)
                  .split(' L')
                  .slice(0, Math.max(1, Math.round((route.busProgress / 100) * 40)))
                  .join(' L')}
                fill="none"
                stroke="url(#routeGrad)"
                strokeWidth="5"
                strokeLinecap="round"
              />

              {/* Stops */}
              {route.stops.map((stop) => {
                const p = pathPoint(stop.progress);
                const passed = stop.status === 'passed' || stop.status === 'current';
                return (
                  <g key={stop.id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={stop.status === 'current' ? 9 : 6}
                      fill={passed ? '#050a44' : '#ffffff'}
                      stroke="#050a44"
                      strokeWidth={2}
                    />
                    <text
                      x={p.x}
                      y={p.y - 16}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={700}
                      fill="#46464f"
                    >
                      {stop.name}
                    </text>
                  </g>
                );
              })}

              {/* Bus marker on current position */}
              <g transform={`translate(${busPos.x}, ${busPos.y})`}>
                <circle r="16" fill="#feb700" opacity="0.25" />
                <circle r="11" fill="#feb700" stroke="#050a44" strokeWidth="2" />
                <foreignObject x="-7" y="-7" width="14" height="14">
                  <Bus className="w-3.5 h-3.5 text-[#050a44]" />
                </foreignObject>
              </g>
            </svg>

            <div className="absolute bottom-2 left-2 md:bottom-3 md:left-3 bg-white/90 backdrop-blur px-2 py-1 md:px-3 md:py-1.5 rounded-full text-[9px] md:text-[11px] font-semibold text-[#46464f] flex items-center gap-1.5 border border-[#edeef0]">
              <Circle className="w-2 h-2 fill-[#feb700] text-[#feb700]" />
              Mock preview — live GPS coming soon
            </div>
          </div>

          {/* Trip summary */}
          <div className="shrink-0 grid grid-cols-3 gap-2 md:gap-3 px-4 mt-3 md:px-6 md:mt-5">
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

          {/* Stop list — condensed spacing on mobile so it fits the 80vh sheet
              without scrolling; desktop keeps the roomier version. */}
          <div className="shrink-0 px-4 py-3 md:px-6 md:py-5 overflow-hidden md:overflow-visible">
            <p className="text-[10px] md:text-[11px] font-bold text-[#46464f] tracking-[0.06em] mb-2 md:mb-3">
              STOP SCHEDULE
            </p>
            <div className="space-y-0">
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
                        className={`w-[2px] h-4 md:h-9 ${
                          stop.status === 'passed' ? 'bg-[#050a44]' : 'bg-[#edeef0]'
                        }`}
                      />
                    )}
                  </div>
                  <div className="pb-2 md:pb-6 -mt-0.5 flex-1 flex items-center justify-between">
                    <p
                      className={`text-[13px] md:text-[14px] ${
                        stop.status === 'current'
                          ? 'font-bold text-[#050a44]'
                          : 'font-medium text-[#191c1e]'
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
        <div className="px-4 py-3 md:px-6 md:py-4 border-t border-[#edeef0] flex items-center justify-between bg-white shrink-0">
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
      `}</style>
    </div>
  );
}