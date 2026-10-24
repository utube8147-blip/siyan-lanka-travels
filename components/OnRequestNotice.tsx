'use client';
// Shown to a passenger whose boarding point or drop-off is an "on request"
// stop: the bus only goes there if enough seats are booked to or from it.

import { useMemo } from 'react';
import { useOptionalStatus } from '@/lib/conductor';
import { departureDate, formatDateLabel, formatTime12 } from '@/lib/trips';
import { useStore } from '@/lib/store';
import { tx } from '@/lib/i18n';

export function OnRequestNotice({ routeId, scheduleId, date, from, to, className = '' }: { routeId: string; scheduleId: string; date: string; from: string; to: string; className?: string }) {
  const { data } = useStore();
  const route = data.routes.find((r) => r.id === routeId);
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  const status = useOptionalStatus(route, scheduleId, date, data.bookings);
  const mine = useMemo(() => status.filter((s) => [from, to].some((x) => x.toLowerCase() === s.stop.toLowerCase())), [status, from, to]);
  if (!route || !schedule || mine.length === 0) return null;

  const hours = data.optionalCutoffHours ?? 3;
  const cutoff = new Date(departureDate(date, schedule.departure).getTime() - hours * 3600e3);
  const cutoffText = `${formatDateLabel(cutoff.toISOString().slice(0, 10), false)}, ${formatTime12(`${String(cutoff.getHours()).padStart(2, '0')}:${String(cutoff.getMinutes()).padStart(2, '0')}`)}`;

  return (
    <div className={`rounded-xl bg-[#f5f3ff] border border-[#ddd6fe] px-4 py-3 text-[13px] text-[#3b0764] space-y-1.5 ${className}`} role="note">
      {mine.map((s) => {
        const main = nearestMain(route.stops, s.stop);
        if (s.decided && !s.runs) {
          return <p key={s.stop} className="font-semibold">{tx('The bus is not going to {stop} on this trip: not enough passengers booked it. Please choose another stop.', { stop: s.stop })}</p>;
        }
        if (s.decided && s.runs) {
          return <p key={s.stop}><b>{s.stop}</b>: {tx('on-request stop, confirmed for this trip.')}</p>;
        }
        return (
          <p key={s.stop}>
            <b>{tx('{stop} is an on-request stop.', { stop: s.stop })}</b>{' '}
            {tx('The bus goes there only if at least {min} seats are booked to or from it by {cutoff}. So far: {seats}.', { min: s.minSeats, cutoff: cutoffText, seats: s.seats })}{' '}
            {main && tx('If not, you will use {main} instead, and we will tell you by text.', { main })}
          </p>
        );
      })}
    </div>
  );
}

/** The main stop nearest in time to an on-request stop (what passengers are moved to). */
function nearestMain(stops: { name: string; offsetMin: number; optional?: boolean }[], name: string) {
  const at = stops.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!at) return null;
  return [...stops].filter((s) => !s.optional).sort((a, b) => Math.abs(a.offsetMin - at.offsetMin) - Math.abs(b.offsetMin - at.offsetMin))[0]?.name ?? null;
}
