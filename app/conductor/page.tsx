'use client';
// Conductor page: made for a phone in one hand on a moving bus.
// Two jobs, two tabs, because they happen at different times:
//   Boarding     at each stop: scan the ticket or tap "Board". Nobody is asked
//                for money at the door; an unpaid passenger is simply on board.
//   Collect cash on the way: only the passengers who still owe, in seat order
//                for walking down the aisle. Tap the amount, tap again to confirm.
// Location sharing, updates to passengers and the printable sheet sit above.
// The conductor does not close the trip in the app: they fill in the paper
// trip sheet and hand it in with the cash, and the booking centre closes it.
// This screen only tells them how much cash they should be holding.
// Works for office staff too.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Banknote, Check, ChevronDown, FileDown, LogOut, MapPin, Megaphone, MessageCircle, Phone, Radio, ScanLine, Search, UserX, Undo2, Wallet } from 'lucide-react';
import { isStaffRole, useAuth } from '@/contexts/AuthContext';
import { PageSkeleton, useStore } from '@/lib/store';
import { addDays, formatDateLabel, formatLKR, formatTime12, listRuns, routeLabel, todayISO, departureDate } from '@/lib/trips';
import { isDue, manifestFor, scanTicket } from '@/lib/manifest';
import { downloadManifestPdf } from '@/lib/manifestPdf';
import { lastReading, useOdometer } from '@/lib/odometer';
import { postTripEvent, useCashSummary, type TripEvent } from '@/lib/extras';
import { QrScanner } from '@/components/staff/QrScanner';
import { UpdateModal, useLocationSharing, type SharingStatus } from '@/components/admin/TripTools';
import { useToast } from '@/components/admin/ui';
import { Wordmark } from '@/components/Wordmark';
import type { Booking } from '@/lib/types';
import { OPERATOR } from '@/config/operator';
import { friendlyError, isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { LanguageSwitcher, tx, txMessage, txn } from '@/lib/i18n';
import { MapTab } from '@/components/conductor/MapTab';
import { BottomNav, type ConductorTab } from '@/components/conductor/BottomNav';
import { PAY_LABEL } from '@/lib/analytics';

export default function ConductorPage() {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();
  const { data, ready, updateBooking, confirmPayment } = useStore();
  const { toast, Toast } = useToast();
  const [runKey, setRunKey] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [posting, setPosting] = useState<TripEvent['kind'] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Three jobs, three tabs (bottom bar). The last one used is remembered on this phone.
  const [tab, setTabState] = useState<ConductorTab>('board');
  useEffect(() => {
    try {
      const t = (new URLSearchParams(window.location.search).get('tab') ?? sessionStorage.getItem('conductor-tab')) as ConductorTab | null;
      if (t === 'board' || t === 'cash' || t === 'map') setTabState(t);
    } catch {
      /* ignore */
    }
  }, []);
  const setTab = (t: ConductorTab) => {
    setTabState(t);
    setOpen(null);
    setQ('');
    try {
      sessionStorage.setItem('conductor-tab', t);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  };
  // Collecting money takes two taps on the same button, so a bump on the road can't record a payment.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  useEffect(() => {
    if (!isLoading && !isStaffRole(user?.role)) router.replace('/staff/login?next=/conductor');
  }, [isLoading, user, router]);

  // Last night's bus may still be on the road: look at yesterday → tomorrow.
  const runs = useMemo(() => (ready ? listRuns(data, addDays(todayISO(), -1), 3) : []), [data, ready]);
  const best = useMemo(() => {
    const now = Date.now();
    const scored = runs.map((r) => {
      const dep = departureDate(r.date, r.schedule.departure).getTime();
      const end = dep + (r.route.stops[r.route.stops.length - 1].offsetMin + 60) * 60000;
      return { r, score: now >= dep - 3 * 3600e3 && now <= end ? 0 : Math.abs(dep - now) };
    });
    return scored.sort((a, b) => a.score - b.score)[0]?.r;
  }, [runs]);
  const run = runs.find((r) => `${r.schedule.id}|${r.date}` === runKey) ?? best;
  // The cash this conductor should be holding for the chosen trip, worked out by the database:
  // what they took, less refunds they paid. Re-read whenever a payment is recorded.
  const myCash = useCashSummary(run?.date ?? todayISO(), run?.schedule.id ?? null, data.bookings.filter((b) => b.paymentStatus === 'paid').length);
  // For the printed trip sheet: the bus's last odometer reading goes in as the start.
  const odometer = useOdometer();
  const sharingCtl = useLocationSharing(run?.schedule.id ?? '', run?.date ?? '', toast);
  // The bus position is this device's GPS. A conductor's phone is on the bus; anyone else is asked first,
  // so an office computer is not turned into the bus by mistake.
  const toggleSharing = () => {
    if (!sharingCtl.sharing && user?.role !== 'conductor' && !window.confirm(tx('Share the position of THIS device as the bus? Only say yes on a phone that is on the bus.'))) return;
    sharingCtl.toggle();
  };
  const inTripWindow = useMemo(() => {
    if (!run) return false;
    const dep = departureDate(run.date, run.schedule.departure).getTime();
    const end = dep + (run.route.stops[run.route.stops.length - 1].offsetMin + 60) * 60000;
    return Date.now() >= dep - 2 * 3600e3 && Date.now() <= end;
  }, [run]);

  if (!ready || isLoading || !isStaffRole(user?.role)) return <div className="keep-navy min-h-screen bg-[#0d0e11]"><PageSkeleton /></div>;

  const m = run ? manifestFor(data, run.schedule.id, run.date) : null;
  const bookings = m?.list ?? [];
  const act = {
    board: (b: Booking) => updateBooking(b.id, { status: 'boarded' }),
    // Recorded on this screen = taken on the bus: it is the trip's cash, not the office's.
    takeCash: (b: Booking) => confirmPayment(b.id, 'cash', undefined, true),
  };
  const filter = q.trim().toLowerCase();
  const groups = (m?.groups ?? [])
    .map((g) => ({ ...g, bookings: g.bookings.filter((b) => !filter || `${b.passenger.name} ${b.ref} ${b.seats.join(' ')} ${b.passenger.phone}`.toLowerCase().includes(filter)) }))
    .filter((g) => g.bookings.length);
  const pct = m && m.totals.seats ? Math.round((m.totals.boarded / m.totals.seats) * 100) : 0;
  // Works for "17" as well as "3A": front of the bus first.
  const seatOrder = (seat: string) => {
    const x = seat.match(/^(\d+)([A-Z]?)/);
    return x ? Number(x[1]) * 30 + (x[2] ? x[2].charCodeAt(0) - 64 : 0) : 99999;
  };
  const matches = (b: Booking) => !filter || `${b.passenger.name} ${b.ref} ${b.seats.join(' ')} ${b.passenger.phone}`.toLowerCase().includes(filter);
  // Money: who still owes (on board first, then in seat order), and what has been taken in cash.
  const owing = bookings.filter(isDue).sort((a, b) => Number(b.status === 'boarded') - Number(a.status === 'boarded') || seatOrder(a.seats[0]) - seatOrder(b.seats[0]));
  const owingShown = owing.filter(matches);
  // Cash collected ON THE BUS: payments recorded on this screen (or by a conductor account). A seat paid in
  // cash at the office is the office's money even when it was booked online and even when the same person
  // does both jobs; card and bank payments are nobody's cash. The database marks each payment (migration 31).
  const paidCash = bookings.filter((b) => b.paymentMethod === 'cash' && b.paymentStatus === 'paid' && b.status !== 'no-show' && b.paidOnBus);
  const paidCashTotal = paidCash.reduce((n, b) => n + b.total, 0);
  // The headline figure comes from the database when connected: fares taken on the bus by the person signed in,
  // less cash refunds they paid and costs paid from that cash. An older database (before migration 31) can't
  // tell a counter payment from one taken on the bus, so there only a conductor account's figure is trusted.
  const mine = myCash && myCash !== 'error' && run ? myCash : null;
  const dbKnowsWhere = !!mine && (mine.v ?? 0) >= 31;
  const holding = mine && (dbKnowsWhere || user?.role === 'conductor') ? mine.expected : paidCashTotal;
  const tookCount = mine && (dbKnowsWhere || user?.role === 'conductor') ? mine.taken.length : paidCash.length;

  // Send this one passenger where the bus is right now (WhatsApp if set up, otherwise a text).
  const sendLocation = async (b: Booking) => {
    if (!isSupabaseConfigured) return toast(tx('Sending messages needs the database (not available in demo mode).'), 'error');
    const { data: via, error } = await supabase().rpc('send_bus_location', { p_booking: b.id });
    toast(error ? friendlyError(error) : via === 'whatsapp' ? tx("Bus location sent to {name} by WhatsApp (text if they don't have it)", { name: b.passenger.name.split(' ')[0] }) : tx('Bus location sent to {name} by text message', { name: b.passenger.name.split(' ')[0] }), error ? 'error' : 'ok');
  };
  // The same, from the conductor's own WhatsApp: opens the chat with the message ready to send.
  const openWhatsApp = async (b: Booking) => {
    const phone = (b.contact.phone || b.passenger.phone || '').replace(/\D/g, '').replace(/^0/, '94');
    if (!phone) return toast(tx('There is no phone number on this booking.'), 'error');
    let where = '';
    if (isSupabaseConfigured) {
      const { data: loc } = await supabase().from('bus_locations').select('lat, lng').eq('schedule_id', b.scheduleId).eq('travel_date', b.date).maybeSingle();
      if (loc) where = ' ' + tx('The bus is here now: {link}', { link: `https://maps.google.com/?q=${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}` });
    }
    const text = tx('Siyan Lanka Travels: your bus for {from} → {to}, seat {seats}.{where} Live: {siteUrl}/track?ref={ref}', { from: b.from, to: b.to, seats: b.seats.join(', '), where, siteUrl: OPERATOR.siteUrl, ref: b.ref });
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  // 'cash' = paid at the door and boarded; 'collect' = already on board, paying now;
  // 'board' on an unpaid pay-on-bus seat = board first, collect during the trip.
  const doAction = async (b: Booking, what: 'board' | 'noshow' | 'undo' | 'cash' | 'collect') => {
    setOpen(null);
    const r =
      what === 'cash'
        ? await confirmPayment(b.id, 'cash', undefined, true).then(async (p) => (p.ok ? updateBooking(b.id, { status: 'boarded' }) : p))
        : what === 'collect'
        ? await confirmPayment(b.id, 'cash', undefined, true)
        : // Undo for someone who hasn't paid goes back to "held", so the money is still asked for.
          await updateBooking(b.id, { status: what === 'board' ? 'boarded' : what === 'noshow' ? 'no-show' : b.paymentStatus === 'unpaid' ? 'held' : 'confirmed' });
    const name = b.passenger.name;
    toast(
      r.ok
        ? what === 'board' ? tx('{name}: on board', { name })
          : what === 'noshow' ? tx('{name}: no-show', { name })
          : what === 'cash' ? tx('{name}: paid & on board', { name })
          : what === 'collect' ? tx('{name}: paid {amount}', { name, amount: formatLKR(b.total) })
          : tx('{name}: undone', { name })
        : txMessage(r.reason ?? tx('Could not update')),
      r.ok ? 'ok' : 'error',
    );
    if (r.ok && (what === 'board' || what === 'cash' || what === 'collect')) navigator.vibrate?.(60);
  };

  return (
    <div className="keep-navy min-h-screen bg-[#0d0e11] text-white pb-[calc(env(safe-area-inset-bottom)+110px)]">
      <header className="sticky top-0 z-30 bg-[#111216]/95 backdrop-blur border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="h-14 px-4 flex items-center justify-between max-w-2xl mx-auto">
          <Wordmark size="sm" />
          <div className="flex items-center gap-1">
            <LanguageSwitcher className="!bg-white/10 [&_button]:!text-white/70 [&_button[aria-checked=true]]:!bg-white [&_button[aria-checked=true]]:!text-[#0d0e11] mr-1" />
            {user?.role !== 'conductor' && <Link href="/admin" className="px-3 h-9 rounded-lg text-[12px] font-semibold bg-white/10 flex items-center">{tx('Staff area')}</Link>}
            <button onClick={async () => { await logout(); router.replace('/staff/login'); }} aria-label={tx('Sign out')} className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Departure picker */}
        <label className="block relative">
          <span className="sr-only">{tx('Departure')}</span>
          <select
            value={run ? `${run.schedule.id}|${run.date}` : ''}
            onChange={(e) => setRunKey(e.target.value)}
            className="w-full h-12 pl-4 pr-10 rounded-xl bg-white/5 border border-white/15 text-[15px] font-semibold appearance-none"
          >
            {runs.length === 0 && <option>{tx('No departures today')}</option>}
            {runs.map((r) => (
              <option key={`${r.schedule.id}|${r.date}`} value={`${r.schedule.id}|${r.date}`} className="text-black">
                {r.date === todayISO() ? tx('Today') : formatDateLabel(r.date, false)} · {formatTime12(r.schedule.departure)} · {routeLabel(r.route)}
              </option>
            ))}
          </select>
          <ChevronDown className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/60" />
        </label>

        {run && m && (
          <>
            {tab === 'board' && (
            <section className="rounded-2xl bg-white/[0.05] border border-white/10 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[13px] text-white/60">{run.bus.name} · {run.bus.regNo}</p>
                  <p className="text-[18px] font-semibold">{routeLabel(run.route)}</p>
                </div>
                <p className="text-right">
                  <span className="text-[30px] font-semibold tabular-nums">{m.totals.boarded}</span>
                  <span className="text-white/60 text-[16px]"> / {m.totals.seats}</span>
                  <span className="block text-[11px] text-white/50 -mt-1">{tx('seats on board')}</span>
                </p>
              </div>
              <div className="h-2.5 rounded-full bg-white/10 mt-3 overflow-hidden">
                <motion.div className="h-full bg-[#5bd97a] rounded-full" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-white/70">
                <span>{tx('{waiting} still to board', { waiting: m.totals.waiting })}</span>
                {m.totals.bikes > 0 && <span>{txn(m.totals.bikes, '{n} bike to load', '{n} bikes to load')}</span>}
              </div>
            </section>
            )}

            {tab !== 'cash' && !sharingCtl.sharing && inTripWindow && (
              <button onClick={toggleSharing} className="w-full rounded-2xl border-2 border-dashed border-[#5bd97a]/60 bg-[#0f7a2a]/15 p-4 text-left flex items-center gap-3">
                <Radio className="w-7 h-7 text-[#5bd97a] shrink-0" />
                <span>
                  <span className="block text-[16px] font-semibold">{tx('Start sharing the bus location')}</span>
                  <span className="block text-[12px] text-white/70">{tx('Uses this phone\'s GPS. Passengers see the bus on their ticket. Keep this page open and the phone charging.')}</span>
                </span>
              </button>
            )}
            {tab !== 'cash' && sharingCtl.sharing && <SharingLine status={sharingCtl.status} />}

            {tab === 'board' && (
            <div className="grid grid-cols-3 gap-2">
              <button onClick={toggleSharing} aria-pressed={sharingCtl.sharing}
                className={`h-[72px] rounded-xl border text-[12px] font-semibold flex flex-col items-center justify-center gap-1 ${sharingCtl.sharing ? 'bg-[#0f7a2a] border-[#0f7a2a]' : 'bg-white/5 border-white/15'}`}>
                <Radio className={`w-5 h-5 ${sharingCtl.sharing ? 'animate-pulse' : ''}`} /> {sharingCtl.sharing ? tx('Sharing location') : tx('Share location')}
              </button>
              <button onClick={() => setPosting('departed')} className="h-[72px] rounded-xl bg-white/5 border border-white/15 text-[12px] font-semibold flex flex-col items-center justify-center gap-1">
                <Megaphone className="w-5 h-5" />{' '}{tx('Update passengers')}</button>
              <button onClick={() => { downloadManifestPdf(data, run.schedule.id, run.date, { lastOdometer: lastReading(odometer.logs, run.bus.id) }); toast(tx('Trip sheet downloaded')); }} className="h-[72px] rounded-xl bg-white/5 border border-white/15 text-[12px] font-semibold flex flex-col items-center justify-center gap-1">
                <FileDown className="w-5 h-5" />{' '}{tx('Trip sheet PDF')}</button>
            </div>

            )}

            {tab !== 'map' && (
            <label className="relative block">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Find name, seat or ref')} aria-label={tx('Find passenger')}
                className="w-full h-11 pl-10 pr-3 rounded-xl bg-white/5 border border-white/15 text-[15px] placeholder:text-white/40" />
            </label>
            )}

            {tab === 'board' && (
              <>
                <button
                  onClick={() => setScanning(true)}
                  className="w-full h-20 rounded-2xl bg-[#feb700] text-[#14120a] text-[20px] font-bold flex items-center justify-center gap-3 shadow-[0_10px_30px_-10px_rgba(254,183,0,0.6)] active:scale-[0.98] transition-transform"
                >
                  <ScanLine className="w-7 h-7" />{' '}{tx('Scan tickets')}</button>
                <p className="text-[12px] text-white/55 -mt-2 px-1">{tx('Scanning puts the passenger on board. Fares are collected later, in the Cash tab.')}</p>

                {groups.length === 0 ? (
                  <p className="text-center text-white/60 text-[14px] py-8">{bookings.length ? tx('No match.') : tx('No passengers booked on this departure yet.')}</p>
                ) : (
                  groups.map((g) => {
                    const seats = g.bookings.reduce((n, b) => n + b.seats.length, 0);
                    const on = g.bookings.filter((b) => b.status === 'boarded').reduce((n, b) => n + b.seats.length, 0);
                    return (
                      <section key={g.stop}>
                        <h2 className="flex items-center justify-between text-[13px] font-semibold text-white/70 px-1 mb-2">
                          <span>{tx('Boarding at {stop}', { stop: g.stop })}</span>
                          <span className={on === seats ? 'text-[#5bd97a]' : ''}>{tx('{on}/{seats} on board', { on, seats })}</span>
                        </h2>
                        <ul className="rounded-2xl overflow-hidden border border-white/10 divide-y divide-white/10">
                          {g.bookings.map((b) => {
                            const isOpen = open === b.id;
                            const canBoard = b.status === 'confirmed' || b.status === 'held';
                            const tone = b.status === 'boarded' ? 'bg-[#0f7a2a]/25' : b.status === 'no-show' ? 'bg-white/[0.02] opacity-60' : 'bg-white/[0.04]';
                            return (
                              <li key={b.id} className={tone}>
                                <div className="flex items-stretch">
                                  <button onClick={() => setOpen(isOpen ? null : b.id)} aria-expanded={isOpen} className="flex-1 min-w-0 flex items-center gap-3 pl-3 pr-2 py-3 text-left min-h-[64px]">
                                    <span className={`shrink-0 min-w-12 h-10 px-2 rounded-lg flex items-center justify-center text-[14px] font-bold ${b.status === 'boarded' ? 'bg-[#5bd97a] text-[#0d0e11]' : 'bg-white/10'}`}>
                                      {b.status === 'boarded' ? <Check className="w-5 h-5" /> : b.seats.join(' ')}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                      <span className="block text-[15px] font-semibold truncate">{b.passenger.name}{b.passenger.gender === 'Female' ? ' ♀' : ''}</span>
                                      <span className="block text-[12px] text-white/60 truncate">
                                        {b.status === 'boarded' ? tx('Seat {seats} · to {to}', { seats: b.seats.join(', '), to: b.to }) : tx('to {to}', { to: b.to })}{b.bikes?.length ? ` · 🚲 ${b.bikes.length}` : ''}
                                        {isDue(b) && <span className="text-[#ffcf5c] font-semibold">{' '}{tx('· pays {amount}', { amount: formatLKR(b.total) })}</span>}
                                      </span>
                                    </span>
                                    {b.status === 'no-show' && <span className="shrink-0 text-[11px] font-bold text-white/60">{tx('NO-SHOW')}</span>}
                                  </button>
                                  {/* One tap: on board. Whether they have paid is not asked here. */}
                                  {canBoard && (
                                    <button onClick={() => doAction(b, 'board')} aria-label={tx('Board {name}, seat {seats}', { name: b.passenger.name, seats: b.seats.join(', ') })}
                                      className="shrink-0 my-2 mr-2 px-4 rounded-xl bg-[#5bd97a] text-[#0d0e11] text-[14px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
                                      <Check className="w-4 h-4" />{' '}{tx('Board')}</button>
                                  )}
                                </div>
                                <AnimatePresence initial={false}>
                                  {isOpen && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                      <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                                        {b.status === 'held' && (
                                          <button onClick={() => doAction(b, 'cash')} className="col-span-2 h-11 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Banknote className="w-4 h-4" />{' '}{tx('Paying now: {amount} received · board', { amount: formatLKR(b.total) })}</button>
                                        )}
                                        {b.status === 'boarded' && isDue(b) && (
                                          <button onClick={() => doAction(b, 'collect')} className="col-span-2 h-12 rounded-xl bg-[#feb700] text-[#14120a] font-bold flex items-center justify-center gap-2"><Banknote className="w-5 h-5" />{' '}{tx('Cash {amount} received', { amount: formatLKR(b.total) })}</button>
                                        )}
                                        {(b.status === 'boarded' || b.status === 'no-show') && (
                                          <button onClick={() => doAction(b, 'undo')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Undo2 className="w-4 h-4" /> {b.status === 'boarded' ? tx('Undo boarding') : tx('Undo')}</button>
                                        )}
                                        {canBoard && (
                                          <button onClick={() => doAction(b, 'noshow')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><UserX className="w-4 h-4" />{' '}{tx('No-show')}</button>
                                        )}
                                        {(b.passenger.phone || b.contact.phone) && (
                                          <a href={`tel:${(b.passenger.phone || b.contact.phone).replace(/\s/g, '')}`} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Phone className="w-4 h-4" />{' '}{tx('Call')}</a>
                                        )}
                                        {(b.passenger.phone || b.contact.phone) && b.status !== 'no-show' && (
                                          <>
                                            <button onClick={() => sendLocation(b)} className="col-span-2 h-12 rounded-xl bg-[#1d4ed8] text-white font-bold flex items-center justify-center gap-2">
                                              <MapPin className="w-5 h-5" />{' '}{tx('Send bus location')}</button>
                                            <button onClick={() => openWhatsApp(b)} className="col-span-2 h-10 rounded-xl bg-white/10 text-[13px] font-semibold flex items-center justify-center gap-2">
                                              <MessageCircle className="w-4 h-4" />{' '}{tx('Send from my WhatsApp')}</button>
                                          </>
                                        )}
                                        <p className="col-span-2 text-[12px] text-white/50">{b.ref} · {b.from} → {b.to} · {b.channel === 'online' ? (isDue(b) ? (b.paymentMethod === 'bus' ? tx('pays on the bus') : tx('not paid yet ({paymentMethod})', { paymentMethod: tx(PAY_LABEL[b.paymentMethod ?? ''] ?? b.paymentMethod ?? '') })) : b.paymentMethod === 'cash' ? tx('paid cash') : tx('paid online')) : b.channel === 'phone' ? tx('sold by phone') : tx('sold at the counter')}</p>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })
                )}
              </>
            )}

            {tab === 'cash' && (
              <>
                <section className="rounded-2xl bg-white/[0.05] border border-white/10 p-4 grid grid-cols-2 gap-3">
                  <p>
                    <span className="block text-[12px] text-white/60">{tx('Still to collect')}</span>
                    <span className={`block text-[24px] font-semibold tabular-nums ${m.totals.unpaid > 0 ? 'text-[#ffcf5c]' : 'text-[#5bd97a]'}`}>{formatLKR(m.totals.unpaid)}</span>
                    <span className="block text-[12px] text-white/60">{txn(m.totals.unpaidCount, '{n} passenger', '{n} passengers')}</span>
                  </p>
                  <p>
                    <span className="block text-[12px] text-white/60">{tx('Cash you should have')}</span>
                    <span className="block text-[24px] font-semibold tabular-nums">{formatLKR(holding)}</span>
                    <span className="block text-[12px] text-white/60">{txn(tookCount, '{n} fare collected on the bus', '{n} fares collected on the bus')}</span>
                  </p>
                </section>

                {owing.length === 0 ? (
                  <p className="text-center text-[#9be8ad] text-[15px] font-semibold py-6">{tx('Nothing left to collect on this trip.')}</p>
                ) : owingShown.length === 0 ? (
                  <p className="text-center text-white/60 text-[14px] py-6">{tx('No match.')}</p>
                ) : (
                  <section>
                    <h2 className="text-[13px] font-semibold text-white/70 px-1 mb-2">{tx('Seat by seat, front of the bus first')}</h2>
                    <ul className="rounded-2xl overflow-hidden border border-white/10 divide-y divide-white/10">
                      {owingShown.map((b) => {
                        const onBoard = b.status === 'boarded';
                        const isArmed = armed === b.id;
                        return (
                          <li key={b.id} className={`flex items-stretch ${onBoard ? 'bg-white/[0.04]' : 'bg-white/[0.02]'}`}>
                            <div className="flex-1 min-w-0 flex items-center gap-3 pl-3 pr-2 py-3 min-h-[68px]">
                              <span className="shrink-0 min-w-12 h-10 px-2 rounded-lg bg-white/10 flex items-center justify-center text-[14px] font-bold">{b.seats.join(' ')}</span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[15px] font-semibold truncate">{b.passenger.name}</span>
                                <span className="block text-[12px] text-white/60 truncate">{onBoard ? '' : <span className="text-[#ffcf5c]">{tx('Not on board yet ·')}{' '}</span>}{b.from} → {b.to}</span>
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                if (!isArmed) return setArmed(b.id);
                                setArmed(null);
                                // Not on board yet but paying: they are clearly here, so board them too.
                                doAction(b, onBoard ? 'collect' : 'cash');
                              }}
                              aria-label={isArmed ? tx('Confirm {amount} received from {name}', { amount: formatLKR(b.total), name: b.passenger.name }) : tx('{amount} from {name}, seat {seats}', { amount: formatLKR(b.total), name: b.passenger.name, seats: b.seats.join(', ') })}
                              className={`shrink-0 my-2 mr-2 w-[124px] rounded-xl text-[14px] font-bold flex flex-col items-center justify-center leading-tight active:scale-95 transition-all ${isArmed ? 'bg-[#5bd97a] text-[#0d0e11]' : 'bg-[#feb700] text-[#14120a]'}`}
                            >
                              {isArmed ? <><span>{tx('Tap to confirm')}</span><span className="text-[12px] font-semibold">{tx('{amount} received', { amount: formatLKR(b.total) })}</span></> : <><span className="tabular-nums">{formatLKR(b.total)}</span><span className="text-[12px] font-semibold">{tx('Collect')}</span></>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {paidCash.length > 0 && (
                  <details className="rounded-2xl border border-white/10 bg-white/[0.03]">
                    <summary className="px-4 py-3 text-[13px] font-semibold text-white/80 cursor-pointer">{tx('Cash you collected on this trip ({length})', { length: paidCash.length })}</summary>
                    <ul className="divide-y divide-white/10 border-t border-white/10">
                      {paidCash.map((b) => (
                        <li key={b.id} className="px-4 py-2.5 flex justify-between gap-3 text-[13px]">
                          <span className="min-w-0 truncate"><b className="font-semibold">{b.seats.join(', ')}</b> · {b.passenger.name}</span>
                          <span className="tabular-nums shrink-0 text-[#9be8ad]">{formatLKR(b.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}

            {/* After the trip. Nothing to type: the paper sheet and the cash go to the booking centre, which closes the trip. */}
            {tab === 'cash' && (
            <section className="rounded-2xl bg-white/[0.05] border border-white/10 p-4">
              <div className="flex items-end justify-between gap-3">
                <p>
                  <span className="block text-[12px] text-white/60">{tx('Cash you should have for this trip')}</span>
                  <span className="block text-[28px] font-semibold tabular-nums leading-tight">{formatLKR(holding)}</span>
                </p>
                <Wallet className="w-6 h-6 text-white/40 mb-1" aria-hidden />
              </div>
              <p className="text-[12px] text-white/60 mt-1">{[
                mine && mine.refunds.length > 0
                  ? txn(tookCount, '{n} fare you collected on the bus, less refunds you paid.', '{n} fares you collected on the bus, less refunds you paid.')
                  : txn(tookCount, '{n} fare you collected on the bus.', '{n} fares you collected on the bus.'),
                m.totals.unpaid > 0 ? tx('{amount} still to collect.', { amount: formatLKR(m.totals.unpaid) }) : '',
                tx('Seats paid at the office, by card or by bank are not in this.'),
              ].filter(Boolean).join(' ')}</p>
              <p className="text-[13px] text-white/80 mt-3">{tx('After arriving, hand this cash and your paper trip sheet to the booking centre. Write fuel, tolls and anything else you paid from it on the sheet; they take it off and close the trip.')}</p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <Link href="/conductor/odometer" className="h-11 rounded-xl bg-white/10 text-[13px] font-semibold flex items-center justify-center">{tx('Odometer reading')}</Link>
                <Link href="/conductor/cash" className="h-11 rounded-xl bg-white/10 text-[13px] font-semibold flex items-center justify-center">{tx('Count my cash')}</Link>
              </div>
            </section>
            )}

            {tab === 'map' && (
              <MapTab data={data} route={run.route} schedule={run.schedule} date={run.date} bookings={bookings} userName={user?.user_metadata.full_name ?? ''} toast={toast} />
            )}
          </>
        )}
      </main>

      {scanning && run && (
        <QrScanner
          title={`${formatTime12(run.schedule.departure)} · ${routeLabel(run.route)}`}
          onCode={(text) => scanTicket(text, bookings, act)}
          onClose={() => setScanning(false)}
          footer={m && <p className="text-center text-[13px] text-white/70">{tx('{boarded} / {seats} seats on board', { boarded: m.totals.boarded, seats: m.totals.seats })}</p>}
        />
      )}
      {posting && run && (
        <div className="text-[#191c1e]">
          <UpdateModal
            stops={run.route.stops.filter((s) => !s.hidden).map((s) => s.name)}
            initial={posting}
            onClose={() => setPosting(null)}
            onSend={async (ev) => {
              const r = await postTripEvent(run.schedule.id, run.date, ev);
              if (!r.ok) return toast(r.reason ?? tx('Could not send'), 'error');
              setPosting(null);
              toast(tx('Update sent to passengers'));
            }}
          />
        </div>
      )}
      <BottomNav
        tab={tab}
        onTab={setTab}
        waiting={m?.totals.waiting ?? 0}
        unpaid={m?.totals.unpaidCount ?? 0}
      />
      {/* Messages sit above the bottom bar. */}
      <div className="[&>*]:!bottom-[calc(env(safe-area-inset-bottom)+92px)] [&>*]:!right-4 [&>*]:!left-4 [&>*]:!max-w-none [&>*]:text-center">
        <Toast />
      </div>
    </div>
  );
}

/** "Live · sent 8 s ago · ±12 m", or a red warning when it isn't getting through. */
function SharingLine({ status }: { status: SharingStatus }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  // Never negative: the phone's clock and the timer can be a second or two apart.
  const age = status.lastSentAt ? Math.max(0, Math.round((now - status.lastSentAt) / 1000)) : null;
  const bad = !!status.problem || (age != null && age > 120);
  return (
    <p role="status" className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold ${bad ? 'bg-[#b3261e]/25 text-[#ffb4ab]' : 'bg-[#0f7a2a]/25 text-[#9be8ad]'}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${bad ? 'bg-[#ff8a80]' : 'bg-[#5bd97a] animate-pulse'}`} aria-hidden />
      {status.problem
        ? status.problem
        : age == null
          ? tx('Getting GPS fix…')
          : [
              age < 60 ? tx('Live · sent {s} s ago', { s: age }) : tx('Live · sent {m} min ago', { m: Math.round(age / 60) }),
              status.accuracy ? tx('±{m} m', { m: status.accuracy }) : '',
            ].filter(Boolean).join(' · ')}
    </p>
  );
}
