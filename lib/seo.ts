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
export async function loadTimetable(opts: { fresh?: boolean } = {}): Promise<Timetable> {
  if (!HAS_DB) return SEED_TIMETABLE;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  const get = async (table: string) => {
    // fresh: a separate, short-lived copy, for a link the hourly copy doesn't know yet.
    const res = await fetch(`${url}/rest/v1/${table}?select=*${opts.fresh ? '&fresh=1' : ''}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: opts.fresh ? 60 : 3600, tags: ['timetable'] },
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
import { formatDuration, formatLKR, formatTime12, fromMinutes, toMinutes } from './trips';
import { N_, tx } from './i18n-core';

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
export const absoluteUrl = (path = '/') => `${OPERATOR.siteUrl}${path.startsWith('/') ? path : `/${path}`}`;

const WEEKDAYS = [N_('Sunday'), N_('Monday'), N_('Tuesday'), N_('Wednesday'), N_('Thursday'), N_('Friday'), N_('Saturday')];
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

/**
 * A page for every trip people can take on a route that is running (open, not
 * deleted, a departure that isn't paused on a bus in service): from the
 * route's first stop to every stop, and from every stop to its last stop.
 * On-request stops and hidden shaping points don't get pages.
 */
export function allRoutePages(tt: Timetable = SEED_TIMETABLE): RoutePage[] {
  const pages = new Map<string, RoutePage>();
  const running = tt.routes.filter(
    (r) => r.active && !r.archived && tt.schedules.some((s) => s.routeId === r.id && s.active && !s.archived && tt.buses.find((b) => b.id === s.busId)?.status === 'active'),
  );
  for (const route of running) {
    const stops = route.stops.filter((s) => !s.hidden && !s.optional);
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const from = stops[i];
        const to = stops[j];
        if (i !== 0 && j !== stops.length - 1) continue; // from the start, or to the end
        const slug = `${slugify(from.name)}-to-${slugify(to.name)}`;
        if (pages.has(slug)) continue;
        const schedules = tt.schedules.filter((s) => s.routeId === route.id && s.active && !s.archived);
        if (!schedules.length) continue;
        const bus = tt.buses.find((b) => b.id === schedules[0].busId);
        pages.set(slug, {
          slug,
          from: from.name,
          to: to.name,
          fare: route.flatFare !== false ? route.stops[route.stops.length - 1].fareFromStart : to.fareFromStart - from.fareFromStart,
          durationMin: to.offsetMin - from.offsetMin,
          via: stops.slice(i + 1, j).map((s) => s.name),
          busType: bus ? (bus.type === 'AC' ? N_('AC luxury coach') : N_('Non-AC coach')) : N_('Coach'),
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
              days: s.everyDays && s.everyDays > 1 && s.startDate ? [s.everyDays === 2 ? N_('alternate days') : `every ${s.everyDays} days`] : days.map((d) => WEEKDAYS[d]),
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

/**
 * A route page, looked up so a working link never ends on "page not found":
 * the hourly timetable first, then a fresh one (a route added or renamed in
 * the last hour). If there's still no page (a stop in the middle, or an
 * on-request stop), but both places are stops on some route, the answer is a
 * search for that trip.
 */
export async function resolveRoutePage(slug: string): Promise<{ page: RoutePage; tt: Timetable } | { search: { from: string; to: string } } | null> {
  let tt = await loadTimetable();
  let page = findRoutePage(slug, tt);
  if (!page && HAS_DB) {
    tt = await loadTimetable({ fresh: true });
    page = findRoutePage(slug, tt);
  }
  if (page) return { page, tt };
  const names = new Map<string, string>();
  for (const r of tt.routes) if (!r.archived) for (const st of r.stops) if (!st.hidden) names.set(slugify(st.name), st.name);
  const parts = slug.split('-to-');
  for (let k = 1; k < parts.length; k++) {
    const from = names.get(parts.slice(0, k).join('-to-'));
    const to = names.get(parts.slice(k).join('-to-'));
    if (from && to && from !== to) return { search: { from, to } };
  }
  return null;
}

/** A departure's running days in the language in use ("Monday, Friday", "every 3 days"). */
export function dayList(days: string[]) {
  return days
    .map((x) => {
      const every = /^every (\d+) days$/.exec(x);
      return every ? tx('every {n} days', { n: every[1] }) : tx(x);
    })
    .join(', ');
}

/** In English on the server (page metadata); in the reader's language when rendered by <RouteSummary>. */
export function routeSummary(p: RoutePage) {
  const d = p.departures[0];
  return tx('{from} to {to} by {operator} {busType}: {duration}, from LKR {fare}. Leaves {time} on {days}. Book your seat online.', {
    from: p.from, to: p.to, operator: OPERATOR.name, busType: tx(p.busType), duration: formatDuration(p.durationMin),
    fare: p.fare.toLocaleString('en-LK'), time: d.time, days: dayList(d.days),
  });
}

/** Questions on a route page: English for the structured data, translated on screen by <RouteFaqs>. */
export function routeFaqs(p: RoutePage) {
  const first = p.departures[0];
  const bikeFrom = Math.min(...Object.values(OPERATOR.bikes.kinds).map((k) => k.fullRouteFee));
  const route = { from: p.from, to: p.to };
  return [
    {
      q: tx('How long is the bus from {from} to {to}?', route),
      a: first.nextDay
        ? tx('About {duration}. The bus leaves {from} at {time} and reaches {to} around {arrival} the next morning.', { ...route, duration: formatDuration(p.durationMin), time: first.time, arrival: first.arrival })
        : tx('About {duration}. The bus leaves {from} at {time} and reaches {to} around {arrival}.', { ...route, duration: formatDuration(p.durationMin), time: first.time, arrival: first.arrival }),
    },
    {
      q: tx('How much is the bus ticket from {from} to {to}?', route),
      a: tx('{fare} per seat on our {busType}, plus a {fee} booking fee when you book online.', { fare: formatLKR(p.fare), busType: tx(p.busType), fee: formatLKR(OPERATOR.bookingFee) }),
    },
    {
      q: tx('Which days does the {from} to {to} bus run?', route),
      a: p.departures.map((d) => tx('{time} on {days}', { time: d.time, days: dayList(d.days) })).join('; ') + '.',
    },
    { q: tx('Can I choose my seat?'), a: tx('Yes. You pick your exact seat on a live seat map when you book. Seats at the front are kept for female passengers.') },
    {
      q: tx('Can I take a bicycle or motorbike?'),
      a: tx('Yes, in the luggage compartment under the bus. Add it when you book and upload a photo; prices start around {min} and depend on the distance and the bike (up to {max} for a bicycle on the full route). Space is limited on each departure.', { min: formatLKR(OPERATOR.bikes.minFee), max: formatLKR(bikeFrom) }),
    },
    ...(p.from === 'Colombo' ? [{ q: tx('Where does the bus leave from in Colombo?'), a: `${OPERATOR.contact.address}.` }] : []),
  ];
}

/** JSON for a <script type="application/ld+json"> tag. "<" is escaped so a
 *  name containing "</script>" can't end the tag early. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
