// Turn-off points and timing estimates.
import { describe, expect, it } from 'vitest';
import { splitPoint } from '@/lib/detour';
import { arrivalEstimates, roundedOffsets } from '@/lib/routeEditor';
import { S } from './helpers';

describe('splitPoint (where a detour leaves the road)', () => {
  it('finds the turn-off even when the road has few points', () => {
    const usual: [number, number][] = [[7.0, 79.9], [7.0, 80.1]];
    const detour: [number, number][] = [[7.0, 79.9], [7.0, 79.93], [7.0, 79.95], [7.02, 79.95], [7.05, 79.96]];
    const { point, along } = splitPoint(usual, detour);
    expect(point).toEqual([7.0, 79.95]);
    expect(along).toBeCloseTo(0.25, 2);
  });
  it('at the start when the detour leaves straight away', () => {
    const { along } = splitPoint([[7, 80], [7, 81]], [[7, 80], [7.5, 80]]);
    expect(along).toBe(0);
  });
});

describe('arrivalEstimates', () => {
  const legs = [{ km: 10, min: 10 }, { km: 10, min: 10 }, { km: 10, min: 10 }];
  const P = (name: string, hidden = false) => S(name, { lat: 7, lng: 80, hidden });
  it('hidden shaping points add no stop time', () => {
    expect(arrivalEstimates([P('A'), P('h1', true), P('h2', true), P('B')], legs, 1, 5)).toEqual([0, 10, 20, 30]);
  });
  it('real stops add the stop time', () => {
    expect(arrivalEstimates([P('A'), P('s1'), P('s2'), P('B')], legs, 1, 5)).toEqual([0, 10, 25, 40]);
  });
  it('bus factor slows every leg', () => {
    expect(arrivalEstimates([P('A'), P('B')], [{ km: 10, min: 10 }], 1.5, 2)).toEqual([0, 15]);
  });
  it('timetable times are rounded to 5 minutes and always go up', () => {
    expect(roundedOffsets([0, 2, 3, 31])).toEqual([0, 5, 10, 30]);
  });
});
