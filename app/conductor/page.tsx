'use client';
// Conductor page: made for a phone in one hand on a moving bus.
// Pick today's departure → scan tickets (or tap names) → passengers boarded,
// cash collected, location shared, updates sent. Works for office staff too.

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
import { postTripEvent, type TripEvent } from '@/lib/extras';
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
  const sharingCtl = useLocationSharing(run?.schedule.id ?? '', run?.date ?? '', toast);
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
                {m.totals.unpaid > 0 && <span className="text-[#ffcf5c] font-semibold">{formatLKR(m.totals.unpaid)} to collect</span>}
                {m.totals.bikes > 0 && <span>{m.totals.bikes} bike(s) to load</span>}
              </div>
            </section>

            {!sharingCtl.sharing && inTripWindow && (
              <button onClick={sharingCtl.toggle} className="w-full rounded-2xl border-2 border-dashed border-[#5bd97a]/60 bg-[#0f7a2a]/15 p-4 text-left flex items-center gap-3">
                <Radio className="w-7 h-7 text-[#5bd97a] shrink-0" />
                <span>
                  <span className="block text-[16px] font-semibold">Start sharing the bus location</span>
                  <span className="block text-[12px] text-white/70">Uses this phone&apos;s GPS. Passengers see the bus on their ticket. Keep this page open and the phone charging.</span>
                </span>
              </button>
            )}
            {sharingCtl.sharing && <SharingLine status={sharingCtl.status} />}

            <button
              onClick={() => setScanning(true)}
              className="w-full h-20 rounded-2xl bg-[#feb700] text-[#14120a] text-[20px] font-bold flex items-center justify-center gap-3 shadow-[0_10px_30px_-10px_rgba(254,183,0,0.6)] active:scale-[0.98] transition-transform"
            >
              <ScanLine className="w-7 h-7" /> Scan tickets
            </button>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={sharingCtl.toggle} aria-pressed={sharingCtl.sharing}
                className={`h-[72px] rounded-xl border text-[12px] font-semibold flex flex-col items-center justify-center gap-1 ${sharingCtl.sharing ? 'bg-[#0f7a2a] border-[#0f7a2a]' : 'bg-white/5 border-white/15'}`}>
                <Radio className={`w-5 h-5 ${sharingCtl.sharing ? 'animate-pulse' : ''}`} /> {sharingCtl.sharing ? 'Sharing location' : 'Share location'}
              </button>
              <button onClick={() => setPosting('departed')} className="h-[72px] rounded-xl bg-white/5 border border-white/15 text-[12px] font-semibold flex flex-col items-center justify-center gap-1">
                <Megaphone className="w-5 h-5" /> Update passengers
              </button>
              <button onClick={() => { downloadManifestPdf(data, run.schedule.id, run.date); toast('Passenger list downloaded'); }} className="h-[72px] rounded-xl bg-white/5 border border-white/15 text-[12px] font-semibold flex flex-col items-center justify-center gap-1">
                <FileDown className="w-5 h-5" /> Passenger list PDF
              </button>
            </div>

            <label className="relative block">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find name, seat or ref" aria-label="Find passenger"
                className="w-full h-11 pl-10 pr-3 rounded-xl bg-white/5 border border-white/15 text-[15px] placeholder:text-white/40" />
            </label>

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
                        const tone = b.status === 'boarded' ? 'bg-[#0f7a2a]/25' : b.status === 'held' ? 'bg-[#feb700]/10' : b.status === 'no-show' ? 'bg-white/[0.02] opacity-60' : 'bg-white/[0.04]';
                        return (
                          <li key={b.id} className={tone}>
                            <button onClick={() => setOpen(isOpen ? null : b.id)} aria-expanded={isOpen} className="w-full flex items-center gap-3 px-3 py-3 text-left min-h-[64px]">
                              <span className={`shrink-0 min-w-12 h-10 px-2 rounded-lg flex items-center justify-center text-[14px] font-bold ${b.status === 'boarded' ? 'bg-[#5bd97a] text-[#0d0e11]' : 'bg-white/10'}`}>
                                {b.status === 'boarded' ? <Check className="w-5 h-5" /> : b.seats.join(' ')}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-[15px] font-semibold truncate">{b.passenger.name}{b.passenger.gender === 'Female' ? ' ♀' : ''}</span>
                                <span className="block text-[12px] text-white/60 truncate">
                                  {b.status === 'boarded' ? `Seat ${b.seats.join(', ')} · ` : ''}to {b.to}{b.bikes?.length ? ` · 🚲 ${b.bikes.length}` : ''}
                                </span>
                              </span>
                              {isDue(b) && <span className="shrink-0 text-[12px] font-bold text-[#ffcf5c]">DUE {b.total.toLocaleString('en-LK')}</span>}
                              {b.status === 'no-show' && <span className="shrink-0 text-[11px] font-bold text-white/60">NO-SHOW</span>}
                            </button>
                            <AnimatePresence initial={false}>
                              {isOpen && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                  <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                                    {b.status === 'held' ? (
                                      <>
                                        <button onClick={() => doAction(b, 'cash')} className="col-span-2 h-12 rounded-xl bg-[#feb700] text-[#14120a] font-bold flex items-center justify-center gap-2"><Banknote className="w-5 h-5" /> Cash {formatLKR(b.total)} received · board</button>
                                        {b.paymentMethod === 'bus' && (
                                          <button onClick={() => doAction(b, 'board')} className="col-span-2 h-11 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Check className="w-4 h-4" /> On board · collect later</button>
                                        )}
                                        <button onClick={() => doAction(b, 'noshow')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><UserX className="w-4 h-4" /> No-show</button>
                                      </>
                                    ) : b.status === 'boarded' && isDue(b) ? (
                                      <>
                                        <button onClick={() => doAction(b, 'collect')} className="col-span-2 h-12 rounded-xl bg-[#feb700] text-[#14120a] font-bold flex items-center justify-center gap-2"><Banknote className="w-5 h-5" /> Cash {formatLKR(b.total)} received</button>
                                        <button onClick={() => doAction(b, 'undo')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Undo2 className="w-4 h-4" /> Undo boarding</button>
                                      </>
                                    ) : b.status === 'confirmed' ? (
                                      <button onClick={() => doAction(b, 'board')} className="h-12 rounded-xl bg-[#5bd97a] text-[#0d0e11] font-bold flex items-center justify-center gap-2"><Check className="w-5 h-5" /> On board</button>
                                    ) : (
                                      <button onClick={() => doAction(b, 'undo')} className="h-12 rounded-xl bg-white/10 font-semibold flex items-center justify-center gap-2"><Undo2 className="w-4 h-4" /> Undo</button>
                                    )}
                                    {b.status === 'confirmed' && (
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
                                    <p className="col-span-2 text-[12px] text-white/50">{b.ref} · {b.from} → {b.to} · {b.channel === 'online' ? (isDue(b) ? (b.paymentMethod === 'bus' ? 'pays on the bus' : `held (${b.paymentMethod})`) : b.paymentMethod === 'cash' ? 'paid cash' : 'paid online') : `sold at ${b.channel}`}</p>
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

            {/* Closes the cash for the departure chosen at the top of this screen (not just "today"). */}
            <Link href={`/conductor/cash?date=${run.date}&schedule=${encodeURIComponent(run.schedule.id)}`} className="flex items-center justify-center gap-2 h-12 rounded-xl bg-white/5 border border-white/15 text-[14px] font-semibold">
              <Wallet className="w-4 h-4" /> Close this trip
            </Link>
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
