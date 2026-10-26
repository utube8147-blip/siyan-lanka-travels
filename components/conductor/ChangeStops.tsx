'use client';
// Conductor: who gets on and off at a stop (names, seats, call), and changing
// where a passenger gets on or off after asking them. Used on the Map tab
// (tap a stop) and on the Board tab (a passenger's details).

import { useEffect, useState } from 'react';
import { ArrowRightLeft, Check, Phone, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatLKR, formatTime12, fromMinutes, toMinutes } from '@/lib/trips';
import { tx } from '@/lib/i18n';
import type { Booking, Route } from '@/lib/types';

const low = (s: string) => s.trim().toLowerCase();
const phoneOf = (b: Booking) => (b.passenger.phone || b.contact.phone || '').replace(/\s/g, '');

export function DarkSheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label={tx('Close')} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-t-3xl bg-[#18191d] border-t border-white/10 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)] text-white">
        <div className="mx-auto w-10 h-1.5 rounded-full bg-white/20 mb-3" aria-hidden />
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold truncate">{title}</h2>
            {sub && <p className="text-[13px] text-white/60">{sub}</p>}
          </div>
          <button onClick={onClose} aria-label={tx('Close')} className="shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Everyone getting on or off at one stop (or booked to a stop the bus reaches through it). */
export function PeopleAtStop({
  stop, time, also = [], bookings, onChange, onClose,
}: {
  stop: string;
  time?: string;
  /** Booked stops the bus covers from here tonight (skipped on-request stops, left-out stops). */
  also?: string[];
  bookings: Booking[];
  onChange: (b: Booking) => void;
  onClose: () => void;
}) {
  const here = new Set([stop, ...also].map(low));
  const live = bookings.filter((b) => b.status !== 'cancelled');
  const on = live.filter((b) => here.has(low(b.from)));
  const off = live.filter((b) => here.has(low(b.to)));
  const seats = (l: Booking[]) => l.reduce((n, b) => n + b.seats.length, 0);
  return (
    <DarkSheet title={stop} sub={time} onClose={onClose}>
      {[
        { title: tx('Getting on ({n})', { n: seats(on) }), list: on, tone: 'text-[#9be8ad]' },
        { title: tx('Getting off ({n})', { n: seats(off) }), list: off, tone: 'text-[#fcd34d]' },
      ].map((g) => g.list.length > 0 && (
        <section key={g.title} className="mb-4">
          <h3 className={`text-[13px] font-bold uppercase tracking-wide mb-2 ${g.tone}`}>{g.title}</h3>
          <ul className="rounded-2xl bg-white/[0.05] border border-white/10 divide-y divide-white/10">
            {g.list.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold truncate">{b.passenger.name}</span>
                  <span className="block text-[12px] text-white/60 truncate">
                    {tx('Seat {seats}', { seats: b.seats.join(', ') })} · {b.from} → {b.to}
                    {b.status === 'boarded' ? ` · ${tx('on board')}` : b.status === 'no-show' ? ` · ${tx('no-show')}` : ''}
                  </span>
                  {(b.bookedFrom || b.bookedTo) && <span className="block text-[12px] text-[#c4b5fd]">{tx('Booked {from} → {to}', { from: b.bookedFrom ?? b.from, to: b.bookedTo ?? b.to })}</span>}
                </span>
                {phoneOf(b) && (
                  <a href={`tel:${phoneOf(b)}`} aria-label={tx('Call {name}', { name: b.passenger.name })} className="shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><Phone className="w-4 h-4" /></a>
                )}
                {b.status !== 'no-show' && (
                  <button onClick={() => onChange(b)} className="shrink-0 h-10 px-3 rounded-xl bg-white/10 text-[13px] font-semibold flex items-center gap-1.5">
                    <ArrowRightLeft className="w-4 h-4" />{tx('Change stop')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {on.length + off.length === 0 && <p className="text-[14px] text-white/60">{tx('Nobody gets on or off here.')}</p>}
    </DarkSheet>
  );
}

/** Change where one passenger gets on and off. */
export function ChangeStopSheet({
  booking: b, route, departure, onClose, toast,
}: {
  booking: Booking;
  route: Route;
  departure: string;
  onClose: () => void;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
}) {
  const { changeStops } = useStore();
  const stops = route.stops.filter((s) => !s.hidden);
  const [from, setFrom] = useState(stops.find((s) => low(s.name) === low(b.from))?.name ?? b.from);
  const [to, setTo] = useState(stops.find((s) => low(s.name) === low(b.to))?.name ?? b.to);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const fi = stops.findIndex((s) => low(s.name) === low(from));
  const ti = stops.findIndex((s) => low(s.name) === low(to));
  const onBoard = b.status === 'boarded';
  const same = low(from) === low(b.from) && low(to) === low(b.to);
  const wrong = fi < 0 || ti < 0 || fi >= ti;
  const time = (offset: number) => formatTime12(fromMinutes(toMinutes(departure) + offset));
  const flat = route.flatFare !== false;
  const newFare = !flat && fi >= 0 && ti > fi ? stops[ti].fareFromStart - stops[fi].fareFromStart : null;
  const diff = newFare != null ? (newFare - b.fare) * b.seats.length : 0;

  const save = async () => {
    setBusy(true);
    const r = await changeStops(b.id, from, to, note.trim() || undefined);
    setBusy(false);
    if (!r.ok) return toast(r.reason ?? tx('Could not change the stop.'), 'error');
    const d = r.fareDiff ?? 0;
    toast(
      d === 0 ? tx('Done: {name} now {from} → {to}. They get a text.', { name: b.passenger.name, from, to })
        : r.moneyChanged ? tx('Done. New fare {amount} (not paid yet). They get a text.', { amount: formatLKR(b.fare + d / b.seats.length) })
          : d > 0 ? tx('Done. The fare is {amount} more; the office settles it. They get a text.', { amount: formatLKR(d) })
            : tx('Done. The fare is {amount} less; the office settles it. They get a text.', { amount: formatLKR(-d) }),
    );
    onClose();
  };

  return (
    <DarkSheet title={tx('Change stop')} sub={`${b.passenger.name} · ${tx('Seat {seats}', { seats: b.seats.join(', ') })}`} onClose={onClose}>
      <p className="rounded-xl bg-[#feb700]/10 border border-[#feb700]/30 px-3 py-2 text-[13px] text-[#fcd34d] mb-4">
        {tx('Ask the passenger first. They get a text with their new stop, and the change is kept in the trip’s record.')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[12px] font-semibold text-white/60 mb-1">{tx('Gets on at')}</span>
          <select value={from} disabled={onBoard} onChange={(e) => setFrom(e.target.value)} className="w-full h-12 px-3 rounded-xl bg-white/10 border border-white/15 text-[15px] disabled:opacity-50">
            {stops.slice(0, -1).map((s) => <option key={s.name} value={s.name} className="bg-[#18191d]">{time(s.offsetMin)} · {s.name}{s.optional ? ` (${tx('on request')})` : ''}</option>)}
          </select>
          {onBoard && <span className="block text-[12px] text-white/50 mt-1">{tx('Already on the bus.')}</span>}
        </label>
        <label className="block">
          <span className="block text-[12px] font-semibold text-white/60 mb-1">{tx('Gets off at')}</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} className="w-full h-12 px-3 rounded-xl bg-white/10 border border-white/15 text-[15px]">
            {stops.slice(1).map((s) => <option key={s.name} value={s.name} className="bg-[#18191d]">{time(s.offsetMin)} · {s.name}{s.optional ? ` (${tx('on request')})` : ''}</option>)}
          </select>
        </label>
      </div>
      <label className="block mt-3">
        <span className="block text-[12px] font-semibold text-white/60 mb-1">{tx('Note (optional)')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={tx('e.g. asked on the phone')} className="w-full h-12 px-3 rounded-xl bg-white/10 border border-white/15 text-[15px] placeholder:text-white/40" />
      </label>
      {wrong && <p className="mt-3 text-[13px] font-semibold text-[#fca5a5]">{tx('The stop where they get on has to come before the one where they get off.')}</p>}
      {!wrong && !same && diff !== 0 && (
        <p className="mt-3 text-[13px] text-white/70">{diff > 0 ? tx('This stretch costs {amount} more.', { amount: formatLKR(diff) }) : tx('This stretch costs {amount} less.', { amount: formatLKR(-diff) })}</p>
      )}
      <button onClick={save} disabled={busy || wrong || same} className="mt-4 w-full h-12 rounded-xl bg-[#feb700] text-[#14120a] text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40">
        <Check className="w-5 h-5" />{busy ? tx('Saving…') : tx('Save new stop')}
      </button>
    </DarkSheet>
  );
}
