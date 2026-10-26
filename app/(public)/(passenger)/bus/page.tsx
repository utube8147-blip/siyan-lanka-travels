// app/(public)/(passenger)/bus/page.tsx — "Bus routes": a trip finder, then
// each running route with its map, stops, times, fares and bus, and links to
// the journey pages (/bus/colombo-to-batticaloa …) for search engines.
import type { Metadata } from 'next';
import { OPERATOR } from '@/config/operator';
import { allRoutePages, loadTimetable } from '@/lib/seo';
import { Tx } from '@/components/Tx';
import { RouteGuide, type Guide } from '@/components/RouteGuide';

export const metadata: Metadata = {
  title: 'Bus routes, timetables and fares',
  description: `All ${OPERATOR.name} routes with every stop, the time the bus gets there, fares, maps and on-request stops.`,
  alternates: { canonical: '/bus' },
};

export const revalidate = 3600;

const low = (s: string) => s.trim().toLowerCase();

export default async function RoutesIndex() {
  const tt = await loadTimetable();
  const pages = allRoutePages(tt);
  const guides: Guide[] = tt.routes
    .filter((r) => r.active && !r.archived)
    .map((r) => {
      const schedules = tt.schedules
        .filter((s) => s.routeId === r.id && s.active && !s.archived && tt.buses.find((b) => b.id === s.busId)?.status === 'active')
        .sort((a, b) => a.departure.localeCompare(b.departure));
      const stops = r.stops.filter((s) => !s.hidden);
      const order = stops.map((s) => low(s.name));
      return {
        id: r.id,
        title: r.name?.trim() || `${stops[0]?.name} – ${stops[stops.length - 1]?.name}`,
        flat: r.flatFare !== false,
        stops: r.stops.map((s) => ({ ...s, photo: undefined, notes: undefined })),
        departures: schedules.map((s) => {
          const bus = tt.buses.find((b) => b.id === s.busId);
          return {
            time: s.departure,
            days: [...s.days],
            every: s.everyDays && s.everyDays > 1 && s.startDate ? s.everyDays : null,
            bus: bus ? { name: bus.name, ac: bus.type === 'AC', amenities: bus.amenities ?? [], photo: bus.photos?.[0] ?? null, bikes: (bus.bikeSpaces ?? 0) > 0 } : null,
          };
        }),
        pages: pages
          .filter((p) => {
            const i = order.indexOf(low(p.from));
            const j = order.indexOf(low(p.to));
            return i >= 0 && j > i;
          })
          .map((p) => ({ slug: p.slug, from: p.from, to: p.to })),
      };
    })
    .filter((g) => g.departures.length > 0 && g.stops.filter((s) => !s.hidden).length >= 2);

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-[48px] py-[32px]">
      <h1 className="text-[32px] md:text-[34px] font-extrabold tracking-tight text-[#050a44]"><Tx k={'Bus routes'} /></h1>
      <p className="text-[16px] text-[#46464f] mt-2 mb-8 max-w-2xl"><Tx k={'Where our buses go, every stop on the way, when the bus gets there and what it costs.'} /></p>
      {guides.length ? <RouteGuide guides={guides} /> : <p className="text-[15px] text-[#46464f]"><Tx k={'No routes are running right now.'} /></p>}
    </main>
  );
}
