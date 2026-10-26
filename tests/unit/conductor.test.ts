// The conductor's list of tonight's stops.
import { describe, expect, it } from 'vitest';
import { tonightsStops, type OptionalStopStatus } from '@/lib/conductor';
import type { Booking } from '@/lib/types';
import { R, S } from './helpers';

const route = R([S('A'), S('K'), S('M', { optional: true, minSeats: 3 }), S('Maradana'), S('TJ')], {
  variants: [{ id: 'v', name: 'Without M', edited: true, removed: ['TJ'], stops: [S('A'), S('K'), S('Maradana')] }],
});
const notFilled: OptionalStopStatus[] = [{ stop: 'M', minSeats: 3, seats: 0, decided: false, runs: false, movedTo: null, cutoff: null }];
const b = (from: string, to: string, n = 1, x: Partial<Booking> = {}) =>
  ({ id: `${from}${to}${n}`, scheduleId: 's', date: 'd', from, to, seats: Array(n).fill('1A'), status: 'confirmed', ...x }) as Booking;

describe('tonightsStops', () => {
  const plan = tonightsStops(route, [b('A', 'TJ', 2), b('A', 'M'), b('A', 'K', 1, { bookedTo: 'M' })], notFilled);
  it('follows the variant in use', () => {
    expect(plan.map((p) => p.name)).toEqual(['A', 'K', 'Maradana']);
  });
  it('counts passengers of a stop the bus skips at the stop before it', () => {
    const k = plan.find((p) => p.name === 'K')!;
    expect(k.off).toBe(2);
    expect(k.via).toEqual([{ stop: 'M', onRequest: true, on: 0, off: 2 }]);
    const m = plan.find((p) => p.name === 'Maradana')!;
    expect(m.via).toEqual([{ stop: 'TJ', onRequest: false, on: 0, off: 2 }]);
  });
});
