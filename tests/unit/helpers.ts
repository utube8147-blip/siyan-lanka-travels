import type { Route, RouteStop } from '@/lib/types';

/** A stop; extra fields as needed. */
export const S = (name: string, o: Partial<RouteStop> = {}): RouteStop => ({ name, offsetMin: 0, fareFromStart: 0, ...o });
export const R = (stops: RouteStop[], o: Partial<Route> = {}): Route => ({ id: 'r', active: true, stops, ...o });
export const names = (stops: RouteStop[]) => stops.map((s) => s.name);
