'use client';
// Plan & sample (admin → GPS trip log): sample the real road a trip took and
// try out new stops next to it — how far off the road, where along the route,
// between which stops, and roughly how much time each would add.

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Download, MapPin, Plus, Save, Trash2, X } from 'lucide-react';
import type { GpsPoint } from '@/lib/gpsLog';
import type { RouteStop } from '@/lib/types';
import {
  VERDICT_LABEL,
  assess,
  buildTrack,
  deletePlan,
  downloadPlanCsv,
  downloadPlanGpx,
  downloadSamplesCsv,
  loadPlans,
  parseLatLng,
  resample,
  savePlan,
  trackLength,
  type Candidate,
  type RoutePlan,
} from '@/lib/routePlan';
import { Button, Card, Field, inputClass, useToast } from '@/components/admin/ui';

const GpsRouteMap = dynamic(() => import('@/components/admin/GpsRouteMap').then((m) => m.GpsRouteMap), {
  ssr: false,
  loading: () => <div className="h-[460px] md:h-[560px] rounded-2xl skeleton" />,
});

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dur = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
const SPACINGS = [0, 0.25, 0.5, 1, 2, 5, 10];
const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function RoutePlanner({
  points,
  routeStops,
  scheduleId,
  date,
  tripLabel,
  totalMin,
}: {
  points: GpsPoint[];
  routeStops: RouteStop[];
  scheduleId: string;
  date: string;
  tripLabel: string;
  /** The trip's time from first to last point. */
  totalMin: number;
}) {
  const { toast, Toast } = useToast();
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [name, setName] = useState('New stops plan');
  const [notes, setNotes] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sampleKm, setSampleKm] = useState(1);
  const [detourSpeed, setDetourSpeed] = useState(25);
  const [defaultDwell, setDefaultDwell] = useState(2);
  const [addMode, setAddMode] = useState(true);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadPlans().then((r) => {
      setPlans(r.plans);
      if (r.error) toast(/route_plans|schema cache/.test(r.error) ? 'Saved plans need the new database update (migration 33).' : r.error, 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const track = useMemo(() => buildTrack(points), [points]);
  const samples = useMemo(() => (sampleKm > 0 ? resample(track, sampleKm) : []), [track, sampleKm]);
  const list = useMemo(() => assess(track, candidates, routeStops, detourSpeed), [track, candidates, routeStops, detourSpeed]);
  const extra = list.reduce((n, a) => n + a.extraMin, 0);
  const fileName = `${name || 'plan'}-${date}`.replace(/[^\w.-]+/g, '_');

  const change = (fn: (c: Candidate[]) => Candidate[]) => {
    setCandidates(fn);
    setDirty(true);
  };
  const add = (lat: number, lng: number, label?: string) =>
    change((cs) => [...cs, { id: newId(), name: label || `New stop ${cs.length + 1}`, lat, lng, dwellMin: defaultDwell }]);
  const update = (id: string, patch: Partial<Candidate>) => change((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const openPlan = (id: string) => {
    if (dirty && !window.confirm('Leave this plan without saving the changes?')) return;
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    setName(p?.name ?? 'New stops plan');
    setNotes(p?.notes ?? '');
    setCandidates(p?.candidates ?? []);
    setDetourSpeed(p?.detourSpeedKmh ?? 25);
    setSampleKm(p?.sampleKm ?? 1);
    setDirty(false);
  };

  const save = async () => {
    setBusy(true);
    const r = await savePlan({ id: planId || undefined, name: name.trim() || 'New stops plan', scheduleId, travelDate: date, candidates, detourSpeedKmh: detourSpeed, sampleKm, notes });
    setBusy(false);
    if (!r.ok || !r.plan) return toast(r.reason ?? 'Could not save', 'error');
    setPlans((ps) => [r.plan!, ...ps.filter((p) => p.id !== r.plan!.id)]);
    setPlanId(r.plan.id);
    setDirty(false);
    toast('Plan saved', 'ok');
  };

  const remove = async () => {
    if (!planId || !window.confirm(`Delete the plan "${name}"?`)) return;
    const r = await deletePlan(planId);
    if (!r.ok) return toast(r.reason ?? 'Could not delete', 'error');
    setPlans((ps) => ps.filter((p) => p.id !== planId));
    setPlanId('');
    setCandidates([]);
    setName('New stops plan');
    setNotes('');
    setDirty(false);
    toast('Plan deleted', 'ok');
  };

  const addPasted = () => {
    const ll = parseLatLng(paste);
    if (!ll) return toast('Paste “latitude, longitude” (e.g. 7.2906, 81.6747) or a Google Maps link', 'error');
    add(ll.lat, ll.lng);
    setPaste('');
  };

  if (track.pts.length < 2) {
    return (
      <Card className="p-5 text-[14px] text-[#46464f]">
        Pick a trip with GPS points to sample it and plan new stops. The trip&apos;s real road is used to measure each place.
      </Card>
    );
  }

  const otherTrip = plans.find((p) => p.id === planId && (p.scheduleId !== scheduleId || p.travelDate !== date));

  return (
    <div className="space-y-6">
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Field label="Plan">
            <select className={inputClass} value={planId} onChange={(e) => openPlan(e.target.value)}>
              <option value="">New plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.candidates.length} stop{p.candidates.length === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan name">
            <input className={inputClass} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          </Field>
          <div className="flex gap-2">
            <Button variant="gold" disabled={busy} onClick={save}>
              <Save className="w-4 h-4" /> {busy ? 'Saving…' : dirty || !planId ? 'Save plan' : 'Saved'}
            </Button>
            {planId && (
              <Button variant="danger" aria-label="Delete plan" onClick={remove}>
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        {otherTrip && (
          <p className="text-[12px] text-[#46464f]">This plan was made on another trip ({otherTrip.travelDate}). Its stops are measured against the trip picked now: {tripLabel}.</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Sample every">
            <select className={inputClass} value={sampleKm} onChange={(e) => { setSampleKm(Number(e.target.value)); setDirty(true); }}>
              {SPACINGS.map((s) => (
                <option key={s} value={s}>{s === 0 ? 'Off' : s < 1 ? `${s * 1000} m` : `${s} km`}</option>
              ))}
            </select>
          </Field>
          <Field label="Detour speed (km/h)" hint="Off the main road">
            <input type="number" min={5} max={80} className={inputClass} value={detourSpeed} onChange={(e) => { setDetourSpeed(Math.max(5, Number(e.target.value) || 25)); setDirty(true); }} />
          </Field>
          <Field label="Stop time (min)" hint="For new stops you add">
            <input type="number" min={0} max={60} className={inputClass} value={defaultDwell} onChange={(e) => setDefaultDwell(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label="Click on the map">
            <button
              onClick={() => setAddMode((v) => !v)}
              aria-pressed={addMode}
              className={`w-full h-[42px] rounded-lg text-[13px] font-bold border ${addMode ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}
            >
              {addMode ? 'Adds a stop' : 'Does nothing'}
            </button>
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Road length', `${trackLength(track).toFixed(1)} km`],
          ['New stops', String(list.length)],
          ['Extra time', list.length ? `+${Math.round(extra)} min` : '—'],
          ['Trip with new stops', totalMin ? dur(totalMin + extra) : '—'],
        ].map(([k, v]) => (
          <Card key={k} className="px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b6d78]">{k}</p>
            <p className="text-[17px] font-extrabold text-[#050a44] tabular-nums mt-0.5">{v}</p>
          </Card>
        ))}
      </div>

      <Card className="p-3">
        <p className="px-2 pb-2 text-[12px] text-[#46464f]">
          {addMode ? 'Click the map to drop a possible stop. ' : ''}Drag a pin to move it. Navy dots are samples along the road the bus drove; the dashed line shows where each pin meets the road.
        </p>
        <GpsRouteMap
          points={points}
          routeStops={routeStops}
          stops={[]}
          gaps={[]}
          focus={null}
          samples={samples}
          candidates={candidates}
          assessments={list}
          showPoints={false}
          onMapClick={addMode ? (lat, lng) => add(lat, lng) : undefined}
          onMoveCandidate={(id, lat, lng) => update(id, { lat, lng })}
          className="h-[460px] md:h-[560px]"
        />
        <div className="flex flex-wrap gap-2 px-2 pt-3">
          <input
            className={`${inputClass} flex-1 min-w-[220px]`}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPasted()}
            placeholder="Or paste coordinates / a Google Maps link"
            aria-label="Coordinates of a place to add"
          />
          <Button variant="secondary" onClick={addPasted}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-[#edeef0] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[16px] font-semibold text-[#050a44]">Possible new stops</h2>
            <p className="text-[12px] text-[#6b6d78]">In route order. Extra time = stop time + going off the road and back (+30% for bends) + slowing down. Rough, to compare options.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={!list.length} onClick={() => downloadPlanCsv(fileName, list)}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button size="sm" variant="secondary" disabled={!list.length && !samples.length} onClick={() => downloadPlanGpx(fileName, samples, list)}>
              <Download className="w-3.5 h-3.5" /> GPX
            </Button>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="p-5 text-[13px] text-[#46464f]">No stops yet. Click the map, paste coordinates, or use &ldquo;Add as stop&rdquo; on a sample below.</p>
        ) : (
          <ul className="divide-y divide-[#edeef0]">
            {list.map((a) => {
              const i = candidates.findIndex((c) => c.id === a.c.id);
              const tone = a.verdict === 'on-road' ? 'text-[#1f7a3a] bg-[#1f7a3a]/10' : a.verdict === 'small' ? 'text-[#7c5800] bg-[#feb700]/20' : 'text-[#ba1a1a] bg-[#ba1a1a]/10';
              return (
                <li key={a.c.id} className="px-5 py-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[#050a44] text-white text-[12px] font-bold inline-flex items-center justify-center shrink-0 keep-navy">{i + 1}</span>
                    <input className={`${inputClass} !py-1.5 flex-1 min-w-[160px]`} value={a.c.name} onChange={(e) => update(a.c.id, { name: e.target.value })} aria-label="Stop name" />
                    <span className={`px-2.5 py-1 rounded-full text-[12px] font-bold ${tone}`}>{VERDICT_LABEL[a.verdict]}</span>
                    <label className="flex items-center gap-1.5 text-[12px] font-bold text-[#46464f]">
                      Stop
                      <input type="number" min={0} max={60} className={`${inputClass} !w-16 !py-1.5`} value={a.c.dwellMin} onChange={(e) => update(a.c.id, { dwellMin: Math.max(0, Number(e.target.value) || 0) })} />
                      min
                    </label>
                    <Button size="sm" variant="ghost" aria-label="Remove stop" onClick={() => change((cs) => cs.filter((c) => c.id !== a.c.id))}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-1 text-[12px] text-[#46464f] pl-8">
                    <p><b className="text-[#050a44] tabular-nums">{a.proj.offKm < 0.05 ? 'On the road' : `${a.proj.offKm.toFixed(2)} km`}</b>{a.proj.offKm >= 0.05 ? ' off the road' : ''}</p>
                    <p>km <b className="text-[#050a44] tabular-nums">{a.proj.alongKm.toFixed(1)}</b> from start</p>
                    <p>Bus passed <b className="text-[#050a44] tabular-nums">{hm(a.proj.at)}</b> ({dur(a.minutesFromStart)} in)</p>
                    <p>Adds about <b className="text-[#050a44] tabular-nums">{Math.round(a.extraMin)} min</b>{a.detourKm ? ` (${a.detourKm.toFixed(1)} km detour)` : ''}</p>
                    <p>
                      <a href={`https://maps.google.com/?q=${a.c.lat},${a.c.lng}`} target="_blank" rel="noreferrer" className="font-bold text-[#050a44] underline">
                        <MapPin className="inline w-3.5 h-3.5 -mt-0.5" /> Google Maps
                      </a>
                    </p>
                    <p className="col-span-2 lg:col-span-5">
                      {a.before ? <>After <b className="text-[#050a44]">{a.before.name}</b> ({a.before.km.toFixed(1)} km)</> : 'Before the first stop'}
                      {' · '}
                      {a.after ? <>before <b className="text-[#050a44]">{a.after.name}</b> ({a.after.km.toFixed(1)} km)</> : 'after the last stop'}
                      {a.nearestStop && a.nearestStop.km < 1 && <span className="text-[#ba1a1a] font-semibold"> · Only {Math.round(a.nearestStop.km * 1000)} m from {a.nearestStop.name}, an existing stop</span>}
                    </p>
                    <input
                      className={`${inputClass} !py-1.5 col-span-2 lg:col-span-5`}
                      value={a.c.note ?? ''}
                      onChange={(e) => update(a.c.id, { note: e.target.value })}
                      placeholder="Note (e.g. school, junction, town centre, places to visit)"
                      aria-label="Note"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="px-5 py-4 border-t border-[#edeef0]">
          <Field label="Plan notes">
            <textarea className={`${inputClass} min-h-[70px]`} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Ideas, who to ask, what to check on the next trip…" />
          </Field>
        </div>
      </Card>

      {samples.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[16px] font-semibold text-[#050a44]">Samples ({samples.length})</h2>
              <p className="text-[12px] text-[#6b6d78]">A point every {sampleKm < 1 ? `${sampleKm * 1000} m` : `${sampleKm} km`} along the road the bus drove, with the time it passed.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => downloadSamplesCsv(`samples-${fileName}`, samples)}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          </div>
          <div className="max-h-[380px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#6b6d78] border-b border-[#edeef0]">
                  <th className="px-5 py-2 font-bold">#</th>
                  <th className="px-3 py-2 font-bold">km</th>
                  <th className="px-3 py-2 font-bold">Bus passed</th>
                  <th className="px-3 py-2 font-bold">Latitude, longitude</th>
                  <th className="px-5 py-2 font-bold text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {samples.map((s) => (
                  <tr key={s.n}>
                    <td className="px-5 py-2 tabular-nums text-[#6b6d78]">{s.n}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-[#050a44]">{s.km.toFixed(1)}</td>
                    <td className="px-3 py-2 tabular-nums text-[#46464f]">{hm(s.at)}</td>
                    <td className="px-3 py-2 tabular-nums text-[#46464f]">
                      <a href={`https://maps.google.com/?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer" className="underline">{s.lat.toFixed(5)}, {s.lng.toFixed(5)}</a>
                    </td>
                    <td className="px-5 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => add(s.lat, s.lng, `Stop at km ${s.km.toFixed(1)}`)}>
                        <Plus className="w-3.5 h-3.5" /> Add as stop
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Toast />
    </div>
  );
}
