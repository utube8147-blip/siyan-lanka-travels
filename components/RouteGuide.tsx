'use client';
// Bus routes page (/bus): a trip finder ("from / to"), then one card per
// real route — map, every stop with its time and fare, on-request stops,
// departures and the bus — and the journey pages for search engines.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpDown, Bus, ChevronDown, Clock, MapPin, Search, Ticket, X } from 'lucide-react';
import type { RouteStop } from '@/lib/types';
import { StopsMap } from '@/components/StopsMap';
import { formatDuration, formatLKR, formatTime12, fromMinutes, toMinutes } from '@/lib/trips';
import { tx, useT } from '@/lib/i18n';
import { OPERATOR } from '@/config/operator';

export interface GuideDeparture {
  time: string; // "HH:MM" from the first stop
  days: number[]; // 0 = Sunday
  every: number | null; // alternate-day running
  bus: { name: string; ac: boolean; amenities: string[]; photo: string | null; bikes: boolean } | null;
}
export interface Guide {
  id: string;
  title: string;
  flat: boolean;
  stops: RouteStop[]; // every point, hidden ones too (they shape the map)
  departures: GuideDeparture[];
  pages: { slug: string; from: string; to: string }[];
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const low = (s: string) => s.trim().toLowerCase();

function daysText(d: GuideDeparture, shift = 0) {
  if (d.every && d.every > 1) return d.every === 2 ? tx('alternate days') : tx('every {n} days', { n: d.every });
  if (d.days.length === 7) return tx('Daily');
  const order = (x: number) => (x + 6) % 7; // Monday first
  return d.days.map((x) => (x + shift) % 7).sort((a, b) => order(a) - order(b)).map((x) => tx(DAY[x])).join(', ');
}
const at = (dep: string, offset: number) => toMinutes(dep) + offset;
const clock = (m: number) => formatTime12(fromMinutes(m));
const fareBetween = (g: Guide, a: RouteStop, b: RouteStop) => (g.flat ? g.stops[g.stops.length - 1].fareFromStart : b.fareFromStart - a.fareFromStart);

export function RouteGuide({ guides }: { guides: Guide[] }) {
  useT();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const places = useMemo(() => [...new Set(guides.flatMap((g) => g.stops.filter((s) => !s.hidden).map((s) => s.name)))].sort(), [guides]);

  // Trips that answer the finder (both places filled in, in travel order).
  const trips = useMemo(() => {
    if (!from.trim() || !to.trim()) return null;
    const out: { g: Guide; a: RouteStop; b: RouteStop; d: GuideDeparture }[] = [];
    for (const g of guides) {
      const stops = g.stops.filter((s) => !s.hidden);
      const i = stops.findIndex((s) => low(s.name) === low(from));
      const j = stops.findIndex((s) => low(s.name) === low(to));
      if (i < 0 || j < 0 || i >= j) continue;
      for (const d of g.departures) out.push({ g, a: stops[i], b: stops[j], d });
    }
    return out.sort((x, y) => (at(x.d.time, x.a.offsetMin) % 1440) - (at(y.d.time, y.a.offsetMin) % 1440));
  }, [guides, from, to]);

  // Only one place typed: the routes that stop there.
  const one = !trips && (from.trim() || to.trim()) ? low(from.trim() || to.trim()) : null;
  const shown = one ? guides.filter((g) => g.stops.some((s) => !s.hidden && low(s.name) === one)) : guides;
  const backwards = trips && trips.length === 0 && guides.some((g) => {
    const st = g.stops.filter((s) => !s.hidden).map((s) => low(s.name));
    const i = st.indexOf(low(from));
    const j = st.indexOf(low(to));
    return i >= 0 && j >= 0 && i > j;
  });

  return (
    <div className="space-y-10">
      {/* Finder */}
      <section className="keep-navy rounded-[1.75rem] bg-gradient-to-br from-[#1c1d22] to-[#111216] text-white p-5 md:p-8">
        <h2 className="text-[20px] md:text-[22px] font-bold">{tx('Find your bus')}</h2>
        <p className="text-[14px] text-white/70 mt-1">{tx('Type your town, campus or junction. We show which bus stops there, when, and what it costs.')}</p>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <PlaceInput label={tx('From')} value={from} onChange={setFrom} list="guide-places" />
          <button type="button" onClick={() => { setFrom(to); setTo(from); }} aria-label={tx('Swap')} className="justify-self-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center">
            <ArrowUpDown className="w-4 h-4 md:rotate-90" />
          </button>
          <PlaceInput label={tx('To')} value={to} onChange={setTo} list="guide-places" />
          <datalist id="guide-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
        </div>

        {trips && (
          <div className="mt-5 space-y-2">
            {trips.length === 0 ? (
              <p className="rounded-2xl bg-white/5 border border-white/10 p-4 text-[14px] text-white/80">
                {backwards ? tx('Our buses go the other way between these two. Try swapping From and To.') : tx('No bus of ours stops at both of these. Check the spelling, or pick a place from the list.')}
              </p>
            ) : (
              trips.map(({ g, a, b, d }, k) => {
                const dep = at(d.time, a.offsetMin);
                const arr = at(d.time, b.offsetMin);
                const nextDay = Math.floor(arr / 1440) > Math.floor(dep / 1440);
                return (
                  <div key={k} className="rounded-2xl bg-white/[0.06] border border-white/10 p-4 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[18px] font-extrabold tabular-nums">
                        {clock(dep)} <span className="text-white/40">→</span> {clock(arr)}
                        {nextDay && <span className="text-[12px] font-semibold text-white/60"> {tx('(next day)')}</span>}
                      </p>
                      <p className="text-[13px] text-white/70 mt-0.5">
                        {formatDuration(b.offsetMin - a.offsetMin)} · {daysText(d, Math.floor(dep / 1440))} · {g.title}
                        {d.bus && <> · {d.bus.name}{d.bus.ac ? ` (${tx('AC')})` : ''}</>}
                      </p>
                      {(a.optional || b.optional) && (
                        <p className="text-[12px] font-semibold text-[#c4b5fd] mt-1">{tx('{stop} is an on-request stop: the bus goes there when enough seats are booked.', { stop: a.optional ? a.name : b.name })}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[18px] font-extrabold">{formatLKR(fareBetween(g, a, b))}</span>
                      <Link href={`/search?${new URLSearchParams({ from: a.name, to: b.name })}`} className="h-11 px-5 rounded-xl bg-[#feb700] text-[#050a44] text-[14px] font-bold flex items-center gap-1.5 hover:brightness-105">
                        {tx('Book')} <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
        {one && shown.length === 0 && <p className="mt-4 text-[14px] text-white/80">{tx('No bus of ours stops there. Check the spelling, or pick a place from the list.')}</p>}
      </section>

      {/* Routes */}
      <section>
        <h2 className="text-[22px] font-bold text-[#050a44]">{one && shown.length ? tx('Routes that stop at {place}', { place: places.find((p) => low(p) === one) ?? one }) : tx('Our routes')}</h2>
        <p className="text-[14px] text-[#46464f] mt-1 mb-4">{tx('Every stop with the time the bus gets there and the fare from the first stop.')}</p>
        <div className="space-y-4">
          {shown.map((g, k) => <RouteCard key={g.id} g={g} open={k === 0 || shown.length === 1} mark={one} />)}
        </div>
      </section>

      {/* Good to know */}
      <section>
        <h2 className="text-[22px] font-bold text-[#050a44] mb-4">{tx('Good to know')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Ticket, t: tx('Pick your seat'), d: tx('Book online and choose your exact seat on the seat map. Seats at the front are kept for female passengers.') },
            { icon: MapPin, t: tx('On-request stops'), d: tx('Marked in purple. The bus goes there only when enough seats are booked; if not, we move you to the nearest stop and text you.') },
            { icon: Clock, t: tx('Plans changed?'), d: tx('Cancel from My trips at least {h} hours before the bus leaves your stop and get {p}% back.', { h: OPERATOR.refundPolicy[0].hoursBefore, p: OPERATOR.refundPolicy[0].percent }) },
            { icon: Bus, t: tx('Track your bus'), d: tx('On the day, open your ticket to see where the bus is and when it reaches your stop.') },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="bg-white rounded-2xl border border-[#e1e2e4] p-4">
              <span className="w-9 h-9 rounded-xl bg-[#fff3cc] text-[#7c5800] flex items-center justify-center"><Icon className="w-5 h-5" /></span>
              <p className="text-[15px] font-bold text-[#050a44] mt-3">{t}</p>
              <p className="text-[13px] text-[#46464f] mt-1 leading-[1.55]">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PlaceInput({ label, value, onChange, list }: { label: string; value: string; onChange: (v: string) => void; list: string }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={list}
        placeholder={label}
        className="w-full h-12 pl-10 pr-10 rounded-xl bg-white/10 border border-white/15 text-[15px] text-white placeholder:text-white/50 outline-none focus:border-[#feb700]"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label={tx('Clear')} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>
      )}
    </label>
  );
}

function RouteCard({ g, open: startOpen, mark }: { g: Guide; open: boolean; mark: string | null }) {
  const [open, setOpen] = useState(startOpen);
  const [di, setDi] = useState(0);
  const stops = g.stops.filter((s) => !s.hidden);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const d = g.departures[Math.min(di, g.departures.length - 1)];
  const onRequest = stops.filter((s) => s.optional).length;
  const bus = d?.bus;
  return (
    <article className="bg-white rounded-2xl border border-[#e1e2e4] overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left p-4 md:p-5 flex items-start gap-4 hover:bg-[#f8f9fb] transition-colors">
        <span className="hidden sm:flex w-11 h-11 rounded-xl bg-[#050a44] text-[#feb700] items-center justify-center shrink-0 keep-navy"><Bus className="w-5 h-5" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-[18px] font-bold text-[#050a44]">{g.title}</span>
          <span className="block text-[13px] text-[#46464f] mt-0.5">
            {tx('{n} stops', { n: stops.length })} · {formatDuration(last.offsetMin - first.offsetMin)} · {tx('from {fare}', { fare: formatLKR(g.flat ? last.fareFromStart : Math.min(...stops.slice(1).map((s) => s.fareFromStart))) })}
            {onRequest > 0 && <> · <span className="text-[#6d28d9] font-semibold">{tx('{n} on request', { n: onRequest })}</span></>}
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {g.departures.map((x, k) => (
              <span key={k} className="h-7 px-2.5 rounded-full bg-[#f2f4f6] text-[12px] font-semibold text-[#050a44] flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[#7c5800]" /> {clock(at(x.time, 0))} · {daysText(x)}
              </span>
            ))}
          </span>
        </span>
        <ChevronDown className={`w-5 h-5 text-[#46464f] shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[#edeef0] grid grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
          <div className="p-4 md:p-5 lg:border-r border-[#edeef0] space-y-4">
            <StopsMap stops={g.stops} className="h-[260px] md:h-[340px] rounded-2xl overflow-hidden" />
            {bus && (
              <div className="rounded-2xl bg-[#f8f9fb] border border-[#edeef0] p-3 flex gap-3 items-center">
                {bus.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bus.photo} alt={bus.name} className="w-20 h-14 rounded-lg object-cover shrink-0" loading="lazy" />
                ) : (
                  <span className="w-20 h-14 rounded-lg bg-[#050a44] text-[#feb700] flex items-center justify-center shrink-0 keep-navy"><Bus className="w-6 h-6" /></span>
                )}
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold text-[#050a44]">{bus.name} · {bus.ac ? tx('AC luxury coach') : tx('Non-AC coach')}</span>
                  <span className="block text-[12px] text-[#46464f] mt-0.5">{[...bus.amenities.map((a) => tx(a)), ...(bus.bikes ? [tx('Bikes carried in the luggage compartment')] : [])].join(' · ')}</span>
                </span>
              </div>
            )}
          </div>

          <div className="p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-[15px] font-bold text-[#050a44]">{tx('Stops and times')}</h3>
              {g.departures.length > 1 && (
                <select value={di} onChange={(e) => setDi(Number(e.target.value))} aria-label={tx('Departure')} className="h-9 px-2 rounded-lg border border-[#e1e2e4] bg-white text-[13px] font-semibold text-[#050a44]">
                  {g.departures.map((x, k) => <option key={k} value={k}>{clock(at(x.time, 0))} · {daysText(x)}</option>)}
                </select>
              )}
            </div>
            <ol>
              {stops.map((s, i) => {
                const end = i === 0 || i === stops.length - 1;
                const hit = mark && low(s.name) === mark;
                const t = d ? at(d.time, s.offsetMin) : s.offsetMin;
                const dayLater = d && i > 0 && Math.floor(t / 1440) > Math.floor(at(d.time, 0) / 1440);
                return (
                  <li key={s.name} className={`flex gap-3 rounded-lg px-2 -mx-2 ${hit ? 'bg-[#fff3cc]' : ''}`}>
                    <span className="w-[66px] shrink-0 py-2 text-[12px] font-semibold text-[#46464f] tabular-nums">
                      {d ? clock(t) : formatDuration(s.offsetMin)}
                      {dayLater && <span className="block text-[10px] font-medium">{tx('next day')}</span>}
                    </span>
                    <span className="relative w-3 shrink-0 flex justify-center" aria-hidden>
                      {i > 0 && <span className="absolute top-0 h-3 w-[2px] bg-[#e1e2e4]" />}
                      {i < stops.length - 1 && <span className="absolute top-3 bottom-0 w-[2px] bg-[#e1e2e4]" />}
                      <span className={`relative mt-2.5 rounded-full ${end ? 'w-3 h-3 bg-[#050a44]' : s.optional ? 'w-2.5 h-2.5 bg-[#8b5cf6]' : 'w-2.5 h-2.5 bg-[#feb700]'}`} />
                    </span>
                    <span className="flex-1 min-w-0 py-1.5">
                      <span className={`block text-[14px] ${end ? 'font-bold text-[#050a44]' : 'font-semibold text-[#1b1c20]'}`}>{s.name}</span>
                      {s.optional && <span className="block text-[12px] font-semibold text-[#6d28d9]">{s.minSeats ? tx('On request: runs if {n}+ seats are booked', { n: s.minSeats }) : tx('On request')}</span>}
                      {s.landmark && <span className="block text-[12px] text-[#46464f]">{s.landmark}</span>}
                    </span>
                    <span className="shrink-0 py-2 text-[12px] font-semibold text-[#46464f] tabular-nums">{i === 0 ? '' : g.flat ? '' : formatLKR(s.fareFromStart)}</span>
                  </li>
                );
              })}
            </ol>
            {g.flat && <p className="mt-2 text-[12px] text-[#46464f]">{tx('One fare for any stop on this route: {fare}.', { fare: formatLKR(last.fareFromStart) })}</p>}
            {!g.flat && <p className="mt-2 text-[12px] text-[#46464f]">{tx('Fares are from {stop}. Between two other stops you pay the difference.', { stop: first.name })}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/search?${new URLSearchParams({ from: first.name, to: last.name })}`} className="h-10 px-4 rounded-xl bg-[#050a44] text-white text-[13px] font-bold flex items-center gap-1.5 keep-navy">
                {tx('Book on this route')} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}
      {g.pages.length > 0 && (
        <details className="group border-t border-[#edeef0] px-4 md:px-5 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-[#7c5800] list-none flex items-center gap-1">
            <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" /> {tx('Timetable page for each journey ({n})', { n: g.pages.length })}
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {g.pages.map((p) => (
              <li key={p.slug}>
                <Link href={`/bus/${p.slug}`} className="h-8 px-3 rounded-full border border-[#e1e2e4] text-[12px] font-semibold text-[#050a44] flex items-center hover:border-[#050a44]">
                  {tx('{from} to {to}', { from: p.from, to: p.to })}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
