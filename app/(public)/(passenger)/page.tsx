// app/(public)/(passenger)/page.tsx — single-operator landing page
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeftRight, Calendar, MapPin, Navigation, Phone, MessageCircle, Wind, Armchair, Usb, Wifi, ShieldCheck, Lightbulb, Mail } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { useStore } from '@/lib/store';
import { addDays, allStopNames, busCapacity, findTrips, formatDateLabel, formatDuration, formatLKR, formatTime12, routeLabel, todayISO } from '@/lib/trips';
import type { Route } from '@/lib/types';

const HERO_IMAGE = '/brand/bus.jpg';

const INTERIOR_CARDS = [
  { image: '/brand/interior.jpg', title: 'Reclining leather seats', subtitle: 'Room to sleep on the overnight run east' },
  { image: '/brand/poster.jpg', title: 'ND 2323, Siyan Lanka Travels', subtitle: 'Your coach, every trip' },
];

const AMENITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'Air conditioning': Wind,
  'Reclining seats': Armchair,
  'USB charging': Usb,
  'Wi-Fi': Wifi,
  'Reading lights': Lightbulb,
};

export default function LandingPage() {
  const router = useRouter();
  const { data, ready } = useStore();
  const stops = useMemo(() => allStopNames(data), [data]);
  const activeRoutes = data.routes.filter((r) => r.active);
  const firstRoute = activeRoutes[0];

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [activeCard, setActiveCard] = useState(0);
  const [paused, setPaused] = useState(false);

  // Default the search widget to the main route once data has loaded.
  useEffect(() => {
    if (!ready || !firstRoute) return;
    setFrom((f) => f || firstRoute.stops[0].name);
    setTo((t) => t || firstRoute.stops[firstRoute.stops.length - 1].name);
    setDate((d) => d || todayISO());
  }, [ready, firstRoute]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActiveCard((p) => (p + 1) % INTERIOR_CARDS.length), 3500);
    return () => clearInterval(id);
  }, [paused]);

  const weeklyDepartures = data.schedules.filter((s) => s.active).reduce((n, s) => n + s.days.length, 0);
  const activeBuses = data.buses.filter((b) => b.status === 'active');

  const search = () => {
    const qs = new URLSearchParams({ from, to, date: date || todayISO() });
    router.push(`/search?${qs.toString()}`);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const inputClass =
    'w-full pl-[48px] pr-[16px] py-2.5 md:py-3.5 rounded-2xl bg-white/10 border border-white/20 focus:bg-white focus:ring-2 focus:ring-[#feb700] focus:border-transparent transition-all outline-none text-white focus:text-[#191c1e] shadow-sm appearance-none';

  return (
    <div className="bg-[#f8f9fb] text-[#191c1e] selection:bg-[#dfe0ff] selection:text-[#0f144c]">
      <main>
        {/* Hero */}
        {/* Desktop: photo behind headline + search side by side.
            Phone/tablet: photo behind the headline only; the search form
            starts where the photo ends. */}
        <section className="relative w-full lg:min-h-[560px] lg:h-[calc(100dvh-80px)]">
          <div className="hidden lg:block absolute inset-0 z-0 overflow-hidden">
            <img alt="" className="w-full h-full object-cover object-[65%_center]" src={HERO_IMAGE} />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/15" />
          </div>

          <div className="relative z-10 h-full lg:px-16 lg:py-6 grid grid-cols-1 lg:grid-cols-2 lg:gap-[48px] items-center max-w-[1440px] mx-auto">
            <div className="relative overflow-hidden lg:overflow-visible text-center lg:text-left px-6 md:px-12 lg:px-0 pt-14 pb-14 md:pt-20 md:pb-20 lg:py-0">
              <div className="lg:hidden absolute inset-0" aria-hidden>
                <img alt="" className="w-full h-full object-cover object-[60%_center]" src={HERO_IMAGE} />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/55 to-black/80" />
              </div>
              <div className="relative">
              <p className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full mb-5 text-[13px] font-semibold">
                <ShieldCheck className="w-4 h-4 text-[#feb700]" />
                {weeklyDepartures} overnight departures a week
              </p>
              <h1 className="text-[36px] sm:text-[52px] lg:text-[64px] font-bold mb-4 lg:mb-6 leading-[1.05] tracking-tight text-white text-shadow-premium">
                {firstRoute ? (
                  <>
                    {firstRoute.stops[0].name} to {firstRoute.stops[firstRoute.stops.length - 1].name}, with a seat that&apos;s yours.
                  </>
                ) : (
                  <>Book your seat before you leave home.</>
                )}
              </h1>
              <p className="text-[16px] leading-[1.6] max-w-xl mx-auto lg:mx-0 text-white/90 text-shadow-premium">
                Board in Colombo at night, wake up in the East. Pick your seat, pay online and show the ticket on your phone.
              </p>
              </div>
            </div>

            <div className="relative w-full px-4 md:px-12 lg:px-0 pt-6 pb-2 lg:py-0">
              <div className="hero-glass-widget p-[16px] md:p-[28px] rounded-[2rem] relative">
                <datalist id="stop-names">
                  {stops.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-[10px] md:gap-[14px] mb-[10px] md:mb-[14px] items-end">
                  <div className="space-y-[6px]">
                    <label htmlFor="hero-from" className="text-[12px] font-semibold text-white/80 ml-1">
                      Boarding point
                    </label>
                    <div className="relative">
                      <MapPin className="w-5 h-5 absolute left-[16px] top-1/2 -translate-y-1/2 text-white/60" />
                      <input id="hero-from" list="stop-names" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} placeholder="Where from?" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={swap}
                    aria-label="Swap boarding and drop-off"
                    className="justify-self-center mb-1 p-2.5 rounded-full bg-white/15 border border-white/25 text-white hover:bg-white hover:text-[#050a44] transition-colors"
                  >
                    <ArrowLeftRight className="w-4 h-4 rotate-90 md:rotate-0" />
                  </button>
                  <div className="space-y-[6px]">
                    <label htmlFor="hero-to" className="text-[12px] font-semibold text-white/80 ml-1">
                      Drop-off point
                    </label>
                    <div className="relative">
                      <Navigation className="w-5 h-5 absolute left-[16px] top-1/2 -translate-y-1/2 text-white/60" />
                      <input id="hero-to" list="stop-names" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} placeholder="Where to?" />
                    </div>
                  </div>
                </div>
                <div className="space-y-[6px] mb-[14px] md:mb-[20px]">
                  <label htmlFor="hero-date" className="text-[12px] font-semibold text-white/80 ml-1">
                    Travel date
                  </label>
                  <div className="relative">
                    <Calendar className="w-5 h-5 absolute left-[16px] top-1/2 -translate-y-1/2 text-white/60" />
                    <input id="hero-date" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <button
                  onClick={search}
                  disabled={!from || !to}
                  className="w-full py-3.5 md:py-[18px] bg-[#feb700] text-[#050a44] rounded-2xl text-[17px] font-semibold hover:bg-white hover:shadow-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60"
                >
                  <span>Find buses</span>
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Timetable — the operator's real departures, with live seats left today */}
        <section id="timetable" className="py-[56px] bg-white border-b border-[#edeef0] scroll-mt-20">
          <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-8">
              <div>
                <h2 className="text-[28px] md:text-[36px] font-bold text-[#050a44] leading-[1.2]">Next departures</h2>
                <p className="text-[15px] text-[#46464f] mt-2 max-w-xl">Seats left update as people book. Tap a departure to choose your seat.</p>
              </div>
              <Link href="/search" className="text-[14px] font-bold text-[#050a44] hover:underline">
                Search a date
              </Link>
            </div>
            {!ready ? (
              <div className="h-48 rounded-2xl bg-[#f2f4f6] animate-pulse" />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {activeRoutes.map((route) => (
                  <TimetableCard key={route.id} route={route} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Stops along the way */}
        {firstRoute && (
          <section className="py-[56px] bg-[#fcfcfd]">
            <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-[#050a44] leading-[1.2] mb-2">Where we stop</h2>
              <p className="text-[15px] text-[#46464f] mb-10 max-w-xl">
                Get on or off at any of these. Fares shown from {firstRoute.stops[0].name}; you only pay for the part you ride.
              </p>
              <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
                <ol className="relative flex min-w-[1080px]">
                  <div className="absolute left-3 right-3 top-[11px] h-[3px] bg-[#050a44]/15 rounded-full" aria-hidden />
                  {firstRoute.stops.map((stop, i) => {
                    const ends = i === 0 || i === firstRoute.stops.length - 1;
                    return (
                      <li key={stop.name} className="relative flex-1 flex flex-col items-center text-center">
                        <span
                          className={`relative z-10 rounded-full border-4 border-[#fcfcfd] ${ends ? 'w-6 h-6 bg-[#050a44]' : 'w-6 h-6 bg-[#feb700]'}`}
                          aria-hidden
                        />
                        <span className="mt-3 text-[14px] font-bold text-[#050a44]">{stop.name}</span>
                        <span className="text-[12px] font-medium text-[#46464f]">{i === 0 ? 'Start' : formatDuration(stop.offsetMin)}</span>
                        {i > 0 && <span className="mt-1 text-[12px] font-bold text-[#7c5800]">{formatLKR(stop.fareFromStart)}</span>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </section>
        )}

        {/* Bikes in the luggage compartment */}
        {activeBuses.some((b) => b.bikeSpaces > 0) && (
          <section className="py-[56px] bg-white border-t border-[#edeef0]">
            <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-[40px] items-center">
              <div>
                <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#feb700]/15 text-[#7c5800] text-[12px] font-bold mb-4">
                  <span className="material-symbols-outlined text-[16px]">new_releases</span>
                  New
                </p>
                <h2 className="text-[28px] md:text-[40px] font-bold text-[#050a44] leading-[1.15] mb-4">Bring your bike with you</h2>
                <p className="text-[16px] leading-[1.7] text-[#46464f] max-w-lg">
                  Book a space in the luggage compartment when you book your seat. Upload a photo of the bike, and the crew will load it at your stop and have it ready when you get off.
                </p>
                <Link
                  href="/search"
                  className="inline-flex items-center gap-2 mt-7 px-7 py-4 bg-[#050a44] text-white rounded-2xl text-[16px] font-semibold hover:opacity-90"
                >
                  Book a seat and a bike space <ArrowRight className="w-5 h-5" />
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                {Object.values(OPERATOR.bikes.kinds).map((k) => (
                  <div key={k.label} className="rounded-2xl border border-[#c7c5d1] p-3 sm:p-5 bg-[#fcfcfd]">
                    <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[#050a44] text-[#feb700] flex items-center justify-center">
                      <span className="material-symbols-outlined text-[28px]">{k.icon}</span>
                    </span>
                    <p className="text-[14px] sm:text-[16px] font-bold text-[#050a44] mt-3 sm:mt-4 leading-tight">{k.label}</p>
                    <p className="text-[13px] text-[#46464f] mt-1">Up to {formatLKR(k.fullRouteFee)}</p>
                    <p className="text-[12px] text-[#686873] mt-0.5">Less for shorter trips</p>
                  </div>
                ))}
                <p className="col-span-3 text-[12px] text-[#46464f]">
                  Space is limited on each departure. Motorbike tanks no more than a quarter full.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* The coach + fleet */}
        <section className="py-[56px] bg-white overflow-hidden">
          <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-[48px] items-center">
            <div>
              <h2 className="text-[28px] md:text-[40px] font-bold text-[#050a44] leading-[1.15] mb-4">
                {activeBuses.length === 1 ? 'Our coach' : `Our ${activeBuses.length} coaches`}
              </h2>
              <p className="text-[16px] leading-[1.7] text-[#46464f] mb-8 max-w-lg">
                We run our own coach and keep it that way: cleaned between trips, serviced on schedule, driven by people who know Route 48 by heart.
              </p>
              <div className="space-y-4">
                {activeBuses.map((bus) => (
                  <div key={bus.id} className="rounded-2xl border border-[#edeef0] p-5 premium-shadow">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="text-[17px] font-bold text-[#050a44]">{bus.name}</p>
                        <p className="text-[13px] text-[#46464f]">
                          {bus.type} · {busCapacity(bus)} seats · {bus.regNo}
                        </p>
                      </div>
                      <span className="bg-[#feb700]/15 text-[#7c5800] text-[11px] px-2.5 py-1 rounded-full font-bold">{bus.type === 'AC' ? 'AC coach' : 'Non-AC'}</span>
                    </div>
                    <ul className="flex flex-wrap gap-2">
                      {bus.amenities.map((a) => {
                        const Icon = AMENITY_ICONS[a];
                        return (
                          <li key={a} className="flex items-center gap-1.5 text-[13px] font-medium text-[#050a44] bg-[#f2f4f6] rounded-full px-3 py-1.5">
                            {Icon && <Icon className="w-4 h-4" />}
                            {a}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-full max-w-[520px] mx-auto flex flex-col items-center">
              <div className="relative w-full aspect-[4/3]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
                {INTERIOR_CARDS.map((card, i) => {
                  const position = (i - activeCard + INTERIOR_CARDS.length) % INTERIOR_CARDS.length;
                  const style = [
                    { transform: 'rotate(-3deg) translate(0px, 0px) scale(1)', zIndex: 30, opacity: 1 },
                    { transform: 'rotate(4deg) translate(14px, -6px) scale(0.95)', zIndex: 20, opacity: 0.85 },
                    { transform: 'rotate(9deg) translate(28px, 10px) scale(0.9)', zIndex: 10, opacity: 0.6 },
                  ][position];
                  return (
                    <button
                      key={card.image}
                      type="button"
                      onClick={() => setActiveCard(i)}
                      aria-label={`Show ${card.title}`}
                      className="absolute inset-0 bg-white rounded-[2.5rem] overflow-hidden border border-[#edeef0] shadow-2xl transition-all duration-700 ease-out text-left"
                      style={style}
                    >
                      <img alt={card.title} className="w-full h-full object-cover" src={card.image} />
                      {position === 0 && (
                        <div className="absolute bottom-6 left-6 right-6 bg-black/40 backdrop-blur-md p-4 rounded-2xl border border-white/20">
                          <div className="text-white text-[14px] font-semibold mb-1">{card.title}</div>
                          <div className="text-white/75 text-[12px] font-medium">{card.subtitle}</div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-8">
                {INTERIOR_CARDS.map((card, i) => (
                  <button
                    key={card.image}
                    type="button"
                    onClick={() => setActiveCard(i)}
                    aria-label={`Show ${card.title}`}
                    className={`h-2 rounded-full transition-all duration-300 ${activeCard === i ? 'w-6 bg-[#050a44]' : 'w-2 bg-[#c7c5d1] hover:bg-[#9a99a8]'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it works — a real sequence, so numbering earns its place */}
        <section className="keep-navy py-[56px] bg-[#141519] text-white">
          <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto">
            <h2 className="text-[28px] md:text-[36px] font-bold leading-[1.2] mb-10">Booking takes about two minutes</h2>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                ['Choose a departure', 'Pick where you get on and off and the time that suits you.'],
                ['Pick your seat', 'See exactly which seats are free. Ladies-only seats are marked at the front.'],
                ['Show your ticket', 'Pay online and show the QR ticket to the conductor at Bastian Mawatha or your stop.'],
              ].map(([title, body], i) => (
                <li key={title} className="rounded-2xl bg-white/5 border border-white/10 p-6">
                  <span className="text-[40px] font-black text-[#feb700] leading-none">{i + 1}</span>
                  <h3 className="text-[18px] font-bold mt-4 mb-2">{title}</h3>
                  <p className="text-[14px] leading-[1.6] text-[#bdc2ff]">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Contact */}
        <section className="py-[56px] bg-white">
          <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto">
            <div className="rounded-[2.5rem] border border-[#edeef0] premium-shadow p-8 md:p-14 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
              <div className="max-w-xl">
                <h2 className="text-[28px] md:text-[36px] font-bold text-[#050a44] leading-[1.2] mb-3">Questions, or booking for a group?</h2>
                <p className="text-[16px] leading-[1.7] text-[#46464f]">
                  Get in touch and we&apos;ll hold seats for you. You can also buy tickets from our conductor at {OPERATOR.contact.address.split(',')[0]}.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                {OPERATOR.contact.phone ? (
                  <a href={OPERATOR.contact.phoneHref} className="flex items-center justify-center gap-2 px-7 py-4 bg-[#050a44] text-white rounded-2xl text-[16px] font-semibold hover:opacity-90">
                    <Phone className="w-5 h-5" /> {OPERATOR.contact.phone}
                  </a>
                ) : null}
                {OPERATOR.contact.whatsappHref ? (
                  <a href={OPERATOR.contact.whatsappHref} className="flex items-center justify-center gap-2 px-7 py-4 bg-white border border-[#c7c5d1] text-[#050a44] rounded-2xl text-[16px] font-semibold hover:bg-[#edeef0]">
                    <MessageCircle className="w-5 h-5" /> WhatsApp
                  </a>
                ) : null}
                <a href={`mailto:${OPERATOR.contact.email}`} className="flex items-center justify-center gap-2 px-7 py-4 bg-white border border-[#c7c5d1] text-[#050a44] rounded-2xl text-[16px] font-semibold hover:bg-[#edeef0]">
                  <Mail className="w-5 h-5" /> {OPERATOR.contact.email}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function TimetableCard({ route }: { route: Route }) {
  const { data } = useStore();
  const from = route.stops[0].name;
  const to = route.stops[route.stops.length - 1].name;
  const today = todayISO();
  const trips: ReturnType<typeof findTrips> = [];
  for (let i = 0; i < 21 && trips.length < 3; i++) {
    const d = addDays(today, i);
    trips.push(...findTrips(data, from, to, d).filter((t) => t.routeId === route.id && !t.closed));
  }
  const shown = trips.slice(0, 3);
  return (
    <div className="rounded-2xl border border-[#c7c5d1] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-[#f2f4f6]">
        <h3 className="text-[17px] font-bold text-[#050a44]">{routeLabel(route)}</h3>
        <span className="text-[13px] font-semibold text-[#46464f]">{formatLKR(route.stops[route.stops.length - 1].fareFromStart)}</span>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-[#46464f]">No departures in the next three weeks.</p>
      ) : (
        <ul className="divide-y divide-[#edeef0]">
          {shown.map((t) => {
            const href = `/seats/${t.scheduleId}?${new URLSearchParams({ from, to, date: t.date }).toString()}`;
            return (
              <li key={`${t.scheduleId}-${t.date}`}>
                <Link href={href} className="grid grid-cols-[1fr_auto] sm:grid-cols-[150px_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-[#f8f9fb]">
                  <span>
                    <span className="block text-[13px] font-semibold text-[#46464f]">{formatDateLabel(t.boardingDate, false)}</span>
                    <span className="block text-[20px] font-extrabold text-[#050a44] tabular-nums">{formatTime12(t.departure)}</span>
                  </span>
                  <span className="hidden sm:block text-[13px] text-[#46464f]">
                    Arrives {formatTime12(t.arrival)}{t.arrivalDayOffset ? ' next morning' : ''} · {formatDuration(t.durationMin)}
                  </span>
                  <span className={`text-[13px] font-bold whitespace-nowrap ${t.seatsLeft <= 5 ? 'text-[#ba1a1a]' : 'text-[#006e1c]'}`}>
                    {t.seatsLeft === 0 ? 'Full' : `${t.seatsLeft} seats left`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
