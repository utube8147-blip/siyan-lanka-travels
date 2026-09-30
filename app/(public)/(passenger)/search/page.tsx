// app/(public)/(passenger)/search/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OPERATOR } from '@/config/operator';
import { useStore } from '@/lib/store';
import { addDays, allStopNames, cityCode, formatDateLabel, findTrips, formatDuration, formatLKR, formatTime12, todayISO } from '@/lib/trips';
import type { Trip } from '@/lib/types';
import {
  MapPin,
  Calendar,
  ArrowLeftRight,
  Bus as BusIcon,
  Armchair,
  ChevronDown,
  ArrowUpDown,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { RouteMapOverlay, type RouteData, type RouteStop } from '@/components/RouteMapOverlay'

interface Schedule {
  id: string;
  operator: string;
  operatorInitials: string;
  busName: string;
  busType: 'AC' | 'Non-AC';
  departure: string; // display, e.g. 05:30 AM
  arrival: string;
  sortKey: string; // HH:MM for sorting
  durationLabel: string;
  stopLabel: string;
  seatsRemaining: number;
  fare: number;
  closed: boolean;
  trip: Trip;
}

function toSchedule(t: Trip): Schedule {
  return {
    id: t.scheduleId,
    operator: OPERATOR.name,
    operatorInitials: OPERATOR.initials,
    busName: `${t.bus.name} · ${t.bus.regNo}`,
    busType: t.bus.type,
    departure: formatTime12(t.departure),
    arrival: `${formatTime12(t.arrival)}${t.arrivalDayOffset ? ' +1' : ''}`,
    sortKey: t.departure,
    durationLabel: formatDuration(t.durationMin),
    stopLabel: t.via.length === 0 ? 'Non-stop' : `${t.via.length} stop${t.via.length > 1 ? 's' : ''}`,
    seatsRemaining: t.seatsLeft,
    fare: t.fare,
    closed: t.closed,
    trip: t,
  };
}

// Turns "6h 30m" into a rough mock distance, assuming ~55km/h average — purely
// cosmetic for the route overlay's stat row until real route data is wired in.
function estimateDistanceKm(durationLabel: string) {
  const hMatch = durationLabel.match(/(\d+)h/);
  const mMatch = durationLabel.match(/(\d+)m/);
  const hours = (hMatch ? parseInt(hMatch[1], 10) : 0) + (mMatch ? parseInt(mMatch[1], 10) : 0) / 60;
  return `${Math.round(hours * 55)} km`;
}

type DropdownKey = null;
type SortField = 'departure' | 'price';

// Fixed number of date pills — no longer computed from remaining flex space,
// so the strip never resizes when the filter pills next to it change width.
// The row scrolls horizontally instead (see date strip container below).
const DATE_STRIP_COUNT = 10;

export default function SearchPage() {
  return (
    <React.Suspense fallback={null}>
      <SearchPageInner />
    </React.Suspense>
  );
}

function SearchPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data, ready } = useStore();

  const initialFrom = searchParams.get('from') || '';
  const initialTo = searchParams.get('to') || '';
  const initialDate = searchParams.get('date') || todayISO();

  const [tripType, setTripType] = useState<'one-way' | 'round-trip'>('one-way');
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [date, setDate] = useState(initialDate);

  const [busTypeFilter, setBusTypeFilter] = useState<'all' | 'AC' | 'Non-AC'>('all');
  // The search only re-runs when "Search bus" is pressed (or a date is picked),
  // so half-typed place names don't flash "no results".
  const [query, setQuery] = useState({ from: initialFrom, to: initialTo });
  const stopNames = useMemo(() => allStopNames(data), [data]);

  // First visit with no query: default to the operator's main route.
  useEffect(() => {
    if (!ready || query.from || query.to) return;
    const r = data.routes.find((x) => x.active);
    if (!r) return;
    const f = r.stops[0].name;
    const t = r.stops[r.stops.length - 1].name;
    setFrom(f);
    setTo(t);
    setQuery({ from: f, to: t });
  }, [ready, data.routes, query.from, query.to]);

  const loading = !ready;
  const schedules = useMemo<Schedule[]>(
    () => (ready && query.from && query.to ? findTrips(data, query.from, query.to, date).map(toSchedule) : []),
    [data, ready, query, date],
  );

  // When nothing runs on the chosen date, point to the next day that does.
  const nextRunDate = useMemo(() => {
    if (!ready || !query.from || !query.to || schedules.length > 0) return null;
    for (let i = 1; i <= 14; i++) {
      const d = addDays(date, i);
      if (findTrips(data, query.from, query.to, d).some((t) => !t.closed)) return d;
    }
    return null;
  }, [ready, data, query, date, schedules.length]);

  const runSearch = (next = { from, to }) => {
    setQuery(next);
    const qs = new URLSearchParams({ from: next.from, to: next.to, date });
    router.replace(`/search?${qs.toString()}`, { scroll: false });
  };

  // --- Route map overlay state — holds the schedule whose route is being viewed, if any ---
  const [routeSchedule, setRouteSchedule] = useState<Schedule | null>(null);

  // --- Dropdown state (Fleet only — Price is now a plain toggle) ---
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // --- Date strip state ---
  const [dateWindowOffset, setDateWindowOffset] = useState(0);

  // --- Sort state (shared between Departure time & Price toggles) ---
  const [sortBy, setSortBy] = useState<SortField>('departure');
  const [sortAsc, setSortAsc] = useState(true);

  const dateStrip = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: DATE_STRIP_COUNT }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + dateWindowOffset + i);
      return d;
    });
  }, [dateWindowOffset]);


  const toISODate = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const formatStripDate = (d: Date) => {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const day = d.getDate().toString().padStart(2, '0');
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${weekday}, ${day} ${month}`;
  };

  // Compact pieces used for the mobile date card (day number over weekday abbreviation)
  const stripDayNumber = (d: Date) => d.getDate().toString().padStart(2, '0');
  const stripWeekdayShort = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const insideBar = filterBarRef.current?.contains(target);
      const insideMenu = menuPanelRef.current?.contains(target);
      if (!insideBar && !insideMenu) {
        setOpenDropdown(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenDropdown(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!openDropdown) return;
    const closeOnMove = () => setOpenDropdown(null);
    window.addEventListener('scroll', closeOnMove, true);
    window.addEventListener('resize', closeOnMove);
    return () => {
      window.removeEventListener('scroll', closeOnMove, true);
      window.removeEventListener('resize', closeOnMove);
    };
  }, [openDropdown]);

  const toggleDropdown = (key: Exclude<DropdownKey, null>, btnRef: React.RefObject<HTMLButtonElement | null>) => {
    setOpenDropdown((prev) => {
      if (prev === key) return null;
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuPos({ top: rect.bottom + 8, left: rect.left });
      }
      return key;
    });
  };

  // Toggle sort: clicking the active field flips direction, clicking the other field switches to it (ascending first).
  // Used by both the Departure time pill and the Price pill — both are plain toggles, no dropdown menus.
  const handleSort = (field: SortField) => {
    setSortBy((prevField) => {
      if (prevField === field) {
        setSortAsc((prevAsc) => !prevAsc);
        return prevField;
      }
      setSortAsc(true);
      return field;
    });
  };

  const filteredSchedules = useMemo(() => {
    const result = schedules.filter((s) => {
      if (busTypeFilter !== 'all' && s.busType !== busTypeFilter) return false;
      return true;
    });
    return result.sort((a, b) => {
      if (sortBy === 'price') {
        return sortAsc ? a.fare - b.fare : b.fare - a.fare;
      }
      return sortAsc ? a.sortKey.localeCompare(b.sortKey) : b.sortKey.localeCompare(a.sortKey);
    });
  }, [schedules, busTypeFilter, sortBy, sortAsc]);

  const swapCities = () => {
    setFrom(to);
    setTo(from);
    runSearch({ from: to, to: from });
  };

  const resetFilters = () => {
    setBusTypeFilter('all');
    setOpenDropdown(null);
  };

  const fromCode = cityCode(query.from);
  const toCode = cityCode(query.to);

  const activeFilterCount = busTypeFilter !== 'all' ? 1 : 0;

  // Builds the RouteMapOverlay's mock RouteData from a schedule + the current
  // from/to/via search fields. Swap this out for real stop/geo data later —
  // the overlay only cares about the shape below.
  const buildRouteData = (s: Schedule): RouteData => {
    const t = s.trip;
    const route = data.routes.find((r) => r.id === t.routeId);
    const all = route ? route.stops : [];
    const fi = all.findIndex((x) => x.name === t.from);
    const ti = all.findIndex((x) => x.name === t.to);
    const segment = fi >= 0 && ti > fi ? all.slice(fi, ti + 1) : [];
    const span = segment.length > 1 ? segment[segment.length - 1].offsetMin - segment[0].offsetMin : 1;
    const depMin = parseInt(t.departure.slice(0, 2), 10) * 60 + parseInt(t.departure.slice(3), 10);
    const stops: RouteStop[] = segment.map((x, i) => {
      const mins = depMin + (x.offsetMin - segment[0].offsetMin);
      const hhmm = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      return {
        id: `${i}-${x.name}`,
        name: x.name,
        time: formatTime12(hhmm),
        progress: Math.round(((x.offsetMin - segment[0].offsetMin) / span) * 100),
        status: i === 0 ? 'passed' : 'upcoming',
      };
    });

    return {
      busNumber: t.bus.regNo,
      origin: t.from,
      destination: t.to,
      departureTime: s.departure,
      arrivalTime: s.arrival,
      duration: s.durationLabel,
      distance: estimateDistanceKm(s.durationLabel),
      busProgress: 8,
      stops,
    };
  };

  return (
    <div className="bg-[#f2f4f7] min-h-screen overflow-x-hidden">
      <main className="max-w-[1440px] mx-auto px-3 sm:px-4 md:px-[32px] py-4 sm:py-8">
        <div className="bg-white rounded-2xl sm:rounded-[24px] shadow-sm overflow-hidden border border-[#e1e2e4]/60">
          {/* Search Bar */}
          <section className="p-4 sm:p-6 md:p-8 bg-white border-b border-[#e1e2e4]/60">
            <datalist id="search-stop-names">
              {stopNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <div className="flex flex-col md:grid md:grid-cols-[1fr_auto_1fr_1fr_auto] gap-3 sm:gap-4 md:items-end">
              {/* Boarding + swap + drop-off — always one compact row on mobile.
                  md:contents makes this wrapper "disappear" at the md breakpoint so
                  its 3 children slot directly into the outer 6-column desktop grid,
                  keeping the original desktop layout exactly as it was. */}
              <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-end md:contents">
                <div className="space-y-1 sm:space-y-2 min-w-0">
                  <label className="text-[10px] sm:text-[12px] font-bold text-[#46464f] px-1">Boarding point</label>
                  <div className="relative">
                    <MapPin className="w-3.5 h-3.5 sm:w-5 sm:h-5 absolute left-2.5 sm:left-4 top-1/2 -translate-y-1/2 text-[#c7c5d1]" />
                    <input
                      value={from}
                      list="search-stop-names"
                      aria-label="Boarding point"
                      onChange={(e) => setFrom(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                      className="w-full pl-7 sm:pl-12 pr-2 sm:pr-4 py-2 sm:py-3.5 bg-[#f1f3f9]/60 border-none rounded-xl text-xs sm:text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
                      type="text"
                    />
                  </div>
                </div>

                <div className="flex md:block justify-center pb-1">
                  <button
                    onClick={swapCities}
                    className="bg-[#050a44] text-white p-1.5 sm:p-2.5 rounded-full hover:scale-105 transition-transform shadow-sm"
                    aria-label="Swap boarding and drop-off points"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 sm:w-5 sm:h-5 md:rotate-0 rotate-90" />
                  </button>
                </div>

                <div className="space-y-1 sm:space-y-2 min-w-0">
                  <label className="text-[10px] sm:text-[12px] font-bold text-[#46464f] px-1">Drop-off point</label>
                  <div className="relative">
                    <MapPin className="w-3.5 h-3.5 sm:w-5 sm:h-5 absolute left-2.5 sm:left-4 top-1/2 -translate-y-1/2 text-[#c7c5d1]" />
                    <input
                      value={to}
                      list="search-stop-names"
                      aria-label="Drop-off point"
                      onChange={(e) => setTo(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                      className="w-full pl-7 sm:pl-12 pr-2 sm:pr-4 py-2 sm:py-3.5 bg-[#f1f3f9]/60 border-none rounded-xl text-xs sm:text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
                      type="text"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[12px] font-bold text-[#46464f] px-1">Departure date</label>
                <div className="relative">
                  <Calendar className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[#c7c5d1]" />
                  <input
                    value={date}
                    min={todayISO()}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-[#f1f3f9]/60 border-none rounded-xl text-sm font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
                    type="date"
                  />
                </div>
              </div>

              <div className="pb-1">
                <button
                  onClick={() => runSearch()}
                  className="w-full md:w-auto h-[52px] px-8 bg-[#050a44] text-white rounded-xl font-bold text-sm hover:opacity-90 transition-all shadow-sm whitespace-nowrap"
                >
                  Search bus
                </button>
              </div>
            </div>
          </section>

          {/*
            Filters — on desktop/laptop this is a single row: filter pills on the left,
            date strip filling the remaining space on the right, each scrolling
            independently so neither one resizes the other when a filter is toggled.
            Only on mobile (below md) do the two groups stack into separate rows,
            since there isn't enough width to show both comfortably on one line.
          */}
          <section className="px-4 sm:px-6 md:px-8 py-3 sm:py-4 bg-white border-b border-[#e1e2e4]/60">
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
            {/* Filter pills */}
            <div ref={filterBarRef} className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto no-scrollbar md:shrink-0">
              {/* Departure time sort — plain toggle */}
              <button
                onClick={() => handleSort('departure')}
                className={`flex items-center gap-1.5 sm:gap-2 pl-3 sm:pl-4 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-bold border transition-colors whitespace-nowrap shrink-0 ${
                  sortBy === 'departure'
                    ? 'border-[#050a44] bg-[#050a44] text-white'
                    : 'border-[#e1e2e4] bg-white text-[#050a44] hover:bg-[#f1f3f9]'
                }`}
              >
                <ArrowUpDown
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform ${
                    sortBy === 'departure' && !sortAsc ? 'rotate-180' : ''
                  } ${sortBy === 'departure' ? 'text-white/70' : 'text-[#c7c5d1]'}`}
                />
                Departure time
              </button>

              {/* Price sort — plain toggle, same pattern as Departure time (no dropdown) */}
              <button
                onClick={() => handleSort('price')}
                className={`flex items-center gap-1.5 sm:gap-2 pl-3 sm:pl-4 pr-3 sm:pr-4 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-bold border transition-colors whitespace-nowrap shrink-0 ${
                  sortBy === 'price'
                    ? 'border-[#050a44] bg-[#050a44] text-white'
                    : 'border-[#e1e2e4] bg-white text-[#050a44] hover:bg-[#f1f3f9]'
                }`}
              >
                <ArrowUpDown
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform ${
                    sortBy === 'price' && !sortAsc ? 'rotate-180' : ''
                  } ${sortBy === 'price' ? 'text-white/70' : 'text-[#c7c5d1]'}`}
                />
                Price
              </button>

              {/* Bus Type — two compact toggle pills instead of a 3-way segmented control.
                  Tapping a selected type again clears it back to "all", so there's no
                  need for a separate "All" pill — saves roughly a third of the width
                  this control used to take on mobile. */}
              <div className="hidden sm:flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setBusTypeFilter((prev) => (prev === 'AC' ? 'all' : 'AC'))}
                  className={`px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-[10px] sm:text-sm font-bold whitespace-nowrap border transition-colors ${
                    busTypeFilter === 'AC'
                      ? 'border-[#050a44] bg-[#050a44] text-white'
                      : 'border-[#e1e2e4] bg-white text-[#46464f] hover:bg-[#f1f3f9]'
                  }`}
                >
                  AC
                </button>
                <button
                  onClick={() => setBusTypeFilter((prev) => (prev === 'Non-AC' ? 'all' : 'Non-AC'))}
                  className={`px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-full text-[10px] sm:text-sm font-bold whitespace-nowrap border transition-colors ${
                    busTypeFilter === 'Non-AC'
                      ? 'border-[#050a44] bg-[#050a44] text-white'
                      : 'border-[#e1e2e4] bg-white text-[#46464f] hover:bg-[#f1f3f9]'
                  }`}
                >
                  <span className="sm:hidden">Non</span>
                  <span className="hidden sm:inline">Non-AC</span>
                </button>
              </div>

              {/* Compact AC toggle — fills the empty space on narrow mobile widths,
                  where the full AC/Non-AC control above is hidden. Placed before
                  Reset so Reset always stays as the last pill in the row. Hidden
                  again from sm up, since the full control is visible by then. */}
              <button
                onClick={() => setBusTypeFilter((prev) => (prev === 'AC' ? 'all' : 'AC'))}
                aria-pressed={busTypeFilter === 'AC'}
                className={`sm:hidden shrink-0 px-3 py-2 rounded-full text-xs font-bold border transition-colors ${
                  busTypeFilter === 'AC'
                    ? 'border-[#050a44] bg-[#050a44] text-white'
                    : 'border-[#e1e2e4] bg-white text-[#46464f] hover:bg-[#f1f3f9]'
                }`}
              >
                AC
              </button>

              {/* Reset / remove filters — compact, icon-first */}
              <button
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
                aria-label="Reset filters"
                className={`flex items-center gap-1.5 pl-2.5 sm:pl-3 pr-2.5 sm:pr-3 py-2 sm:py-2.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                  activeFilterCount > 0
                    ? 'text-[#E74C3C] border border-[#E74C3C]/30 bg-[#E74C3C]/5 hover:bg-[#E74C3C]/10'
                    : 'text-[#c7c5d1] border border-[#e1e2e4] cursor-not-allowed'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  Reset{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </span>
              </button>
            </div>

            {/* Date strip — sits inline to the right of the pills on desktop; own row on mobile */}
            <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 md:flex-1 md:justify-end">
              <button
                onClick={() => setDateWindowOffset((o) => Math.max(0, o - 1))}
                className="p-1.5 sm:p-2 rounded-full text-[#46464f] hover:bg-[#f1f3f9] transition-colors shrink-0"
                aria-label="Earlier dates"
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <div className="flex items-center gap-1.5 sm:gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1">
                {dateStrip.map((d) => {
                  const iso = toISODate(d);
                  const isSelected = iso === date;
                  return (
                    <button
                      key={iso}
                      onClick={() => setDate(iso)}
                      className={`flex flex-col sm:block items-center justify-center gap-0.5 w-11 sm:w-auto px-0 sm:px-4 py-1.5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-colors shrink-0 ${
                        isSelected
                          ? 'bg-[#050a44] text-white'
                          : 'text-[#46464f] hover:bg-[#f1f3f9]'
                      }`}
                    >
                      {/* Mobile: compact card — day number over weekday abbreviation */}
                      <span className="sm:hidden text-base font-extrabold leading-none">
                        {stripDayNumber(d)}
                      </span>
                      <span
                        className={`sm:hidden text-[9px] font-bold uppercase tracking-wide leading-none ${
                          isSelected ? 'text-white/70' : 'text-[#9a9ba5]'
                        }`}
                      >
                        {stripWeekdayShort(d)}
                      </span>
                      {/* Desktop/tablet: full "Sun, 05 Jul" pill */}
                      <span className="hidden sm:inline">{formatStripDate(d)}</span>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setDateWindowOffset((o) => o + 1)}
                className="p-1.5 sm:p-2 rounded-full text-[#46464f] hover:bg-[#f1f3f9] transition-colors shrink-0"
                aria-label="Later dates"
              >
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            </div>
          </section>

          {/* Results list */}
          <div className="p-4 sm:p-6 md:p-8 bg-white">
            <div className="flex justify-between items-center mb-6 sm:mb-8 px-1 sm:px-2 flex-wrap gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-[#050a44]">
                Buses from {query.from} to {query.to}
              </h1>
              <span className="text-sm font-semibold text-[#46464f]">
                {filteredSchedules.length} result{filteredSchedules.length !== 1 ? 's' : ''} found
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#edeef0] border-t-[#050a44]"></div>
              </div>
            ) : schedules.length === 0 ? (
              <div className="py-20 text-center max-w-md mx-auto">
                <p className="text-[#050a44] text-lg font-bold">No departures from {query.from} to {query.to} on this date</p>
                {nextRunDate ? (
                  <button
                    onClick={() => setDate(nextRunDate)}
                    className="mt-5 px-6 py-3 bg-[#050a44] text-white rounded-xl text-sm font-bold hover:opacity-90"
                  >
                    Next bus: {formatDateLabel(nextRunDate, false)}
                  </button>
                ) : (
                  <p className="text-[#46464f] text-sm mt-2">
                    We stop at {stopNames.join(', ')}. Check the spelling of your stops.
                  </p>
                )}
              </div>
            ) : filteredSchedules.length === 0 ? (
              <div className="py-24 text-center">
                <p className="text-[#46464f] text-lg">No buses match your filters</p>
                <button onClick={resetFilters} className="mt-4 text-[#050a44] font-bold hover:underline">
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                {filteredSchedules.map((s) => (
                  <div
                    key={s.id}
                    className="bg-white rounded-xl border border-[#c7c5d1] shadow-sm p-[24px] hover:shadow-md transition-shadow"
                  >
                    {/* Header: navy OperatorBadge + gold class pill, same pattern as
                        dashboard/my-bookings/marketplace ticket rows */}
                    <div className="flex justify-between items-center mb-[20px]">
                      <div className="flex items-center gap-[12px]">
                        <div className="w-11 h-11 rounded-lg bg-[#050a44] text-white flex items-center justify-center text-[13px] font-bold flex-shrink-0">
                          {s.operatorInitials}
                        </div>
                        <div>
                          <p className="text-[15px] font-bold text-[#050a44]">{s.operator}</p>
                          <p className="text-[12px] font-medium text-[#46464f]">{s.busName}</p>
                        </div>
                      </div>
                      <span className="inline-block bg-[#feb700]/15 text-[#7c5800] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                        {s.busType === 'AC' ? 'AC Bus' : 'Non-AC Bus'}
                      </span>
                    </div>

                    {/* Route visualization — click to open the route map overlay for this bus.
                        Wrapped in the bg-[#f2f4f6] rounded-xl panel used for boarding/drop-off
                        on the seats page and the route blocks on dashboard + my-bookings. */}
                    <button
                      type="button"
                      onClick={() => setRouteSchedule(s)}
                      title="View route on map"
                      className="w-full flex justify-between items-center bg-[#f2f4f6] rounded-xl p-[16px] mb-[16px] group cursor-pointer"
                    >
                      <div className="text-left">
                        <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{s.trip.from}</p>
                        <p className="text-[20px] font-extrabold text-[#050a44]">{fromCode}</p>
                        <p className="text-[12px] font-medium text-[#46464f] mt-0.5">{s.departure}</p>
                      </div>
                      <div className="flex-1 px-[16px] flex flex-col items-center">
                        <span className="text-[11px] font-bold text-[#46464f] mb-1 group-hover:text-[#050a44] transition-colors">
                          {s.durationLabel}
                        </span>
                        <div className="relative w-full border-t border-dashed border-[#c7c5d1] group-hover:border-[#050a44] transition-colors">
                          <BusIcon className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-[#f2f4f6] px-0.5 text-[#050a44]" />
                        </div>
                        <span className="text-[11px] font-bold text-[#46464f] mt-2">
                          {s.stopLabel}
                        </span>
                        <span className="text-[10px] font-bold text-[#050a44] mt-1 tracking-wide uppercase group-hover:underline">
                          View route
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-bold text-[#46464f] uppercase tracking-wide mb-1">{s.trip.to}</p>
                        <p className="text-[20px] font-extrabold text-[#050a44]">{toCode}</p>
                        <p className="text-[12px] font-medium text-[#46464f] mt-0.5">{s.arrival}</p>
                      </div>
                    </button>

                    {/* Footer: seats + price + CTA, same button treatment as
                        Buy Now / Grab Now / Select Seats elsewhere in the app */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-[6px]">
                        <Armchair className="w-[18px] h-[18px] text-[#46464f]" />
                        <span className={`text-[13px] font-bold ${s.seatsRemaining <= 5 ? 'text-[#ba1a1a]' : 'text-[#46464f]'}`}>
                          {s.seatsRemaining === 0 ? 'Full' : `${s.seatsRemaining} seats left`}
                        </span>
                        {s.trip.bikeSpaces > 0 && (
                          <span
                            className={`ml-2 inline-flex items-center gap-1 text-[12px] font-bold rounded-full px-2 py-0.5 ${
                              s.trip.bikeSpacesLeft > 0 ? 'bg-[#feb700]/15 text-[#7c5800]' : 'bg-[#e1e2e4] text-[#777680]'
                            }`}
                            title="Space for bikes in the luggage compartment"
                          >
                            <span className="material-symbols-outlined text-[15px]">two_wheeler</span>
                            {s.trip.bikeSpacesLeft > 0 ? 'Bike space' : 'No bike space'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-[16px]">
                        <p className="text-[22px] font-extrabold text-[#050a44]">{formatLKR(s.fare)}</p>
                        {s.closed || s.seatsRemaining === 0 ? (
                          <span className="bg-[#e1e2e4] text-[#46464f] rounded-xl px-6 py-2.5 text-[13px] font-bold whitespace-nowrap">
                            {s.closed ? 'Booking closed' : 'Sold out'}
                          </span>
                        ) : (
                          <Link
                            href={`/seats/${s.id}?${new URLSearchParams({ from: s.trip.from, to: s.trip.to, date: s.trip.date }).toString()}`}
                            className="bg-[#050a44] text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-90 active:scale-95 transition-all whitespace-nowrap"
                          >
                            Select seats
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Route map overlay — mock map for now, opens when a card's route row is clicked */}
      {routeSchedule && (
        <RouteMapOverlay
          isOpen={!!routeSchedule}
          onClose={() => setRouteSchedule(null)}
          route={buildRouteData(routeSchedule)}
        />
      )}
    </div>
  );
}