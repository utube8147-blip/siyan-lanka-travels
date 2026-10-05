// app/(public)/(passenger)/bus/page.tsx — index of every route page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { allRoutePages, loadTimetable } from '@/lib/seo';
import { formatDuration, formatLKR } from '@/lib/trips';

export const metadata: Metadata = {
  title: 'Bus routes, timetables and fares',
  description: `All ${OPERATOR.name} routes: Colombo to Kurunegala, Dambulla, Habarana, Polonnaruwa, Batticaloa, Kalmunai and Akkaraipattu, with times and fares.`,
  alternates: { canonical: '/bus' },
};

export const revalidate = 3600;

export default async function RoutesIndex() {
  const pages = allRoutePages(await loadTimetable());
  const groups = [
    { title: 'From Colombo', items: pages.filter((p) => p.from === 'Colombo') },
    { title: 'To Colombo', items: pages.filter((p) => p.to === 'Colombo') },
    { title: 'Between towns', items: pages.filter((p) => p.from !== 'Colombo' && p.to !== 'Colombo') },
  ];
  return (
    <main className="max-w-[1400px] mx-auto px-4 md:px-[48px] py-[32px]">
      <h1 className="text-[32px] md:text-[34px] font-extrabold tracking-tight text-[#050a44]">Bus routes</h1>
      <p className="text-[16px] text-[#46464f] mt-2 max-w-2xl">
        Route 48 overnight luxury coach between Colombo and the Eastern Province. Pick a journey for its timetable, fare and stops.
      </p>
      {groups.map((g) => (
        <section key={g.title} className="mt-10">
          <h2 className="text-[20px] font-bold text-[#050a44] mb-4">{g.title}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map((p) => (
              <li key={p.slug}>
                <Link href={`/bus/${p.slug}`} className="group flex items-center justify-between gap-3 bg-white rounded-2xl border border-[#e1e2e4] p-4 hover:border-[#050a44] transition-colors">
                  <span>
                    <span className="block text-[15px] font-bold text-[#050a44]">
                      {p.from} to {p.to}
                    </span>
                    <span className="block text-[13px] text-[#46464f]">
                      {formatDuration(p.durationMin)} · {formatLKR(p.fare)}
                    </span>
                  </span>
                  <ArrowRight className="w-5 h-5 text-[#46464f] group-hover:translate-x-1 transition-transform" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
