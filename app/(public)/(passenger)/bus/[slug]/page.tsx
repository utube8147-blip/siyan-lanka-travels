// app/(public)/(passenger)/bus/[slug]/page.tsx — one search-friendly page per
// journey, e.g. /bus/colombo-to-batticaloa. Built at compile time from the
// timetable in lib/seed.ts (server-rendered, so Google sees everything).

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Clock, MapPin, Ticket, Bus, ChevronRight } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { absoluteUrl, allRoutePages, findRoutePage, loadTimetable, routeFaqs, routeSummary, jsonLdScript } from '@/lib/seo';
import { N_ } from '@/lib/i18n-core';
import { RouteDays, RouteFaqs, RouteSummary } from '@/components/RouteTexts';
import { formatDuration, formatLKR } from '@/lib/trips';
import { Tx } from '@/components/Tx';

// New routes added in the dashboard get pages on first visit; all refresh hourly.
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return allRoutePages(await loadTimetable()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = findRoutePage((await params).slug, await loadTimetable());
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
  const tt = await loadTimetable();
  const p = findRoutePage((await params).slug, tt);
  if (!p) notFound();
  const others = allRoutePages(tt).filter((o) => o.slug !== p.slug && (o.from === p.from || o.to === p.to)).slice(0, 8);
  const bookHref = `/search?${new URLSearchParams({ from: p.from, to: p.to }).toString()}`;
  const first = p.departures[0];
  const faqs = routeFaqs(p); // English here (for search engines); <RouteFaqs> shows them translated

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }} />

      <nav aria-label="Breadcrumb" className="hidden md:flex flex-wrap items-center gap-1 text-[13px] font-medium text-[#46464f] mb-6">
        <Link href="/" className="hover:text-[#050a44]"><Tx k={'Home'} /></Link>
        <ChevronRight className="w-4 h-4" />
        <Link href="/bus" className="hover:text-[#050a44]"><Tx k={'Bus routes'} /></Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-[#050a44] font-bold"><Tx k={'{from} to {to}'} v={{ from: p.from, to: p.to }} /></span>
      </nav>

      <section className="keep-navy rounded-[2rem] bg-gradient-to-br from-[#1c1d22] to-[#111216] text-white p-7 md:p-10 mb-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#feb700]">{OPERATOR.name}</p>
        <h1 className="text-[32px] md:text-[38px] font-extrabold leading-[1.1] tracking-tight mt-2"><Tx k={'{from} to {to} bus'} v={{ from: p.from, to: p.to }} /></h1>
        <p className="text-[16px] text-white/80 mt-3 max-w-2xl"><RouteSummary p={p} /></p>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-7">
          {[
            { icon: Clock, k: N_('Departs'), v: `${first.time}` },
            { icon: Bus, k: N_('Journey'), v: formatDuration(p.durationMin) },
            { icon: Ticket, k: N_('Fare'), v: formatLKR(p.fare) },
            { icon: MapPin, k: N_('Stops on the way'), v: String(p.via.length) },
          ].map(({ icon: Icon, k, v }) => (
            <div key={k} className="rounded-2xl bg-white/10 border border-white/10 p-4">
              <dt className="text-[12px] text-white/70 flex items-center gap-1.5">
                <Icon className="w-4 h-4 text-[#feb700]" /> <Tx k={k} />
              </dt>
              <dd className="text-[18px] font-extrabold mt-1">{v}</dd>
            </div>
          ))}
        </dl>
        <Link
          href={bookHref}
          className="inline-flex items-center gap-2 mt-7 px-7 py-4 bg-[#feb700] text-[#050a44] rounded-2xl text-[16px] font-bold hover:brightness-105"
        ><Tx k={'Choose your seat'} />{' '}<ArrowRight className="w-5 h-5" />
        </Link>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-8">
        <div className="space-y-8">
          <section>
            <h2 className="text-[22px] font-bold text-[#050a44] mb-3"><Tx k={'Timetable'} /></h2>
            <div className="bg-white rounded-2xl border border-[#e1e2e4] overflow-hidden">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] font-bold text-[#46464f] bg-[#f8f9fb]">
                    <th className="px-4 py-3"><Tx k={'Leaves {from}'} v={{ from: p.from }} /></th>
                    <th className="px-4 py-3"><Tx k={'Arrives {to}'} v={{ to: p.to }} /></th>
                    <th className="px-4 py-3"><Tx k={'Runs on'} /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edeef0]">
                  {p.departures.map((d) => (
                    <tr key={d.time}>
                      <td className="px-4 py-3 font-extrabold text-[#050a44]">{d.time}</td>
                      <td className="px-4 py-3 text-[#050a44]">
                        {d.arrival}
                        {d.nextDay && <span className="text-[12px] text-[#46464f]"><Tx k={'(next day)'} /></span>}
                      </td>
                      <td className="px-4 py-3 text-[#46464f]"><RouteDays days={d.days} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {p.via.length > 0 && (
            <section>
              <h2 className="text-[22px] font-bold text-[#050a44] mb-3"><Tx k={'Stops on the way'} /></h2>
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
            <h2 className="text-[22px] font-bold text-[#050a44] mb-3"><Tx k={'Questions'} /></h2>
            <RouteFaqs p={p} />
          </section>
        </div>

        <aside className="space-y-6">
          <section className="bg-white rounded-2xl border border-[#e1e2e4] p-5">
            <h2 className="text-[17px] font-bold text-[#050a44] mb-3"><Tx k={'On board'} /></h2>
            <ul className="space-y-2 text-[14px] text-[#46464f]">
              {p.amenities.map((a) => (
                <li key={a} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#feb700]" aria-hidden /> <Tx k={a} />
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#feb700]" aria-hidden />{' '}<Tx k={'Bikes carried in the luggage compartment'} /></li>
            </ul>
          </section>
          {others.length > 0 && (
            <section className="bg-white rounded-2xl border border-[#e1e2e4] p-5">
              <h2 className="text-[17px] font-bold text-[#050a44] mb-3"><Tx k={'Other routes'} /></h2>
              <ul className="space-y-2">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link href={`/bus/${o.slug}`} className="flex items-center justify-between text-[14px] font-semibold text-[#050a44] hover:underline"><Tx k={'{from} to {to}'} v={{ from: o.from, to: o.to }} /><span className="text-[#46464f] font-medium">{formatLKR(o.fare)}</span>
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
