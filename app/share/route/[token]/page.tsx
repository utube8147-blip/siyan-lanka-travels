'use client';
// /share/route/<token> — a route plan shared from the route editor: read-only,
// no sign-in. Shows the snapshot taken when the link was made (map, road,
// stops, times). Links can be turned off; then this says so.

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Clock, MapPin, Route as RouteIcon } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { Wordmark } from '@/components/Wordmark';
import { GoogleMapsLinks } from '@/components/GoogleMapsLinks';
import { getShare, type RouteShare } from '@/lib/routeShare';
import { fetchRoadRoute } from '@/lib/routing';
import { formatTime12, dateLocale } from '@/lib/trips';
import { tx } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
const RouteShareMap = dynamic(() => import('@/components/RouteShareMap').then((m) => m.RouteShareMap), {
  ssr: false,
  loading: () => <div className="h-[360px] lg:h-[calc(100vh-140px)] rounded-2xl skeleton" />,
});

const hmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const dur = (m: number) => (m < 60 ? tx('{m} min', { m: Math.round(m) }) : tx('{floor} h {padStart} min', { floor: Math.floor(m / 60), padStart: String(Math.round(m % 60)).padStart(2, '0') }));
const clock = (departure: string, plusMin: number) => {
  const [h, m] = departure.split(':').map(Number);
  const total = h * 60 + m + Math.round(plusMin);
  const day = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(t / 60);
  return `${((hh + 11) % 12) + 1}:${String(t % 60).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}${day > 0 ? ` (+${day} day)` : ''}`;
};

export default function SharedRoutePage() {
  const { token } = useParams<{ token: string }>();
  const [share, setShare] = useState<RouteShare | null | undefined>(undefined);
  const [road, setRoad] = useState<{ path: [number, number][]; km: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    getShare(token).then(setShare);
  }, [token]);

  // Older links or links with stops left out have no road line saved: ask the routing server.
  useEffect(() => {
    if (!share) return;
    if (share.path) {
      setRoad({ path: share.path, km: share.distanceKm ?? 0 });
      return;
    }
    const ctl = new AbortController();
    fetchRoadRoute(share.stops.map((s) => [s.lat, s.lng]), ctl.signal).then((r) => r.route && setRoad({ path: r.route.path, km: r.route.distanceKm }));
    return () => ctl.abort();
  }, [share]);

  if (share === undefined) {
    return (
      <Shell>
        <div className="h-8 w-64 rounded-lg skeleton mb-4" />
        <div className="h-[360px] rounded-2xl skeleton" />
      </Shell>
    );
  }
  if (share === null) {
    return (
      <Shell>
        <div className="max-w-lg mx-auto text-center py-16">
          <RouteIcon className="w-10 h-10 mx-auto text-[#6b6d78]" />
          <h1 className="text-[22px] font-extrabold text-[#050a44] mt-3">{tx('This link isn\'t available')}</h1>
          <p className="text-[14px] text-[#46464f] mt-2">{tx('It may have been turned off by {name}, or the address isn\'t complete. Ask the person who sent it for a new link.', { name: OPERATOR.name })}</p>
          <Link href="/" className="inline-block mt-6 font-bold text-[#050a44] underline">{tx('Go to {name}', { name: OPERATOR.name })}</Link>
        </div>
      </Shell>
    );
  }

  const stops = share.stops;
  const total = stops[stops.length - 1]?.offsetMin ?? 0;
  const km = road?.km || share.distanceKm || 0;

  return (
    <Shell>
      <div className="mb-5">
        <p className="text-[12px] font-bold uppercase tracking-wide text-[#7c5800]">{tx('Route plan')}</p>
        <h1 className="text-[24px] md:text-[30px] font-extrabold tracking-tight text-[#050a44] leading-tight">{share.title}</h1>
        <p className="text-[13px] text-[#6b6d78] mt-1">{tx('Shared by {name} on {date}. A plan for review: times are estimates, not a booking timetable.', { name: OPERATOR.name, date: fmtDate(new Date(share.createdAt), { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
        {share.note && <p className="mt-3 rounded-xl bg-[#feb700]/12 border border-[#feb700]/40 px-4 py-3 text-[14px] text-[#191c1e] whitespace-pre-line">{share.note}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Fact label={tx('Stops')} value={String(stops.length)} />
        <Fact label={tx('Distance by road')} value={km ? `${km.toFixed(0)} km` : '…'} />
        <Fact label={tx('Travel time')} value={dur(total)} />
        <Fact label={share.departure ? tx('Leaves → arrives') : tx('From → to')} value={share.departure ? `${clock(share.departure, 0)} → ${clock(share.departure, total)}` : `${stops[0].name} → ${stops[stops.length - 1].name}`} small />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="lg:sticky lg:top-4 space-y-2">
          <RouteShareMap stops={stops} path={road?.path ?? null} selected={selected} onSelect={setSelected} className="h-[360px] md:h-[460px] lg:h-[calc(100vh-140px)] lg:min-h-[480px]" />
          <div className="flex flex-wrap items-center gap-2">
            <GoogleMapsLinks stops={stops} label={tx('Open in Google Maps')} />
            <span className="text-[12px] text-[#6b6d78]">{tx('Tap a stop to find it on the map.')}</span>
          </div>
        </div>

        <ol className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm overflow-hidden">
          {stops.map((s, i) => {
            const end = i === 0 || i === stops.length - 1;
            const on = selected === i;
            return (
              <li key={i}>
                <button type="button" onClick={() => setSelected(i)} className={`w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-[#f2f4f6] ${on ? 'bg-[#feb700]/10' : ''}`}>
                  <span className={`mt-0.5 w-7 h-7 shrink-0 rounded-full border-[3px] text-[11px] font-extrabold inline-flex items-center justify-center ${end ? 'bg-[#050a44] text-white keep-navy' : 'bg-[#feb700] text-[#050a44]'} ${on ? 'border-[#feb700]' : 'border-[#050a44]'}`}>{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-bold text-[#050a44]">{s.name}</span>
                    {s.landmark && (
                      <span className="block text-[12px] text-[#46464f]">
                        <MapPin className="inline w-3.5 h-3.5 -mt-0.5" /> {s.landmark}
                      </span>
                    )}
                  </span>
                  <span className="text-right shrink-0">
                    {share.departure && <span className="block text-[14px] font-bold text-[#050a44] tabular-nums">{clock(share.departure, s.offsetMin)}</span>}
                    <span className="block text-[12px] text-[#6b6d78] tabular-nums">
                      <Clock className="inline w-3 h-3 -mt-0.5" /> {i === 0 ? 'start' : `+${hmm(s.offsetMin)}`}
                    </span>
                  </span>
                </button>
                {i < stops.length - 1 && <div className="ml-[29px] h-0 border-l-2 border-dashed border-[#c7c5d1]" />}
              </li>
            );
          })}
        </ol>
      </div>
      {share.departure && <p className="mt-4 text-[12px] text-[#6b6d78]">{tx('Clock times are for the {time} departure.', { time: formatTime12(share.departure) })}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <header className="keep-navy bg-[#111216]">
        <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/" aria-label={OPERATOR.name}>
            <Wordmark size="sm" />
          </Link>
          <span className="text-[12px] font-semibold text-white/70">{tx('Shared route')}</span>
        </div>
      </header>
      <main className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">{children}</main>
    </div>
  );
}

function Fact({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b6d78]">{label}</p>
      <p className={`${small ? 'text-[14px]' : 'text-[18px]'} font-extrabold text-[#050a44] tabular-nums mt-0.5`}>{value}</p>
    </div>
  );
}
