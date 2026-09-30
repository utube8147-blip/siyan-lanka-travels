// app/(public)/(passenger)/bus/[slug]/page.tsx — one search-friendly page per
// journey, e.g. /bus/colombo-to-batticaloa. Built at compile time from the
// timetable in lib/seed.ts (server-rendered, so Google sees everything).

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Clock, MapPin, Ticket, Bus, ChevronRight } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { absoluteUrl, allRoutePages, findRoutePage, routeSummary } from '@/lib/seo';
import { formatDuration, formatLKR } from '@/lib/trips';

export const dynamicParams = false;

export function generateStaticParams() {
  return allRoutePages().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = findRoutePage((await params).slug);
  if (!p) return {};
  const title = `${p.from} to ${p.to} bus: timetable, fare & online booking`;
  const description = routeSummary(p);
  return {
    title,
    description,
    alternates: { canonical: `/bus/${p.slug}` },
    openGraph: { title, description, url: `/bus/${p.slug}`, images: ['/og.jpg'] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.jpg'] },
  };
}

export default async function RoutePage({ params }: { params: Promise<{ slug: string }> }) {
  const p = findRoutePage((await params).slug);
  if (!p) notFound();
  const others = allRoutePages().filter((o) => o.slug !== p.slug && (o.from === p.from || o.to === p.to)).slice(0, 8);
  const bookHref = `/search?${new URLSearchParams({ from: p.from, to: p.to }).toString()}`;
  const first = p.departures[0];
  const bikeFrom = Math.min(...Object.values(OPERATOR.bikes.kinds).map((k) => k.fullRouteFee));

  const faqs = [
    { q: `How long is the bus from ${p.from} to ${p.to}?`, a: `About ${formatDuration(p.durationMin)}. The bus leaves ${p.from} at ${first.time} and reaches ${p.to} around ${first.arrival}${first.nextDay ? ' the next morning' : ''}.` },
    { q: `How much is the bus ticket from ${p.from} to ${p.to}?`, a: `${formatLKR(p.fare)} per seat on our ${p.busType}, plus a ${formatLKR(OPERATOR.bookingFee)} booking fee when you book online.` },
    { q: `Which days does the ${p.from} to ${p.to} bus run?`, a: p.departures.map((d) => `${d.time} on ${d.days.join(', ')}`).join('; ') + '.' },
    { q: 'Can I choose my seat?', a: 'Yes. You pick your exact seat on a live seat map when you book. Seats at the front are kept for female passengers.' },
    { q: 'Can I take a bicycle or motorbike?', a: `Yes, in the luggage compartment under the bus. Add it when you book and upload a photo; prices start around ${formatLKR(OPERATOR.bikes.minFee)} and depend on the distance and the bike (up to ${formatLKR(bikeFrom)} for a bicycle on the full route). Space is limited on each departure.` },
    ...(p.from === 'Colombo' ? [{ q: 'Where does the bus leave from in Colombo?', a: `${OPERATOR.contact.address}.` }] : []),
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
          { '@type': 'ListItem', position: 2, name: 'Bus routes', item: absoluteUrl('/bus') },
          { '@type': 'ListItem', position: 3, name: `${p.from} to ${p.to}`, item: absoluteUrl(`/bus/${p.slug}`) },
        ],
      },
      ...p.departures.map((d) => ({
        '@type': 'BusTrip',
        name: `${p.from} to ${p.to} (${d.time})`,
        provider: { '@id': `${OPERATOR.siteUrl}/#organization` },
        departureBusStop: { '@type': 'BusStop', name: p.from, address: { '@type': 'PostalAddress', addressCountry: 'LK' } },
        arrivalBusStop: { '@type': 'BusStop', name: p.to, address: { '@type': 'PostalAddress', addressCountry: 'LK' } },
        departureTime: d.time,
        arrivalTime: d.arrival,
        offers: { '@type': 'Offer', price: p.fare, priceCurrency: 'LKR', url: absoluteUrl(bookHref), availability: 'https://schema.org/InStock' },
      })),
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  };

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-[48px] py-[32px]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] font-medium text-[#46464f] mb-6">
        <Link href="/" className="hover:text-[#050a44]">Home</Link>
        <ChevronRight className="w-4 h-4" />
        <Link href="/bus" className="hover:text-[#050a44]">Bus routes</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-[#050a44] font-bold">{p.from} to {p.to}</span>
      </nav>

      <section className="keep-navy rounded-[2rem] bg-gradient-to-br from-[#1c1d22] to-[#111216] text-white p-7 md:p-10 mb-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#feb700]">{OPERATOR.name}</p>
        <h1 className="text-[32px] md:text-[44px] font-extrabold leading-[1.1] tracking-tight mt-2">
          {p.from} to {p.to} bus
        </h1>
        <p className="text-[16px] text-white/80 mt-3 max-w-2xl">{routeSummary(p)}</p>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-7">
          {[
            { icon: Clock, k: 'Departs', v: `${first.time}` },
            { icon: Bus, k: 'Journey', v: formatDuration(p.durationMin) },
            { icon: Ticket, k: 'Fare', v: formatLKR(p.fare) },
            { icon: MapPin, k: 'Stops on the way', v: String(p.via.length) },
          ].map(({ icon: Icon, k, v }) => (
            <div key={k} className="rounded-2xl bg-white/10 border border-white/10 p-4">
              <dt className="text-[12px] text-white/70 flex items-center gap-1.5">
                <Icon className="w-4 h-4 text-[#feb700]" /> {k}
              </dt>
              <dd className="text-[18px] font-extrabold mt-1">{v}</dd>
            </div>
          ))}
        </dl>
        <Link
          href={bookHref}
          className="inline-flex items-center gap-2 mt-7 px-7 py-4 bg-[#feb700] text-[#050a44] rounded-2xl text-[16px] font-bold hover:brightness-105"
        >
          Choose your seat <ArrowRight className="w-5 h-5" />
        </Link>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-8">
        <div className="space-y-8">
          <section>
            <h2 className="text-[22px] font-bold text-[#050a44] mb-3">Timetable</h2>
            <div className="bg-white rounded-2xl border border-[#e1e2e4] overflow-hidden">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] font-bold text-[#46464f] bg-[#f8f9fb]">
                    <th className="px-4 py-3">Leaves {p.from}</th>
                    <th className="px-4 py-3">Arrives {p.to}</th>
                    <th className="px-4 py-3">Runs on</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edeef0]">
                  {p.departures.map((d) => (
                    <tr key={d.time}>
                      <td className="px-4 py-3 font-extrabold text-[#050a44]">{d.time}</td>
                      <td className="px-4 py-3 text-[#050a44]">
                        {d.arrival}
                        {d.nextDay && <span className="text-[12px] text-[#46464f]"> (next day)</span>}
                      </td>
                      <td className="px-4 py-3 text-[#46464f]">{d.days.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {p.via.length > 0 && (
            <section>
              <h2 className="text-[22px] font-bold text-[#050a44] mb-3">Stops on the way</h2>
              <ol className="bg-white rounded-2xl border border-[#e1e2e4] p-5 space-y-3">
                {[p.from, ...p.via, p.to].map((s, i, arr) => (
                  <li key={s} className="flex items-center gap-3 text-[15px]">
                    <span className={`w-3 h-3 rounded-full ${i === 0 || i === arr.length - 1 ? 'bg-[#050a44]' : 'bg-[#feb700]'}`} aria-hidden />
                    <span className={i === 0 || i === arr.length - 1 ? 'font-bold text-[#050a44]' : 'text-[#46464f]'}>{s}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <h2 className="text-[22px] font-bold text-[#050a44] mb-3">Questions</h2>
            <div className="space-y-3">
              {faqs.map((f) => (
                <details key={f.q} className="group bg-white rounded-2xl border border-[#e1e2e4] px-5 py-4">
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-bold text-[15px] text-[#050a44]">
                    {f.q}
                    <ChevronRight className="w-5 h-5 shrink-0 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="text-[14px] leading-[1.7] text-[#46464f] mt-3">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="bg-white rounded-2xl border border-[#e1e2e4] p-5">
            <h2 className="text-[17px] font-bold text-[#050a44] mb-3">On board</h2>
            <ul className="space-y-2 text-[14px] text-[#46464f]">
              {p.amenities.map((a) => (
                <li key={a} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#feb700]" aria-hidden /> {a}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#feb700]" aria-hidden /> Bikes carried in the luggage compartment
              </li>
            </ul>
          </section>
          {others.length > 0 && (
            <section className="bg-white rounded-2xl border border-[#e1e2e4] p-5">
              <h2 className="text-[17px] font-bold text-[#050a44] mb-3">Other routes</h2>
              <ul className="space-y-2">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link href={`/bus/${o.slug}`} className="flex items-center justify-between text-[14px] font-semibold text-[#050a44] hover:underline">
                      {o.from} to {o.to}
                      <span className="text-[#46464f] font-medium">{formatLKR(o.fare)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
