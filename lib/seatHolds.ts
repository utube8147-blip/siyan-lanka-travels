'use client';
// Seats held during checkout (migration 21). Choosing seats places a real
// 10-minute hold in the database: other passengers see those seats as "held
// by another passenger", staff see them on the Departures seat map, and only
// office staff can sell over a hold. In demo mode (no database) nothing is
// held and the countdown is only a timer, as before.

import { useCallback, useEffect, useState } from 'react';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';

export interface SeatHold { seat: string; expiresAt: string; mine: boolean }

/** Live holds for one departure. Refreshes on changes, and every 15 seconds so lapsed holds disappear. */
export function useSeatHolds(scheduleId?: string, date?: string) {
  const [holds, setHolds] = useState<SeatHold[]>([]);
  const load = useCallback(async () => {
    if (!DB || !scheduleId || !date) return setHolds([]);
    const { data, error } = await supabase().rpc('get_seat_holds', { p_from: date, p_to: date });
    if (error) return; // database not updated yet: behave as if nothing is held
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setHolds(((data as any[]) ?? []).filter((h) => h.schedule_id === scheduleId).map((h) => ({ seat: h.seat, expiresAt: h.expires_at, mine: !!h.mine })));
  }, [scheduleId, date]);

  useEffect(() => {
    load();
    if (!DB || !scheduleId || !date) return;
    const timer = setInterval(load, 15_000);
    // A channel name of its own for every use of this hook. Two parts of a page can watch the same
    // departure (the seat map and the Sell window), and in development React mounts effects twice;
    // with a shared name the second one is handed the first one's already-subscribed channel and
    // Supabase refuses to add a listener to it.
    const ch = supabase()
      .channel(`seat-holds-${scheduleId}-${date}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_holds' }, load)
      .subscribe();
    return () => {
      clearInterval(timer);
      supabase().removeChannel(ch);
    };
  }, [load, scheduleId, date]);

  const now = Date.now();
  return { holds: holds.filter((h) => new Date(h.expiresAt).getTime() > now), reload: load };
}

/** Holds exactly these seats for the signed-in passenger (an empty list releases everything). */
export async function holdSeats(scheduleId: string, date: string, seats: string[]): Promise<{ ok: boolean; expiresAt?: string | null; reason?: string }> {
  if (!DB) return { ok: true, expiresAt: null };
  const { data, error } = await supabase().rpc('hold_seats', { p_schedule: scheduleId, p_date: date, p_seats: seats });
  if (error) {
    // An older database without this function: carry on without a hold.
    if (/function .*hold_seats|schema cache/i.test(error.message)) return { ok: true, expiresAt: null };
    return { ok: false, reason: friendlyError(error) };
  }
  return { ok: true, expiresAt: (data as string | null) ?? null };
}

export async function releaseSeatHolds() {
  if (!DB) return;
  await supabase().rpc('release_seat_holds');
}
