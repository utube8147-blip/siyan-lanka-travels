'use client';
// The conductor's trip sheet (migration 27): what was spent on the road for
// one departure. Fuel, tolls, parking, cleaning and other costs are saved as
// ordinary expenses tied to the trip, so the office sees them in Expenses &
// fuel and in the reports. A cost "paid from the trip cash" comes off the
// cash the conductor should hand in. The same fields are printed on the paper
// sheet (lib/manifestPdf.ts) so paper and app are filled in the same order.

import { useCallback, useEffect, useState } from 'react';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';
import { todayISO } from './trips';
import { uuid } from './uuid';

export type RoadCostKind = 'toll' | 'parking' | 'cleaning' | 'other';
export const ROAD_COST_LABEL: Record<RoadCostKind | 'fuel', string> = { fuel: 'Fuel', toll: 'Highway toll', parking: 'Parking', cleaning: 'Cleaning', other: 'Other' };

/** A cost already saved against the trip. */
export interface SavedCost {
  id: string;
  category: RoadCostKind | 'fuel' | string;
  amount: number;
  litres: number | null;
  odometerKm: number | null;
  vendor: string;
  description: string;
  fromTakings: boolean;
  mine: boolean;
  by: string;
}
export interface FuelDraft { key: string; litres: number | ''; amount: number | ''; station: string; odometerKm: number | ''; fromCash: boolean }
export interface CostDraft { key: string; kind: RoadCostKind; amount: number | ''; note: string; fromCash: boolean }
/** What the conductor has typed and not saved yet. */
export interface TripSheetDraft { start: number | ''; end: number | ''; fuels: FuelDraft[]; costs: CostDraft[] }

export const emptySheet = (): TripSheetDraft => ({ start: '', end: '', fuels: [], costs: [] });
export const newFuel = (): FuelDraft => ({ key: uuid(), litres: '', amount: '', station: '', odometerKm: '', fromCash: true });
export const newCost = (): CostDraft => ({ key: uuid(), kind: 'toll', amount: '', note: '', fromCash: true });

/** Typed costs that will come out of the trip cash once saved. */
export const pendingFromCash = (d: TripSheetDraft) =>
  [...d.fuels, ...d.costs].reduce((n, x) => n + (x.fromCash && typeof x.amount === 'number' ? x.amount : 0), 0);

/** What is wrong with the typed costs (the odometer boxes are checked by lib/odometer). Empty = fine. */
export function costProblems(d: TripSheetDraft): string[] {
  const out: string[] = [];
  d.fuels.forEach((f, i) => {
    const n = d.fuels.length > 1 ? ` ${i + 1}` : '';
    if (!(typeof f.litres === 'number' && f.litres > 0)) out.push(`Fuel${n}: enter the litres.`);
    if (!(typeof f.amount === 'number' && f.amount > 0)) out.push(`Fuel${n}: enter the amount paid.`);
    if (typeof f.odometerKm === 'number' && typeof d.start === 'number' && f.odometerKm < d.start) out.push(`Fuel${n}: the reading at the pump is lower than the reading at the start.`);
    if (typeof f.odometerKm === 'number' && typeof d.end === 'number' && f.odometerKm > d.end) out.push(`Fuel${n}: the reading at the pump is higher than the reading at the end.`);
  });
  d.costs.forEach((c) => {
    if (!(typeof c.amount === 'number' && c.amount > 0)) out.push(`${ROAD_COST_LABEL[c.kind]}: enter the amount.`);
    if (c.kind === 'other' && c.note.trim().length < 3) out.push('Other cost: say what it was for.');
  });
  return out;
}

type Result = { ok: true } | { ok: false; reason: string };
const DEMO_KEY = 'demo-trip-sheet';

export function useTripSheet(scheduleId: string | null, date: string, busId: string | null) {
  const [saved, setSaved] = useState<SavedCost[]>([]);
  const [ready, setReady] = useState(false);
  /** Set when the database doesn't have migration 27 yet: the screen falls back to cash + odometer only. */
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!scheduleId) return;
    if (!DB) {
      try {
        const all = JSON.parse(localStorage.getItem(DEMO_KEY) ?? '{}') as Record<string, SavedCost[]>;
        setSaved(all[`${scheduleId}|${date}`] ?? []);
      } catch {
        setSaved([]);
      }
      return setReady(true);
    }
    const { data, error } = await supabase().rpc('trip_sheet', { p_schedule: scheduleId, p_date: date });
    setUnavailable(!!error);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSaved(((data as any[]) ?? []).map((r) => ({
      id: r.id, category: r.category, amount: r.amount, litres: r.litres != null ? Number(r.litres) : null, odometerKm: r.odometer_km ?? null,
      vendor: r.vendor ?? '', description: r.description ?? '', fromTakings: !!r.from_takings, mine: !!r.mine, by: r.by ?? '',
    })));
    setReady(true);
  }, [scheduleId, date]);
  useEffect(() => {
    setReady(false);
    load();
  }, [load]);

  /** Saves one cost against this trip. */
  const add = async (c: { category: RoadCostKind | 'fuel'; amount: number; litres?: number | null; odometerKm?: number | null; vendor?: string; description?: string; fromCash: boolean; /** Whose trip cash it came out of, when the office is typing it in for a conductor. */ takingsOf?: string | null }): Promise<Result> => {
    if (!scheduleId) return { ok: false, reason: 'No trip chosen.' };
    if (!DB) {
      const row: SavedCost = { id: uuid(), category: c.category, amount: c.amount, litres: c.litres ?? null, odometerKm: c.odometerKm ?? null, vendor: c.vendor ?? '', description: c.description ?? '', fromTakings: c.fromCash, mine: true, by: '' };
      try {
        const all = JSON.parse(localStorage.getItem(DEMO_KEY) ?? '{}') as Record<string, SavedCost[]>;
        all[`${scheduleId}|${date}`] = [...(all[`${scheduleId}|${date}`] ?? []), row];
        localStorage.setItem(DEMO_KEY, JSON.stringify(all));
      } catch {
        /* storage full */
      }
      setSaved((p) => [...p, row]);
      return { ok: true };
    }
    const { error } = await supabase().from('expenses').insert({
      spent_on: todayISO(), category: c.category, amount: Math.round(c.amount), bus_id: busId, schedule_id: scheduleId, travel_date: date,
      description: c.description ?? '', vendor: c.vendor ?? '', payment_method: c.fromCash ? 'cash' : 'other',
      litres: c.litres ?? null, odometer_km: c.odometerKm ?? null, from_takings: c.fromCash,
      ...(c.fromCash && c.takingsOf ? { takings_of: c.takingsOf } : {}),
    });
    if (error) return { ok: false, reason: friendlyError(error) };
    await load();
    return { ok: true };
  };

  return { saved, ready, unavailable, add, reload: load };
}
