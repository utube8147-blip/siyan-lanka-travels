'use client';
// Daily odometer readings (migration 23): the distance each bus really
// travels. Office staff (asking the conductor) or the conductor enter the
// reading each day; the distance for a day is the difference from the
// reading before it. Readings typed with a fuel or service expense count
// too, so they are merged in. Supabase when connected; this browser in demo.

import { useCallback, useEffect, useState } from 'react';
import { friendlyError, isSupabaseConfigured as DB, supabase } from './supabase/client';
import { uuid } from './uuid';

export interface OdoLog { id: string; busId: string; date: string; km: number; notes: string; by?: string; /** 'log' = entered here; 'fuel' / 'service' = came with an expense. */ source: 'log' | 'fuel' | 'service' }
type Result = { ok: boolean; reason?: string };
const KEY = 'demo-odometer';

/** A reading that came with an expense (Expenses & fuel). */
export interface ExpenseReading { id: string; spentOn: string; category: string; busId?: string | null; odometerKm?: number | null }

export function useOdometer() {
  const [logs, setLogs] = useState<OdoLog[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!DB) {
      try {
        setLogs(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
      } catch {
        setLogs([]);
      }
      return setReady(true);
    }
    const { data, error } = await supabase().from('odometer_logs').select('*, profiles(full_name)').order('log_date', { ascending: false }).limit(1500);
    if (error) setError("Odometer readings couldn't be loaded. If this is new, run supabase/setup.sql, then reload.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLogs(((data as any[]) ?? []).map((r) => ({ id: r.id, busId: r.bus_id, date: r.log_date, km: r.reading_km, notes: r.notes ?? '', by: r.profiles?.full_name ?? '', source: 'log' as const })));
    setReady(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (busId: string, date: string, km: number, notes: string): Promise<Result> => {
    if (!(km > 0)) return { ok: false, reason: 'Enter the reading on the odometer.' };
    if (!DB) {
      const earlier = logs.filter((l) => l.busId === busId && l.date < date).reduce((m, l) => Math.max(m, l.km), 0);
      if (earlier && km < earlier) return { ok: false, reason: `The reading can't be lower than an earlier one (${earlier.toLocaleString('en-LK')} km).` };
      // Read what is stored, not this render's copy: two readings saved one after the other (start and end of a trip) must both be kept.
      let stored: OdoLog[] = logs;
      try {
        stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? logs;
      } catch {
        /* keep this render's copy */
      }
      const next = [{ id: uuid(), busId, date, km, notes, source: 'log' as const }, ...stored];
      setLogs(next);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage full */
      }
      return { ok: true };
    }
    const { error } = await supabase().from('odometer_logs').insert({ bus_id: busId, log_date: date, reading_km: Math.round(km), notes });
    if (error) return { ok: false, reason: friendlyError(error) };
    await load();
    return { ok: true };
  };

  const remove = async (id: string): Promise<Result> => {
    if (!DB) {
      const next = logs.filter((l) => l.id !== id);
      setLogs(next);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return { ok: true };
    }
    const { error } = await supabase().from('odometer_logs').delete().eq('id', id);
    if (error) return { ok: false, reason: friendlyError(error) };
    await load();
    return { ok: true };
  };

  return { logs, ready, error, add, remove };
}

/** Logged readings plus the ones that came with fuel / service expenses, oldest first. */
export function allReadings(logs: OdoLog[], expenses: ExpenseReading[]): OdoLog[] {
  const fromExpenses = expenses
    .filter((e) => e.busId && e.odometerKm)
    .map((e): OdoLog => ({ id: `exp-${e.id}`, busId: e.busId!, date: e.spentOn, km: e.odometerKm!, notes: '', source: e.category === 'fuel' ? 'fuel' : 'service' }));
  return [...logs, ...fromExpenses].sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}

/**
 * Distance covered, day by day, for one bus: each reading minus the one
 * before it, counted on the day of the later reading. The first reading has
 * nothing before it, so it only sets the starting point.
 */
export function dailyDistance(readings: OdoLog[], busId: string): Map<string, number> {
  const mine = readings.filter((r) => r.busId === busId).sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  const out = new Map<string, number>();
  for (let i = 1; i < mine.length; i++) {
    const d = mine[i].km - mine[i - 1].km;
    if (d > 0) out.set(mine[i].date, (out.get(mine[i].date) ?? 0) + d);
  }
  return out;
}

const kmText = (n: number) => `${n.toLocaleString('en-LK')} km`;
const sourceText = (r: OdoLog) => (r.source === 'fuel' ? 'the fuel log' : r.source === 'service' ? 'a service entry' : 'the reading');
/** A jump this big between two readings is almost always a typing mistake. */
export const ODO_WARN_KM = 1500;
/** More than this is refused (the database refuses it for daily readings too). */
export const ODO_MAX_JUMP_KM = 3000;

/**
 * What a typed reading means against the bus's other readings: the distance
 * since the last one, a warning, or what is wrong with it. An odometer only
 * goes up, so the number can't be lower than any earlier day's reading or
 * higher than any later day's. Used when closing a trip or day and on the
 * fuel / service form, so a slipped digit is caught before it is saved.
 * `dayText` turns a date into words for the messages.
 */
export function checkReading(readings: OdoLog[], busId: string, date: string, value: number | '' | null | undefined, dayText: (iso: string) => string = (d) => d) {
  const mine = readings.filter((l) => l.busId === busId);
  const byLatest = (a: OdoLog, b: OdoLog) => b.date.localeCompare(a.date) || b.km - a.km;
  /** The latest reading on or before the day (what the hint shows). */
  const before = mine.filter((l) => l.date <= date).sort(byLatest)[0] ?? null;
  /** The highest reading from an earlier day, and the lowest from a later day. */
  const floor = mine.filter((l) => l.date < date).sort((a, b) => b.km - a.km)[0] ?? null;
  const ceiling = mine.filter((l) => l.date > date).sort((a, b) => a.km - b.km)[0] ?? null;
  /** Already entered for that day. */
  const logged = mine.filter((l) => l.date === date).sort((a, b) => b.km - a.km)[0] ?? null;
  let problem: string | null = null;
  let warning: string | null = null;
  if (typeof value === 'number') {
    if (!(value > 0)) problem = 'Enter the number on the odometer.';
    else if (floor && value < floor.km) problem = `Lower than ${sourceText(floor)} on ${dayText(floor.date)} (${kmText(floor.km)}). An odometer only goes up: check the number.`;
    else if (ceiling && value > ceiling.km) problem = `Higher than ${sourceText(ceiling)} on ${dayText(ceiling.date)} (${kmText(ceiling.km)}). Check the number or the date.`;
    else if (floor && value - floor.km > ODO_MAX_JUMP_KM) problem = `That is ${kmText(value - floor.km)} more than the last reading (${kmText(floor.km)}). Check the number.`;
    else if (floor && value - floor.km > ODO_WARN_KM) warning = `That is ${kmText(value - floor.km)} since the last reading (${kmText(floor.km)}). Check it before you save.`;
  }
  const distance = typeof value === 'number' && !problem && floor ? value - floor.km : null;
  return { before, logged, problem, warning, distance };
}
