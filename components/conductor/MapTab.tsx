'use client';
// Conductor app → Map tab.
//   - Tonight's stops: only where someone gets on or off, in the order the bus
//     will take them. The conductor can move them up or down, or let the app
//     put the drop-offs nearest-first from where the bus is; the road and the
//     time are redrawn. The order is kept on this phone for this trip.
//   - On-request stops: how many have booked, and whether the detour runs.
//   - Road reports from every conductor: report what you see, confirm or clear
//     what others reported. A warning comes up when the bus gets close to one.
//   - Any route or draft from Routes & timetable can be laid over the map.

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowDown, ArrowUp, Check, ChevronDown, Crosshair, ExternalLink, Layers, Navigation, Plus, RotateCcw, Shuffle, X } from 'lucide-react';
import {
  REPORT_KINDS, applyOrder, isLive, kindOf, kmBetween, minutesToStop, nearestFirst, reportRoad, saveOrder, savedOrder, tonightsStops, useMyPosition, useNearbyAlerts, useOptionalStatus, useRoadReports, voteReport,
  type ReportKind, type RoadReport,
} from '@/lib/conductor';
import { fetchRoadRoute } from '@/lib/routing';
import { googleMapsParts } from '@/lib/routeShare';
import { loadPlans, type RoutePlan } from '@/lib/routeEditor';
import { formatDuration, formatTime12, routeLabel } from '@/lib/trips';
import { tx, txn } from '@/lib/i18n';
import type { Booking, Route, Schedule, StoreData } from '@/lib/types';

const ConductorMap = dynamic(() => import('./ConductorMap').then((m) => m.ConductorMap), { ssr: false, loading: () => <div className="w-full h-full bg-[#1a1b1f] animate-pulse" /> });

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? tx('just now') : m < 60 ? tx('{m} min ago', { m }) : tx('{h} h ago', { h: Math.round(m / 60) });
};

export function MapTab({
  data,
  route,
  schedule,
  date,
  bookings,
  userName,
  toast,
}: {
  data: StoreData;
  route: Route;
  schedule: Schedule;
  date: string;
  bookings: Booking[];
  userName: string;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
}) {
  const { here, problem } = useMyPosition(true);
  const { reports, error: reportsError, reload } = useRoadReports();
  const live = useMemo(() => reports.filter((r) => isLive(r)), [reports]);
  const near = useNearbyAlerts(here, live);
  const optional = useOptionalStatus(route, schedule.id, date, bookings);

  // ---- tonight's stops, in the conductor's order
  const base = useMemo(() => tonightsStops(route, bookings, optional), [route, bookings, optional]);
  const [order, setOrder] = useState<string[] | null>(() => savedOrder(schedule.id, date));
  useEffect(() => setOrder(savedOrder(schedule.id, date)), [schedule.id, date]);
  const stops = useMemo(() => applyOrder(base, order), [base, order]);
  const changeOrder = (names: string[] | null) => {
    setOrder(names);
    saveOrder(schedule.id, date, names);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    const names = stops.map((s) => s.name);
    [names[i], names[j]] = [names[j], names[i]];
    changeOrder(names);
  };
  const inRouteOrder = !order || stops.every((s, i) => s.name === base[i]?.name);

  // ---- the road through them (from the bus, when we know where it is)
  const [road, setRoad] = useState<{ path: [number, number][]; km: number; min: number } | null>(null);
  const [roadBusy, setRoadBusy] = useState(false);
  const [fromBus, setFromBus] = useState(false);
  // In route order the road also goes through the office's shaping points (hidden stops),
  // so it follows the exact way the route was drawn.
  const tonight = new Set(stops.map((s) => s.name.toLowerCase()));
  const pins = (inRouteOrder ? route.stops.filter((s) => s.hidden || tonight.has(s.name.toLowerCase())) : stops)
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => [s.lat!, s.lng!] as [number, number]);
  const pinKey = pins.map((p) => p.join(',')).join(';') + (fromBus && here ? `|${here.lat.toFixed(3)},${here.lng.toFixed(3)}` : '');
  useEffect(() => {
    const pts = fromBus && here ? [[here.lat, here.lng] as [number, number], ...pins] : pins;
    if (pts.length < 2) return setRoad(null);
    const ctl = new AbortController();
    setRoadBusy(true);
    const t = setTimeout(() => {
      fetchRoadRoute(pts, ctl.signal)
        .then(({ route: r }) => setRoad(r ? { path: r.path, km: r.distanceKm, min: r.durationMin * 1.25 } : null))
        .finally(() => setRoadBusy(false));
    }, 600);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [pinKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- map state
  const [follow, setFollow] = useState(false);
  const [compare, setCompare] = useState<{ label: string; stops: { name: string; lat: number; lng: number }[] } | null>(null);
  const [picker, setPicker] = useState(false);
  const [reporting, setReporting] = useState<null | { at: { lat: number; lng: number } | null }>(null);
  const [placing, setPlacing] = useState(false);
  const [openReport, setOpenReport] = useState<RoadReport | null>(null);

  const [alertsPerm, setAlertsPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setAlertsPerm(Notification.permission);
  }, []);

  const startReport = () => setReporting({ at: here ? { lat: here.lat, lng: here.lng } : null });

  const mapsLinks = googleMapsParts(fromBus && here ? [{ name: tx('Bus'), lat: here.lat, lng: here.lng }, ...stops] : stops);

  return (
    <div className="space-y-4">
      {/* Map */}
      <div className="relative -mx-4 h-[52vh] min-h-[300px] border-y border-white/10">
        <ConductorMap
          className="h-full"
          stops={stops}
          path={road?.path ?? null}
          here={here}
          reports={live}
          compare={compare?.stops ?? null}
          follow={follow}
          placing={placing}
          onPlace={(p) => {
            setPlacing(false);
            setReporting({ at: p });
          }}
          onReport={setOpenReport}
          onStop={() => {}}
          onUserMove={() => setFollow(false)}
        />
        {placing && (
          <div className="absolute top-3 inset-x-3 z-[500] rounded-xl bg-[#feb700] text-[#14120a] px-3 py-2 text-[13px] font-bold flex items-center justify-between gap-2 shadow-lg">
            {tx('Tap the map where it is')}
            <button onClick={() => setPlacing(false)} aria-label={tx('Cancel')} className="w-8 h-8 rounded-lg bg-black/10 flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
        )}
        <div className="absolute right-3 top-3 z-[500] flex flex-col gap-2">
          <button onClick={() => setFollow((f) => !f)} disabled={!here} aria-pressed={follow} aria-label={tx('Keep the bus in view')}
            className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-lg border ${follow ? 'bg-[#3b82f6] border-[#3b82f6] text-white' : 'bg-[#111216]/90 border-white/15 text-white'} disabled:opacity-40`}>
            <Crosshair className="w-5 h-5" />
          </button>
          <button onClick={() => setPicker(true)} aria-label={tx('Show an office route')} className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-lg border ${compare ? 'bg-[#93c5fd] border-[#93c5fd] text-[#0d0e11]' : 'bg-[#111216]/90 border-white/15 text-white'}`}>
            <Layers className="w-5 h-5" />
          </button>
        </div>
        <button onClick={startReport} className="absolute right-3 bottom-4 z-[500] h-14 pl-4 pr-5 rounded-2xl bg-[#dc2626] text-white text-[15px] font-bold flex items-center gap-2 shadow-[0_10px_30px_-8px_rgba(220,38,38,.8)] active:scale-95 transition-transform">
          <Plus className="w-5 h-5" /> {tx('Report')}
        </button>
      </div>

      {problem && <p className="rounded-xl bg-[#b3261e]/25 text-[#ffb4ab] px-3 py-2 text-[13px] font-semibold">{problem}</p>}

      {/* Close to a report */}
      {near.length > 0 && (
        <div role="alert" className="rounded-2xl bg-[#dc2626]/20 border border-[#dc2626]/50 p-3 space-y-1">
          {near.slice(0, 3).map(({ report, km }) => (
            <button key={report.id} onClick={() => setOpenReport(report)} className="w-full text-left flex items-center gap-3">
              <span className="text-[22px]" aria-hidden>{kindOf(report.kind).icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold">{tx('{kind} ahead', { kind: tx(kindOf(report.kind).label) })}</span>
                <span className="block text-[12px] text-white/70 truncate">{tx('About {km} km from the bus.', { km: km.toFixed(1) })} {report.note}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {compare && (
        <div className="flex items-center gap-2 rounded-xl bg-[#93c5fd]/15 border border-[#93c5fd]/40 px-3 py-2 text-[13px]">
          <span className="w-3 h-3 rounded-full border-2 border-[#93c5fd] shrink-0" aria-hidden />
          <span className="flex-1 min-w-0 truncate">{tx('Showing: {name}', { name: compare.label })}</span>
          <button onClick={() => setCompare(null)} className="font-semibold text-[#93c5fd]">{tx('Hide')}</button>
        </div>
      )}

      {/* Tonight's stops */}
      <section className="rounded-2xl bg-white/[0.05] border border-white/10">
        <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-bold">{tx('Tonight’s stops')}</h2>
            <p className="text-[12px] text-white/60">{tx('Only where someone gets on or off. ↑ getting on, ↓ getting off.')}</p>
          </div>
          {road && (
            <p className="text-right shrink-0">
              <span className="block text-[18px] font-bold tabular-nums">{road.km.toFixed(0)} km</span>
              <span className="block text-[12px] text-white/60">{roadBusy ? tx('working out the road…') : tx('about {dur}', { dur: formatDuration(Math.round(road.min)) })}</span>
            </p>
          )}
        </div>
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          <button onClick={() => changeOrder(nearestFirst(stops, here ? { lat: here.lat, lng: here.lng } : null).map((s) => s.name))}
            className="h-9 px-3 rounded-lg bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><Shuffle className="w-4 h-4" />{tx('Nearest drop-off first')}</button>
          {!inRouteOrder && (
            <button onClick={() => changeOrder(null)} className="h-9 px-3 rounded-lg bg-white/10 text-[13px] font-semibold flex items-center gap-1.5"><RotateCcw className="w-4 h-4" />{tx('Route order')}</button>
          )}
          <label className="h-9 px-3 rounded-lg bg-white/10 text-[13px] font-semibold flex items-center gap-2">
            <input type="checkbox" checked={fromBus} disabled={!here} onChange={(e) => setFromBus(e.target.checked)} className="accent-[#feb700]" />
            {tx('From the bus')}
          </label>
        </div>
        {stops.length === 0 ? (
          <p className="px-4 pb-4 text-[14px] text-white/60">{tx('No passengers booked on this departure yet.')}</p>
        ) : (
          <ol className="divide-y divide-white/10 border-t border-white/10">
            {stops.map((s, i) => {
              const due = minutesToStop(date, schedule.departure, s.offsetMin);
              const dist = here && s.lat != null && s.lng != null ? kmBetween(here, { lat: s.lat, lng: s.lng }) : null;
              return (
                <li key={s.name} className="flex items-center gap-3 px-4 py-3">
                  <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold text-[#0d0e11] ${i === 0 || i === stops.length - 1 ? 'bg-white' : s.optional ? 'bg-[#a78bfa]' : 'bg-[#feb700]'}`}>{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold truncate">{s.name}</span>
                    <span className="block text-[12px] text-white/60">
                      {[
                        s.on ? `↑${s.on}` : '',
                        s.off ? `↓${s.off}` : '',
                        formatTime12(addMinutes(schedule.departure, s.offsetMin)),
                        dist != null ? `${dist.toFixed(dist < 10 ? 1 : 0)} km` : '',
                        s.optional ? tx('on request') : '',
                        s.lat == null ? tx('no map pin') : '',
                      ].filter(Boolean).join(' · ')}
                      {due > 0 && due < 90 && <span className="text-[#9be8ad]"> · {tx('in {m} min', { m: due })}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 flex gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={tx('Move {name} up', { name: s.name })} className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center disabled:opacity-25"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label={tx('Move {name} down', { name: s.name })} className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center disabled:opacity-25"><ArrowDown className="w-4 h-4" /></button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {mapsLinks.length > 0 && (
          <div className="px-4 py-3 border-t border-white/10 flex flex-wrap gap-2">
            {mapsLinks.map((p, i) => (
              <a key={p.url} href={p.url} target="_blank" rel="noopener" className="h-10 px-3 rounded-lg bg-[#1d4ed8] text-[13px] font-bold flex items-center gap-1.5">
                <Navigation className="w-4 h-4" />
                {mapsLinks.length > 1 ? tx('Google Maps, part {n}', { n: i + 1 }) : tx('Open in Google Maps')}
              </a>
            ))}
          </div>
        )}
      </section>

      {/* On-request stops */}
      {optional.length > 0 && (
        <section className="rounded-2xl bg-white/[0.05] border border-white/10 p-4 space-y-3">
          <div>
            <h2 className="text-[16px] font-bold">{tx('On-request stops')}</h2>
            <p className="text-[12px] text-white/60">{tx('The bus only goes there when enough seats are booked to or from them.')}</p>
          </div>
          <ul className="space-y-2">
            {optional.map((o) => {
              const state = o.decided ? (o.runs ? 'runs' : 'skipped') : o.seats >= o.minSeats ? 'likely' : 'unlikely';
              return (
                <li key={o.stop} className="flex items-center justify-between gap-3 text-[14px]">
                  <span className="min-w-0">
                    <span className="block font-semibold truncate">{o.stop}</span>
                    <span className="block text-[12px] text-white/60">{tx('{seats} of {min} seats needed', { seats: o.seats, min: o.minSeats })}</span>
                  </span>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-[12px] font-bold ${state === 'runs' || state === 'likely' ? 'bg-[#0f7a2a]/40 text-[#9be8ad]' : 'bg-white/10 text-white/70'}`}>
                    {state === 'runs' ? tx('Going') : state === 'skipped' ? (o.movedTo ? tx('Not going: moved to {stop}', { stop: o.movedTo }) : tx('Not going')) : state === 'likely' ? tx('Enough so far') : tx('Not enough yet')}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Road reports */}
      <section className="rounded-2xl bg-white/[0.05] border border-white/10">
        <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-bold">{tx('Road reports')}</h2>
            <p className="text-[12px] text-white/60">{tx('From every conductor. They go after 2 hours unless someone says they are still there.')}</p>
          </div>
          <button onClick={startReport} className="shrink-0 h-9 px-3 rounded-lg bg-[#dc2626] text-[13px] font-bold flex items-center gap-1"><Plus className="w-4 h-4" />{tx('Report')}</button>
        </div>
        {reportsError && <p className="px-4 pb-3 text-[13px] text-[#ffb4ab]">{reportsError}</p>}
        {alertsPerm === 'default' && (
          <div className="mx-4 mb-3 rounded-xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
            <p className="flex-1 text-[13px] text-white/80">{tx('Get a phone alert when the bus nears a report, even with the screen on another app.')}</p>
            <button onClick={async () => { try { setAlertsPerm(await Notification.requestPermission()); } catch { /* not supported */ } }}
              className="shrink-0 h-9 px-3 rounded-lg bg-white text-[#0d0e11] text-[13px] font-bold">{tx('Turn on')}</button>
          </div>
        )}
        {live.length === 0 ? (
          <p className="px-4 pb-4 text-[14px] text-white/60">{tx('Nothing reported on the roads right now.')}</p>
        ) : (
          <ul className="divide-y divide-white/10 border-t border-white/10">
            {live
              .map((r) => ({ r, km: here ? kmBetween(here, r) : null }))
              .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
              .map(({ r, km }) => (
                <li key={r.id}>
                  <button onClick={() => setOpenReport(r)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] shrink-0" style={{ background: kindOf(r.kind).color }} aria-hidden>{kindOf(r.kind).icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold">{tx(kindOf(r.kind).label)}</span>
                      <span className="block text-[12px] text-white/60 truncate">
                        {[km != null ? `${km.toFixed(km < 10 ? 1 : 0)} km` : '', ago(r.createdAt), r.confirmations ? txn(r.confirmations, '{n} confirmed', '{n} confirmed') : '', r.note].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Report sheet */}
      {reporting && (
        <Sheet title={tx('What did you see?')} onClose={() => setReporting(null)}>
          <ReportForm
            at={reporting.at}
            onPickOnMap={() => {
              setReporting(null);
              setPlacing(true);
            }}
            onSend={async (kind, note) => {
              if (!reporting.at) return;
              const r = await reportRoad({ kind, note, lat: reporting.at.lat, lng: reporting.at.lng, scheduleId: schedule.id, reporterName: userName });
              if (!r.ok) return toast(r.reason ?? tx('Could not send'), 'error');
              setReporting(null);
              toast(tx('Reported. Other buses will see it.'));
              navigator.vibrate?.(60);
              reload();
            }}
          />
        </Sheet>
      )}

      {/* One report */}
      {openReport && (
        <Sheet title={tx(kindOf(openReport.kind).label)} onClose={() => setOpenReport(null)}>
          <div className="space-y-3">
            <p className="text-[14px] text-white/80">
              {[tx('Reported {ago} by {name}', { ago: ago(openReport.createdAt), name: openReport.reporterName || tx('a conductor') }), openReport.confirmations ? txn(openReport.confirmations, '{n} confirmed', '{n} confirmed') : ''].filter(Boolean).join(' · ')}
            </p>
            {openReport.note && <p className="rounded-xl bg-white/10 px-3 py-2 text-[15px]">{openReport.note}</p>}
            {here && <p className="text-[13px] text-white/60">{tx('About {km} km from the bus.', { km: kmBetween(here, openReport).toFixed(1) })}</p>}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button onClick={async () => { const r = await voteReport(openReport.id, true); toast(r.ok ? tx('Thanks: kept for another hour') : r.reason ?? tx('Could not send'), r.ok ? 'ok' : 'error'); setOpenReport(null); reload(); }}
                className="h-12 rounded-xl bg-white/10 font-bold flex items-center justify-center gap-2"><Check className="w-5 h-5" />{tx('Still there')}</button>
              <button onClick={async () => { const r = await voteReport(openReport.id, false); toast(r.ok ? tx('Thanks') : r.reason ?? tx('Could not send'), r.ok ? 'ok' : 'error'); setOpenReport(null); reload(); }}
                className="h-12 rounded-xl bg-white/10 font-bold flex items-center justify-center gap-2"><X className="w-5 h-5" />{tx('Gone')}</button>
            </div>
            <a href={`https://www.google.com/maps/search/?api=1&query=${openReport.lat},${openReport.lng}`} target="_blank" rel="noopener" className="h-11 rounded-xl border border-white/15 text-[14px] font-semibold flex items-center justify-center gap-2">
              <ExternalLink className="w-4 h-4" />{tx('Open in Google Maps')}</a>
          </div>
        </Sheet>
      )}

      {/* Office routes */}
      {picker && (
        <Sheet title={tx('Office routes')} onClose={() => setPicker(false)}>
          <RoutePicker
            routes={data.routes}
            current={route.id}
            onPick={(label, s) => {
              setCompare({ label, stops: s });
              setPicker(false);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function addMinutes(hhmm: string, add: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (((h * 60 + m + add) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Bottom sheet on the dark conductor screen. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label={tx('Close')} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-t-3xl bg-[#18191d] border-t border-white/10 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)] text-white">
        <div className="mx-auto w-10 h-1.5 rounded-full bg-white/20 mb-3" aria-hidden />
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[18px] font-bold">{title}</h2>
          <button onClick={onClose} aria-label={tx('Close')} className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReportForm({ at, onPickOnMap, onSend }: { at: { lat: number; lng: number } | null; onPickOnMap: () => void; onSend: (kind: ReportKind, note: string) => Promise<void> }) {
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {REPORT_KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}
            className={`h-16 rounded-2xl border-2 px-3 flex items-center gap-2 text-left text-[14px] font-bold ${kind === k.id ? 'border-white bg-white/15' : 'border-white/10 bg-white/5'}`}>
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px] shrink-0" style={{ background: k.color }} aria-hidden>{k.icon}</span>
            <span className="leading-tight">{tx(k.label)}</span>
          </button>
        ))}
      </div>
      <label className="block">
        <span className="block text-[13px] text-white/70 mb-1">{tx('Note (optional)')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder={tx('e.g. checking licences, left lane closed')}
          className="w-full h-12 px-3 rounded-xl bg-white/5 border border-white/15 text-[15px] placeholder:text-white/40" />
      </label>
      <p className="text-[13px] text-white/70">
        {at ? tx('Where the bus is now.') : tx('Waiting for GPS. You can tap the spot on the map instead.')}{' '}
        <button onClick={onPickOnMap} className="font-semibold text-[#feb700] underline underline-offset-2">{tx('Pick on the map')}</button>
      </p>
      <button disabled={!kind || !at || busy} onClick={async () => { setBusy(true); await onSend(kind!, note); setBusy(false); }}
        className="w-full h-14 rounded-2xl bg-[#dc2626] text-white text-[16px] font-bold disabled:opacity-40">
        {busy ? tx('Sending…') : tx('Send report')}
      </button>
    </div>
  );
}

/** Any route from Routes & timetable, or one of its drafts, to lay over the map. */
function RoutePicker({ routes, current, onPick }: { routes: Route[]; current: string; onPick: (label: string, stops: { name: string; lat: number; lng: number }[]) => void }) {
  const [routeId, setRouteId] = useState(current);
  const [plans, setPlans] = useState<RoutePlan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setPlans(null);
    loadPlans(routeId).then(({ plans, error }) => {
      setPlans(plans);
      setErr(error ?? null);
    });
  }, [routeId]);
  const route = routes.find((r) => r.id === routeId);
  const pinned = (stops: Route['stops']) => stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ name: s.name, lat: s.lat!, lng: s.lng! }));
  return (
    <div className="space-y-3">
      <label className="block relative">
        <span className="block text-[13px] text-white/70 mb-1">{tx('Route')}</span>
        <select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="w-full h-12 pl-3 pr-10 rounded-xl bg-white/5 border border-white/15 text-[15px] font-semibold appearance-none">
          {routes.map((r) => <option key={r.id} value={r.id} className="text-black">{routeLabel(r)}{r.active ? '' : ` (${tx('closed')})`}</option>)}
        </select>
        <ChevronDown className="w-5 h-5 absolute right-3 bottom-3.5 pointer-events-none text-white/60" />
      </label>
      {route && (
        <button onClick={() => onPick(routeLabel(route), pinned(route.stops))} className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-3 text-left">
          <span className="block text-[15px] font-semibold">{tx('Live route')}</span>
          <span className="block text-[12px] text-white/60">{txn(route.stops.length, '{n} stop', '{n} stops')}</span>
        </button>
      )}
      {err && <p className="text-[13px] text-[#ffb4ab]">{err}</p>}
      {plans === null ? (
        <p className="text-[13px] text-white/60">{tx('Loading…')}</p>
      ) : plans.length === 0 ? (
        <p className="text-[13px] text-white/60">{tx('No drafts for this route.')}</p>
      ) : (
        plans.map((p) => (
          <button key={p.id} onClick={() => onPick(p.name, pinned(p.stops))} className="w-full rounded-xl bg-white/5 border border-white/15 px-3 py-3 text-left">
            <span className="block text-[15px] font-semibold">{tx('Draft: {name}', { name: p.name })}</span>
            <span className="block text-[12px] text-white/60">{[txn(p.stops.length, '{n} stop', '{n} stops'), p.notes].filter(Boolean).join(' · ')}</span>
          </button>
        ))
      )}
    </div>
  );
}
