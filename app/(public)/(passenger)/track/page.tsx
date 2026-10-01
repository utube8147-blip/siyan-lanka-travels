'use client';
// Track my bus — from a ticket (?ref=SLT-XXXXXX): live map with the bus, its
// last few positions, your stop, an arrival estimate and trip updates.

import { Suspense, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Navigation, Phone, RefreshCw, Share2 } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { useAuth } from '@/contexts/AuthContext';
import { PageSkeleton, useStore } from '@/lib/store';
import { departureDate, formatDateLabel, formatTime12, getTrip } from '@/lib/trips';
import { useTripContact, whatsappShareUrl } from '@/lib/extras';
import { estimateArrival, TRAIL_SIZE, useBusTrail } from '@/lib/tracking';
import { useT } from '@/lib/i18n';

const BusMap = dynamic(() => import('@/components/trip/BusMap').then((m) => m.BusMap), { ssr: false, loading: () => <div className="h-[360px] rounded-2xl skeleton" /> });

const ago = (iso: string, now: number) => {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

function Track() {
  const { t } = useT();
  const params = useSearchParams();
  const ref = (params.get('ref') ?? '').toUpperCase();
  const { user } = useAuth();
  const { data, ready } = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const booking = useMemo(() => data.bookings.find((b) => b.ref.toUpperCase() === ref && (!user || b.userId === user.id)), [data.bookings, ref, user]);
  const trip = booking ? getTrip(data, booking.scheduleId, booking.date, booking.from, booking.to) : null;
  const { latest, trail, events } = useBusTrail(booking?.scheduleId, booking?.date);
  const contact = useTripContact(booking);

  if (!ready) return <PageSkeleton />;
  if (!booking || !trip) {
    return (
      <main className="max-w-[560px] mx-auto px-4 py-14 text-center">
        <h1 className="text-[22px] font-semibold text-[#050a44]">Ticket not found</h1>
        <p className="text-[14px] text-[#46464f] mt-2">Open tracking from one of your tickets in My trips.</p>
        <Link href="/my-bookings" className="inline-block mt-5 px-5 py-3 rounded-xl bg-[#050a44] text-white text-[14px] font-bold">{t('My trips')}</Link>
      </main>
    );
  }

  const route = data.routes.find((r) => r.id === trip.routeId);
  const stops = route?.stops ?? [];
  const bi = stops.findIndex((s) => s.name === booking.from);
  const stop = stops[bi];
  const leaves = departureDate(trip.boardingDate, trip.departure);
  const minsToDep = Math.round((leaves.getTime() - now) / 60000);
  const stale = latest ? now - new Date(latest.updatedAt).getTime() > 20 * 60000 : true;
  const eta = estimateArrival(stops, bi, stale ? null : latest);
  const delay = events.find((e) => e.kind === 'delayed')?.minutes ?? 0;
  const etaTime = eta?.state === 'coming' ? new Date(now + eta.minutes * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;

  const headline = !latest
    ? minsToDep > 6 * 60
      ? 'Tracking starts a few hours before departure'
      : 'Waiting for the bus to share its location'
    : stale
      ? `Last seen ${ago(latest.updatedAt, now)}: signal may be weak`
      : eta?.state === 'passed'
        ? 'The bus has passed your stop'
        : eta?.state === 'here'
          ? 'The bus is at your stop now'
          : eta
            ? `About ${eta.minutes} min away · near ${eta.near}`
            : 'Bus is on its way';

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-[48px] py-5 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="hidden md:block text-[26px] font-semibold text-[#050a44]">Track my bus</h1>
          <p className="text-[14px] text-[#46464f]">
            <b className="text-[#050a44]">{booking.from} → {booking.to}</b> · {formatDateLabel(trip.boardingDate)} · {formatTime12(trip.departure)} · seat {booking.seats.join(', ')} · {booking.ref}
          </p>
        </div>
        <p className="text-[12px] text-[#6b6d78] flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Updates automatically</p>
      </div>

      <div className={`rounded-2xl px-5 py-4 mb-4 ${eta?.state === 'here' ? 'bg-[#006e1c] text-white' : stale && latest ? 'bg-[#feb700]/15 text-[#7c5800]' : 'bg-[#050a44] text-white'}`} role="status" aria-live="polite">
        <p className="text-[18px] md:text-[20px] font-semibold">{headline}</p>
        <p className="text-[13px] opacity-80 mt-0.5">
          {etaTime ? `Expected at ${booking.from} around ${etaTime}. ` : ''}
          {delay ? `Running ~${delay} min late. ` : ''}
          {latest ? `Location from ${ago(latest.updatedAt, now)}${latest.speedKmh ? ` · ${latest.speedKmh} km/h` : ''}.` : `Scheduled at ${booking.from}: ${formatTime12(trip.departure)}.`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        <BusMap trail={trail} stops={stops} boardingIndex={bi} className="h-[360px] md:h-[460px]" />
        <aside className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#c7c5d1] p-5">
            <p className="text-[12px] font-bold text-[#46464f]">{t('Where to wait')}</p>
            <p className="text-[15px] font-semibold text-[#050a44] mt-1">{stop?.landmark || `${booking.from} bus stand`}</p>
            <p className="text-[12px] text-[#6b6d78] mt-1">Be there 20 minutes early. Look for &ldquo;SIYAN LANKA&rdquo; on the windscreen.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {stop?.lat != null && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#f2f4f6] text-[13px] font-bold text-[#050a44]">
                  <Navigation className="w-4 h-4" /> Directions to stop
                </a>
              )}
              {latest && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${latest.lat},${latest.lng}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#f2f4f6] text-[13px] font-bold text-[#050a44]">
                  Bus in Google Maps
                </a>
              )}
              {contact && (
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#050a44] text-white text-[13px] font-bold">
                  <Phone className="w-4 h-4" /> Call {contact.role}
                </a>
              )}
              <a
                href={whatsappShareUrl(`I'm on the ${OPERATOR.name} bus ${booking.from} → ${booking.to}. ${latest ? `It's here now: https://maps.google.com/?q=${latest.lat},${latest.lng}` : ''}`)}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#25D366] text-white text-[13px] font-bold"
              >
                <Share2 className="w-4 h-4" /> Share
              </a>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#c7c5d1] p-5">
            <p className="text-[12px] font-bold text-[#46464f]">Recent positions</p>
            {trail.length === 0 ? (
              <p className="text-[13px] text-[#6b6d78] mt-1">None yet.</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {trail.map((p, i) => (
                  <li key={p.updatedAt} className="flex justify-between text-[13px]">
                    <span className={i === 0 ? 'font-semibold text-[#050a44]' : 'text-[#46464f]'}>{i === 0 ? 'Now' : `${i} update${i > 1 ? 's' : ''} ago`}</span>
                    <span className="tabular-nums text-[#6b6d78]">{new Date(p.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-[11px] text-[#6b6d78] mt-2">Shows up to the last {TRAIL_SIZE} positions.</p>
          </div>

          {events.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#c7c5d1] p-5">
              <p className="text-[12px] font-bold text-[#46464f]">Updates from the crew</p>
              <ul className="mt-2 space-y-1.5">
                {events.slice(0, 5).map((e) => (
                  <li key={e.id} className="text-[13px] text-[#46464f]">
                    <span className="text-[#6b6d78] tabular-nums">{new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
                    {e.kind === 'departed' ? `Left ${e.stop}` : e.kind === 'delayed' ? `Running ${e.minutes} min late` : e.kind === 'arriving' ? `${e.minutes} min from ${e.stop}` : e.kind === 'arrived' ? `Reached ${e.stop}` : e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Track />
    </Suspense>
  );
}
