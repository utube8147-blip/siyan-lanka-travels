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
import { departureDate, formatDateLabel, formatLKR, formatTime12, getTrip, toMinutes, dateLocale } from '@/lib/trips';
import { km, useLiveTrip, usePublicSettings, useTripContact, whatsappShareUrl } from '@/lib/extras';
import { startPayhere } from '@/lib/payhere-client';
import { mockPaymentsOn } from '@/lib/mockVerification';
import type { Booking } from '@/lib/types';
import { useT, txr } from '@/lib/i18n';
import { counterPlaces, useBranches } from '@/lib/branches';
import { TripBell } from '@/components/trip/TripBell';
import { tx } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? tx('just now') : m < 60 ? tx('{m} min ago', { m }) : tx('{round} h ago', { round: Math.round(m / 60) });
};

export function NextTripPanel() {
  const { t } = useT();
  const { user } = useAuth();
  const { data, ready } = useStore();
  const pub = usePublicSettings();
  const counters = counterPlaces(useBranches().branches);
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
      if (near.i > bi && toStop > 3) eta = { text: tx('The bus has passed your stop'), tone: 'done' };
      else if (toStop <= 1) eta = { text: tx('The bus is at your stop now'), tone: 'ok' };
      else {
        const mins = Math.max(2, stops[bi].offsetMin - stops[near.i].offsetMin + Math.round((near.d / 45) * 60));
        eta = { text: tx('About {mins} min away · near {name}', { mins, name: stops[near.i].name }), tone: 'ok' };
      }
    } else if (minsToDep > -30) {
      const at = new Date(leaves.getTime() + delay * 60000);
      eta = { text: delay ? tx('Running ~{delay} min late · expected {toLocaleTimeString}', { delay, toLocaleTimeString: at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }) : tx('On schedule · {time}', { time: formatTime12(trip.departure) }), tone: delay ? 'warn' : 'ok' };
    }
  }

  const mapUrl = stop?.lat != null ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${booking.from} bus stand Sri Lanka`)}`;
  const busUrl = location ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}` : null;
  const share = whatsappShareUrl(
    tx('My {name} ticket {ref}: {from} → {to}, {date} at {time}, seat {seats}. Boarding: {v}. {siteUrl}/my-bookings', { name: OPERATOR.name, ref: booking.ref, from: booking.from, to: booking.to, date: formatDateLabel(trip.boardingDate), time: formatTime12(trip.departure), seats: booking.seats.join(', '), v: stop?.landmark ?? booking.from, siteUrl: OPERATOR.siteUrl }),
  );
  const held = booking.status === 'held';

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-[#c7c5d1] shadow-sm overflow-hidden mb-[28px]"
      aria-label={tx('Your next trip')}
    >
      <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#edeef0]">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide text-[#7c5800]">{held ? (booking.paymentMethod === 'bus' ? tx('Seat reserved · pay on the bus') : t('Seat held · not paid yet')) : minsToDep < 24 * 60 ? t('Your trip is coming up') : t('Your next trip')}</p>
          <h2 className="text-[20px] font-semibold text-[#050a44] mt-0.5">
            {booking.from} → {booking.to}
          </h2>
          <p className="text-[13px] text-[#46464f]">{tx('{date} · {time} · seat {seats} · {ref}', { date: formatDateLabel(trip.boardingDate), time: formatTime12(trip.departure), seats: booking.seats.join(', '), ref: booking.ref })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Bell: fixed 40x40 icon-only box. overflow-hidden + hidden captions so nothing inside TripBell can widen it. */}
          <div
            className="shrink-0 w-10 h-10 overflow-hidden [&_p]:!hidden [&_button]:!w-10 [&_button]:!min-w-0 [&_button]:!h-10 [&_button]:!px-0 [&_button]:!gap-0 [&_button]:!justify-center [&_button]:!text-[0px] [&_button_svg]:!w-[18px] [&_button_svg]:!h-[18px]"
            title={tx('Reminders')}
          >
            <TripBell bookingId={booking.id} />
          </div>
          {contact && (
            <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-xl bg-[#050a44] text-white text-[13px] font-bold">
              <Phone className="w-4 h-4" />{' '}{tx('Call {role}', { role: contact.role })}</a>
          )}
          <a href={`/track?ref=${booking.ref}`} className="flex-1 sm:flex-none min-w-[110px] inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-xl bg-[#feb700] text-[#14120a] text-[13px] font-bold whitespace-nowrap">
            <Radio className="w-4 h-4" />{' '}{tx('Track bus')}</a>
          <a href={share} target="_blank" rel="noopener" className="flex-1 sm:flex-none min-w-[110px] inline-flex items-center justify-center gap-1.5 px-3 h-10 rounded-xl bg-[#25D366] text-white text-[13px] font-bold whitespace-nowrap">
            <Share2 className="w-4 h-4" />{' '}{tx('WhatsApp')}</a>
        </div>
      </div>

      {held && (
        <div className="px-5 py-3 bg-[#feb700]/10 border-b border-[#feb700]/30 text-[13px] text-[#46464f] flex flex-wrap items-center gap-3">
          <Clock3 className="w-4 h-4 text-[#7c5800]" />
          <span className="flex-1 min-w-[200px]">
            {(() => {
              const b = (c: React.ReactNode) => <b className="text-[#050a44]">{c}</b>;
              const amount = formatLKR(booking.total);
              const until = booking.holdExpiresAt ? fmtDate(new Date(booking.holdExpiresAt), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
              if (booking.paymentMethod === 'bus') return txr('Pay <b>{amount}</b> in cash to the conductor when you board. Your seat is reserved; show the QR code.', { amount, b });
              if (booking.paymentMethod === 'bank') return txr('Pay <b>{amount}</b> by <b2>{until}</b2> by bank transfer to {bankDetails} (reference {ref}).', { amount, until, bankDetails: pub.bankDetails, ref: booking.ref, b, b2: b });
              if (booking.paymentMethod === 'counter')
                return txr('Pay <b>{amount}</b> by <b2>{until}</b2> at {where}.', { amount, until, where: counters.list.length ? `${counters.text} (${counters.list.map((x) => x.address || x.name).join('; ')})` : tx('our counter, {address}', { address: OPERATOR.contact.address }), b, b2: b });
              return txr('Payment not finished. Pay <b>{amount}</b> by <b2>{until}</b2> or the seat is released.', { amount, until, b, b2: b });
            })()}
          </span>
          {/* Card / wallet bookings finish through the gateway (its fee is in the total, so a bank-transfer hold stays on bank transfer). */}
          {(booking.paymentMethod === 'card' || booking.paymentMethod === 'wallet') && ((pub.paymentsMode === 'payhere' && pub.cardPayments) || mockPaymentsOn()) && (
            <button
              onClick={async () => {
                if (pub.paymentsMode !== 'payhere' && mockPaymentsOn()) {
                  window.location.href = `/mock-gateway?${new URLSearchParams({ ref: booking.ref, amount: String(booking.total) })}`;
                  return;
                }
                setPayErr(await startPayhere(booking.id));
              }}
              className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#feb700] text-[#14120a] font-bold">
              <CreditCard className="w-4 h-4" />{' '}{tx('Pay online now')}</button>
          )}
          {payErr && <span className="w-full text-[#ba1a1a] font-semibold">{payErr}</span>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#edeef0]">
        <div className="p-5">
          <p className="text-[12px] font-bold text-[#46464f] flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {t('Where to wait')}</p>
          <p className="text-[15px] font-semibold text-[#050a44] mt-1">{stop?.landmark || tx('{from} bus stand', { from: booking.from })}</p>
          {stop?.notes && <p className="text-[13px] text-[#46464f] mt-1">{stop.notes}</p>}
          {stop?.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={stop.photo} alt={tx('Boarding point at {from}', { from: booking.from })} className="mt-3 w-full max-h-48 object-cover rounded-xl border border-[#edeef0]" />
          )}
          <p className="text-[12px] text-[#6b6d78] mt-2">{tx('Be there 20 minutes early. At night, wait in a lit spot and look for “SIYAN LANKA” on the windscreen.')}</p>
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
                <p className="text-[12px] text-[#6b6d78] mt-1">{location.speedKmh ? tx('Location updated {updatedAt} · {speed} km/h', { updatedAt: ago(location.updatedAt), speed: location.speedKmh }) : tx('Location updated {updatedAt}', { updatedAt: ago(location.updatedAt) })} ·{' '}
                  <a href={busUrl!} target="_blank" rel="noopener" className="underline font-semibold text-[#050a44]">{tx('see bus on map')}</a>
                </p>
              ) : (
                <p className="text-[12px] text-[#6b6d78] mt-1">{tx('The bus hasn\'t started sharing its location yet.')}</p>
              )}
            </>
          )}
          {events.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {events.slice(0, 3).map((e) => (
                <li key={e.id} className="text-[13px] text-[#46464f]">
                  <span className="text-[#6b6d78]">{new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>{' '}
                  {e.kind === 'departed' ? tx('Left {stop}', { stop: e.stop }) : e.kind === 'delayed' ? tx('Running {minutes} min late', { minutes: e.minutes }) : e.kind === 'arriving' ? tx('{minutes} min from {stop}', { minutes: e.minutes, stop: e.stop }) : e.kind === 'arrived' ? tx('Reached {stop}', { stop: e.stop }) : e.message}
                  {e.message && e.kind !== 'note' ? ` · ${e.message}` : ''}
                </li>
              ))}
            </ul>
          )}
          {liveWindow && toMinutes(trip.departure) >= 0 && <p className="sr-only">{tx('Scheduled departure {time}', { time: formatTime12(trip.departure) })}</p>}
        </div>
      </div>
    </motion.section>
  );
}