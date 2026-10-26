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
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Crosshair, Share2, Eye, EyeOff, FileUp, Loader2, MapPin, Plus, Redo2, RotateCcw, Search, Trash2, Undo2, Wand2, X } from 'lucide-react';
import { useStore } from '@/lib/store';
import { km } from '@/lib/extras';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { compressPhoto, formatDuration, formatTime12, genId, routeLabel, dateLocale, syncVariants, variantComplete } from '@/lib/trips';
import { uuid } from '@/lib/uuid';
import type { Route, RouteStop } from '@/lib/types';
import { fetchRoadRoute, type RoadRoute } from '@/lib/routing';
import {
  bestInsertIndex,
  deletePlan,
  distanceToLine,
  lineLengthKm,
  loadPlans,
  arrivalEstimates,
  roundedOffsets,
  parseGpsFile,
  countJumps,
  fillGpsGaps,
  placeName,
  savePlan,
  searchPlaces,
  type GpsFile,
  type Place,
  type RoutePlan,
} from '@/lib/routeEditor';
import { Button, Card, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { ShareRouteDialog } from '@/components/admin/ShareRouteDialog';
import { GoogleMapsLinks } from '@/components/GoogleMapsLinks';
import { tx, txn } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
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
  const [roadKey, setRoadKey] = useState('');
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
        setRoadKey(key);
        setError(r.error ?? null);
      });
    }, delay);
    return () => {
      clearTimeout(id);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // fresh: the road is for the stops as they are now (not the ones before the last change).
  return { road, loading, error, fresh: !!road && roadKey === key };
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
        <Card className="p-6 text-[14px] text-[#46464f]">{isNew || saved ? tx('Loading…') : tx('This route no longer exists.')}</Card>
      </>
    );
  }
  return (
    <Editor
      key={base.id}
      route={base}
      savedRoute={isNew ? null : saved ?? null}
      departures={data.schedules.filter((sc) => sc.routeId === base.id && !sc.archived).sort((a, b) => Number(b.active) - Number(a.active) || a.departure.localeCompare(b.departure)).map((sc) => sc.departure)}
      onSave={async (r) => {
        const res = await saveRoute(r);
        if (!res.ok) {
          toast(res.reason ?? tx('Could not save'), 'error');
          return false;
        }
        toast(tx('{r} saved', { r: routeLabel(r) }), 'ok');
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
      <ArrowLeft className="w-4 h-4" />{' '}{tx('Routes & timetable')}</Link>
  );
}

function Editor({
  route,
  savedRoute,
  departures,
  onSave,
  toast,
  Toast,
}: {
  route: Route;
  savedRoute: Route | null;
  /** "HH:MM" departures of this route (active first), for clock times. */
  departures: string[];
  onSave: (r: Route) => Promise<boolean>;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  Toast: () => React.ReactNode;
}) {
  const [stops, setStops] = useState<RouteStop[]>(route.stops);
  const [active, setActive] = useState(route.active);
  const [flat, setFlat] = useState(route.flatFare !== false);
  const [name, setName] = useState(route.name ?? '');
  const [price, setPrice] = useState(route.stops[route.stops.length - 1]?.fareFromStart ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null); // stop waiting for a map click
  // What a click on the map does: add a stop (asks for a name), add a hidden shaping point (straight in), or nothing.
  const [clickMode, setClickMode] = useState<'stop' | 'point' | 'none'>('stop');
  const clickAdds = clickMode !== 'none';
  // Saved with the route, so its times and the road estimate stay in step.
  const [busFactor, setBusFactor] = useState(route.busFactor ?? 1.1);
  const [dwell, setDwell] = useState(route.stopMin ?? 2);
  const [gps, setGps] = useState<GpsFile | null>(null);
  const [gpsShown, setGpsShown] = useState(true);
  // Counts files loaded: the map frames a new file once, but doesn't jump when one is hidden or removed.
  const [gpsLoads, setGpsLoads] = useState(0);
  const [gpsFill, setGpsFill] = useState<{ done: number; total: number; filling: boolean } | null>(null);
  const gpsAbort = useRef<AbortController | null>(null);
  /** Unload the GPS file (stops placed from it stay where they are). */
  const removeGps = () => {
    gpsAbort.current?.abort();
    setGps(null);
    setGpsFill(null);
    setGpsShown(true);
  };
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
  // The map follows the stop you're looking at in the list while you scroll.
  const [follow, setFollow] = useState(true);
  const [inView, setInView] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!follow) {
      setInView(null);
      return;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const items = listRef.current?.querySelectorAll<HTMLElement>('[data-stop]');
        if (!items?.length) return;
        // The first stop whose card reaches below the top fifth of the screen.
        const line = window.innerHeight * 0.2;
        let found: number | null = null;
        for (const el of items) {
          if (el.getBoundingClientRect().bottom > line) {
            found = Number(el.dataset.stop);
            break;
          }
        }
        setInView(found);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [follow]);

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

  // ---- undo / redo ----
  // Every change first records how things were. Typing in one box counts as one
  // step (keystrokes less than a second apart are grouped).
  type Snap = { stops: RouteStop[]; flat: boolean; price: number; busFactor: number; dwell: number };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const lastTyping = useRef<{ key: string; t: number } | null>(null);
  const [, setHistoryTick] = useState(0);
  const snap = (): Snap => ({ stops, flat, price, busFactor, dwell });
  const record = (typingKey?: string) => {
    const now = Date.now();
    if (typingKey && lastTyping.current?.key === typingKey && now - lastTyping.current.t < 1000) {
      lastTyping.current.t = now;
      return;
    }
    lastTyping.current = typingKey ? { key: typingKey, t: now } : null;
    past.current.push(snap());
    if (past.current.length > 200) past.current.shift();
    future.current = [];
    setHistoryTick((n) => n + 1);
  };
  const restore = (to: Snap) => {
    setStops(to.stops);
    setFlat(to.flat);
    setPrice(to.price);
    setBusFactor(to.busFactor);
    setDwell(to.dwell);
    setDirty(true);
    setSelected(null);
    setPickFor(null);
    lastTyping.current = null;
    retime.current = false; // undo/redo brings back the times as they were
    setHistoryTick((n) => n + 1);
  };
  const undo = () => {
    const to = past.current.pop();
    if (!to) return;
    future.current.push(snap());
    restore(to);
  };
  const redo = () => {
    const to = future.current.pop();
    if (!to) return;
    past.current.push(snap());
    restore(to);
  };
  // Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y. Inside a text box, the box's own undo is left alone.
  const keys = useRef({ undo, redo });
  keys.current = { undo, redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) keys.current.undo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') keys.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Set when stops are added, moved, removed or reordered: the next fresh road estimate re-times them (if "Times follow the road" is on).
  const retime = useRef(false);
  const change = (fn: (s: RouteStop[]) => RouteStop[], typingKey?: string) => {
    record(typingKey);
    const next = fn(stops);
    if (layout(next) !== layout(stops)) retime.current = true;
    setStops(next);
    setDirty(true);
  };
  const TYPED: (keyof RouteStop)[] = ['name', 'landmark', 'notes', 'fareFromStart'];
  const update = (i: number, patch: Partial<RouteStop>) => {
    const fields = Object.keys(patch) as (keyof RouteStop)[];
    change((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)), fields.every((k) => TYPED.includes(k)) ? `${i}:${fields.join(',')}` : undefined);
  };
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

  /** Where a new stop fits best: the gap it adds the least distance to (or before the last stop). */
  const bestAt = (lat: number, lng: number) => (stops.length >= 2 && stops.every((s) => s.lat != null) ? bestInsertIndex(stops, { lat, lng }) : Math.max(1, stops.length - 1));

  /**
   * Adds a stop at position `at` (0 = new first stop, stops.length = new last stop),
   * with a time and fare between its neighbours.
   */
  const insertStop = (lat: number, lng: number, name: string, at: number, hidden = false) => {
    const p = stops;
    const prev = p[at - 1];
    const next = p[at];
    let n: RouteStop[];
    if (at === 0) {
      // New start: it leaves at 0:00, everything else is 30 min later.
      n = [{ name, offsetMin: 0, fareFromStart: 0, lat, lng }, ...p.map((s) => ({ ...s, offsetMin: s.offsetMin + 30 }))]; // the first stop is never hidden
    } else {
      const offsetMin = next ? Math.round((prev.offsetMin + next.offsetMin) / 2) : prev.offsetMin + 30;
      const fareFromStart = next ? Math.round((prev.fareFromStart + next.fareFromStart) / 2 / 10) * 10 : prev.fareFromStart + 100;
      n = [...p];
      n.splice(at, 0, { name, offsetMin, fareFromStart, lat, lng, ...(hidden && next ? { hidden: true } : {}) });
    }
    change(() => n);
    setSelected(at);
    return at;
  };

  // A place clicked on the map or found by name waits here until you say where it goes.
  const [pending, setPending] = useState<{ lat: number; lng: number; name: string; at: number; best: number } | null>(null);
  const propose = async (lat: number, lng: number, name: string | null) => {
    const best = bestAt(lat, lng);
    setPending({ lat: round(lat), lng: round(lng), name: name ?? tx('New stop'), at: best, best });
    if (name == null) {
      const found = await placeName(lat, lng);
      if (found) setPending((cur) => (cur && cur.lat === round(lat) && cur.lng === round(lng) && cur.name === 'New stop' ? { ...cur, name: uniqueName(stops, found) } : cur));
    }
  };
  const confirmPending = () => {
    if (!pending) return;
    insertStop(pending.lat, pending.lng, uniqueName(stops, pending.name.trim() || tx('New stop')), pending.at);
    setPending(null);
  };
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPending(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  const onMapClick = (lat: number, lng: number) => {
    if (pickFor != null) {
      update(pickFor, { lat: round(lat), lng: round(lng) });
      setSelected(pickFor);
      setPickFor(null);
      return;
    }
    if (clickMode === 'none') return;
    if (clickMode === 'point') {
      // Shaping point: goes straight in where it fits best, between two stops, with no questions.
      const at = Math.max(1, Math.min(stops.length - 1, bestAt(lat, lng)));
      insertStop(round(lat), round(lng), uniqueName(stops, `Point ${stops.filter((x) => x.hidden).length + 1}`), at, true);
      return;
    }
    propose(lat, lng, null);
  };

  const runSearch = async () => {
    setSearching(true);
    const r = await searchPlaces(query);
    setSearching(false);
    setResults(r.places);
    if (r.error) toast(r.error, 'error');
    else if (!r.places.length) toast(tx('No place found with that name. Try a nearby town, or pick it on the map.'), 'error');
  };
  const choosePlace = (pl: Place) => {
    if (searchFor === 'new') propose(pl.lat, pl.lng, uniqueName(stops, pl.name));
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
  // Road estimates for every stop (stops without a pin are spread between their neighbours).
  const estimates = useMemo(
    () => (edited.fresh && edited.road ? arrivalEstimates(stops, edited.road.legs, busFactor, dwell) : null),
    [edited.fresh, edited.road, stops, busFactor, dwell],
  );
  // While the road for the latest change is on its way, keep showing the last estimates (faded).
  const lastEstimates = useRef<number[] | null>(null);
  if (estimates) lastEstimates.current = estimates;
  const shownEst = estimates ?? (lastEstimates.current && lastEstimates.current.length === stops.length ? lastEstimates.current : null);
  const estStale = !estimates && !!shownEst;
  const roadOffsets = useMemo(() => (estimates ? roundedOffsets(estimates) : null), [estimates]);
  // Road distance / time for the leg into stop i, when it and the stop before both have pins.
  const legInto = (i: number) => {
    if (!edited.fresh || !edited.road) return null;
    const pinned = stops.map((s, j) => (s.lat != null ? j : -1)).filter((j) => j >= 0);
    const k = pinned.indexOf(i);
    return k > 0 && pinned[k - 1] === i - 1 ? edited.road.legs[k - 1] ?? null : null;
  };
  const editedTime = estimates ? estimates[estimates.length - 1] : null;
  const savedPinned = savedRoute ? located(savedRoute.stops).length === savedRoute.stops.length : false;
  const savedTime = savedPinned && savedRoad.road && savedRoad.fresh ? arrivalEstimates(savedRoute!.stops, savedRoad.road.legs, busFactor, dwell)?.at(-1) ?? null : null;

  // "Times follow the road": after you add, move, remove or reorder stops, every stop's time is set from the new estimate.
  const [autoTimes, setAutoTimes] = useState(true);
  const settingRetime = useRef(false);
  /** After "Bus vs car time" or "Stop time" changes: re-time the stops (or say how). */
  const settingChanged = () => {
    setDirty(true);
    if (!autoTimes) return toast(tx('Times not changed: tick “Times follow the road” or press “Fill times from road”.'), 'ok');
    if (!roadOffsets) return toast(tx('Times will update when the road estimate is ready (every stop needs a map pin).'), 'ok');
    settingRetime.current = true;
  };
  useEffect(() => {
    if (!autoTimes || !retime.current || !roadOffsets || roadOffsets.length !== stops.length) return;
    retime.current = false;
    const bySetting = settingRetime.current;
    settingRetime.current = false;
    if (stops.every((s, i) => s.offsetMin === roadOffsets[i])) return bySetting ? toast(tx('Stop times already match the new estimate'), 'ok') : undefined;
    setStops((p) => (p.length === roadOffsets.length ? p.map((s, i) => ({ ...s, offsetMin: roadOffsets[i] })) : p));
    setDirty(true);
    if (bySetting) toast(tx('Stop times updated. Save the route to keep them.'), 'ok');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadOffsets, autoTimes]);

  // Clock times on one of this route's departures.
  const [clockDep, setClockDep] = useState(departures[0] ?? '');
  const [sharing, setSharing] = useState(false);
  const changedFromSaved = !!savedRoute && JSON.stringify(savedRoute.stops.map(pick)) !== JSON.stringify(stops.map(pick));

  /**
   * Turn the route round: last stop first. Times and fares are mirrored (a stop
   * 2:05 from the start is now 2:05 from the end), and with "Times follow the
   * road" they are then re-timed from the road in the new direction. Undoable.
   */
  const reverseStops = () => {
    if (
      departures.length > 0 &&
      !window.confirm(
        txn(departures.length, 'This route has {n} departure in the timetable. Saving it reversed changes the direction those buses run, for passengers who already booked too.\n\nTo run the other direction as well, use "Create return route" on the Routes & timetable page instead.\n\nReverse this route anyway? (You can undo it, and nothing changes until you save.)', 'This route has {n} departures in the timetable. Saving it reversed changes the direction those buses run, for passengers who already booked too.\n\nTo run the other direction as well, use "Create return route" on the Routes & timetable page instead.\n\nReverse this route anyway? (You can undo it, and nothing changes until you save.)'),
      )
    )
      return;
    change((p) => {
      const last = p[p.length - 1];
      return [...p].reverse().map((s) => ({ ...s, offsetMin: last.offsetMin - s.offsetMin, fareFromStart: last.fareFromStart - s.fareFromStart }));
    });
    setSelected(null);
    toast(tx('Route reversed. Undo brings it back.'), 'ok');
  };

  const fillTimes = () => {
    if (!roadOffsets) return;
    change((p) => p.map((s, i) => ({ ...s, offsetMin: roadOffsets[i] })));
    toast(tx('Times filled from the road estimate'), 'ok');
  };

  // ---- GPS file ----
  const loadGps = async (file: File) => {
    const parsed = parseGpsFile(file.name, await file.text());
    if (!parsed) return toast(tx('No GPS points found in that file. Use the CSV or GPX from GPS trip log, or any GPX track.'), 'error');
    gpsAbort.current?.abort();
    setGps(parsed);
    setGpsShown(true);
    setGpsLoads((n) => n + 1);
    toast(tx('Loaded {length} points from {name}', { length: parsed.line.length.toLocaleString(), name: file.name }), 'ok');
    // Gaps of more than 2 km still in the file (e.g. exported before they were filled, or from another app): fill them with the likely road.
    const total = countJumps(parsed);
    setGpsFill(total ? { done: 0, total, filling: true } : null);
    if (!total) return;
    const ctl = new AbortController();
    gpsAbort.current = ctl;
    await fillGpsGaps(parsed, (f, done) => { if (!ctl.signal.aborted) { setGps(f); setGpsFill({ done, total, filling: done < total }); } }, ctl.signal);
    if (!ctl.signal.aborted) setGpsFill((g) => (g ? { ...g, filling: false } : g));
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

  const finalRoute = (): Route => ({ ...route, variants: savedRoute?.variants ?? route.variants, name: name.trim() || undefined, busFactor, stopMin: dwell, active, flatFare: flat, stops: (flat ? flatStops(stops, price) : stops).map((s) => ({ ...s, name: s.name.trim() })) });
  // ---- variants: other ways for when on-request stops don't fill ----
  // Every mix of on-request stops has a variant (made automatically, shown here even before the next save).
  const variants = useMemo(() => (savedRoute ? syncVariants(savedRoute).variants ?? [] : []), [savedRoute]);
  const variantId = planId.startsWith('v:') ? planId.slice(2) : null;
  const openVariant = variantId ? variants.find((v) => v.id === variantId) ?? null : null;
  const mainOptional = (savedRoute?.stops ?? []).filter((s) => s.optional && !s.hidden);
  const covers = (list: RouteStop[]) => mainOptional.filter((o) => list.some((s) => !s.hidden && s.name.trim().toLowerCase() === o.name.trim().toLowerCase())).map((o) => o.name);
  const variantProblems = (list: RouteStop[], selfId: string | null): string[] => {
    if (!savedRoute) return [];
    const out: string[] = [];
    const has = (n: string) => list.some((s) => !s.hidden && s.name.trim().toLowerCase() === n.trim().toLowerCase());
    if (list[0] && savedRoute.stops[0] && list[0].name.trim().toLowerCase() !== savedRoute.stops[0].name.trim().toLowerCase()) out.push(`A variant starts where the route starts (${savedRoute.stops[0].name}).`);
    const extra = list.filter((s) => !s.hidden && !savedRoute.stops.some((m) => m.name.trim().toLowerCase() === s.name.trim().toLowerCase())).map((s) => s.name);
    if (extra.length) out.push(`A variant can only use the route's stops (add new stops to the live route first): ${extra.join(', ')}.`);
    const cov = covers(list);
    if (cov.length === mainOptional.length) out.push('This variant goes to every on-request stop, like the live route. Remove the on-request stops it is for skipping.');
    const same = variants.find((v) => v.id !== selfId && JSON.stringify(covers(v.stops).sort()) === JSON.stringify([...cov].sort()));
    if (same) out.push(`The variant "${same.name}" already covers the same on-request stops.`);
    return out;
  };
  const vProblems = openVariant ? variantProblems(finalRoute().stops, openVariant.id) : [];
  // Main stops left out of the open variant (allowed, but passengers booked there are affected).
  const leftOut = (list: RouteStop[]) =>
    (savedRoute?.stops ?? []).filter((m) => !m.hidden && !m.optional && !list.some((s) => !s.hidden && s.name.trim().toLowerCase() === m.name.trim().toLowerCase())).map((m) => m.name);
  const vLeftOut = openVariant ? leftOut(stops) : [];

  const save = async () => {
    setSaving(true);
    const ok = openVariant && savedRoute
      ? await onSave({ ...savedRoute, variants: variants.map((v) => (v.id === openVariant.id ? { ...v, stops: finalRoute().stops, edited: true, removed: leftOut(finalRoute().stops) } : v)) })
      : await onSave(finalRoute());
    setSaving(false);
    if (ok) setDirty(false);
  };
  /** Back to the automatic version of an edited variant (rebuilt from the live route). */
  const resetVariant = async () => {
    if (!openVariant || !savedRoute || !window.confirm(`Reset "${openVariant.name}" to the automatic version? Your changes to it are lost.`)) return;
    const next = syncVariants({ ...savedRoute, variants: variants.map((v) => (v.id === openVariant.id ? { ...v, edited: false } : v)) });
    const ok = await onSave(next);
    if (ok) {
      const fresh = next.variants?.find((v) => v.id === openVariant.id);
      if (fresh) setStops(structuredClone(fresh.stops));
      setDirty(false);
    }
  };

  // ---- drafts ----
  const saveDraft = async () => {
    if (!savedRoute) return;
    const current = plans.find((p) => p.id === planId);
    const name = window.prompt(tx('Name this draft'), current?.name ?? `${tx('Draft')} ${fmtDate(new Date(), { day: 'numeric', month: 'short' })}`);
    if (name == null) return;
    const r = await savePlan({ id: current && current.name === name ? current.id : undefined, name: name.trim() || tx('Draft'), routeId: savedRoute.id, stops: finalRoute().stops, notes: '' });
    if (!r.ok || !r.plan) return toast(r.reason ?? tx('Could not save the draft'), 'error');
    setPlans((ps) => [r.plan!, ...ps.filter((p) => p.id !== r.plan!.id)]);
    setPlanId(r.plan.id);
    toast(tx('Draft saved. The live route is unchanged.'), 'ok');
  };
  const openDraft = (id: string) => {
    if (dirty && !window.confirm(tx('Open this version? Changes not saved here will be lost.'))) return;
    // Variants: the up-to-date list (made automatically), not only what was last saved.
    const src = id.startsWith('v:') ? variants.find((v) => v.id === id.slice(2))?.stops : id ? plans.find((p) => p.id === id)?.stops : savedRoute?.stops;
    if (!src) return toast(tx('Could not open that version.'), 'error');
    setPlanId(id);
    record();
    setStops(structuredClone(src));
    setPrice(src[src.length - 1]?.fareFromStart ?? price);
    setSelected(null);
    setDirty(!!id && !id.startsWith('v:'));
  };
  const removeDraft = async () => {
    const p = plans.find((x) => x.id === planId);
    if (!p || !window.confirm(tx('Delete the draft "{name}"?', { name: p.name }))) return;
    const r = await deletePlan(p.id);
    if (!r.ok) return toast(r.reason ?? tx('Could not delete'), 'error');
    setPlans((ps) => ps.filter((x) => x.id !== p.id));
    setPlanId('');
    toast(tx('Draft deleted'), 'ok');
  };

  const title = savedRoute ? tx('Edit {savedRoute}', { savedRoute: routeLabel(savedRoute) }) : tx('New route');

  return (
    <>
      <BackLink />
      <PageHeader
        title={title}
        description={tx('Find stops by name or place them on the map. The road route updates as you go, next to the saved route, so you can try changes and see the distance and time before saving.')}
        actions={
          <>
            {savedRoute && (
              <Button variant="secondary" onClick={() => setSharing(true)} title={tx('A private link to a read-only page with this route as it is now')}>
                <Share2 className="w-4 h-4" />{' '}{tx('Share')}</Button>
            )}
            {savedRoute && !openVariant && (
              <Button variant="secondary" onClick={saveDraft}>{tx('Save as draft')}</Button>
            )}
            <Button variant="gold" disabled={problems.length > 0 || vProblems.length > 0 || saving} onClick={save}>
              {saving ? tx('Saving…') : openVariant ? 'Save variant' : tx('Save route')}
            </Button>
          </>
        }
      />

      {/* Summary: as edited vs saved */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label={tx('Road distance')} value={edited.fresh && edited.road ? `${edited.road.distanceKm.toFixed(1)} km${allPinned ? '' : '*'}` : edited.loading ? '…' : '—'} sub={savedRoute && edited.fresh && edited.road && savedRoad.road && savedPinned && allPinned ? tx('{d} vs saved', { d: signed(edited.road!.distanceKm - savedRoad.road.distanceKm, 'km', 1) }) : allPinned ? tx('by road') : tx('*through pinned stops · {n} without a pin', { n: unpinned })} />
        <Stat label={tx('Bus time (road estimate)')} value={editedTime != null ? dur(editedTime) : '—'} sub={savedTime != null && editedTime != null ? `${signed(editedTime - savedTime, 'min')} vs saved` : `road × ${busFactor} + ${dwell} min a stop`} />
        <Stat label={tx('Timetable end to end')} value={dur(stops[stops.length - 1]?.offsetMin ?? 0)} sub={editedTime != null ? tx('{d} vs road estimate', { d: signed((stops[stops.length - 1]?.offsetMin ?? 0) - editedTime, 'min') }) : tx('from the times below')} />
        <Stat label={tx('Stops')} value={String(stops.length)} sub={savedRoute ? (changedFromSaved ? signed(stops.length - savedRoute.stops.length, tx('vs saved')) : tx('same as saved')) : tx('new route')} />
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
                <span className="text-[12px] font-bold text-[#46464f] px-1">{tx('Version')}</span>
                <select className={`${inputClass} mt-1`} value={planId} onChange={(e) => openDraft(e.target.value)}>
                  <option value="">{tx('Live route')}{changedFromSaved && !planId ? tx(' (edited)') : ''}</option>
                  {variants.length > 0 && (
                    <optgroup label="Variants (when on-request stops don't fill)">
                      {variants.map((v) => {
                        const cov = covers(v.stops);
                        return <option key={v.id} value={`v:${v.id}`}>{`Variant: ${v.name} (${cov.length ? `goes to ${cov.join(', ')}` : 'no on-request stops'}) · ${v.edited ? (savedRoute && !variantComplete(savedRoute, v) ? 'edited, needs fixing' : 'edited') : 'automatic'}`}</option>;
                      })}
                    </optgroup>
                  )}
                  {plans.length > 0 && (
                    <optgroup label="Drafts">
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{tx('Draft: {name} ({length} stops)', { name: p.name, length: p.stops.length })}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              {planId && !openVariant && (
                <Button variant="danger" onClick={removeDraft}>
                  <Trash2 className="w-4 h-4" />{' '}{tx('Delete draft')}</Button>
              )}
              {openVariant?.edited && (
                <Button variant="secondary" onClick={resetVariant}>
                  <RotateCcw className="w-4 h-4" /> Reset to automatic</Button>
              )}
              <p className="w-full text-[12px] text-[#6b6d78]">{tx('Drafts keep ideas without changing the live route. Open one and press “Save route” to make it live.')}</p>
              {mainOptional.length > 0 && (
                <p className="w-full text-[12px] text-[#6b6d78]">
                  Variants are made automatically: one for every mix of on-request stops ({variants.length} for {mainOptional.length} on-request {mainOptional.length === 1 ? 'stop' : 'stops'}), each the route without the stops it skips. Each trip uses the one matching the on-request stops that filled. Open one under Version to change its road, order or times; edited variants are kept when the route changes.
                </p>
              )}
              {openVariant && (
                <div className="w-full rounded-xl bg-[#f5f3ff] border border-[#ddd6fe] px-3 py-2.5 text-[12px] text-[#3b0764]">
                  <p className="font-bold">Editing variant “{openVariant.name}” · {openVariant.edited ? 'edited' : 'automatic (saving here keeps your version)'}</p>
                  <p>{covers(stops).length ? `Used when only ${covers(stops).join(', ')} ${covers(stops).length === 1 ? 'fills' : 'fill'}.` : 'Used when none of the on-request stops fill.'} The live route is not changed.</p>
                  {!openVariant.edited && <p className="mt-1">Times are the live route&apos;s, so nobody waiting at a later stop is left behind (the bus waits instead of leaving early). To use road times for this variant, press “Fill times from road” below and then “Save variant”.</p>}
                  {vProblems.map((p) => <p key={p} className="font-semibold text-[#ba1a1a] mt-1">{p}</p>)}
                  {vLeftOut.length > 0 && (
                    <p className="font-semibold text-[#92400e] mt-1">
                      Not in this variant: {vLeftOut.join(', ')}. On trips that use it, passengers booked to or from {vLeftOut.length === 1 ? 'it' : 'them'} are shown the nearest point on the way the bus goes instead. Tell them, or make sure nobody is booked there.
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {!openVariant && <Card className="p-4 space-y-2">
            <label className="block">
              <span className="text-[13px] font-bold text-[#050a44]">{tx('Route name')}</span>
              <input
                className={`${inputClass} mt-1.5`}
                value={name}
                maxLength={60}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
                placeholder={stops.length >= 2 && stops[0].name && stops[stops.length - 1].name ? `${stops[0].name.trim()} → ${stops[stops.length - 1].name.trim()}` : tx('e.g. Akkaraipattu to Colombo')}
              />
            </label>
            <p className="text-[12px] text-[#6b6d78]">{tx('Shown to staff, conductors and passengers. Leave it empty to use the first and last stop.')}</p>
          </Card>}

          <Card className="p-4 space-y-3">
            <p className="text-[13px] font-bold text-[#050a44]">{tx('Ticket price')}</p>
            <div className="flex gap-2">
              {([true, false] as const).map((f) => (
                <button
                  key={String(f)}
                  type="button"
                  aria-pressed={flat === f}
                  onClick={() => { if (flat !== f) record(); setFlat(f); setDirty(true); }}
                  className={`flex-1 min-h-10 px-2 py-1.5 rounded-lg text-[13px] font-bold border ${flat === f ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white border-[#c7c5d1] text-[#46464f]'}`}
                >
                  {f ? tx('One price for the whole route') : tx('Price by distance (per stop)')}
                </button>
              ))}
            </div>
            {flat ? (
              <label className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] font-bold text-[#46464f]">{tx('Price per seat (LKR)')}</span>
                <input type="number" min={0} step={50} className={`${inputClass} !w-36`} value={price} onChange={(e) => { record('price'); setPrice(Math.max(0, Number(e.target.value))); setDirty(true); }} aria-label={tx('Ticket price')} />
              </label>
            ) : (
              <p className="text-[12px] text-[#46464f]">{tx('Each stop\'s fare from the first stop is set below. A passenger pays the difference between their two stops.')}</p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[#edeef0] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Stops')}</h2>
                <p className="text-[12px] text-[#6b6d78]">{tx('“Arrives after” is the time from leaving the first stop.')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" disabled={stops.length < 2} onClick={reverseStops} title={tx('Last stop first: turn this route round (undoable)')}>
                  <ArrowUpDown className="w-3.5 h-3.5" />{' '}{tx('Reverse order')}</Button>
                <label className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#050a44]" title={tx('When you add, move, remove or reorder stops, every stop\'s time is set from the road estimate (undo brings the old times back)')}>
                  <input type="checkbox" className="w-4 h-4 accent-[#050a44]" checked={autoTimes} onChange={(e) => { setAutoTimes(e.target.checked); if (e.target.checked) retime.current = true; }} />{tx('Times follow the road')}</label>
                {!autoTimes && (
                  <Button size="sm" variant="secondary" disabled={!roadOffsets} onClick={fillTimes} title={roadOffsets ? '' : tx('The first and last stops need a map pin')}>
                    <Wand2 className="w-3.5 h-3.5" />{' '}{tx('Fill times from road')}</Button>
                )}
              </div>
            </div>
            {departures.length > 0 && (
              <div className="px-4 py-2 border-b border-[#edeef0] flex flex-wrap items-center gap-2 text-[12px] text-[#46464f]">
                <span className="font-bold">{tx('Clock times for the')}</span>
                <select className={`${inputClass} !w-auto !py-1`} value={clockDep} onChange={(e) => setClockDep(e.target.value)} aria-label={tx('Departure for clock times')}>
                  {departures.filter((d, i, a) => a.indexOf(d) === i).map((d) => (
                    <option key={d} value={d}>{formatTime12(d)}</option>
                  ))}
                  <option value="">{tx('(no clock times)')}</option>
                </select>
                <span>{tx('departure')}</span>
              </div>
            )}
            <ol ref={listRef}>
              {stops.map((s, i) => {
                const leg = i > 0 ? legInto(i) : null;
                const est = shownEst?.[i];
                const off = est != null && i > 0 && !estStale ? s.offsetMin - est : null;
                const fromGps = gps && gpsShown && s.lat != null ? distanceToLine(gps.line, { lat: s.lat, lng: s.lng! }) : null;
                const end = i === 0 || i === stops.length - 1;
                return (
                  <li key={i} data-stop={i}>
                    {i > 0 && (
                      <div className="pl-[30px] py-1 text-[11px] font-semibold text-[#6b6d78] tabular-nums border-l-2 border-dashed border-[#c7c5d1] ml-[27px]">
                        {leg ? tx('{km} km · {dur} by road', { km: leg.km.toFixed(1), dur: dur(leg.min * busFactor) }) : edited.loading ? tx('working out the road…') : ''}
                      </div>
                    )}
                    <div className={`px-4 py-3 ${selected === i ? 'bg-[#feb700]/10' : ''}`} onFocus={() => setSelected(i)}>
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(i)}
                          aria-label={tx('Show stop {v} on the map', { v: i + 1 })}
                          className={`mt-1.5 w-7 h-7 shrink-0 rounded-full border-[3px] text-[11px] font-extrabold inline-flex items-center justify-center ${end ? 'bg-[#050a44] text-white keep-navy' : 'bg-white text-[#050a44]'} ${selected === i ? 'border-[#feb700]' : 'border-[#050a44]'}`}
                        >
                          {i + 1}
                        </button>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex gap-1.5">
                            <input aria-label={tx('Stop {v} name', { v: i + 1 })} className={inputClass} value={s.name} placeholder={tx('Stop name, e.g. Kegalle')} onChange={(e) => update(i, { name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && openSearch(i)} />
                            <Button variant="secondary" aria-label={tx('Find this place on the map')} title={tx('Find on the map')} onClick={() => openSearch(i)}>
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
                              <span className="font-semibold text-[#7c5800]">{tx('No map pin: search or pick on the map')}</span>
                            )}
                            <button type="button" className={`font-bold underline ${pickFor === i ? 'text-[#ba1a1a]' : 'text-[#050a44]'}`} onClick={() => setPickFor(pickFor === i ? null : i)}>
                              <Crosshair className="inline w-3.5 h-3.5 -mt-0.5" /> {pickFor === i ? tx('Click the map… (cancel)') : tx('Pick on map')}
                            </button>
                            {fromGps != null && fromGps > 0.3 && fromGps < 15 && <span className="font-semibold text-[#ba1a1a]">{tx('{fromGps} km from the road driven', { fromGps: fromGps.toFixed(1) })}</span>}
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="block">
                              <span className="block text-[11px] font-bold text-[#686873] mb-0.5">{tx('Arrives after (h:mm)')}</span>
                              <DurationInput label={tx('Stop {v} time from start', { v: i + 1 })} minutes={s.offsetMin} disabled={i === 0} onChange={(m) => update(i, { offsetMin: m })} />
                            </label>
                            {!flat && (
                              <label className="block">
                                <span className="block text-[11px] font-bold text-[#686873] mb-0.5">{tx('Fare from start (LKR)')}</span>
                                <input aria-label={tx('Stop {v} fare', { v: i + 1 })} type="number" min={0} step={10} className={`${inputClass} !w-32`} value={s.fareFromStart} disabled={i === 0} onChange={(e) => update(i, { fareFromStart: Number(e.target.value) })} />
                              </label>
                            )}
                            {est != null && i > 0 && (
                              <p className={`text-[11px] text-[#6b6d78] pb-2 transition-opacity ${estStale ? 'opacity-40' : ''}`} aria-live="polite">{tx('Road estimate')}{' '}<b className="text-[#050a44] tabular-nums">{hmm(est)}</b>
                                {clockDep && <>{tx('· arrives')}{' '}<b className="text-[#050a44] tabular-nums">≈ {clock(clockDep, est)}</b></>}
                                {s.lat == null && tx(' (no pin: between its neighbours)')}
                                {off != null && Math.abs(off) >= 15 && <span className={`font-semibold ${off < 0 ? 'text-[#ba1a1a]' : 'text-[#7c5800]'}`}>{tx('({off} vs timetable)', { off: signed(off, 'min') })}</span>}
                                {estStale && tx(' · updating…')}
                              </p>
                            )}
                          </div>
                          {i > 0 && i < stops.length - 1 && (
                            <label className="flex items-center gap-2 px-2 py-1 text-[12px] font-bold text-[#46464f] cursor-pointer">
                              <input type="checkbox" checked={!!s.hidden} onChange={(e) => update(i, { hidden: e.target.checked || undefined, ...(e.target.checked ? { optional: undefined, minSeats: undefined } : {}) })} className="accent-[#050a44]" />
                              Hide from passengers (only shapes the road)
                            </label>
                          )}
                          {i > 0 && i < stops.length - 1 && !s.hidden && (
                            <div className={`rounded-lg px-2 py-1.5 mb-1 ${s.optional ? 'bg-[#f5f3ff] border border-[#ddd6fe]' : ''}`}>
                              <label className="flex items-center gap-2 text-[12px] font-bold text-[#4c1d95] cursor-pointer">
                                <input type="checkbox" checked={!!s.optional} onChange={(e) => update(i, { optional: e.target.checked || undefined, minSeats: e.target.checked ? s.minSeats ?? 4 : undefined })} className="accent-[#7c3aed]" />
                                On request (detour)
                              </label>
                              {s.optional && (
                                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-[#46464f]">
                                  Only if at least
                                  <input type="number" min={1} max={60} aria-label={`Seats needed for ${s.name || `stop ${i + 1}`}`} value={s.minSeats ?? 4}
                                    onChange={(e) => update(i, { minSeats: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                                    className="w-16 h-8 px-2 rounded-md border border-[#c7c5d1] bg-white text-[13px] font-bold text-[#050a44]" />
                                  seats are booked to or from here. Otherwise those passengers are moved to the nearest main stop and told.
                                </p>
                              )}
                            </div>
                          )}
                          <details>
                            <summary className="text-[11px] font-bold text-[#7c5800] cursor-pointer">{tx('Where to wait')}{s.landmark ? ' ✓' : ''}</summary>
                            <div className="space-y-1.5 mt-1.5">
                              <input aria-label={tx('Stop {v} landmark', { v: i + 1 })} className={inputClass} placeholder={tx('Landmark, e.g. Clock tower roundabout')} value={s.landmark ?? ''} onChange={(e) => update(i, { landmark: e.target.value })} />
                              <input aria-label={tx('Stop {v} notes', { v: i + 1 })} className={inputClass} placeholder={tx('Notes, e.g. wait under the bus shelter')} value={s.notes ?? ''} onChange={(e) => update(i, { notes: e.target.value })} />
                              <div className="flex items-center gap-2">
                                {s.photo && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={s.photo} alt="" className="w-12 h-12 rounded object-cover border border-[#e1e2e4]" />
                                )}
                                <label className="text-[12px] font-bold text-[#050a44] underline cursor-pointer">
                                  {s.photo ? tx('Replace photo') : tx('Add photo of the spot')}
                                  <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) update(i, { photo: await uploadStopPhoto(f) }); }} />
                                </label>
                              </div>
                            </div>
                          </details>
                        </div>
                        <div className="flex flex-col">
                          <Button size="sm" variant="ghost" aria-label={tx('Move up')} disabled={i === 0} onClick={() => move(i, -1)}>
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={tx('Move down')} disabled={i === stops.length - 1} onClick={() => move(i, 1)}>
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={tx('Remove stop')} disabled={stops.length <= 2} onClick={() => removeStop(i)}>
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
                <SearchBox query={query} setQuery={setQuery} run={runSearch} searching={searching} results={results} choose={choosePlace} close={() => setSearchFor(null)} placeholder={tx('Town or place to add as a stop')} autoFocus />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openSearch('new')}>
                    <Search className="w-4 h-4" />{' '}{tx('Add a stop by name')}</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const last = stops[stops.length - 1];
                      change((p) => [...p, { name: '', offsetMin: last.offsetMin + 30, fareFromStart: last.fareFromStart + 100 }]);
                    }}
                  >
                    <Plus className="w-4 h-4" />{' '}{tx('Empty stop at the end')}</Button>
                </div>
              )}
              <p className="text-[11px] text-[#686873]">{tx('A stop found by name or clicked on the map goes where it fits best on the way. Times are hours:minutes from the first stop, e.g. 2:05.')}</p>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <label className="flex items-center gap-2 text-[13px] font-semibold text-[#050a44]">
              <input type="checkbox" checked={active} onChange={(e) => { setActive(e.target.checked); setDirty(true); }} className="w-4 h-4 accent-[#050a44]" />{tx('Route is open for booking')}</label>
            {problems.length > 0 ? (
              <ul className="text-[12px] font-semibold text-[#ba1a1a] space-y-0.5">
                {problems.slice(0, 5).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[#1f7a3a] font-semibold">{tx('Ready to save.')}{dirty ? tx(' You have unsaved changes.') : ''}</p>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------ right: map -- */}
        <div className="xl:sticky xl:top-4 space-y-3 min-w-0 order-1 xl:order-2">
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
              <div className="inline-flex p-0.5 rounded-lg bg-[#f2f4f6] border border-[#e1e2e4]" role="group" aria-label={tx('Clicking the map')}>
                {(['stop', 'point', 'none'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={clickMode === v} onClick={() => setClickMode(v)} className={`px-3 h-8 rounded-md text-[12px] font-bold ${clickMode === v ? 'bg-[#050a44] text-white keep-navy' : 'text-[#050a44]'}`}
                    title={v === 'point' ? 'Each click adds a hidden point that makes the road go that way. Passengers never see it.' : undefined}>
                    {v === 'stop' ? 'Click adds a stop' : v === 'point' ? 'Click adds a hidden point' : 'Click does nothing'}
                  </button>
                ))}
              </div>
              <div className="inline-flex gap-1" role="group" aria-label={tx('Undo and redo')}>
                <Button size="sm" variant="secondary" disabled={!past.current.length} onClick={undo} title={tx('Undo (Ctrl+Z)')} aria-label={tx('Undo')}>
                  <Undo2 className="w-3.5 h-3.5" />{' '}{tx('Undo')}</Button>
                <Button size="sm" variant="secondary" disabled={!future.current.length} onClick={redo} title={tx('Redo (Ctrl+Shift+Z or Ctrl+Y)')} aria-label={tx('Redo')}>
                  <Redo2 className="w-3.5 h-3.5" />{' '}{tx('Redo')}</Button>
              </div>
              {savedRoute && changedFromSaved && (
                <Button
                  size="sm"
                  variant="ghost"
                  title={tx('Back to the saved route (can be undone)')}
                  onClick={() => {
                    record();
                    setStops(structuredClone(openVariant?.stops ?? savedRoute.stops));
                    setFlat(savedRoute.flatFare !== false);
                    setName(savedRoute.name ?? '');
                    setBusFactor(savedRoute.busFactor ?? 1.1);
                    setDwell(savedRoute.stopMin ?? 2);
                    setPrice(savedRoute.stops[savedRoute.stops.length - 1]?.fareFromStart ?? price);
                    setSelected(null);
                    setDirty(false);
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" />{' '}{tx('Back to saved')}</Button>
              )}
              <GoogleMapsLinks stops={stops} />
              <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                <FileUp className="w-3.5 h-3.5" /> {gps ? tx('Change GPS file') : tx('Load GPS file')}
              </Button>
              {gps && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setGpsShown((v) => !v)} aria-pressed={!gpsShown} title={gpsShown ? tx('Hide the GPS track (keep it loaded)') : tx('Show the GPS track again')}>
                    {gpsShown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {gpsShown ? tx('Hide GPS') : tx('Show GPS')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={removeGps} title={tx('Remove the GPS track from the map. Your stops stay where you put them.')}>
                    <X className="w-3.5 h-3.5" />{' '}{tx('Remove GPS')}</Button>
                </>
              )}
              <input ref={fileInput} type="file" accept=".gpx,.csv,application/gpx+xml,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadGps(f); e.target.value = ''; }} />
              {(edited.loading || savedRoad.loading) && <Loader2 className="w-4 h-4 animate-spin text-[#6b6d78]" aria-label={tx('Updating the road route')} />}
            </div>
            {pending && (
              <PendingPanel
                pending={pending}
                stops={stops}
                onChange={(patch) => setPending((cur) => (cur ? { ...cur, ...patch } : cur))}
                onAdd={confirmPending}
                onCancel={() => setPending(null)}
              />
            )}
            {pickFor != null && (
              <p className="mx-1 mb-2 rounded-lg bg-[#feb700]/20 px-3 py-2 text-[12px] font-bold text-[#050a44]">{tx('Click the map to place')}{' '}{stops[pickFor]?.name || tx('stop {v}', { v: pickFor + 1 })}.{' '}
                <button className="underline" onClick={() => setPickFor(null)}>{tx('Cancel')}</button>
              </p>
            )}
            <RouteEditorMap
              stops={stops}
              selected={selected}
              editedRoad={edited.road?.path}
              savedRoad={changedFromSaved ? savedRoad.road?.path : null}
              gps={gps && gpsShown ? { line: gps.line, est: gps.est } : null}
              picking={pickFor != null || clickAdds}
              follow={follow ? inView : null}
              pending={
                pending
                  ? {
                      lat: pending.lat,
                      lng: pending.lng,
                      prev: pinOf(stops[pending.at - 1]),
                      next: pinOf(stops[pending.at]),
                    }
                  : null
              }
              onMovePending={(lat, lng) =>
                setPending((cur) => {
                  if (!cur) return cur;
                  const best = bestAt(lat, lng);
                  // Still on the suggested position? Keep following the best fit.
                  return { ...cur, lat: round(lat), lng: round(lng), best, at: cur.at === cur.best ? best : cur.at };
                })
              }
              onMoveStop={(i, lat, lng) => { update(i, { lat: round(lat), lng: round(lng) }); setSelected(i); }}
              onSelect={setSelected}
              onMapClick={onMapClick}
              fitKey={`${route.id}:${planId}:${gpsLoads}`}
              className="h-[420px] xl:h-[calc(100vh-260px)] xl:min-h-[480px]"
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-[12px] text-[#46464f]">
              <span><i className="inline-block w-5 h-1.5 align-middle rounded bg-[#1f7a3a] mr-1" />{tx('Route as edited')}</span>
              {changedFromSaved && <span><i className="inline-block w-5 align-middle border-t-[3px] border-dashed border-[#6b6d78] mr-1" />{tx('Saved route')}</span>}
              {gps && (
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block w-5 h-1 align-middle rounded bg-[#feb700] mr-1" />{tx('Road driven: {name} · {toFixed} km', { name: gps.name, toFixed: lineLengthKm(gps.line).toFixed(1) })}{gpsShown ? '' : tx(' (hidden)')}
                  {gps.est.some(Boolean) && <span className="inline-flex items-center"><i className="inline-block w-4 align-middle border-t-[3px] border-dotted border-[#ba1a1a] mx-1" />{tx('estimated road in gaps')}</span>}
                  {gpsFill?.filling && <span className="text-[#6b6d78]">{tx('· filling gaps over 2 km… {done}/{total}', { done: gpsFill.done, total: gpsFill.total })}</span>}
                  <button aria-label={tx('Remove GPS file')} onClick={removeGps} className="ml-0.5"><X className="w-3.5 h-3.5" /></button>
                </span>
              )}
              <label className="inline-flex items-center gap-1.5 font-semibold text-[#050a44]">
                <input type="checkbox" className="w-3.5 h-3.5 accent-[#050a44]" checked={follow} onChange={(e) => setFollow(e.target.checked)} />{tx('Map follows the list')}</label>
              <span className="text-[#6b6d78]">{tx('Scroll or swipe to move the map · pinch or Ctrl+scroll to zoom · drag a pin to move a stop.')}</span>
            </div>
          </Card>
          <Card className="p-4 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-0.5">{tx('Bus vs car time')}</span>
              <SettingNumber
                label={tx('Bus vs car time')}
                value={busFactor}
                min={0.5}
                max={3}
                onChange={(v) => {
                  // A slower or faster bus: re-time the stops too (if "Times follow the road" is on). Undoable.
                  record('setting:busFactor');
                  retime.current = true;
                  setBusFactor(v);
                  settingChanged();
                }}
              />
              <span className="block text-[11px] text-[#686873] mt-0.5">{tx('Road times are car times; a bus is slower. With “Times follow the road” on, changing this re-times the stops.')}</span>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-0.5">{tx('Stop time (min)')}</span>
              <SettingNumber
                label={tx('Stop time in minutes')}
                value={dwell}
                min={0}
                max={30}
                onChange={(v) => {
                  record('setting:dwell');
                  retime.current = true;
                  setDwell(v);
                  settingChanged();
                }}
              />
              <span className="block text-[11px] text-[#686873] mt-0.5">{tx('At each stop on the way (hidden points add none). Also re-times the stops.')}</span>
            </label>
          </Card>
        </div>
      </div>
      {sharing && savedRoute && (
        <ShareRouteDialog
          routeId={savedRoute.id}
          defaultTitle={plans.find((x) => x.id === planId)?.name ?? `${stops[0]?.name || tx('Start')} → ${stops[stops.length - 1]?.name || tx('End')}${changedFromSaved ? ` (${tx('proposed')})` : ''}`}
          stops={stops}
          path={edited.fresh && allPinned ? edited.road?.path ?? null : null}
          distanceKm={edited.fresh && allPinned ? edited.road?.distanceKm ?? null : null}
          departures={departures}
          defaultDeparture={clockDep}
          onClose={() => setSharing(false)}
          toast={toast}
        />
      )}
      <Toast />
    </>
  );
}

const pinOf = (s: RouteStop | undefined): [number, number] | null => (s?.lat != null && s.lng != null ? [s.lat, s.lng] : null);

/** A place waiting to be added: its name and which stop it comes after. */
function PendingPanel({
  pending,
  stops,
  onChange,
  onAdd,
  onCancel,
}: {
  pending: { lat: number; lng: number; name: string; at: number; best: number };
  stops: RouteStop[];
  onChange: (patch: { name?: string; at?: number }) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const p = { lat: pending.lat, lng: pending.lng };
  const prev = stops[pending.at - 1];
  const next = stops[pending.at];
  // Extra straight-line distance from going via this place (a rough guide; the road route updates once it's added).
  const extra = (() => {
    const a = prev?.lat != null ? { lat: prev.lat, lng: prev.lng! } : null;
    const b = next?.lat != null ? { lat: next.lat, lng: next.lng! } : null;
    if (a && b) return km(a, p) + km(p, b) - km(a, b);
    if (a) return km(a, p);
    if (b) return km(p, b);
    return null;
  })();
  const label = (s: RouteStop, i: number) => `${i + 1}. ${s.name || tx('Stop {n}', { n: i + 1 })}`;
  return (
    <div className="mx-1 mb-2 rounded-xl border-2 border-[#feb700] bg-[#feb700]/10 p-3 space-y-2" role="dialog" aria-label={tx('Add this place as a stop')}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[160px]">
          <span className="block text-[11px] font-bold text-[#686873] mb-0.5">{tx('New stop')}</span>
          <input className={inputClass} value={pending.name} onChange={(e) => onChange({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && onAdd()} aria-label={tx('New stop name')} />
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="block text-[11px] font-bold text-[#686873] mb-0.5">{tx('Comes after')}</span>
          <select className={inputClass} value={pending.at} onChange={(e) => onChange({ at: Number(e.target.value) })} aria-label={tx('Comes after')}>
            <option value={0}>{tx('Nothing: the new first stop')}</option>
            {stops.map((s, i) => (
              <option key={i} value={i + 1}>
                {label(s, i)}
                {i === stops.length - 1 ? tx(' (becomes the new last stop)') : ''}
                {i + 1 === pending.best ? tx('  ★ best fit') : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[12px] text-[#46464f]">
        {prev ? <>{tx('After')}{' '}<b className="text-[#050a44]">{prev.name || tx('the stop before')}</b></> : <b className="text-[#050a44]">{tx('New first stop')}</b>}
        {next ? <>{tx('and before')}{' '}<b className="text-[#050a44]">{next.name || tx('the next stop')}</b></> : prev ? <>{tx(', as the')}{' '}<b className="text-[#050a44]">{tx('new last stop')}</b></> : null}
        {extra != null && <>{tx('· adds about')}{' '}<b className="text-[#050a44] tabular-nums">{tx('{extra} km', { extra: extra.toFixed(1) })}</b>{' '}{tx('in a straight line')}</>}
        {pending.at !== pending.best && <> · <button type="button" className="font-bold underline text-[#050a44]" onClick={() => onChange({ at: pending.best })}>{tx('use best fit')}</button></>}{tx('. Drag the gold pin to adjust the spot.')}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="gold" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5" />{' '}{tx('Add stop')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{tx('Cancel')}</Button>
      </div>
    </div>
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
  placeholder = tx('Search a town or place'),
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
        <input className={inputClass} value={query} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); if (e.key === 'Escape') close(); }} aria-label={tx('Place to search')} />
        <Button size="sm" className="!h-[42px]" disabled={searching || !query.trim()} onClick={run}>
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{' '}{tx('Search')}</Button>
        <Button size="sm" variant="ghost" className="!h-[42px]" aria-label={tx('Close search')} onClick={close}>
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

/** "21:00" + 135 min → "23:15", or "01:15 (+1)" past midnight. */
const clock = (departure: string, plusMin: number) => {
  const [h, m] = departure.split(':').map(Number);
  const total = h * 60 + m + Math.round(plusMin);
  const day = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}${day > 0 ? ` (+${day})` : ''}`;
};

/** 125 → "2:05" (a duration, not a clock time). */
const hmm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/**
 * A number box for the settings: takes "1.1" or "1,1", applies the value as soon
 * as it's a valid number in range, and doesn't jump back while you're typing
 * (an empty or half-typed box is left alone; leaving the box shows the value in use).
 */
function SettingNumber({ value, onChange, min, max, label }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const parse = (t: string) => {
    const n = Number(t.trim().replace(',', '.'));
    return t.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const bad = focused && text.trim() !== '' && parse(text) == null && !/[.,]$/.test(text.trim());
  return (
    <>
      <input
        aria-label={label}
        inputMode="decimal"
        className={`${inputClass} ${bad ? '!border-[#ba1a1a]' : ''}`}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parse(e.target.value);
          if (n != null && n !== value) onChange(n);
        }}
        onBlur={() => {
          setFocused(false);
          setText(String(value));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {bad && <span className="block text-[11px] font-semibold text-[#ba1a1a] mt-0.5">{tx('Enter a number from {min} to {max}', { min, max })}</span>}
    </>
  );
}

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

/** Which stops, where, in what order (stops without a pin by name): what the road estimate depends on. */
const layout = (stops: RouteStop[]) => stops.map((s) => (s.lat != null ? `${s.lat},${s.lng}` : `?${s.name}`)).join(';');

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const pick = (s: RouteStop) => [s.name.trim(), s.offsetMin, s.fareFromStart, s.lat ?? null, s.lng ?? null];
function uniqueName(stops: RouteStop[], name: string) {
  const taken = new Set(stops.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}
