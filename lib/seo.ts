// lib/seo.ts — helpers for search-engine pages (server-side).
// With Supabase connected, the timetable is read from the database (public
// tables, cached for an hour). Otherwise it uses lib/seed.ts.

import { OPERATOR } from '@/config/operator';
import { SEED_BUSES, SEED_ROUTES, SEED_SCHEDULES } from './seed';
import type { Bus, Route, Schedule } from './types';
import { HAS_DB } from './features';
import { busFromRow, routeFromRow, scheduleFromRow } from './supabase/mappers';

export interface Timetable {
  buses: Bus[];
  routes: Route[];
  schedules: Schedule[];
}
const SEED_TIMETABLE: Timetable = { buses: SEED_BUSES, routes: SEED_ROUTES, schedules: SEED_SCHEDULES };

/** Timetable for server pages: database when connected (refreshed hourly), else the seed. */
export async function loadTimetable(): Promise<Timetable> {
  if (!HAS_DB) return SEED_TIMETABLE;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  const get = async (table: string) => {
    const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 3600, tags: ['timetable'] },
    });
    if (!res.ok) throw new Error(`${table}: ${res.status}`);
    return res.json();
  };
  try {
    const [b, r, s] = await Promise.all([get('buses'), get('routes'), get('schedules')]);
    return { buses: b.map(busFromRow), routes: r.map(routeFromRow), schedules: s.map(scheduleFromRow) };
  } catch (e) {
    console.warn('SEO pages: using built-in timetable (database not reachable)', e);
    return SEED_TIMETABLE;
  }
}
import { formatDuration, formatTime12, fromMinutes, toMinutes } from './trips';

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
export const absoluteUrl = (path = '/') => `${OPERATOR.siteUrl}${path.startsWith('/') ? path : `/${path}`}`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCHEMA_DAYS = WEEKDAYS.map((d) => `https://schema.org/${d}`);

export interface RoutePage {
  slug: string;
  from: string;
  to: string;
  fare: number;
  durationMin: number;
  departures: { time: string; arrival: string; nextDay: boolean; days: string[]; schemaDays: string[] }[];
  via: string[];
  busType: string;
  amenities: string[];
}

/** Every Colombo ⇄ stop pair, plus the big-town pairs people search for. */
export function allRoutePages(tt: Timetable = SEED_TIMETABLE): RoutePage[] {
  const pages = new Map<string, RoutePage>();
  for (const route of tt.routes.filter((r) => r.active)) {
    const stops = route.stops;
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const from = stops[i];
        const to = stops[j];
        const endsAtColombo = from.name === 'Colombo' || to.name === 'Colombo';
        const bigTowns = ['Kurunegala', 'Dambulla', 'Polonnaruwa', 'Batticaloa', 'Kalmunai', 'Akkaraipattu'];
        if (!endsAtColombo && !(bigTowns.includes(from.name) && bigTowns.includes(to.name))) continue;
        const slug = `${slugify(from.name)}-to-${slugify(to.name)}`;
        if (pages.has(slug)) continue;
        const schedules = tt.schedules.filter((s) => s.routeId === route.id && s.active);
        if (!schedules.length) continue;
        const bus = tt.buses.find((b) => b.id === schedules[0].busId);
        pages.set(slug, {
          slug,
          from: from.name,
          to: to.name,
          fare: to.fareFromStart - from.fareFromStart,
          durationMin: to.offsetMin - from.offsetMin,
          via: stops.slice(i + 1, j).map((s) => s.name),
          busType: bus ? `${bus.type} luxury coach` : 'Coach',
          amenities: bus?.amenities ?? [],
          departures: schedules.map((s) => {
            const dep = toMinutes(s.departure) + from.offsetMin;
            const arr = toMinutes(s.departure) + to.offsetMin;
            // Day the passenger boards (bus may have left its first stop the evening before)
            const shift = Math.floor(dep / 1440);
            const days = [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => (d + shift) % 7);
            return {
              time: formatTime12(fromMinutes(dep)),
              arrival: formatTime12(fromMinutes(arr)),
              nextDay: Math.floor(arr / 1440) > shift,
              // Alternate-day departures don't fall on fixed weekdays.
              days: s.everyDays && s.everyDays > 1 && s.startDate ? [s.everyDays === 2 ? 'alternate days' : `every ${s.everyDays} days`] : days.map((d) => WEEKDAYS[d]),
              schemaDays: days.map((d) => SCHEMA_DAYS[d]),
            };
          }),
        });
      }
    }
  }
  return [...pages.values()];
}

export function findRoutePage(slug: string, tt: Timetable = SEED_TIMETABLE) {
  return allRoutePages(tt).find((p) => p.slug === slug);
}

export function routeSummary(p: RoutePage) {
  const d = p.departures[0];
  return `${p.from} to ${p.to} by ${OPERATOR.name} ${p.busType}: ${formatDuration(p.durationMin)}, from LKR ${p.fare.toLocaleString('en-LK')}. Leaves ${d.time} on ${d.days.join(', ')}. Book your seat online.`;
}
