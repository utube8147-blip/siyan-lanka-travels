'use client';
// GPS trip log — the exact road a bus took on a trip, from every position the
// conductor's phone sent while "Share location" was on. Pick a day and a trip.
// The data is in bus_location_log (migration 33); conductors and passengers
// see nothing new.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, MapPinned, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { addDays, formatDateLabel, formatTime12, listRuns, routeLabel, todayISO } from '@/lib/trips';
import { deleteGpsPoints, downloadCsv, downloadGpx, findGaps, findStops, loadGpsPoints, loadGpsTrips, summarise, type GpsPoint, type GpsTripSummary } from '@/lib/gpsLog';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';

const GpsRouteMap = dynamic(() => import('@/components/admin/GpsRouteMap').then((m) => m.GpsRouteMap), {
  ssr: false,
  loading: () => <div className="h-[460px] md:h-[560px] rounded-2xl skeleton" />,
});

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const hms = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dur = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

export default function GpsLogPage() {
  const { data } = useStore();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { toast, Toast } = useToast();
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [scheduleId, setScheduleId] = useState('');
  const [summaries, setSummaries] = useState<GpsTripSummary[]>([]);
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Trips that ran that day (from the timetable) plus any with GPS points but no longer in the timetable.
  const trips = useMemo(() => {
    const runs = listRuns(data, date, 1);
    const rows = runs.map((r) => ({ scheduleId: r.schedule.id, label: routeLabel(r.route), departure: r.schedule.departure, bus: r.bus.regNo, summary: summaries.find((s) => s.scheduleId === r.schedule.id) }));
    for (const s of summaries) {
      if (rows.some((r) => r.scheduleId === s.scheduleId)) continue;
      const sch = data.schedules.find((x) => x.id === s.scheduleId);
      rows.push({
        scheduleId: s.scheduleId,
        label: sch ? routeLabel(data.routes.find((r) => r.id === sch.routeId)) : s.scheduleId,
        departure: sch?.departure ?? '',
        bus: sch ? data.buses.find((b) => b.id === sch.busId)?.regNo ?? '' : '',
        summary: s,
      });
    }
    return rows.sort((a, b) => a.departure.localeCompare(b.departure));
  }, [data, date, summaries]);

  const trip = trips.find((t) => t.scheduleId === scheduleId);
  const schedule = data.schedules.find((s) => s.id === scheduleId);
  const route = schedule ? data.routes.find((r) => r.id === schedule.routeId) : undefined;

  const loadTrips = useCallback(async () => {
    const r = await loadGpsTrips(date);
    setSummaries(r.trips);
    if (r.error) setError(r.error);
    return r.trips;
  }, [date]);

  const loadPoints = useCallback(async () => {
    if (!scheduleId) return setPoints([]);
    const r = await loadGpsPoints(scheduleId, date);
    setPoints(r.points);
    setError(r.error ?? null);
  }, [scheduleId, date]);

  // New day: load its trips and pick the first one that has GPS points.
  useEffect(() => {
    let off = false;
    setLoading(true);
    setError(null);
    setPoints([]);
    setFocus(null);
    loadTrips().then((ts) => {
      if (off) return;
      setLoading(false);
      setScheduleId((cur) => (ts.some((t) => t.scheduleId === cur) ? cur : ts.sort((a, b) => a.firstAt.localeCompare(b.firstAt))[0]?.scheduleId ?? ''));
    });
    return () => {
      off = true;
    };
  }, [loadTrips]);

  useEffect(() => {
    setFocus(null);
    setShowAll(false);
    setSelected(new Set());
    loadPoints();
  }, [loadPoints]);

  // While a trip is still sending, refresh every 30 s.
  const live = points.length > 0 && Date.now() - new Date(points[points.length - 1].at).getTime() < 10 * 60_000;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      loadPoints();
      loadTrips();
    }, 30_000);
    return () => clearInterval(id);
  }, [live, loadPoints, loadTrips]);

  const stats = useMemo(() => summarise(points), [points]);
  const stops = useMemo(() => findStops(points), [points]);
  const gaps = useMemo(() => findGaps(points), [points]);
  const fileName = `gps-${trip?.bus || scheduleId}-${date}`.replace(/[^\w.-]+/g, '_');
  const tableRows = showAll ? points : points.slice(-100);
  const tableOffset = showAll ? 0 : Math.max(0, points.length - 100);
  const remove = async (ids?: (number | string)[]) => {
    const what = ids ? `${ids.length} selected point${ids.length === 1 ? '' : 's'}` : `ALL ${points.length.toLocaleString()} GPS points of this trip`;
    if (!window.confirm(`Delete ${what}? This can't be undone.`)) return;
    setDeleting(true);
    const r = await deleteGpsPoints(scheduleId, date, ids);
    setDeleting(false);
    toast(r.ok ? `Deleted ${r.deleted ?? 0} point${r.deleted === 1 ? '' : 's'}` : r.reason ?? 'Could not delete', r.ok ? 'ok' : 'error');
    if (r.ok) {
      setSelected(new Set());
      setFocus(null);
      await Promise.all([loadPoints(), loadTrips()]);
    }
  };
  const toggle = (id: number | string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleSelected = tableRows.length > 0 && tableRows.every((p) => selected.has(p.id));

  const nearestIndex = (iso: string) => {
    const t = new Date(iso).getTime();
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(new Date(p.at).getTime() - t) < Math.abs(new Date(points[best].at).getTime() - t)) best = i;
    });
    return best;
  };

  return (
    <>
      <PageHeader
        title="GPS trip log"
        description="Every position the conductor's phone sent during a trip, kept in full. See the exact road the bus took, where it stopped and where the signal dropped."
        actions={
          <>
            <Button variant="secondary" disabled={loading} onClick={() => { loadTrips(); loadPoints(); }}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </Button>
            <Button variant="secondary" disabled={points.length === 0} onClick={() => downloadCsv(fileName, points)}>
              <Download className="w-4 h-4" /> CSV
            </Button>
            <Button variant="secondary" disabled={points.length === 0} onClick={() => downloadGpx(fileName, points)}>
              <Download className="w-4 h-4" /> GPX
            </Button>
            {isAdmin && (
              <Button variant="danger" disabled={points.length === 0 || deleting} onClick={() => remove()}>
                <Trash2 className="w-4 h-4" /> Delete trip&apos;s GPS
              </Button>
            )}
          </>
        }
      />
      {error && <p role="alert" className="mb-4 rounded-xl bg-[#ba1a1a]/10 border border-[#ba1a1a]/25 text-[#93000a] text-[14px] font-semibold px-4 py-3">{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <Card className="p-5 space-y-4 self-start">
          <Field label="Day the trip left">
            <div className="flex gap-2">
              <Button variant="secondary" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</Button>
              <input type="date" max={today} className={inputClass} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <Button variant="secondary" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</Button>
            </div>
          </Field>
          <div>
            <p className="text-[12px] font-bold text-[#46464f] px-1 mb-1.5">Trip</p>
            {trips.length === 0 ? (
              <p className="text-[13px] text-[#46464f] px-1">{loading ? 'Loading…' : 'No trips on this day.'}</p>
            ) : (
              <ul className="space-y-2">
                {trips.map((t) => {
                  const on = t.scheduleId === scheduleId;
                  return (
                    <li key={t.scheduleId}>
                      <button
                        onClick={() => setScheduleId(t.scheduleId)}
                        aria-pressed={on}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${on ? 'bg-[#050a44] border-[#050a44] text-white keep-navy' : 'bg-white border-[#e1e2e4] hover:bg-[#f2f4f6]'}`}
                      >
                        <p className={`text-[13px] font-bold ${on ? 'text-white' : 'text-[#050a44]'}`}>
                          {t.departure ? formatTime12(t.departure) : 'Trip'} · {t.label}
                        </p>
                        <p className={`text-[12px] ${on ? 'text-white/80' : 'text-[#6b6d78]'}`}>
                          {t.bus ? `${t.bus} · ` : ''}
                          {t.summary ? `${t.summary.points.toLocaleString()} points, ${hm(t.summary.firstAt)}–${hm(t.summary.lastAt)}` : 'No GPS recorded'}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="text-[12px] text-[#6b6d78]">
            Points are recorded while the conductor has &ldquo;Share location&rdquo; on. A new point is saved once the bus is 100 m or more from the last one; while it stands or crawls, that point just shows how long it was there. Overnight trips are listed under the day they left.
            <br />
            <br />
            To plan a route with a trip&apos;s real road, download its GPX or CSV here and load it in Routes &amp; timetable → Edit route.
          </p>
        </Card>

        <div className="space-y-6 min-w-0">
          {scheduleId && (
            <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-3">
              {[
                ['Distance', `${stats.distance.toFixed(1)} km`],
                ['First → last point', points.length ? `${hm(points[0].at)} → ${hm(points[points.length - 1].at)}` : '—'],
                ['Time', points.length > 1 ? dur(stats.totalMin) : '—'],
                ['Avg moving speed', stats.avgMoving ? `${Math.round(stats.avgMoving)} km/h` : '—'],
                ['Top speed', stats.maxSpeed ? `${Math.round(stats.maxSpeed)} km/h` : '—'],
                ['Points', points.length.toLocaleString()],
              ].map(([k, v]) => (
                <Card key={k} className="px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b6d78]">{k}</p>
                  <p className="text-[17px] font-extrabold text-[#050a44] tabular-nums mt-0.5">{v}</p>
                </Card>
              ))}
            </div>
          )}

          <Card className="p-3">
            {live && <p className="px-2 pb-2 text-[12px] font-bold text-[#050a44]"><span className="inline-block w-2 h-2 rounded-full bg-[#feb700] mr-1.5 align-middle" />Trip still sending: updates every 30 seconds</p>}
            <GpsRouteMap points={points} routeStops={route?.stops ?? []} stops={stops} gaps={gaps} focus={focus} className="h-[460px] md:h-[560px]" />
            {points.length > 1 ? (
              <div className="px-2 pt-3">
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-bold text-[#46464f]">
                  <span className="shrink-0">Replay</span>
                  <input
                    type="range"
                    min={0}
                    max={points.length - 1}
                    value={focus ?? 0}
                    onChange={(e) => setFocus(Number(e.target.value))}
                    className="flex-1 min-w-0 accent-[#050a44]"
                    aria-label="Move through the trip"
                  />
                  <span className="tabular-nums text-[#050a44] w-full sm:w-[150px] sm:text-right">
                    {focus != null ? `${hms(points[focus].at)}${points[focus].speedKmh != null ? ` · ${Math.round(points[focus].speedKmh!)} km/h` : ''}` : 'drag to replay'}
                  </span>
                </label>
              </div>
            ) : (
              scheduleId && !loading && <p className="px-2 pt-3 text-[13px] text-[#46464f]"><MapPinned className="inline w-4 h-4 mr-1 -mt-0.5" />No GPS points for this trip. They appear once the conductor turns on &ldquo;Share location&rdquo;.</p>
            )}
          </Card>

          {points.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="overflow-hidden self-start">
                <div className="px-5 py-4 border-b border-[#edeef0]">
                  <h2 className="text-[16px] font-semibold text-[#050a44]">Stops ({stops.length})</h2>
                  <p className="text-[12px] text-[#6b6d78]">Places the bus stood still for 3 minutes or more. Tap one to see it on the map.</p>
                </div>
                {stops.length === 0 ? (
                  <p className="p-5 text-[13px] text-[#46464f]">None.</p>
                ) : (
                  <ul className="divide-y divide-[#edeef0] max-h-[320px] overflow-y-auto">
                    {stops.map((s) => (
                      <li key={s.from}>
                        <button className="w-full text-left px-5 py-2.5 text-[13px] hover:bg-[#f2f4f6] flex justify-between gap-3" onClick={() => setFocus(nearestIndex(s.from))}>
                          <span className="text-[#050a44] font-semibold tabular-nums">{hm(s.from)} – {hm(s.to)}</span>
                          <span className="text-[#46464f] tabular-nums">{dur(s.minutes)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="overflow-hidden self-start">
                <div className="px-5 py-4 border-b border-[#edeef0]">
                  <h2 className="text-[16px] font-semibold text-[#050a44]">Signal gaps ({gaps.length})</h2>
                  <p className="text-[12px] text-[#6b6d78]">3 minutes or more with no position: no signal, the phone locked or sharing turned off. Shown dashed red on the map.</p>
                </div>
                {gaps.length === 0 ? (
                  <p className="p-5 text-[13px] text-[#46464f]">None.</p>
                ) : (
                  <ul className="divide-y divide-[#edeef0] max-h-[320px] overflow-y-auto">
                    {gaps.map((g) => (
                      <li key={g.from}>
                        <button className="w-full text-left px-5 py-2.5 text-[13px] hover:bg-[#f2f4f6] flex justify-between gap-3" onClick={() => setFocus(nearestIndex(g.from))}>
                          <span className="text-[#050a44] font-semibold tabular-nums">{hm(g.from)} – {hm(g.to)}</span>
                          <span className="text-[#ba1a1a] font-semibold tabular-nums">{dur(g.minutes)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {points.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[#edeef0] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[16px] font-semibold text-[#050a44]">All points</h2>
                  <p className="text-[12px] text-[#6b6d78]">{showAll ? `All ${points.length.toLocaleString()}` : `Latest ${tableRows.length} of ${points.length.toLocaleString()}`}. Tap a row to see it on the map.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isAdmin && selected.size > 0 && (
                    <Button size="sm" variant="danger" disabled={deleting} onClick={() => remove([...selected])}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete {selected.size} selected
                    </Button>
                  )}
                  {points.length > 100 && <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show latest 100' : 'Show all'}</Button>}
                </div>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#6b6d78] border-b border-[#edeef0]">
                      {isAdmin && (
                        <th className="pl-5 py-2 w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all shown points"
                            className="accent-[#050a44]"
                            checked={allVisibleSelected}
                            onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(tableRows.map((p) => p.id)))}
                          />
                        </th>
                      )}
                      <th className="px-5 py-2 font-bold">Time</th>
                      <th className="px-3 py-2 font-bold">Latitude, longitude</th>
                      <th className="px-3 py-2 font-bold text-right">Speed</th>
                      <th className="px-3 py-2 font-bold text-right">Accuracy</th>
                      <th className="px-5 py-2 font-bold text-right">Map</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edeef0]">
                    {[...tableRows].reverse().map((p, k) => {
                      const i = tableOffset + tableRows.length - 1 - k;
                      return (
                        <tr key={p.id} onClick={() => setFocus(i)} className={`cursor-pointer hover:bg-[#f2f4f6] ${focus === i ? 'bg-[#feb700]/15' : ''}`}>
                          {isAdmin && (
                            <td className="pl-5 py-2" onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`Select point at ${hms(p.at)}`} className="accent-[#050a44]" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                            </td>
                          )}
                          <td className="px-5 py-2 tabular-nums font-semibold text-[#050a44]">
                            {hms(p.at)}
                            {p.until && <span className="block text-[11px] font-medium text-[#6b6d78]">here until {hm(p.until)}</span>}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-[#46464f]">{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</td>
                          <td className="px-3 py-2 tabular-nums text-right text-[#46464f]">{p.speedKmh != null ? `${Math.round(p.speedKmh)} km/h` : '—'}</td>
                          <td className="px-3 py-2 tabular-nums text-right text-[#46464f]">{p.accuracyM != null ? `±${Math.round(p.accuracyM)} m` : '—'}</td>
                          <td className="px-5 py-2 text-right">
                            <a href={`https://maps.google.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[12px] font-bold text-[#050a44] underline">
                              Google Maps
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
      <p className="mt-6 text-[12px] text-[#6b6d78]">
        {formatDateLabel(date)}
        {isAdmin ? ' · Admins can delete a whole trip’s GPS or tick single points (e.g. a bad GPS jump) and delete them.' : ''}
      </p>
      <Toast />
    </>
  );
}
