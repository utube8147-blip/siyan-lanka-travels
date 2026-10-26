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
import { departureDate, formatDateLabel, formatTime12, getTrip, tripWay } from '@/lib/trips';
import { goesTo, useOptionalStatus } from '@/lib/conductor';
import { useJunction } from '@/lib/detour';
import type { RouteStop } from '@/lib/types';
import { useTripContact, whatsappShareUrl } from '@/lib/extras';
import { estimateArrival, TRAIL_SIZE, useBusTrail } from '@/lib/tracking';
import { useT, txn } from '@/lib/i18n';
import { tx } from '@/lib/i18n';

const BusMap = dynamic(() => import('@/components/trip/BusMap').then((m) => m.BusMap), { ssr: false, loading: () => <div className="h-[360px] rounded-2xl skeleton" /> });

const ago = (iso: string, now: number) => {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  return m < 1 ? tx('just now') : m < 60 ? tx('{m} min ago', { m }) : tx('{floor} h {v} min ago', { floor: Math.floor(m / 60), v: m % 60 });
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
  // On-request stops with too few seats aren't on tonight's road.
  const optStatus = useOptionalStatus(trip ? data.routes.find((r) => r.id === trip.routeId) : undefined, booking?.scheduleId, booking?.date, data.bookings);
  const tRoute = trip ? data.routes.find((r) => r.id === trip.routeId) : undefined;
  const tRoad = useMemo(() => (tRoute ? tripWay(tRoute, goesTo(optStatus)).stops : []), [tRoute, optStatus]);
  // Booked an on-request stop that hasn't filled: picked up where the bus would turn off for it.
  // The stop the passenger chose (kept on the ticket when the bus doesn't go there).
  const bookedFrom = booking ? booking.bookedFrom ?? booking.from : null;
  const jFrom = useJunction(tRoute?.stops, tRoad, bookedFrom, 'board');

  if (!ready) return <PageSkeleton />;
  if (!booking || !trip) {
    return (
      <main className="max-w-[560px] mx-auto px-4 py-14 text-center">
        <h1 className="text-[22px] font-semibold text-[#050a44]">{tx('Ticket not found')}</h1>
        <p className="text-[14px] text-[#46464f] mt-2">{tx('Open tracking from one of your tickets in My trips.')}</p>
        <Link href="/my-bookings" className="inline-block mt-5 px-5 py-3 rounded-xl bg-[#050a44] text-white text-[14px] font-bold">{t('My trips')}</Link>
      </main>
    );
  }

  const route = data.routes.find((r) => r.id === trip.routeId);
  // An on-request stop that hasn't filled isn't on the road: the bus picks up
  // where it would turn off for it (or, until that's worked out, the stop after).
  const stops: RouteStop[] = [...tRoad];
  let boardAt = booking.from;
  if (route && jFrom.skipped) {
    if (jFrom.junction && tRoute?.stops.find((s) => s.name === bookedFrom)?.optional) {
      const pt: RouteStop = { name: tx('Turn-off for {stop}', { stop: bookedFrom! }), offsetMin: jFrom.junction.offsetMin, fareFromStart: 0, lat: jFrom.junction.lat, lng: jFrom.junction.lng, landmark: tx('Where the road turns off for {stop}, about {km} km from it', { stop: bookedFrom!, km: jFrom.junction.kmToStop < 1 ? jFrom.junction.kmToStop.toFixed(1) : Math.round(jFrom.junction.kmToStop) }) };
      const at = stops.findIndex((x) => x.offsetMin > pt.offsetMin);
      stops.splice(at < 0 ? stops.length : at, 0, pt);
      boardAt = pt.name;
    } else if (stops.some((s) => s.name === booking.from)) boardAt = booking.from; // moved at the cut-off
    else if (jFrom.fallback != null) boardAt = route.stops[jFrom.fallback].name;
  }
  const bi = stops.findIndex((s) => s.name === boardAt);
  const stop = stops[bi];
  const leaves = departureDate(trip.boardingDate, trip.departure);
  const minsToDep = Math.round((leaves.getTime() - now) / 60000);
  const stale = latest ? now - new Date(latest.updatedAt).getTime() > 20 * 60000 : true;
  const eta = estimateArrival(stops, bi, stale ? null : latest);
  const delay = events.find((e) => e.kind === 'delayed')?.minutes ?? 0;
  const etaTime = eta?.state === 'coming' ? new Date(now + eta.minutes * 60000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;

  const headline = !latest
    ? minsToDep > 6 * 60
      ? tx('Tracking starts a few hours before departure')
      : tx('Waiting for the bus to share its location')
    : stale
      ? tx('Last seen {updatedAt}: signal may be weak', { updatedAt: ago(latest.updatedAt, now) })
      : eta?.state === 'passed'
        ? tx('The bus has passed your stop')
        : eta?.state === 'here'
          ? tx('The bus is at your stop now')
          : eta
            ? tx('About {minutes} min away · near {near}', { minutes: eta.minutes, near: eta.near })
            : tx('Bus is on its way');

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-[48px] py-5 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="hidden md:block text-[26px] font-semibold text-[#050a44]">{tx('Track my bus')}</h1>
          <p className="text-[14px] text-[#46464f]">
            <b className="text-[#050a44]">{booking.from} → {booking.to}</b>{' '}{tx('· {date} · {time} · seat {seats} · {ref}', { date: formatDateLabel(trip.boardingDate), time: formatTime12(trip.departure), seats: booking.seats.join(', '), ref: booking.ref })}</p>
        </div>
        <p className="text-[12px] text-[#6b6d78] flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />{' '}{tx('Updates automatically')}</p>
      </div>

      <div className={`rounded-2xl px-5 py-4 mb-4 ${eta?.state === 'here' ? 'bg-[#006e1c] text-white' : stale && latest ? 'bg-[#feb700]/15 text-[#7c5800]' : 'bg-[#050a44] text-white'}`} role="status" aria-live="polite">
        <p className="text-[18px] md:text-[20px] font-semibold">{headline}</p>
        <p className="text-[13px] opacity-80 mt-0.5">
          {[
            etaTime ? tx('Expected at {from} around {etaTime}.', { from: booking.from, etaTime }) : '',
            delay ? tx('Running ~{delay} min late.', { delay }) : '',
            latest
              ? latest.speedKmh
                ? tx('Location from {updatedAt} · {speed} km/h.', { updatedAt: ago(latest.updatedAt, now), speed: latest.speedKmh })
                : tx('Location from {updatedAt}.', { updatedAt: ago(latest.updatedAt, now) })
              : tx('Scheduled at {from}: {time}.', { from: booking.from, time: formatTime12(trip.departure) }),
          ].filter(Boolean).join(' ')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5">
        <BusMap trail={trail} stops={stops} boardingIndex={bi} className="h-[360px] md:h-[460px]" />
        <aside className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#c7c5d1] p-5">
            <p className="text-[12px] font-bold text-[#46464f]">{t('Where to wait')}</p>
            <p className="text-[15px] font-semibold text-[#050a44] mt-1">{stop?.landmark || tx('{from} bus stand', { from: booking.from })}</p>
            <p className="text-[12px] text-[#6b6d78] mt-1">{tx('Be there 20 minutes early. Look for “SIYAN LANKA” on the windscreen.')}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {stop?.lat != null && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#f2f4f6] text-[13px] font-bold text-[#050a44]">
                  <Navigation className="w-4 h-4" />{' '}{tx('Directions to stop')}</a>
              )}
              {latest && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${latest.lat},${latest.lng}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#f2f4f6] text-[13px] font-bold text-[#050a44]">{tx('Bus in Google Maps')}</a>
              )}
              {contact && (
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#050a44] text-white text-[13px] font-bold">
                  <Phone className="w-4 h-4" />{' '}{tx('Call {role}', { role: contact.role })}</a>
              )}
              <a
                href={whatsappShareUrl(`I'm on the ${OPERATOR.name} bus ${booking.from} → ${booking.to}. ${latest ? `It's here now: https://maps.google.com/?q=${latest.lat},${latest.lng}` : ''}`)}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#25D366] text-white text-[13px] font-bold"
              >
                <Share2 className="w-4 h-4" />{' '}{tx('Share')}</a>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#c7c5d1] p-5">
            <p className="text-[12px] font-bold text-[#46464f]">{tx('Recent positions')}</p>
            {trail.length === 0 ? (
              <p className="text-[13px] text-[#6b6d78] mt-1">{tx('None yet.')}</p>
            ) : (
              <ol className="mt-2 space-y-1.5">
                {trail.map((p, i) => (
                  <li key={p.updatedAt} className="flex justify-between text-[13px]">
                    <span className={i === 0 ? 'font-semibold text-[#050a44]' : 'text-[#46464f]'}>{i === 0 ? tx('Now') : txn(i, '{n} update ago', '{n} updates ago')}</span>
                    <span className="tabular-nums text-[#6b6d78]">{new Date(p.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-[11px] text-[#6b6d78] mt-2">{tx('Shows up to the last {TRAIL_SIZE} positions.', { TRAIL_SIZE })}</p>
          </div>

          {events.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#c7c5d1] p-5">
              <p className="text-[12px] font-bold text-[#46464f]">{tx('Updates from the crew')}</p>
              <ul className="mt-2 space-y-1.5">
                {events.slice(0, 5).map((e) => (
                  <li key={e.id} className="text-[13px] text-[#46464f]">
                    <span className="text-[#6b6d78] tabular-nums">{new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
                    {e.kind === 'departed' ? tx('Left {stop}', { stop: e.stop }) : e.kind === 'delayed' ? tx('Running {minutes} min late', { minutes: e.minutes }) : e.kind === 'arriving' ? tx('{minutes} min from {stop}', { minutes: e.minutes, stop: e.stop }) : e.kind === 'arrived' ? tx('Reached {stop}', { stop: e.stop }) : e.message}
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
