// How the bus goes on a trip: skipped on-request stops, variants, left-out stops.
import { describe, expect, it } from 'vitest';
import { fallbackStop, roadStops, runningRoutes, syncVariants, tripWay, variantComplete } from '@/lib/trips';
import { names, R, S } from './helpers';

const route = () =>
  R([S('A'), S('h1', { hidden: true }), S('X', { optional: true, minSeats: 2 }), S('h2', { hidden: true }), S('B'), S('Y', { optional: true }), S('C')]);

describe('roadStops', () => {
  it('drops an on-request stop that is not running, with the shaping points of its detour', () => {
    expect(names(roadStops(route().stops, () => false))).toEqual(['A', 'B', 'C']);
  });
  it('keeps it (and its shaping points) when it runs', () => {
    expect(names(roadStops(route().stops, (n) => n === 'X'))).toEqual(['A', 'h1', 'X', 'h2', 'B', 'C']);
  });
  it('keeps shaping points that are not next to a skipped stop', () => {
    const r = R([S('A'), S('p', { hidden: true }), S('B'), S('X', { optional: true }), S('C')]);
    expect(names(roadStops(r.stops, () => false))).toEqual(['A', 'p', 'B', 'C']);
  });
});

describe('automatic variants', () => {
  it('makes one for every mix of on-request stops except "all"', () => {
    const v = syncVariants(route()).variants!;
    expect(v.map((x) => x.name)).toEqual(['Without Y', 'Without X', 'Without X, Y']);
    expect(names(v[2].stops)).toEqual(['A', 'B', 'C']);
  });
  it('keeps edited variants and rebuilds automatic ones', () => {
    const r = syncVariants(route());
    r.variants![0] = { ...r.variants![0], edited: true, stops: [S('A'), S('X', { optional: true }), S('C'), S('B')] };
    const again = syncVariants({ ...r, stops: [...r.stops, S('D')] });
    expect(again.variants![0].edited).toBe(true);
    expect(names(again.variants![0].stops)).toEqual(['A', 'X', 'C', 'B']);
    expect(names(again.variants![2].stops)).toContain('D');
  });
  it('drops variants when no stop is on request', () => {
    expect(syncVariants(R([S('A'), S('B')])).variants).toEqual([]);
  });
});

describe('tripWay', () => {
  it('main route when every on-request stop fills', () => {
    const w = tripWay(route(), () => true);
    expect(w.variant).toBeNull();
    expect(names(w.stops)).toContain('X');
  });
  it('the variant for exactly the stops that filled', () => {
    expect(tripWay(route(), (n) => n === 'Y').variant?.name).toBe('Without X');
    expect(tripWay(route(), () => false).variant?.name).toBe('Without X, Y');
  });
  it('an edited variant missing a main stop added later is not used', () => {
    const r = syncVariants(route());
    r.variants![1] = { ...r.variants![1], edited: true };
    const grown = { ...r, stops: [...r.stops.slice(0, -1), S('D'), S('C')] };
    expect(variantComplete(grown, grown.variants![1])).toBe(false);
    expect(tripWay(grown, (n) => n === 'Y').variant).toBeNull();
    expect(names(tripWay(grown, (n) => n === 'Y').stops)).toEqual(['A', 'B', 'Y', 'D', 'C']);
  });
  it('a main stop removed on purpose keeps the variant usable', () => {
    const r = syncVariants(route());
    r.variants![2] = { ...r.variants![2], edited: true, removed: ['C'], stops: [S('A'), S('B')] };
    expect(variantComplete(r, r.variants![2])).toBe(true);
    expect(names(tripWay(r, () => false).stops)).toEqual(['A', 'B']);
  });
});

describe('fallbackStop / runningRoutes', () => {
  it('nearest main stop in time', () => {
    const stops = [S('A', { offsetMin: 0 }), S('X', { optional: true, offsetMin: 50 }), S('B', { offsetMin: 60 }), S('C', { offsetMin: 200 })];
    expect(fallbackStop(stops, 'X')).toBe('B');
  });
  it('only routes with an open departure on an active bus', () => {
    const data = {
      routes: [R([S('A'), S('B')], { id: 'r1' }), R([S('A'), S('C')], { id: 'r2' })],
      schedules: [
        { id: 's1', routeId: 'r1', busId: 'b', departure: '21:00', days: [1], active: true },
        { id: 's2', routeId: 'r2', busId: 'b', departure: '21:00', days: [1], active: false },
      ],
      buses: [{ id: 'b', status: 'active' }],
    } as never;
    expect(runningRoutes(data).map((r) => r.id)).toEqual(['r1']);
  });
});
