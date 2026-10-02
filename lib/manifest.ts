// lib/manifest.ts — passenger list for one departure, in boarding order, and
// the boarding logic shared by the conductor page and the staff scanner.

import type { Booking, StoreData } from './types';
import type { ScanResult } from '@/components/staff/QrScanner';

export interface ManifestGroup { stop: string; bookings: Booking[] }

export function manifestFor(data: StoreData, scheduleId: string, date: string) {
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  const route = data.routes.find((r) => r.id === schedule?.routeId);
  const order = new Map((route?.stops ?? []).map((s, i) => [s.name, i]));
  // Works for "17" as well as "3A": the number first, then any letter.
  const seatKey = (s: string) => {
    const m = s.match(/^(\d+)([A-Z]?)/);
    return m ? Number(m[1]) * 30 + (m[2] ? m[2].charCodeAt(0) - 64 : 0) : 99999;
  };
  const list = data.bookings
    .filter((b) => b.scheduleId === scheduleId && b.date === date && !b.id.startsWith('avail-') && (b.status === 'confirmed' || b.status === 'boarded' || b.status === 'held' || b.status === 'no-show'))
    .sort((a, b) => (order.get(a.from) ?? 99) - (order.get(b.from) ?? 99) || seatKey(a.seats[0]) - seatKey(b.seats[0]));
  const groups: ManifestGroup[] = [];
  for (const b of list) {
    const g = groups.find((x) => x.stop === b.from);
    if (g) g.bookings.push(b);
    else groups.push({ stop: b.from, bookings: [b] });
  }
  const seats = (f: (b: Booking) => boolean) => list.filter(f).reduce((n, b) => n + b.seats.length, 0);
  return {
    list,
    groups,
    totals: {
      seats: seats(() => true),
      boarded: seats((b) => b.status === 'boarded'),
      waiting: seats((b) => b.status === 'confirmed' || b.status === 'held'),
      // Still to collect: held seats, and passengers already on board who pay in transit.
      unpaid: list.filter(isDue).reduce((n, b) => n + b.total, 0),
      unpaidCount: list.filter(isDue).length,
      bikes: list.reduce((n, b) => n + (b.bikes?.length ?? 0), 0),
    },
  };
}

/** Money still to collect from this passenger (not paid, and not cancelled / no-show). */
export const isDue = (b: Booking) => b.paymentStatus === 'unpaid' && (b.status === 'held' || b.status === 'boarded');

/** Pull a booking ref out of a scanned QR (JSON with ref, a URL, or plain text). */
export function refFromScan(text: string) {
  const raw = text.trim();
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.ref === 'string') return j.ref.toUpperCase();
  } catch {
    /* not JSON */
  }
  const m = raw.toUpperCase().match(/[A-Z]{2,4}-[A-Z0-9]{6}/);
  return m ? m[0] : raw.toUpperCase();
}

type Actions = {
  board: (b: Booking) => Promise<{ ok: boolean; reason?: string }>;
  takeCash: (b: Booking) => Promise<{ ok: boolean; reason?: string }>;
};

/** What happens when a ticket (or a typed ref / seat number) is scanned on a departure. */
export async function scanTicket(text: string, bookings: Booking[], act: Actions): Promise<ScanResult> {
  const ref = refFromScan(text);
  // A typed seat number ("17", "3A") finds the passenger in that seat; booking references are longer.
  const bySeat = /^[A-Z0-9]{1,4}$/.test(ref) ? bookings.find((b) => b.seats.includes(ref) && b.status !== 'cancelled') : undefined;
  const b = bySeat ?? bookings.find((x) => x.ref.toUpperCase() === ref);
  if (!b) return { ok: false, msg: 'Not on this bus', detail: `${ref}: wrong date or departure? Check the ticket.` };
  const who = `${b.passenger.name} · seat ${b.seats.join(', ')}`;
  const where = `${b.from} → ${b.to}${b.bikes?.length ? ` · ${b.bikes.length} bike` : ''}`;
  if (b.status === 'boarded' && isDue(b))
    return {
      ok: false,
      msg: `On board, not paid: collect LKR ${b.total.toLocaleString('en-LK')}`,
      detail: `${who} · ${where}`,
      action: {
        label: `Cash received from ${b.passenger.name.split(' ')[0]}`,
        run: async () => {
          const p = await act.takeCash(b);
          return p.ok ? { ok: true, msg: `✓ Paid: ${who}`, detail: where } : { ok: false, msg: p.reason ?? 'Could not record payment' };
        },
      },
    };
  if (b.status === 'boarded') return { ok: true, msg: `Already on board: ${who}`, detail: where };
  if (b.status === 'cancelled') return { ok: false, msg: 'Cancelled ticket', detail: `${who}. Don't board.` };
  if (b.status === 'held')
    return {
      ok: false,
      msg: `Not paid: collect LKR ${b.total.toLocaleString('en-LK')}`,
      detail: `${who} · ${where}`,
      action: {
        label: `Cash received · board ${b.passenger.name.split(' ')[0]}`,
        run: async () => {
          const p = await act.takeCash(b);
          if (!p.ok) return { ok: false, msg: p.reason ?? 'Could not record payment' };
          const r = await act.board(b);
          return r.ok ? { ok: true, msg: `✓ Paid & boarded: ${who}`, detail: where } : { ok: false, msg: r.reason ?? 'Could not board' };
        },
      },
      // Pay-on-the-bus passengers may board first and pay during the trip.
      later:
        b.paymentMethod === 'bus'
          ? {
              label: 'Board now, collect later',
              run: async () => {
                const r = await act.board(b);
                return r.ok ? { ok: true, msg: `✓ On board, LKR ${b.total.toLocaleString('en-LK')} still to collect: ${who}`, detail: where } : { ok: false, msg: r.reason ?? 'Could not board' };
              },
            }
          : undefined,
    };
  const r = await act.board(b);
  return r.ok ? { ok: true, msg: `✓ ${who}`, detail: where } : { ok: false, msg: r.reason ?? 'Could not board' };
}
