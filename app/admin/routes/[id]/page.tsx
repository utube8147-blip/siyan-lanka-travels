'use client';
// app/admin/routes/[id]/page.tsx — edit a route (stops, times, fares) on a map.
//
// - Stops are found by name (place search) or placed / dragged on the map.
//   Clicking the map adds a stop where it fits best in the order.
// - The road route through the stops is drawn live (routing server), with the
//   distance and time between stops, next to the saved route: changing stops
//   IS the simulation, and nothing is live until "Save route".
// - A GPS file (CSV / GPX from GPS trip log, or any GPX) can be loaded to see
//   the road a bus really drove.
// - "Save as draft" keeps a version without changing the live route.
// /admin/routes/new starts a new route.

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Crosshair, FileUp, Loader2, MapPin, Plus, Search, Trash2, Wand2, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { compressPhoto, formatDuration, genId, routeLabel } from '@/lib/trips';
import { uuid } from '@/lib/uuid';
import type { Route, RouteStop } from '@/lib/types';
import { fetchRoadRoute, type RoadRoute } from '@/lib/routing';
import {
  bestInsertIndex,
  deletePlan,
  distanceToLine,
  lineLengthKm,
  loadPlans,
  offsetsFromLegs,
  parseGpsFile,
  placeName,
  savePlan,
  searchPlaces,
  type GpsFile,
  type Place,
  type RoutePlan,
} from '@/lib/routeEditor';
import { Button, Card, PageHeader, inputClass, useToast } from '@/components/admin/ui';

const RouteEditorMap = dynamic(() => import('@/components/admin/RouteEditorMap').then((m) => m.RouteEditorMap), {
  ssr: false,
  loading: () => <div className="h-full min-h-[420px] rounded-2xl skeleton" />,
});

/** Stop photos: public storage with Supabase, an embedded image in demo mode. */
async function uploadStopPhoto(file: File) {
  const dataUrl = await compressPhoto(file, 1000);
  if (!isSupabaseConfigured) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${uuid()}.jpg`;
  const { error } = await supabase().storage.from('stop-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) return dataUrl;
  return supabase().storage.from('stop-photos').getPublicUrl(path).data.publicUrl;
}

/**
 * Saving a one-price route: the last stop carries the price. The other stops'
 * figures aren't used, but are kept valid (never above the price, never going
 * down) so switching back to per-stop fares later starts from something sane.
 */
function flatStops(stops: RouteStop[], price: number): RouteStop[] {
  let prev = 0;
  return stops.map((s, i) => {
    const fare = i === 0 ? 0 : i === stops.length - 1 ? price : Math.min(price, Math.max(prev, s.fareFromStart));
    prev = fare;
    return { ...s, fareFromStart: fare };
  });
}

const located = (stops: RouteStop[]) => stops.filter((s) => s.lat != null && s.lng != null);
const coordsKey = (stops: RouteStop[]) => located(stops).map((s) => `${s.lat!.toFixed(5)},${s.lng!.toFixed(5)}`).join(';');
const signed = (n: number, unit: string, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)} ${unit}`;
const dur = (m: number) => formatDuration(Math.max(0, Math.round(m)));

/** Road route for a list of stops, refreshed (debounced) when their positions change. */
function useRoad(stops: RouteStop[], delay = 600) {
  const key = coordsKey(stops);
  const [road, setRoad] = useState<RoadRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const pts = located(stops).map((s) => [s.lat!, s.lng!] as [number, number]);
    if (pts.length < 2) {
      setRoad(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const id = setTimeout(() => {
      fetchRoadRoute(pts, ctl.signal).then((r) => {
        if (ctl.signal.aborted) return;
        setLoading(false);
        setRoad(r.route);
        setError(r.error ?? null);
      });
    }, delay);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { road, loading, error };
}

export default function RouteEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data, saveRoute } = useStore();
  const { toast, Toast } = useToast();
  const isNew = params.id === 'new';
  const saved = data.routes.find((r) => r.id === params.id);

  // The route being edited (a new one starts with two empty stops).
  const [base, setBase] = useState<Route | null>(null);
  useEffect(() => {
    if (base) return;
    if (isNew) setBase({ id: genId('route'), active: true, flatFare: true, stops: [{ name: '', offsetMin: 0, fareFromStart: 0 }, { name: '', offsetMin: 60, fareFromStart: 500 }] });
    else if (saved) setBase(structuredClone(saved));
  }, [isNew, saved, base]);

  if (!base) {
    return (
      <>
        <BackLink />
        <Card className="p-6 text-[14px] text-[#46464f]">{isNew || saved ? 'Loading…' : 'This route no longer exists.'}</Card>
      </>
    );
  }
  return (
    <Editor
      key={base.id}
      route={base}
      savedRoute={isNew ? null : saved ?? null}
      onSave={async (r) => {
        const res = await saveRoute(r);
        if (!res.ok) {
          toast(res.reason ?? 'Could not save', 'error');
          return false;
        }
        toast(`${routeLabel(r)} saved`, 'ok');
        if (isNew) router.replace(`/admin/routes/${r.id}`);
        return true;
      }}
      toast={toast}
      Toast={Toast}
    />
  );
}

function BackLink() {
  return (
    <Link href="/admin/routes" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[#050a44] mb-3 hover:underline">
      <ArrowLeft className="w-4 h-4" /> Routes &amp; timetable
    </Link>
  );
}

function Editor({
  route,
  savedRoute,
  onSave,
  toast,
  Toast,
}: {
  route: Route;
  savedRoute: Route | null;
  onSave: (r: Route) => Promise<boolean>;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  Toast: () => React.ReactNode;
}) {
  const [stops, setStops] = useState<RouteStop[]>(route.stops);
  const [active, setActive] = useState(route.active);
  const [flat, setFlat] = useState(route.flatFare !== false);
  const [price, setPrice] = useState(route.stops[route.stops.length - 1]?.fareFromStart ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null); // stop waiting for a map click
  const [clickAdds, setClickAdds] = useState(true);
  const [busFactor, setBusFactor] = useState(1.3);
  const [dwell, setDwell] = useState(2);
  const [gps, setGps] = useState<GpsFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Search: per stop (index) or for a new stop ('new').
  const [searchFor, setSearchFor] = useState<number | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  // Drafts
  const [plans, setPlans] = useState<RoutePlan[]>([]);
  const [planId, setPlanId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!savedRoute) return;
    loadPlans(savedRoute.id).then((r) => {
      setPlans(r.plans);
      if (r.error) toast(r.error, 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRoute?.id]);

  // Don't lose work by closing the tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (fn: (s: RouteStop[]) => RouteStop[]) => {
    setStops(fn);
    setDirty(true);
  };
  const update = (i: number, patch: Partial<RouteStop>) => change((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    change((p) => {
      const n = [...p];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const removeStop = (i: number) => {
    change((p) => p.filter((_, j) => j !== i));
    setSelected(null);
  };

  /** A new stop at a place: put where it fits best, with a time and fare between its neighbours. */
  const insertStop = (lat: number, lng: number, name: string) => {
    const p = stops;
    const pinned = p.every((s) => s.lat != null);
    // Stops with a pin: where it adds the least distance. Otherwise: before the last stop.
    const at = pinned && p.length >= 2 ? bestInsertIndex(p, { lat, lng }) : Math.max(1, p.length - 1);
    const prev = p[at - 1];
    const next = p[at];
    const offsetMin = next ? Math.round((prev.offsetMin + next.offsetMin) / 2) : (prev?.offsetMin ?? 0) + 30;
    const fareFromStart = next ? Math.round((prev.fareFromStart + next.fareFromStart) / 2 / 10) * 10 : (prev?.fareFromStart ?? 0) + 100;
    const n = [...p];
    n.splice(at, 0, { name, offsetMin, fareFromStart, lat, lng });
    change(() => n);
    setSelected(at);
    return at;
  };

  const onMapClick = async (lat: number, lng: number) => {
    if (pickFor != null) {
      update(pickFor, { lat: round(lat), lng: round(lng) });
      setSelected(pickFor);
      setPickFor(null);
      return;
    }
    if (!clickAdds) return;
    const at = insertStop(round(lat), round(lng), 'New stop');
    const name = await placeName(lat, lng);
    if (name) setStops((p) => p.map((s, j) => (j === at && s.name === 'New stop' ? { ...s, name: uniqueName(p, name) } : s)));
  };

  const runSearch = async () => {
    setSearching(true);
    const r = await searchPlaces(query);
    setSearching(false);
    setResults(r.places);
    if (r.error) toast(r.error, 'error');
    else if (!r.places.length) toast('No place found with that name. Try a nearby town, or pick it on the map.', 'error');
  };
  const choosePlace = (pl: Place) => {
    if (searchFor === 'new') insertStop(round(pl.lat), round(pl.lng), uniqueName(stops, pl.name));
    else if (typeof searchFor === 'number') {
      update(searchFor, { lat: round(pl.lat), lng: round(pl.lng), ...(stops[searchFor].name.trim() ? {} : { name: pl.name }) });
      setSelected(searchFor);
    }
    setSearchFor(null);
    setResults([]);
    setQuery('');
  };
  const openSearch = (target: number | 'new') => {
    setSearchFor(target);
    setResults([]);
    setQuery(typeof target === 'number' ? stops[target].name : '');
  };

  // ---- road routes: as edited, and as saved ----
  const edited = useRoad(stops);
  const savedRoad = useRoad(savedRoute?.stops ?? [], 0);
  const allPinned = stops.length >= 2 && stops.every((s) => s.lat != null);
  const legs = allPinned && edited.road && edited.road.legs.length === stops.length - 1 ? edited.road.legs : null;
  const busTime = (r: RoadRoute | null, n: number) => (r ? r.durationMin * busFactor + Math.max(0, n - 2) * dwell : null);
  const editedTime = busTime(legs ? edited.road : null, stops.length);
  const savedPinned = savedRoute ? located(savedRoute.stops).length === savedRoute.stops.length : false;
  const savedTime = savedPinned ? busTime(savedRoad.road, savedRoute!.stops.length) : null;
  const roadOffsets = useMemo(() => (legs ? offsetsFromLegs(legs, busFactor, dwell) : null), [legs, busFactor, dwell]);
  const changedFromSaved = !!savedRoute && JSON.stringify(savedRoute.stops.map(pick)) !== JSON.stringify(stops.map(pick));

  const fillTimes = () => {
    if (!roadOffsets) return;
    if (!window.confirm('Set every stop’s "arrives after" time from the road estimate? You can still change any of them after.')) return;
    change((p) => p.map((s, i) => ({ ...s, offsetMin: roadOffsets[i] })));
    toast('Times filled from the road estimate', 'ok');
  };

  // ---- GPS file ----
  const loadGps = async (file: File) => {
    const parsed = parseGpsFile(file.name, await file.text());
    if (!parsed) return toast('No GPS points found in that file. Use the CSV or GPX from GPS trip log, or any GPX track.', 'error');
    setGps(parsed);
    toast(`Loaded ${parsed.line.length.toLocaleString()} points from ${file.name}`, 'ok');
  };

  // ---- checks (same rules as before) ----
  const problems: string[] = [];
  if (stops.length < 2) problems.push('A route needs at least two stops.');
  if (stops.some((s) => !s.name.trim())) problems.push('Every stop needs a name.');
  if (new Set(stops.map((s) => s.name.trim().toLowerCase())).size !== stops.length) problems.push('Stop names must be different.');
  if (stops[0] && (stops[0].offsetMin !== 0 || (!flat && stops[0].fareFromStart !== 0))) problems.push('The first stop is the start: time and fare 0.');
  if (flat && price <= 0) problems.push('Enter the ticket price.');
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].offsetMin <= stops[i - 1].offsetMin) problems.push(`${stops[i].name || `Stop ${i + 1}`} must come later than the stop before.`);
    if (!flat && stops[i].fareFromStart < stops[i - 1].fareFromStart) problems.push(`${stops[i].name || `Stop ${i + 1}`} fare can't be lower than the stop before.`);
  }
  const unpinned = stops.filter((s) => s.lat == null).length;

  const finalRoute = (): Route => ({ ...route, active, flatFare: flat, stops: (flat ? flatStops(stops, price) : stops).map((s) => ({ ...s, name: s.name.trim() })) });
  const save = async () => {
    setSaving(true);
    const ok = await onSave(finalRoute());
    setSaving(false);
    if (ok) setDirty(false);
  };

  // ---- drafts ----
  const saveDraft = async () => {
    if (!savedRoute) return;
    const current = plans.find((p) => p.id === planId);
    const name = window.prompt('Name this draft', current?.name ?? `Draft ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
    if (name == null) return;
    const r = await savePlan({ id: current && current.name === name ? current.id : undefined, name: name.trim() || 'Draft', routeId: savedRoute.id, stops: finalRoute().stops, notes: '' });
    if (!r.ok || !r.plan) return toast(r.reason ?? 'Could not save the draft', 'error');
    setPlans((ps) => [r.plan!, ...ps.filter((p) => p.id !== r.plan!.id)]);
    setPlanId(r.plan.id);
    toast('Draft saved. The live route is unchanged.', 'ok');
  };
  const openDraft = (id: string) => {
    if (dirty && !window.confirm('Open this version? Changes not saved here will be lost.')) return;
    setPlanId(id);
    const src = id ? plans.find((p) => p.id === id)?.stops : savedRoute?.stops;
    if (!src) return;
    setStops(structuredClone(src));
    setPrice(src[src.length - 1]?.fareFromStart ?? price);
    setSelected(null);
    setDirty(!!id);
  };
  const removeDraft = async () => {
    const p = plans.find((x) => x.id === planId);
    if (!p || !window.confirm(`Delete the draft "${p.name}"?`)) return;
    const r = await deletePlan(p.id);
    if (!r.ok) return toast(r.reason ?? 'Could not delete', 'error');
    setPlans((ps) => ps.filter((x) => x.id !== p.id));
    setPlanId('');
    toast('Draft deleted', 'ok');
  };

  const title = savedRoute ? `Edit ${routeLabel(savedRoute)}` : 'New route';

  return (
    <>
      <BackLink />
      <PageHeader
        title={title}
        description="Find stops by name or place them on the map. The road route updates as you go, next to the saved route, so you can try changes and see the distance and time before saving."
        actions={
          <>
            {savedRoute && (
              <Button variant="secondary" onClick={saveDraft}>
                Save as draft
              </Button>
            )}
            <Button variant="gold" disabled={problems.length > 0 || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save route'}
            </Button>
          </>
        }
      />

      {/* Summary: as edited vs saved */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Road distance" value={legs ? `${edited.road!.distanceKm.toFixed(1)} km` : edited.loading ? '…' : '—'} sub={savedRoute && legs && savedRoad.road && savedPinned ? `${signed(edited.road!.distanceKm - savedRoad.road.distanceKm, 'km', 1)} vs saved` : allPinned ? 'by road' : `${unpinned} stop${unpinned === 1 ? '' : 's'} without a map pin`} />
        <Stat label="Bus time (road estimate)" value={editedTime != null ? dur(editedTime) : '—'} sub={savedTime != null && editedTime != null ? `${signed(editedTime - savedTime, 'min')} vs saved` : `road × ${busFactor} + ${dwell} min a stop`} />
        <Stat label="Timetable end to end" value={dur(stops[stops.length - 1]?.offsetMin ?? 0)} sub={editedTime != null ? `${signed((stops[stops.length - 1]?.offsetMin ?? 0) - editedTime, 'min')} vs road estimate` : 'from the times below'} />
        <Stat label="Stops" value={String(stops.length)} sub={savedRoute ? (changedFromSaved ? `${signed(stops.length - savedRoute.stops.length, 'vs saved')}` : 'same as saved') : 'new route'} />
      </div>
      {(edited.error || savedRoad.error) && (
        <p role="alert" className="mb-4 rounded-xl bg-[#ba1a1a]/10 border border-[#ba1a1a]/25 text-[#93000a] text-[13px] font-semibold px-4 py-2.5">{edited.error ?? savedRoad.error}</p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
        {/* ------------------------------------------------ left: stops -- */}
        <div className="space-y-4 min-w-0 order-2 xl:order-1">
          {savedRoute && (
            <Card className="p-4 flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-[200px]">
                <span className="text-[12px] font-bold text-[#46464f] px-1">Version</span>
                <select className={`${inputClass} mt-1`} value={planId} onChange={(e) => openDraft(e.target.value)}>
                  <option value="">Live route{changedFromSaved && !planId ? ' (edited)' : ''}</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      Draft: {p.name} ({p.stops.length} stops)
                    </option>
                  ))}
                </select>
              </label>
              {planId && (
                <Button variant="danger" onClick={removeDraft}>
                  <Trash2 className="w-4 h-4" /> Delete draft
                </Button>
              )}
              <p className="w-full text-[12px] text-[#6b6d78]">Drafts keep ideas without changing the live route. Open one and press &ldquo;Save route&rdquo; to make it live.</p>
            </Card>
          )}

          <Card className="p-4 space-y-3">
            <p className="text-[13px] font-bold text-[#050a44]">Ticket price</p>
            <div className="flex gap-2">
              {([true, false] as const).map((f) => (
                <button
                  key={String(f)}
                  type="button"
                  aria-pressed={flat === f}
                  onClick={() => { setFlat(f); setDirty(true); }}
                  className={`flex-1 min-h-10 px-2 py-1.5 rounded-lg text-[13px] font-bold border ${flat === f ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white border-[#c7c5d1] text-[#46464f]'}`}
                >
                  {f ? 'One price for the whole route' : 'Price by distance (per stop)'}
                </button>
              ))}
            </div>
            {flat ? (
              <label className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] font-bold text-[#46464f]">Price per seat (LKR)</span>
                <input type="number" min={0} step={50} className={`${inputClass} !w-36`} value={price} onChange={(e) => { setPrice(Math.max(0, Number(e.target.value))); setDirty(true); }} aria-label="Ticket price" />
              </label>
            ) : (
              <p className="text-[12px] text-[#46464f]">Each stop&apos;s fare from the first stop is set below. A passenger pays the difference between their two stops.</p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[#edeef0] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[16px] font-semibold text-[#050a44]">Stops</h2>
                <p className="text-[12px] text-[#6b6d78]">&ldquo;Arrives after&rdquo; is the time from leaving the first stop.</p>
              </div>
              <Button size="sm" variant="secondary" disabled={!roadOffsets} onClick={fillTimes} title={roadOffsets ? '' : 'Every stop needs a map pin first'}>
                <Wand2 className="w-3.5 h-3.5" /> Fill times from road
              </Button>
            </div>
            <ol>
              {stops.map((s, i) => {
                const leg = legs && i > 0 ? legs[i - 1] : null;
                const est = roadOffsets?.[i];
                const off = est != null && i > 0 ? s.offsetMin - est : null;
                const fromGps = gps && s.lat != null ? distanceToLine(gps.line, { lat: s.lat, lng: s.lng! }) : null;
                const end = i === 0 || i === stops.length - 1;
                return (
                  <li key={i}>
                    {i > 0 && (
                      <div className="pl-[30px] py-1 text-[11px] font-semibold text-[#6b6d78] tabular-nums border-l-2 border-dashed border-[#c7c5d1] ml-[27px]">
                        {leg ? `${leg.km.toFixed(1)} km · ${dur(leg.min * busFactor)} by road` : edited.loading ? '…' : ''}
                      </div>
                    )}
                    <div className={`px-4 py-3 ${selected === i ? 'bg-[#feb700]/10' : ''}`} onFocus={() => setSelected(i)}>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(i)}
                          aria-label={`Show stop ${i + 1} on the map`}
                          className={`mt-1.5 w-7 h-7 shrink-0 rounded-full border-[3px] text-[11px] font-extrabold inline-flex items-center justify-center ${end ? 'bg-[#050a44] text-white keep-navy' : 'bg-white text-[#050a44]'} ${selected === i ? 'border-[#feb700]' : 'border-[#050a44]'}`}
                        >
                          {i + 1}
                        </button>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex gap-1.5">
                            <input aria-label={`Stop ${i + 1} name`} className={inputClass} value={s.name} placeholder="Stop name, e.g. Kegalle" onChange={(e) => update(i, { name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && openSearch(i)} />
                            <Button variant="secondary" aria-label="Find this place on the map" title="Find on the map" onClick={() => openSearch(i)}>
                              <Search className="w-4 h-4" />
                            </Button>
                          </div>
                          {searchFor === i && <SearchBox query={query} setQuery={setQuery} run={runSearch} searching={searching} results={results} choose={choosePlace} close={() => setSearchFor(null)} />}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                            {s.lat != null ? (
                              <a className="text-[#46464f] tabular-nums underline" href={`https://maps.google.com/?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">
                                <MapPin className="inline w-3.5 h-3.5 -mt-0.5" /> {s.lat.toFixed(5)}, {s.lng!.toFixed(5)}
                              </a>
                            ) : (
                              <span className="font-semibold text-[#7c5800]">No map pin: search or pick on the map</span>
                            )}
                            <button type="button" className={`font-bold underline ${pickFor === i ? 'text-[#ba1a1a]' : 'text-[#050a44]'}`} onClick={() => setPickFor(pickFor === i ? null : i)}>
                              <Crosshair className="inline w-3.5 h-3.5 -mt-0.5" /> {pickFor === i ? 'Click the map… (cancel)' : 'Pick on map'}
                            </button>
                            {fromGps != null && fromGps > 0.3 && fromGps < 15 && <span className="font-semibold text-[#ba1a1a]">{fromGps.toFixed(1)} km from the road driven</span>}
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="block">
                              <span className="block text-[11px] font-bold text-[#686873] mb-0.5">Arrives after (h:mm)</span>
                              <DurationInput label={`Stop ${i + 1} time from start`} minutes={s.offsetMin} disabled={i === 0} onChange={(m) => update(i, { offsetMin: m })} />
                            </label>
                            {!flat && (
                              <label className="block">
                                <span className="block text-[11px] font-bold text-[#686873] mb-0.5">Fare from start (LKR)</span>
                                <input aria-label={`Stop ${i + 1} fare`} type="number" min={0} step={10} className={`${inputClass} !w-32`} value={s.fareFromStart} disabled={i === 0} onChange={(e) => update(i, { fareFromStart: Number(e.target.value) })} />
                              </label>
                            )}
                            {est != null && i > 0 && (
                              <p className="text-[11px] text-[#6b6d78] pb-2">
                                Road estimate <b className="text-[#050a44] tabular-nums">{hmm(est)}</b>
                                {off != null && Math.abs(off) >= 15 && <span className={`font-semibold ${off < 0 ? 'text-[#ba1a1a]' : 'text-[#7c5800]'}`}> ({signed(off, 'min')})</span>}
                              </p>
                            )}
                          </div>
                          <details>
                            <summary className="text-[11px] font-bold text-[#7c5800] cursor-pointer">Where to wait{s.landmark ? ' ✓' : ''}</summary>
                            <div className="space-y-1.5 mt-1.5">
                              <input aria-label={`Stop ${i + 1} landmark`} className={inputClass} placeholder="Landmark, e.g. Clock tower roundabout" value={s.landmark ?? ''} onChange={(e) => update(i, { landmark: e.target.value })} />
                              <input aria-label={`Stop ${i + 1} notes`} className={inputClass} placeholder="Notes, e.g. wait under the bus shelter" value={s.notes ?? ''} onChange={(e) => update(i, { notes: e.target.value })} />
                              <div className="flex items-center gap-2">
                                {s.photo && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={s.photo} alt="" className="w-12 h-12 rounded object-cover border border-[#e1e2e4]" />
                                )}
                                <label className="text-[12px] font-bold text-[#050a44] underline cursor-pointer">
                                  {s.photo ? 'Replace photo' : 'Add photo of the spot'}
                                  <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) update(i, { photo: await uploadStopPhoto(f) }); }} />
                                </label>
                              </div>
                            </div>
                          </details>
                        </div>
                        <div className="flex flex-col">
                          <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)}>
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label="Remove stop" disabled={stops.length <= 2} onClick={() => removeStop(i)}>
                            <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="px-4 py-3 border-t border-[#edeef0] space-y-2">
              {searchFor === 'new' ? (
                <SearchBox query={query} setQuery={setQuery} run={runSearch} searching={searching} results={results} choose={choosePlace} close={() => setSearchFor(null)} placeholder="Town or place to add as a stop" autoFocus />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openSearch('new')}>
                    <Search className="w-4 h-4" /> Add a stop by name
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const last = stops[stops.length - 1];
                      change((p) => [...p, { name: '', offsetMin: last.offsetMin + 30, fareFromStart: last.fareFromStart + 100 }]);
                    }}
                  >
                    <Plus className="w-4 h-4" /> Empty stop at the end
                  </Button>
                </div>
              )}
              <p className="text-[11px] text-[#686873]">A stop found by name or clicked on the map goes where it fits best on the way. Times are hours:minutes from the first stop, e.g. 2:05.</p>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <label className="flex items-center gap-2 text-[13px] font-semibold text-[#050a44]">
              <input type="checkbox" checked={active} onChange={(e) => { setActive(e.target.checked); setDirty(true); }} className="w-4 h-4 accent-[#050a44]" />
              Route is open for booking
            </label>
            {problems.length > 0 ? (
              <ul className="text-[12px] font-semibold text-[#ba1a1a] space-y-0.5">
                {problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[#1f7a3a] font-semibold">Ready to save.{dirty ? ' You have unsaved changes.' : ''}</p>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------ right: map -- */}
        <div className="xl:sticky xl:top-4 space-y-3 min-w-0 order-1 xl:order-2">
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
              <div className="inline-flex p-0.5 rounded-lg bg-[#f2f4f6] border border-[#e1e2e4]" role="group" aria-label="Clicking the map">
                {([true, false] as const).map((v) => (
                  <button key={String(v)} type="button" aria-pressed={clickAdds === v} onClick={() => setClickAdds(v)} className={`px-3 h-8 rounded-md text-[12px] font-bold ${clickAdds === v ? 'bg-[#050a44] text-white keep-navy' : 'text-[#050a44]'}`}>
                    {v ? 'Click adds a stop' : 'Click does nothing'}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                <FileUp className="w-3.5 h-3.5" /> {gps ? 'Change GPS file' : 'Load GPS file'}
              </Button>
              <input ref={fileInput} type="file" accept=".gpx,.csv,application/gpx+xml,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadGps(f); e.target.value = ''; }} />
              {(edited.loading || savedRoad.loading) && <Loader2 className="w-4 h-4 animate-spin text-[#6b6d78]" aria-label="Updating the road route" />}
            </div>
            {pickFor != null && (
              <p className="mx-1 mb-2 rounded-lg bg-[#feb700]/20 px-3 py-2 text-[12px] font-bold text-[#050a44]">
                Click the map to place {stops[pickFor]?.name || `stop ${pickFor + 1}`}.{' '}
                <button className="underline" onClick={() => setPickFor(null)}>Cancel</button>
              </p>
            )}
            <RouteEditorMap
              stops={stops}
              selected={selected}
              editedRoad={edited.road?.path}
              savedRoad={changedFromSaved ? savedRoad.road?.path : null}
              gps={gps?.line}
              picking={pickFor != null || clickAdds}
              onMoveStop={(i, lat, lng) => { update(i, { lat: round(lat), lng: round(lng) }); setSelected(i); }}
              onSelect={setSelected}
              onMapClick={onMapClick}
              fitKey={`${route.id}:${planId}:${gps?.name ?? ''}`}
              className="h-[420px] xl:h-[calc(100vh-260px)] xl:min-h-[480px]"
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-[12px] text-[#46464f]">
              <span><i className="inline-block w-5 h-1.5 align-middle rounded bg-[#1f7a3a] mr-1" />Route as edited</span>
              {changedFromSaved && <span><i className="inline-block w-5 h-1 align-middle rounded bg-[#050a44]/50 mr-1" />Saved route</span>}
              {gps && (
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block w-5 h-1 align-middle rounded bg-[#feb700] mr-1" />
                  Road driven: {gps.name} · {lineLengthKm(gps.line).toFixed(1)} km
                  <button aria-label="Remove GPS file" onClick={() => setGps(null)} className="ml-0.5"><X className="w-3.5 h-3.5" /></button>
                </span>
              )}
              <span className="text-[#6b6d78]">Drag a pin to move a stop.</span>
            </div>
          </Card>
          <Card className="p-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-0.5">Bus vs car time</span>
              <input type="number" min={1} max={3} step={0.05} className={inputClass} value={busFactor} onChange={(e) => setBusFactor(Math.min(3, Math.max(1, Number(e.target.value) || 1.3)))} />
              <span className="block text-[11px] text-[#686873] mt-0.5">Road times are car times; a bus is slower.</span>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-0.5">Stop time (min)</span>
              <input type="number" min={0} max={30} className={inputClass} value={dwell} onChange={(e) => setDwell(Math.max(0, Number(e.target.value) || 0))} />
              <span className="block text-[11px] text-[#686873] mt-0.5">At each stop on the way.</span>
            </label>
          </Card>
        </div>
      </div>
      <Toast />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b6d78]">{label}</p>
      <p className="text-[18px] font-extrabold text-[#050a44] tabular-nums mt-0.5">{value}</p>
      <p className="text-[12px] text-[#46464f] tabular-nums">{sub}</p>
    </Card>
  );
}

function SearchBox({
  query,
  setQuery,
  run,
  searching,
  results,
  choose,
  close,
  placeholder = 'Search a town or place',
  autoFocus,
}: {
  query: string;
  setQuery: (q: string) => void;
  run: () => void;
  searching: boolean;
  results: Place[];
  choose: (p: Place) => void;
  close: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#c7c5d1] bg-white p-2 space-y-1.5">
      <div className="flex gap-1.5">
        <input className={inputClass} value={query} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); if (e.key === 'Escape') close(); }} aria-label="Place to search" />
        <Button size="sm" className="!h-[42px]" disabled={searching || !query.trim()} onClick={run}>
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
        </Button>
        <Button size="sm" variant="ghost" className="!h-[42px]" aria-label="Close search" onClick={close}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="divide-y divide-[#edeef0]">
          {results.map((p) => (
            <li key={`${p.lat},${p.lng}`}>
              <button type="button" className="w-full text-left px-2 py-2 hover:bg-[#f2f4f6] rounded-lg" onClick={() => choose(p)}>
                <span className="block text-[13px] font-bold text-[#050a44]">{p.name}</span>
                <span className="block text-[11px] text-[#6b6d78] truncate">{p.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 125 → "2:05" (a duration, not a clock time). */
const hmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/** Duration box: type "2:05", "2.05" or minutes ("125"). Applied when you leave the box or press Enter. */
function DurationInput({ minutes, onChange, disabled, label }: { minutes: number; onChange: (m: number) => void; disabled?: boolean; label: string }) {
  const [text, setText] = useState(hmm(minutes));
  useEffect(() => setText(hmm(minutes)), [minutes]);
  const commit = () => {
    const t = text.trim();
    const hm = t.match(/^(\d{1,3})[:.](\d{1,2})$/);
    const m = hm ? Number(hm[1]) * 60 + Number(hm[2]) : /^\d{1,4}$/.test(t) ? Number(t) : NaN;
    if (Number.isFinite(m) && (!hm || Number(hm[2]) < 60)) onChange(m);
    else setText(hmm(minutes));
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      className={`${inputClass} !w-28 tabular-nums`}
      value={text}
      disabled={disabled}
      placeholder="h:mm"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const pick = (s: RouteStop) => [s.name.trim(), s.offsetMin, s.fareFromStart, s.lat ?? null, s.lng ?? null];
function uniqueName(stops: RouteStop[], name: string) {
  const taken = new Set(stops.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}
