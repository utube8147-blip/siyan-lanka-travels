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
import { postTripEvent, useCashSummary, type TripEvent } from '@/lib/extras';
import { QrScanner } from '@/components/staff/QrScanner';
import { UpdateModal, useLocationSharing, type SharingStatus } from '@/components/admin/TripTools';
import { useToast } from '@/components/admin/ui';
import { Wordmark } from '@/components/Wordmark';
import type { Booking } from '@/lib/types';
import { OPERATOR } from '@/config/operator';
import { friendlyError, isSupabaseConfigured, supabase } from '@/lib/supabase/client';

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
  const [tab, setTab] = useState<'board' | 'cash'>('board');
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
  const sharingCtl = useLocationSharing(run?.schedule.id ?? '', run?.date ?? '', toast);
  // The bus position is this device's GPS. A conductor's phone is on the bus; anyone else is asked first,
  // so an office computer is not turned into the bus by mistake.
  const toggleSharing = () => {
    if (!sharingCtl.sharing && user?.role !== 'conductor' && !window.confirm('Share the position of THIS device as the bus? Only say yes on a phone that is on the bus.')) return;
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
    takeCash: (b: Booking) => confirmPayment(b.id, 'cash'),
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
  const paidCash = bookings.filter((b) => b.paymentMethod === 'cash' && b.paymentStatus === 'paid' && b.status !== 'no-show');
  const paidCashTotal = paidCash.reduce((n, b) => n + b.total, 0);
  // From the database when connected (only what THIS person took); otherwise every cash payment on the trip.
  const mine = myCash && myCash !== 'error' && run ? myCash : null;
  const holding = mine ? mine.expected : paidCashTotal;
  const tookCount = mine ? mine.taken.length : paidCash.length;

  // Send this one passenger where the bus is right now (WhatsApp if set up, otherwise a text).
  const sendLocation = async (b: Booking) => {
    if (!isSupabaseConfigured) return toast('Sending messages needs the database (not available in demo mode).', 'error');
    const { data: via, error } = await supabase().rpc('send_bus_location', { p_booking: b.id });
    toast(error ? friendlyError(error) : `Bus location sent to ${b.passenger.name.split(' ')[0]} by ${via === 'whatsapp' ? 'WhatsApp (text if they don\'t have it)' : 'text message'}`, error ? 'error' : 'ok');
  };
  // The same, from the conductor's own WhatsApp: opens the chat with the message ready to send.
  const openWhatsApp = async (b: Booking) => {
    const phone = (b.contact.phone || b.passenger.phone || '').replace(/\D/g, '').replace(/^0/, '94');
    if (!phone) return toast('There is no phone number on this booking.', 'error');
    let where = '';
    if (isSupabaseConfigured) {
      const { data: loc } = await supabase().from('bus_locations').select('lat, lng').eq('schedule_id', b.scheduleId).eq('travel_date', b.date).maybeSingle();
      if (loc) where = ` The bus is here now: https://maps.google.com/?q=${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
    }
    const text = `Siyan Lanka Travels: your bus for ${b.from} → ${b.to}, seat ${b.seats.join(', ')}.${where} Live: ${OPERATOR.siteUrl}/track?ref=${b.ref}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  // 'cash' = paid at the door and boarded; 'collect' = already on board, paying now;
  // 'board' on an unpaid pay-on-bus seat = board first, collect during the trip.
  const doAction = async (b: Booking, what: 'board' | 'noshow' | 'undo' | 'cash' | 'collect') => {
    setOpen(null);
    const r =
      what === 'cash'
        ? await confirmPayment(b.id, 'cash').then(async (p) => (p.ok ? updateBooking(b.id, { status: 'boarded' }) : p))
        : what === 'collect'
        ? await confirmPayment(b.id, 'cash')
        : // Undo for someone who hasn't paid goes back to "held", so the money is still asked for.
          await updateBooking(b.id, { status: what === 'board' ? 'boarded' : what === 'noshow' ? 'no-show' : b.paymentStatus === 'unpaid' ? 'held' : 'confirmed' });
    toast(r.ok ? `${b.passenger.name}: ${what === 'board' ? 'on board' : what === 'noshow' ? 'no-show' : what === 'cash' ? 'paid & on board' : what === 'collect' ? `paid ${formatLKR(b.total)}` : 'undone'}` : r.reason ?? 'Could not update', r.ok ? 'ok' : 'error');
    if (r.ok && (what === 'board' || what === 'cash' || what === 'collect')) navigator.vibrate?.(60);
  };

  return (
    <div className="keep-navy min-h-screen bg-[#0d0e11] text-white pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <header className="sticky top-0 z-30 bg-[#111216]/95 backdrop-blur border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="h-14 px-4 flex items-center justify-between max-w-2xl mx-auto">
          <Wordmark size="sm" />
          <div className="flex items-center gap-1">
            <span className="text-[12px] text-white/60 mr-1 max-w-[110px] truncate">{user?.user_metadata.full_name}</span>
            {user?.role !== 'conductor' && <Link href="/admin" className="px-3 h-9 rounded-lg text-[12px] font-semibold bg-white/10 flex items-center">Staff area</Link>}
            <button onClick={async () => { await logout(); router.replace('/staff/login'); }} aria-label="Sign out" className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Departure picker */}
        <label className="block relative">
          <span className="sr-only">Departure</span>
          <select
            value={run ? `${run.schedule.id}|${run.date}` : ''}
            onChange={(e) => setRunKey(e.target.value)}
            className="w-full h-12 pl-4 pr-10 rounded-xl bg-white/5 border border-white/15 text-[15px] font-semibold appearance-none"
          >
            {runs.length === 0 && <option>No departures today</option>}
            {runs.map((r) => (
              <option key={`${r.schedule.id}|${r.date}`} value={`${r.schedule.id}|${r.date}`} className="text-black">
                {r.date === todayISO() ? 'Today' : formatDateLabel(r.date, false)} · {formatTime12(r.schedule.departure)} · {routeLabel(r.route)}
              </option>
            ))}
          </select>
          <ChevronDown className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/60" />
        </label>

        {run && m && (
          <>
            <section className="rounded-2xl bg-white/[0.05] border border-white/10 p-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[13px] text-white/60">{run.bus.name} · {run.bus.regNo}</p>
                  <p className="text-[18px] font-semibold">{routeLabel(run.route)}</p>
                </div>
                <p className="text-right">
                  <span className="text-[30px] font-semibold tabular-nums">{m.totals.boarded}</span>
                  <span className="text-white/60 text-[16px]"> / {m.totals.seats}</span>
                  <span className="block text-[11px] text-white/50 -mt-1">seats on board</span>
                </p>
              </div>
              <div className="h-2.5 rounded-full bg-white/10 mt-3 overflow-hidden">
                <motion.div className="h-full bg-[#5bd97a] rounded-full" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-white/70">
                <span>{m.totals.waiting} still to board</span>
                {m.totals.bikes > 0 && <span>{m.totals.bikes} bike(s) to load</span>}
              </div>
            </section>

            {!sharingCtl.sharing && inTripWindow && (
              <button onClick={toggleSharing} className="w-full rounded-2xl border-2 border-dashed border-[#5bd97a]/60 bg-[#0f7a2a]/15 p-4 text-left flex items-center gap-3">
                <Radio className="w-7 h-7 text-[#5bd97a] shrink-0" />
                <span>
                  <span className="block text-[16px] font-semibold">Start sharing the bus location</span>
                  <span className="block text-[12px] text-white/70">Uses this phone&apos;s GPS. Passengers see the bus on their ticket. Keep this page open and the phone charging.</span>
                </span>
              </button>
            )}
            {sharingCtl.sharing && <SharingLine status={sharingCtl.status} />}

            <div className="grid grid-cols-3 gap-2">
              <button onClick={toggleSharing} aria-pressed={sharingCtl.sharing}
                className={`h-[72px] rounded-xl border text-[12px] font-semibold flex flex-col items-center justify-center gap-1 ${sharingCtl.sharing ? 'bg-[#0f7a2a] border-[#0f7a2a]' : 'bg-white/5 border-white/15'}`}>
                <Radio className={`w-5 h-5 ${sharingCtl.sharing ? 'animate-pulse' : ''}`} /> {sharingCtl.sharing ? 'Sharing location' : 'Share location'}
              </button>
              <button onClick={() => setPosting('departed')} className="h-[72px] rounded-xl bg-white/5 border border-white/15 text-[12px] font-semibold flex flex-col items-center justify-center gap-1">
                <Megaphone className="w-5 h-5" /> Update passengers
              </button>
              <button onClick={() => { downloadManifestPdf(data, run.schedule.id, run.date); toast('Trip sheet downloaded'); }} className="h-[72px] rounded-xl bg-white/5 border border-white/15 text-[12px] font-semibold flex flex-col items-center justify-center gap-1">
                <FileDown className="w-5 h-5" /> Trip sheet PDF
              </button>
            </div>

            {/* The two jobs. Stays in reach while the list scrolls. */}
            <div role="tablist" aria-label="What you are doing" className="sticky top-[calc(env(safe-area-inset-top)+56px)] z-20 -mx-4 px-4 py-2 bg-[#0d0e11]/95 backdrop-blur grid grid-cols-2 gap-2">
              <button role="tab" aria-selected={tab === 'board'} onClick={() => { setTab('board'); setOpen(null); }}
                className={`h-14 rounded-xl text-left px-3 border ${tab === 'board' ? 'bg-white text-[#0d0e11] border-white' : 'bg-white/5 border-white/15 text-white'}`}>
                <span className="block text-[15px] font-bold leading-tight">Boarding</span>
                <span className={`block text-[12px] ${tab === 'board' ? 'text-[#0d0e11]/70' : 'text-white/60'}`}>{m.totals.waiting === 0 ? 'Everyone is on' : `${m.totals.waiting} still to board`}</span>
              </button>
              <button role="tab" aria-selected={tab === 'cash'} onClick={() => { setTab('cash'); setOpen(null); }}
                className={`h-14 rounded-xl text-left px-3 border ${tab === 'cash' ? 'bg-[#feb700] text-[#14120a] border-[#feb700]' : 'bg-white/5 border-white/15 text-white'}`}>
                <span className="block text-[15px] font-bold leading-tight">Collect cash</span>
                <span className={`block text-[12px] ${tab === 'cash' ? 'text-[#14120a]/75' : m.totals.unpaid > 0 ? 'text-[#ffcf5c] font-semibold' : 'text-white/60'}`}>
                  {m.totals.unpaid > 0 ? `${formatLKR(m.totals.unpaid)} from ${m.totals.unpaidCount}` : 'Nothing to collect'}
                </span>
              </button>
            </div>

            <label className="relative block">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find name, seat or ref" aria-label="Find passenger"
                className="w-full h-11 pl-10 pr-3 rounded-xl bg-white/5 border border-white/15 text-[15px] placeholder:text-white/40" />
            </label>

            {tab === 'board' && (
              <>
                <button
                  onClick={() => setScanning(true)}
                  className="w-full h-20 rounded-2xl bg-[#feb700] text-[#14120a] text-[20px] font-bold flex items-center justify-center gap-3 shadow-[0_10px_30px_-10px_rgba(254,183,0,0.6)] active:scale-[0.98] transition-transform"
                >
                  <ScanLine className="w-7 h-7" /> Scan tickets
                </button>
                <p className="text-[12px] text-white/55 -mt-2 px-1">Scanning puts the passenger on board. Fares are collected later, under Collect cash.</p>

                {groups.length === 0 ? (
                  <p className="text-center text-white/60 text-[14px] py-8">{bookings.length ? 'No match.' : 'No passengers booked on this departure yet.'}</p>
                ) : (
                  groups.map((g) => {
                    const seats = g.bookings.reduce((n, b) => n + b.seats.length, 0);
                    const on = g.bookings.filter((b) => b.status === 'boarded').reduce((n, b) => n + b.seats.length, 0);
                    return (
                      <section key={g.stop}>
                        <h2 className="flex items-center justify-between text-[13px] font-semibold text-white/70 px-1 mb-2">
                          <span>Boarding at {g.stop}</span>
                          <span className={on === seats ? 'text-[#5bd97a]' : ''}>{on}/{seats} on board</span>
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
                                        {b.status === 'boarded' ? `Seat ${b.seats.join(', ')} · ` : ''}to {b.to}{b.bikes?.length ? ` · 🚲 ${b.bikes.length}` : ''}
                                        {isDue(b) && <span className="text-[#ffcf5c] font-semibold"> · pays {formatLKR(b.total)}</span>}
                                      </span>
                                    </span>
                                    {b.status === 'no-show' && <span className="shrink-0 text-[11px] font-bold text-white/60">NO-SHOW</span>}
                                  </button>
                                  {/* One tap: on board. Whether they have paid is not asked here. */}
                                  {canBoard && (
                                    <button onClick={() => doAction(b, 'board')} aria-label={`Board ${b.passenger.name}, seat ${b.seats.join(', ')}`}
                                      className="shrink-0 my-2 mr-2 px-4 rounded-xl bg-[#5bd97a] text-[#0d0e11] text-[14px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
                                      <Check className="w-4 h-4" /> Board
                                    </button>
                                  )}
                                </div>
                                <AnimatePresence initial={false}>
                                  {isOpen && (
                                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                      <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                                        {b.status === 'held' && (
                                          <button onClick={() => doAction(b, 'cash')} className="col-span-2 h-11 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Banknote className="w-4 h-4" /> Paying now: {formatLKR(b.total)} received · board</button>
                                        )}
                                        {b.status === 'boarded' && isDue(b) && (
                                          <button onClick={() => doAction(b, 'collect')} className="col-span-2 h-12 rounded-xl bg-[#feb700] text-[#14120a] font-bold flex items-center justify-center gap-2"><Banknote className="w-5 h-5" /> Cash {formatLKR(b.total)} received</button>
                                        )}
                                        {(b.status === 'boarded' || b.status === 'no-show') && (
                                          <button onClick={() => doAction(b, 'undo')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Undo2 className="w-4 h-4" /> {b.status === 'boarded' ? 'Undo boarding' : 'Undo'}</button>
                                        )}
                                        {canBoard && (
                                          <button onClick={() => doAction(b, 'noshow')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><UserX className="w-4 h-4" /> No-show</button>
                                        )}
                                        {(b.passenger.phone || b.contact.phone) && (
                                          <a href={`tel:${(b.passenger.phone || b.contact.phone).replace(/\s/g, '')}`} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Phone className="w-4 h-4" /> Call</a>
                                        )}
                                        {(b.passenger.phone || b.contact.phone) && b.status !== 'no-show' && (
                                          <>
                                            <button onClick={() => sendLocation(b)} className="col-span-2 h-12 rounded-xl bg-[#1d4ed8] text-white font-bold flex items-center justify-center gap-2">
                                              <MapPin className="w-5 h-5" /> Send bus location
                                            </button>
                                            <button onClick={() => openWhatsApp(b)} className="col-span-2 h-10 rounded-xl bg-white/10 text-[13px] font-semibold flex items-center justify-center gap-2">
                                              <MessageCircle className="w-4 h-4" /> Send from my WhatsApp
                                            </button>
                                          </>
                                        )}
                                        <p className="col-span-2 text-[12px] text-white/50">{b.ref} · {b.from} → {b.to} · {b.channel === 'online' ? (isDue(b) ? (b.paymentMethod === 'bus' ? 'pays on the bus' : `not paid yet (${b.paymentMethod})`) : b.paymentMethod === 'cash' ? 'paid cash' : 'paid online') : `sold at ${b.channel}`}</p>
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
                    <span className="block text-[12px] text-white/60">Still to collect</span>
                    <span className={`block text-[24px] font-semibold tabular-nums ${m.totals.unpaid > 0 ? 'text-[#ffcf5c]' : 'text-[#5bd97a]'}`}>{formatLKR(m.totals.unpaid)}</span>
                    <span className="block text-[12px] text-white/60">{m.totals.unpaidCount} passenger{m.totals.unpaidCount === 1 ? '' : 's'}</span>
                  </p>
                  <p>
                    <span className="block text-[12px] text-white/60">Cash you should have</span>
                    <span className="block text-[24px] font-semibold tabular-nums">{formatLKR(holding)}</span>
                    <span className="block text-[12px] text-white/60">{tookCount} payment{tookCount === 1 ? '' : 's'} you took</span>
                  </p>
                </section>

                {owing.length === 0 ? (
                  <p className="text-center text-[#9be8ad] text-[15px] font-semibold py-6">Nothing left to collect on this trip.</p>
                ) : owingShown.length === 0 ? (
                  <p className="text-center text-white/60 text-[14px] py-6">No match.</p>
                ) : (
                  <section>
                    <h2 className="text-[13px] font-semibold text-white/70 px-1 mb-2">Seat by seat, front of the bus first</h2>
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
                                <span className="block text-[12px] text-white/60 truncate">{onBoard ? '' : <span className="text-[#ffcf5c]">Not on board yet · </span>}{b.from} → {b.to}</span>
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                if (!isArmed) return setArmed(b.id);
                                setArmed(null);
                                // Not on board yet but paying: they are clearly here, so board them too.
                                doAction(b, onBoard ? 'collect' : 'cash');
                              }}
                              aria-label={isArmed ? `Confirm ${formatLKR(b.total)} received from ${b.passenger.name}` : `${formatLKR(b.total)} from ${b.passenger.name}, seat ${b.seats.join(', ')}`}
                              className={`shrink-0 my-2 mr-2 w-[124px] rounded-xl text-[14px] font-bold flex flex-col items-center justify-center leading-tight active:scale-95 transition-all ${isArmed ? 'bg-[#5bd97a] text-[#0d0e11]' : 'bg-[#feb700] text-[#14120a]'}`}
                            >
                              {isArmed ? <><span>Tap to confirm</span><span className="text-[12px] font-semibold">{formatLKR(b.total)} received</span></> : <><span className="tabular-nums">{formatLKR(b.total)}</span><span className="text-[12px] font-semibold">Collect</span></>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {paidCash.length > 0 && (
                  <details className="rounded-2xl border border-white/10 bg-white/[0.03]">
                    <summary className="px-4 py-3 text-[13px] font-semibold text-white/80 cursor-pointer">Paid in cash on this trip ({paidCash.length})</summary>
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
            <section className="rounded-2xl bg-white/[0.05] border border-white/10 p-4">
              <div className="flex items-end justify-between gap-3">
                <p>
                  <span className="block text-[12px] text-white/60">Cash you should have for this trip</span>
                  <span className="block text-[28px] font-semibold tabular-nums leading-tight">{formatLKR(holding)}</span>
                </p>
                <Wallet className="w-6 h-6 text-white/40 mb-1" aria-hidden />
              </div>
              <p className="text-[12px] text-white/60 mt-1">
                {tookCount} cash payment{tookCount === 1 ? '' : 's'} you took{mine && mine.refunds.length > 0 ? ', less refunds you paid' : ''}{m.totals.unpaid > 0 ? `. ${formatLKR(m.totals.unpaid)} still to collect.` : '.'}
              </p>
              <p className="text-[13px] text-white/80 mt-3">
                After arriving, hand this cash and your paper trip sheet to the booking centre. Write fuel, tolls and anything else you paid from it on the sheet; they take it off and close the trip.
              </p>
            </section>
          </>
        )}
      </main>

      {scanning && run && (
        <QrScanner
          title={`${formatTime12(run.schedule.departure)} · ${routeLabel(run.route)}`}
          onCode={(text) => scanTicket(text, bookings, act)}
          onClose={() => setScanning(false)}
          footer={m && <p className="text-center text-[13px] text-white/70">{m.totals.boarded} / {m.totals.seats} seats on board</p>}
        />
      )}
      {posting && run && (
        <div className="text-[#191c1e]">
          <UpdateModal
            stops={run.route.stops.map((s) => s.name)}
            initial={posting}
            onClose={() => setPosting(null)}
            onSend={async (ev) => {
              const r = await postTripEvent(run.schedule.id, run.date, ev);
              if (!r.ok) return toast(r.reason ?? 'Could not send', 'error');
              setPosting(null);
              toast('Update sent to passengers');
            }}
          />
        </div>
      )}
      <Toast />
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
          ? 'Getting GPS fix…'
          : `Live · sent ${age < 60 ? `${age} s` : `${Math.round(age / 60)} min`} ago${status.accuracy ? ` · ±${status.accuracy} m` : ''}`}
    </p>
  );
}
