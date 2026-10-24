'use client';
// On-request stops, as passengers see them: how many seats are booked to or
// from the stop so far, how many it needs, and whether the bus is going.
//   <OnRequestNotice>: the full card (seat page, My trips)
//   <OnRequestChip>:   one line with a small bar (search results)

import { useMemo } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { detourState, useOptionalStatus, type OptionalStopStatus } from '@/lib/conductor';
import { departureDate, formatDateLabel, formatTime12 } from '@/lib/trips';
import { useStore } from '@/lib/store';
import { tx } from '@/lib/i18n';
import type { RouteStop } from '@/lib/types';

/** On-request stops of one trip that the passenger uses (or all of them, when `only` is empty). */
function useTripOnRequest(routeId: string, scheduleId: string, date: string, only: string[]) {
  const { data } = useStore();
  const route = data.routes.find((r) => r.id === routeId);
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  const status = useOptionalStatus(route, scheduleId, date, data.bookings);
  const key = only.filter(Boolean).join('|').toLowerCase();
  const mine = useMemo(() => (key ? status.filter((s) => key.split('|').includes(s.stop.toLowerCase())) : status), [status, key]);
  const cutoff = useMemo(() => {
    if (!schedule) return '';
    const at = new Date(departureDate(date, schedule.departure).getTime() - (data.optionalCutoffHours ?? 3) * 3600e3);
    const ymd = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    return `${formatDateLabel(ymd, false)}, ${formatTime12(`${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`)}`;
  }, [schedule, date, data.optionalCutoffHours]);
  return { route, schedule, mine, cutoff };
}

type Look = { label: string; pill: string; bar: string; Icon: typeof Check };
function look(s: OptionalStopStatus): Look {
  const d = detourState(s);
  const left = Math.max(0, s.minSeats - s.seats);
  if (d === 'runs') return { label: tx('Confirmed'), pill: 'bg-[#dcfce7] text-[#166534]', bar: 'bg-[#16a34a]', Icon: Check };
  if (d === 'skipped') return { label: tx('Not going'), pill: 'bg-[#fee2e2] text-[#991b1b]', bar: 'bg-[#9ca3af]', Icon: X };
  if (d === 'likely') return { label: tx('Going'), pill: 'bg-[#dcfce7] text-[#166534]', bar: 'bg-[#16a34a]', Icon: Check };
  return { label: left === 1 ? tx('1 more seat needed') : tx('{n} more seats needed', { n: left }), pill: 'bg-[#fef3c7] text-[#92400e]', bar: 'bg-[#7c3aed]', Icon: Clock };
}

/** The fill bar: one block per seat needed (a plain bar when it needs many). */
function FillBar({ s, bar, small = false }: { s: OptionalStopStatus; bar: string; small?: boolean }) {
  const filled = Math.min(s.seats, s.minSeats);
  const h = small ? 'h-1.5' : 'h-2.5';
  if (s.minSeats <= 12) {
    return (
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: s.minSeats }, (_, i) => (
          <span key={i} className={`flex-1 ${h} rounded-full ${i < filled ? bar : 'bg-[#e4e1ee]'}`} />
        ))}
      </div>
    );
  }
  return (
    <div className={`${h} rounded-full bg-[#e4e1ee] overflow-hidden`} aria-hidden>
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${(filled / s.minSeats) * 100}%` }} />
    </div>
  );
}

const seatsLine = (s: OptionalStopStatus) => tx('{seats} of {min} seats booked', { seats: s.seats, min: s.minSeats });

export function OnRequestNotice({ routeId, scheduleId, date, from, to, className = '' }: { routeId: string; scheduleId: string; date: string; from: string; to: string; className?: string }) {
  const { route, schedule, mine, cutoff } = useTripOnRequest(routeId, scheduleId, date, [from, to]);
  if (!route || !schedule || mine.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`} role="note">
      {mine.map((s) => {
        const l = look(s);
        const d = detourState(s);
        const main = nearestMain(route.stops, s.stop);
        return (
          <div key={s.stop} className="rounded-2xl bg-[#f7f5ff] border border-[#e4ddfb] px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-[#2e1065]">{s.stop}</p>
                <p className="text-[12px] text-[#5b4b8a]">{tx('On-request stop')}</p>
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${l.pill}`}>
                <l.Icon className="w-3.5 h-3.5" />
                {l.label}
              </span>
            </div>
            <div className="mt-3">
              <FillBar s={s} bar={l.bar} />
              <p className="mt-1.5 text-[12px] font-semibold text-[#3b0764]" aria-live="polite">{seatsLine(s)}</p>
            </div>
            <p className="mt-2 text-[13px] text-[#3b0764] leading-snug">
              {d === 'skipped'
                ? tx('The bus is not going to {stop} on this trip: not enough passengers booked it. Please choose another stop.', { stop: s.stop })
                : d === 'runs'
                  ? tx('The bus goes to {stop} on this trip.', { stop: s.stop })
                  : d === 'likely'
                    ? tx('Enough seats are booked, so the bus is going there. It is final at {cutoff}.', { cutoff })
                    : tx('The bus goes there only if {min} seats are booked to or from it by {cutoff}.', { min: s.minSeats, cutoff })}
              {(d === 'unlikely' || d === 'likely') && main && <> {tx('If not, you will use {main} instead, and we will tell you by text.', { main })}</>}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** One line per on-request stop the passenger uses (every one, without from/to), for search results and the home page. */
export function OnRequestChip({ routeId, scheduleId, date, from = '', to = '' }: { routeId: string; scheduleId: string; date: string; from?: string; to?: string }) {
  const { mine } = useTripOnRequest(routeId, scheduleId, date, [from, to]);
  if (mine.length === 0) return null;
  return (
    <div className="space-y-2" title={tx('The bus goes to this stop only if enough seats are booked. Details on the next page.')}>
      {mine.map((s) => {
        const l = look(s);
        return (
          <div key={s.stop} className="rounded-xl bg-[#f7f5ff] border border-[#e4ddfb] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px]">
              <span className="font-bold text-[#2e1065]">{tx('{stop} (on request)', { stop: s.stop })}</span>
              <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${l.pill}`}>
                <l.Icon className="w-3 h-3" />
                {l.label}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1">
                <FillBar s={s} bar={l.bar} small />
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-[#5b4b8a] tabular-nums">{s.seats}/{s.minSeats}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The main stop nearest in time to an on-request stop (what passengers are moved to). */
function nearestMain(stops: RouteStop[], name: string) {
  const at = stops.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!at) return null;
  return [...stops].filter((s) => !s.optional && !s.hidden).sort((a, b) => Math.abs(a.offsetMin - at.offsetMin) - Math.abs(b.offsetMin - at.offsetMin))[0]?.name ?? null;
}
