'use client';
// Route-page text that is built from the timetable, shown in the reader's
// language. The server page keeps the English for metadata and structured data.
import { ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { dayList, routeFaqs, routeSummary, type RoutePage } from '@/lib/seo';

export function RouteSummary({ p }: { p: RoutePage }) {
  useT();
  return <>{routeSummary(p)}</>;
}

export function RouteDays({ days }: { days: string[] }) {
  useT();
  return <>{dayList(days)}</>;
}

export function RouteFaqs({ p }: { p: RoutePage }) {
  useT();
  return (
    <div className="space-y-3">
      {routeFaqs(p).map((f) => (
        <details key={f.q} className="group bg-white rounded-2xl border border-[#e1e2e4] px-5 py-4">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-bold text-[15px] text-[#050a44]">
            {f.q}
            <ChevronRight className="w-5 h-5 shrink-0 transition-transform group-open:rotate-90" />
          </summary>
          <p className="text-[14px] leading-[1.7] text-[#46464f] mt-3">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
