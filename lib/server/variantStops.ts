// Stops that tonight's variant leaves out (main stops staff removed from a
// variant). Once a trip's on-request stops are decided (after the cut-off),
// the variant in use is known; passengers booked to or from a stop it leaves
// out are moved to the nearest stop on the way (getting on: the next one;
// getting off: the one before), their booked stop is kept on the ticket, and
// they get a notification and a text. Run by the message dispatcher.
import type { SupabaseClient } from '@supabase/supabase-js';
import { routeFromRow } from '@/lib/supabase/mappers';
import { tripWay } from '@/lib/trips';
import type { Route } from '@/lib/types';

const low = (x: string) => x.trim().toLowerCase();
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export interface VariantMove {
  id: string;
  from_stop: string;
  to_stop: string;
  booked_from: string | null;
  booked_to: string | null;
  gone: string;
  /** true: the passenger gets off at to_stop instead; false: gets on at from_stop. */
  off: boolean;
}

/**
 * Who has to move on one trip (pure, no database): bookings to or from a main
 * stop that tonight's variant leaves out → the next stop on the way (getting
 * on) or the one before (getting off).
 */
export function variantMoves(
  route: Route,
  runs: Set<string>,
  bookings: { id: string; from_stop: string; to_stop: string; booked_from?: string | null; booked_to?: string | null }[],
): { variant: string | null; moves: VariantMove[] } {
  const way = tripWay(route, (n) => runs.has(low(n)));
  if (!way.variant) return { variant: null, moves: [] };
  const onWay = new Set(way.stops.filter((s) => !s.hidden).map((s) => low(s.name)));
  const leftOut = new Set(route.stops.filter((s) => !s.hidden && !s.optional && !onWay.has(low(s.name))).map((s) => low(s.name)));
  const order = route.stops.map((s) => low(s.name));
  const nameOf = (k: string) => route.stops.find((s) => low(s.name) === k)?.name ?? k;
  const near = (k: string, after: boolean, lo: number, hi: number) => {
    const i = order.indexOf(k);
    const range = after ? order.slice(i + 1, hi + 1) : order.slice(Math.max(lo, 0), i).reverse();
    return range.find((x) => onWay.has(x));
  };
  const moves: VariantMove[] = [];
  for (const b of bookings) {
    const f = low(b.from_stop);
    const to = low(b.to_stop);
    if (!leftOut.has(f) && !leftOut.has(to)) continue;
    const fi = order.indexOf(f);
    const ti = order.indexOf(to);
    const newFrom = leftOut.has(f) ? near(f, true, 0, ti - 1) ?? near(f, false, 0, ti - 1) : f;
    const newTo = leftOut.has(to) ? near(to, false, (newFrom ? order.indexOf(newFrom) : fi) + 1, order.length - 1) ?? near(to, true, 0, order.length - 1) : to;
    if (!newFrom || !newTo || order.indexOf(newFrom) >= order.indexOf(newTo)) continue; // nowhere sensible: leave it for the office
    moves.push({
      id: b.id,
      from_stop: nameOf(newFrom),
      to_stop: nameOf(newTo),
      booked_from: leftOut.has(f) ? b.booked_from ?? b.from_stop : b.booked_from ?? null,
      booked_to: leftOut.has(to) ? b.booked_to ?? b.to_stop : b.booked_to ?? null,
      gone: leftOut.has(to) ? b.to_stop : b.from_stop,
      off: leftOut.has(to),
    });
  }
  return { variant: way.variant.name, moves };
}

export async function settleVariantStops(db: SupabaseClient) {
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const { data: decisions, error } = await db.from('optional_stop_decisions').select('schedule_id, travel_date, stop, runs').gte('travel_date', since);
  if (error) return { error: error.message.slice(0, 200) };
  const trips = new Map<string, { schedule: string; date: string; runs: Set<string> }>();
  for (const d of decisions ?? []) {
    const k = `${d.schedule_id}|${d.travel_date}`;
    const t = trips.get(k) ?? { schedule: d.schedule_id, date: d.travel_date, runs: new Set<string>() };
    if (d.runs) t.runs.add(low(d.stop));
    trips.set(k, t);
  }
  let moved = 0;
  for (const t of trips.values()) {
    const { data: sch } = await db.from('schedules').select('route_id, routes(*)').eq('id', t.schedule).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (sch as any)?.routes;
    if (!row) continue;
    const route = routeFromRow(row);
    if (!tripWay(route, (n) => t.runs.has(low(n))).variant) continue;
    const { data: bookings } = await db
      .from('bookings')
      .select('id, ref, user_id, from_stop, to_stop, booked_from, booked_to, contact_phone, passenger_phone')
      .eq('schedule_id', t.schedule)
      .eq('travel_date', t.date)
      .in('status', ['confirmed', 'held', 'boarded']);
    const { variant, moves } = variantMoves(route, t.runs, bookings ?? []);
    for (const m of moves) {
      const b = (bookings ?? []).find((x) => x.id === m.id)!;
      const { error: upErr } = await db.from('bookings').update({ from_stop: m.from_stop, to_stop: m.to_stop, booked_from: m.booked_from, booked_to: m.booked_to }).eq('id', m.id);
      if (upErr) continue;
      const instead = m.off ? `You will get off at ${m.to_stop} instead.` : `Please board at ${m.from_stop} instead.`;
      const text = `Siyan Lanka ${b.ref}: on ${day(t.date)} the bus goes the "${variant}" way and doesn't stop at ${m.gone}. ${instead} Same seat, same ticket.`;
      if (b.user_id) {
        await db.from('notifications').insert({ user_id: b.user_id, title: 'Your stop has changed', body: text.replace(/^Siyan Lanka \S+: /, ''), url: `/my-bookings?ref=${b.ref}`, tag: `variant-${b.id}-${low(m.gone)}` });
      }
      await db.rpc('enqueue_message', { p_phone: b.contact_phone || b.passenger_phone, p_body: text, p_kind: 'variant_stop', p_booking: b.id });
      moved++;
    }
  }
  return { moved };
}
