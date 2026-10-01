'use client';
// "Your next trip": boarding spot (landmark, photo, map), live bus position
// and ETA to your stop, trip updates, call the conductor (on the day), share
// on WhatsApp, and how/when to pay for held seats.

import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { MapPin, Navigation, Phone, Radio, Share2, Clock3, CreditCard } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { departureDate, formatDateLabel, formatLKR, formatTime12, getTrip, toMinutes } from '@/lib/trips';
import { km, useLiveTrip, usePublicSettings, useTripContact, whatsappShareUrl } from '@/lib/extras';
import { startPayhere } from '@/lib/payhere-client';
import type { Booking } from '@/lib/types';
import { useT } from '@/lib/i18n';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export function NextTripPanel() {
  const { t } = useT();
  const { user } = useAuth();
  const { data, ready } = useStore();
  const pub = usePublicSettings();
  const [payErr, setPayErr] = useState<string | null>(null);

  const next = useMemo(() => {
    if (!ready || !user) return null;
    const now = Date.now();
    return data.bookings
      .filter((b) => b.userId === user.id && (b.status === 'confirmed' || b.status === 'held'))
      .map((b) => {
        const t = getTrip(data, b.scheduleId, b.date, b.from, b.to);
        const arr = t ? departureDate(t.boardingDate, t.arrival).getTime() + (t.arrivalDayOffset ? 86_400_000 : 0) : 0;
        return { b, t, arr };
      })
      .filter((x) => x.t && x.arr > now)
      .sort((a, b) => a.arr - b.arr)[0] ?? null;
  }, [data, ready, user]);

  const booking: Booking | null = next?.b ?? null;
  const trip = next?.t ?? null;
  const { location, events } = useLiveTrip(booking?.scheduleId, booking?.date);
  const contact = useTripContact(booking);
  if (!booking || !trip) return null;

  const route = data.routes.find((r) => r.id === trip.routeId);
  const stops = route?.stops ?? [];
  const bi = stops.findIndex((s) => s.name === booking.from);
  const stop = stops[bi];
  const leaves = departureDate(trip.boardingDate, trip.departure);
  const minsToDep = Math.round((leaves.getTime() - Date.now()) / 60000);
  const liveWindow = minsToDep < 6 * 60;
  const delay = events.find((e) => e.kind === 'delayed')?.minutes ?? 0;

  // ETA from the bus's live position (nearest stop + timetable gap), else timetable + reported delay.
  let eta: { text: string; tone: 'ok' | 'warn' | 'done' } | null = null;
  if (liveWindow) {
    const fresh = location && Date.now() - new Date(location.updatedAt).getTime() < 20 * 60000;
    if (fresh && stop?.lat != null && stop.lng != null) {
      const withPos = stops.map((s, i) => ({ i, d: s.lat != null && s.lng != null ? km(location, { lat: s.lat, lng: s.lng! }) : Infinity }));
      const near = withPos.sort((a, b) => a.d - b.d)[0];
      const toStop = km(location, { lat: stop.lat, lng: stop.lng });
      if (near.i > bi && toStop > 3) eta = { text: 'The bus has passed your stop', tone: 'done' };
      else if (toStop <= 1) eta = { text: 'The bus is at your stop now', tone: 'ok' };
      else {
        const mins = Math.max(2, stops[bi].offsetMin - stops[near.i].offsetMin + Math.round((near.d / 45) * 60));
        eta = { text: `About ${mins} min away · near ${stops[near.i].name}`, tone: 'ok' };
      }
    } else if (minsToDep > -30) {
      const at = new Date(leaves.getTime() + delay * 60000);
      eta = { text: delay ? `Running ~${delay} min late · expected ${at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : `On schedule · ${formatTime12(trip.departure)}`, tone: delay ? 'warn' : 'ok' };
    }
  }

  const mapUrl = stop?.lat != null ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${booking.from} bus stand Sri Lanka`)}`;
  const busUrl = location ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}` : null;
  const share = whatsappShareUrl(
    `My ${OPERATOR.name} ticket ${booking.ref}: ${booking.from} → ${booking.to}, ${formatDateLabel(trip.boardingDate)} at ${formatTime12(trip.departure)}, seat ${booking.seats.join(', ')}. Boarding: ${stop?.landmark ?? booking.from}. ${OPERATOR.siteUrl}/my-bookings`,
  );
  const held = booking.status === 'held';

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[#c7c5d1] shadow-sm overflow-hidden mb-[28px]"
      aria-label="Your next trip"
    >
      <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#edeef0]">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide text-[#7c5800]">{held ? t('Seat held · not paid yet') : minsToDep < 24 * 60 ? t('Your trip is coming up') : t('Your next trip')}</p>
          <h2 className="text-[20px] font-semibold text-[#050a44] mt-0.5">
            {booking.from} → {booking.to}
          </h2>
          <p className="text-[13px] text-[#46464f]">
            {formatDateLabel(trip.boardingDate)} · {formatTime12(trip.departure)} · seat {booking.seats.join(', ')} · {booking.ref}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {contact && (
            <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl bg-[#050a44] text-white text-[13px] font-bold">
              <Phone className="w-4 h-4" /> Call {contact.role}
            </a>
          )}
          <a href={`/track?ref=${booking.ref}`} className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl bg-[#feb700] text-[#14120a] text-[13px] font-bold">
            <Radio className="w-4 h-4" /> Track bus
          </a>
          <a href={share} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl bg-[#25D366] text-white text-[13px] font-bold">
            <Share2 className="w-4 h-4" /> WhatsApp
          </a>
        </div>
      </div>

      {held && (
        <div className="px-5 py-3 bg-[#feb700]/10 border-b border-[#feb700]/30 text-[13px] text-[#46464f] flex flex-wrap items-center gap-3">
          <Clock3 className="w-4 h-4 text-[#7c5800]" />
          <span className="flex-1 min-w-[200px]">
            Pay <b className="text-[#050a44]">{formatLKR(booking.total)}</b>
            {booking.holdExpiresAt && <> by <b className="text-[#050a44]">{new Date(booking.holdExpiresAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b></>}{' '}
            {booking.paymentMethod === 'bank' ? <>by bank transfer to {pub.bankDetails} (reference {booking.ref}).</> : booking.paymentMethod === 'counter' ? <>at our counter, {OPERATOR.contact.address}.</> : <>or the seat is released.</>}
          </span>
          {pub.paymentsMode === 'payhere' && (
            <button onClick={async () => setPayErr(await startPayhere(booking.id))} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#feb700] text-[#14120a] font-bold">
              <CreditCard className="w-4 h-4" /> Pay online now
            </button>
          )}
          {payErr && <span className="w-full text-[#ba1a1a] font-semibold">{payErr}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#edeef0]">
        <div className="p-5">
          <p className="text-[12px] font-bold text-[#46464f] flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {t('Where to wait')}</p>
          <p className="text-[15px] font-semibold text-[#050a44] mt-1">{stop?.landmark || `${booking.from} bus stand`}</p>
          {stop?.notes && <p className="text-[13px] text-[#46464f] mt-1">{stop.notes}</p>}
          {stop?.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={stop.photo} alt={`Boarding point at ${booking.from}`} className="mt-3 w-full max-h-48 object-cover rounded-xl border border-[#edeef0]" />
          )}
          <p className="text-[12px] text-[#6b6d78] mt-2">Be there 20 minutes early. At night, wait in a lit spot and look for &ldquo;SIYAN LANKA&rdquo; on the windscreen.</p>
          <a href={mapUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 mt-3 text-[13px] font-bold text-[#050a44] underline">
            <Navigation className="w-4 h-4" /> {t('Open in Maps')}
          </a>
        </div>
        <div className="p-5">
          <p className="text-[12px] font-bold text-[#46464f] flex items-center gap-1.5">
            <Radio className={`w-4 h-4 ${location ? 'text-[#006e1c]' : ''}`} /> {t("Where's my bus")}
          </p>
          {!liveWindow ? (
            <p className="text-[14px] text-[#46464f] mt-1">{t('Live tracking starts a few hours before departure.')}</p>
          ) : (
            <>
              {eta && (
                <p className={`text-[15px] font-semibold mt-1 ${eta.tone === 'warn' ? 'text-[#7c5800]' : eta.tone === 'done' ? 'text-[#46464f]' : 'text-[#006e1c]'}`}>{eta.text}</p>
              )}
              {location ? (
                <p className="text-[12px] text-[#6b6d78] mt-1">
                  Location updated {ago(location.updatedAt)}
                  {location.speedKmh ? ` · ${location.speedKmh} km/h` : ''} ·{' '}
                  <a href={busUrl!} target="_blank" rel="noopener" className="underline font-semibold text-[#050a44]">see bus on map</a>
                </p>
              ) : (
                <p className="text-[12px] text-[#6b6d78] mt-1">The bus hasn&apos;t started sharing its location yet.</p>
              )}
            </>
          )}
          {events.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {events.slice(0, 3).map((e) => (
                <li key={e.id} className="text-[13px] text-[#46464f]">
                  <span className="text-[#6b6d78]">{new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
                  {e.kind === 'departed' ? `Left ${e.stop}` : e.kind === 'delayed' ? `Running ${e.minutes} min late` : e.kind === 'arriving' ? `${e.minutes} min from ${e.stop}` : e.kind === 'arrived' ? `Reached ${e.stop}` : e.message}
                  {e.message && e.kind !== 'note' ? ` · ${e.message}` : ''}
                </li>
              ))}
            </ul>
          )}
          {liveWindow && toMinutes(trip.departure) >= 0 && <p className="sr-only">Scheduled departure {formatTime12(trip.departure)}</p>}
        </div>
      </div>
    </motion.section>
  );
}
