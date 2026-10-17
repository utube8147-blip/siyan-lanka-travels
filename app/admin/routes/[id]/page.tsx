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
import { compressPhoto, formatDuration, formatTime12, genId, routeLabel } from '@/lib/trips';
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
        <Card className="p-6 text-[14px] text-[#46464f]">{isNew || saved ? 'Loading…' : 'This route no longer exists.'}</Card>
      </>
    );
  }
  return (
    <Editor
      key={base.id}
      route={base}
      savedRoute={isNew ? null : saved ?? null}
      departures={data.schedules.filter((sc) => sc.routeId === base.id).sort((a, b) => Number(b.active) - Number(a.active) || a.departure.localeCompare(b.departure)).map((sc) => sc.departure)}
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
  const [price, setPrice] = useState(route.stops[route.stops.length - 1]?.fareFromStart ?? 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null); // stop waiting for a map click
  const [clickAdds, setClickAdds] = useState(true);
  const [busFactor, setBusFactor] = useState(1.3);
  const [dwell, setDwell] = useState(2);
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
  type Snap = { stops: RouteStop[]; flat: boolean; price: number };
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const lastTyping = useRef<{ key: string; t: number } | null>(null);
  const [, setHistoryTick] = useState(0);
  const snap = (): Snap => ({ stops, flat, price });
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
  const insertStop = (lat: number, lng: number, name: string, at: number) => {
    const p = stops;
    const prev = p[at - 1];
    const next = p[at];
    let n: RouteStop[];
    if (at === 0) {
      // New start: it leaves at 0:00, everything else is 30 min later.
      n = [{ name, offsetMin: 0, fareFromStart: 0, lat, lng }, ...p.map((s) => ({ ...s, offsetMin: s.offsetMin + 30 }))];
    } else {
      const offsetMin = next ? Math.round((prev.offsetMin + next.offsetMin) / 2) : prev.offsetMin + 30;
      const fareFromStart = next ? Math.round((prev.fareFromStart + next.fareFromStart) / 2 / 10) * 10 : prev.fareFromStart + 100;
      n = [...p];
      n.splice(at, 0, { name, offsetMin, fareFromStart, lat, lng });
    }
    change(() => n);
    setSelected(at);
    return at;
  };

  // A place clicked on the map or found by name waits here until you say where it goes.
  const [pending, setPending] = useState<{ lat: number; lng: number; name: string; at: number; best: number } | null>(null);
  const propose = async (lat: number, lng: number, name: string | null) => {
    const best = bestAt(lat, lng);
    setPending({ lat: round(lat), lng: round(lng), name: name ?? 'New stop', at: best, best });
    if (name == null) {
      const found = await placeName(lat, lng);
      if (found) setPending((cur) => (cur && cur.lat === round(lat) && cur.lng === round(lng) && cur.name === 'New stop' ? { ...cur, name: uniqueName(stops, found) } : cur));
    }
  };
  const confirmPending = () => {
    if (!pending) return;
    insertStop(pending.lat, pending.lng, uniqueName(stops, pending.name.trim() || 'New stop'), pending.at);
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
    if (!clickAdds) return;
    propose(lat, lng, null);
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
  useEffect(() => {
    if (!autoTimes || !retime.current || !roadOffsets || roadOffsets.length !== stops.length) return;
    retime.current = false;
    if (stops.every((s, i) => s.offsetMin === roadOffsets[i])) return;
    setStops((p) => (p.length === roadOffsets.length ? p.map((s, i) => ({ ...s, offsetMin: roadOffsets[i] })) : p));
    setDirty(true);
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
        `This route has ${departures.length} departure${departures.length === 1 ? '' : 's'} in the timetable. Saving it reversed changes the direction those buses run, for passengers who already booked too.\n\nTo run the other direction as well, use "Create return route" on the Routes & timetable page instead.\n\nReverse this route anyway? (You can undo it, and nothing changes until you save.)`,
      )
    )
      return;
    change((p) => {
      const last = p[p.length - 1];
      return [...p].reverse().map((s) => ({ ...s, offsetMin: last.offsetMin - s.offsetMin, fareFromStart: last.fareFromStart - s.fareFromStart }));
    });
    setSelected(null);
    toast('Route reversed. Undo brings it back.', 'ok');
  };

  const fillTimes = () => {
    if (!roadOffsets) return;
    change((p) => p.map((s, i) => ({ ...s, offsetMin: roadOffsets[i] })));
    toast('Times filled from the road estimate', 'ok');
  };

  // ---- GPS file ----
  const loadGps = async (file: File) => {
    const parsed = parseGpsFile(file.name, await file.text());
    if (!parsed) return toast('No GPS points found in that file. Use the CSV or GPX from GPS trip log, or any GPX track.', 'error');
    gpsAbort.current?.abort();
    setGps(parsed);
    setGpsShown(true);
    setGpsLoads((n) => n + 1);
    toast(`Loaded ${parsed.line.length.toLocaleString()} points from ${file.name}`, 'ok');
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
    record();
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
              <Button variant="secondary" onClick={() => setSharing(true)} title="A private link to a read-only page with this route as it is now">
                <Share2 className="w-4 h-4" /> Share
              </Button>
            )}
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
        <Stat label="Road distance" value={edited.fresh && edited.road ? `${edited.road.distanceKm.toFixed(1)} km${allPinned ? '' : '*'}` : edited.loading ? '…' : '—'} sub={savedRoute && edited.fresh && edited.road && savedRoad.road && savedPinned && allPinned ? `${signed(edited.road!.distanceKm - savedRoad.road.distanceKm, 'km', 1)} vs saved` : allPinned ? 'by road' : `*through pinned stops · ${unpinned} without a pin`} />
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
                  onClick={() => { if (flat !== f) record(); setFlat(f); setDirty(true); }}
                  className={`flex-1 min-h-10 px-2 py-1.5 rounded-lg text-[13px] font-bold border ${flat === f ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white border-[#c7c5d1] text-[#46464f]'}`}
                >
                  {f ? 'One price for the whole route' : 'Price by distance (per stop)'}
                </button>
              ))}
            </div>
            {flat ? (
              <label className="flex flex-wrap items-center gap-3">
                <span className="text-[12px] font-bold text-[#46464f]">Price per seat (LKR)</span>
                <input type="number" min={0} step={50} className={`${inputClass} !w-36`} value={price} onChange={(e) => { record('price'); setPrice(Math.max(0, Number(e.target.value))); setDirty(true); }} aria-label="Ticket price" />
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
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" disabled={stops.length < 2} onClick={reverseStops} title="Last stop first: turn this route round (undoable)">
                  <ArrowUpDown className="w-3.5 h-3.5" /> Reverse order
                </Button>
                <label className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#050a44]" title="When you add, move, remove or reorder stops, every stop's time is set from the road estimate (undo brings the old times back)">
                  <input type="checkbox" className="w-4 h-4 accent-[#050a44]" checked={autoTimes} onChange={(e) => { setAutoTimes(e.target.checked); if (e.target.checked) retime.current = true; }} />
                  Times follow the road
                </label>
                {!autoTimes && (
                  <Button size="sm" variant="secondary" disabled={!roadOffsets} onClick={fillTimes} title={roadOffsets ? '' : 'The first and last stops need a map pin'}>
                    <Wand2 className="w-3.5 h-3.5" /> Fill times from road
                  </Button>
                )}
              </div>
            </div>
            {departures.length > 0 && (
              <div className="px-4 py-2 border-b border-[#edeef0] flex flex-wrap items-center gap-2 text-[12px] text-[#46464f]">
                <span className="font-bold">Clock times for the</span>
                <select className={`${inputClass} !w-auto !py-1`} value={clockDep} onChange={(e) => setClockDep(e.target.value)} aria-label="Departure for clock times">
                  {departures.filter((d, i, a) => a.indexOf(d) === i).map((d) => (
                    <option key={d} value={d}>{formatTime12(d)}</option>
                  ))}
                  <option value="">(no clock times)</option>
                </select>
                <span>departure</span>
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
                        {leg ? `${leg.km.toFixed(1)} km · ${dur(leg.min * busFactor)} by road` : edited.loading ? 'working out the road…' : ''}
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
                              <p className={`text-[11px] text-[#6b6d78] pb-2 transition-opacity ${estStale ? 'opacity-40' : ''}`} aria-live="polite">
                                Road estimate <b className="text-[#050a44] tabular-nums">{hmm(est)}</b>
                                {clockDep && <> · arrives <b className="text-[#050a44] tabular-nums">≈ {clock(clockDep, est)}</b></>}
                                {s.lat == null && ' (no pin: between its neighbours)'}
                                {off != null && Math.abs(off) >= 15 && <span className={`font-semibold ${off < 0 ? 'text-[#ba1a1a]' : 'text-[#7c5800]'}`}> ({signed(off, 'min')} vs timetable)</span>}
                                {estStale && ' · updating…'}
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
              <div className="inline-flex gap-1" role="group" aria-label="Undo and redo">
                <Button size="sm" variant="secondary" disabled={!past.current.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </Button>
                <Button size="sm" variant="secondary" disabled={!future.current.length} onClick={redo} title="Redo (Ctrl+Shift+Z or Ctrl+Y)" aria-label="Redo">
                  <Redo2 className="w-3.5 h-3.5" /> Redo
                </Button>
              </div>
              {savedRoute && changedFromSaved && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Back to the saved route (can be undone)"
                  onClick={() => {
                    record();
                    setStops(structuredClone(savedRoute.stops));
                    setFlat(savedRoute.flatFare !== false);
                    setPrice(savedRoute.stops[savedRoute.stops.length - 1]?.fareFromStart ?? price);
                    setSelected(null);
                    setDirty(false);
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Back to saved
                </Button>
              )}
              <GoogleMapsLinks stops={stops} />
              <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                <FileUp className="w-3.5 h-3.5" /> {gps ? 'Change GPS file' : 'Load GPS file'}
              </Button>
              {gps && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setGpsShown((v) => !v)} aria-pressed={!gpsShown} title={gpsShown ? 'Hide the GPS track (keep it loaded)' : 'Show the GPS track again'}>
                    {gpsShown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {gpsShown ? 'Hide GPS' : 'Show GPS'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={removeGps} title="Remove the GPS track from the map. Your stops stay where you put them.">
                    <X className="w-3.5 h-3.5" /> Remove GPS
                  </Button>
                </>
              )}
              <input ref={fileInput} type="file" accept=".gpx,.csv,application/gpx+xml,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadGps(f); e.target.value = ''; }} />
              {(edited.loading || savedRoad.loading) && <Loader2 className="w-4 h-4 animate-spin text-[#6b6d78]" aria-label="Updating the road route" />}
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
              <span><i className="inline-block w-5 h-1.5 align-middle rounded bg-[#1f7a3a] mr-1" />Route as edited</span>
              {changedFromSaved && <span><i className="inline-block w-5 align-middle border-t-[3px] border-dashed border-[#6b6d78] mr-1" />Saved route</span>}
              {gps && (
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block w-5 h-1 align-middle rounded bg-[#feb700] mr-1" />
                  Road driven: {gps.name} · {lineLengthKm(gps.line).toFixed(1)} km{gpsShown ? '' : ' (hidden)'}
                  {gps.est.some(Boolean) && <span className="inline-flex items-center"><i className="inline-block w-4 align-middle border-t-[3px] border-dotted border-[#ba1a1a] mx-1" />estimated road in gaps</span>}
                  {gpsFill?.filling && <span className="text-[#6b6d78]"> · filling gaps over 2 km… {gpsFill.done}/{gpsFill.total}</span>}
                  <button aria-label="Remove GPS file" onClick={removeGps} className="ml-0.5"><X className="w-3.5 h-3.5" /></button>
                </span>
              )}
              <label className="inline-flex items-center gap-1.5 font-semibold text-[#050a44]">
                <input type="checkbox" className="w-3.5 h-3.5 accent-[#050a44]" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                Map follows the list
              </label>
              <span className="text-[#6b6d78]">Scroll or swipe to move the map · pinch or Ctrl+scroll to zoom · drag a pin to move a stop.</span>
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
      {sharing && savedRoute && (
        <ShareRouteDialog
          routeId={savedRoute.id}
          defaultTitle={plans.find((x) => x.id === planId)?.name ?? `${stops[0]?.name || 'Start'} → ${stops[stops.length - 1]?.name || 'End'}${changedFromSaved ? ' (proposed)' : ''}`}
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
  const label = (s: RouteStop, i: number) => `${i + 1}. ${s.name || `Stop ${i + 1}`}`;
  return (
    <div className="mx-1 mb-2 rounded-xl border-2 border-[#feb700] bg-[#feb700]/10 p-3 space-y-2" role="dialog" aria-label="Add this place as a stop">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[160px]">
          <span className="block text-[11px] font-bold text-[#686873] mb-0.5">New stop</span>
          <input className={inputClass} value={pending.name} onChange={(e) => onChange({ name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && onAdd()} aria-label="New stop name" />
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="block text-[11px] font-bold text-[#686873] mb-0.5">Comes after</span>
          <select className={inputClass} value={pending.at} onChange={(e) => onChange({ at: Number(e.target.value) })} aria-label="Comes after">
            <option value={0}>Nothing: the new first stop</option>
            {stops.map((s, i) => (
              <option key={i} value={i + 1}>
                {label(s, i)}
                {i === stops.length - 1 ? ' (becomes the new last stop)' : ''}
                {i + 1 === pending.best ? '  ★ best fit' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[12px] text-[#46464f]">
        {prev ? <>After <b className="text-[#050a44]">{prev.name || 'the stop before'}</b></> : <b className="text-[#050a44]">New first stop</b>}
        {next ? <> and before <b className="text-[#050a44]">{next.name || 'the next stop'}</b></> : prev ? <>, as the <b className="text-[#050a44]">new last stop</b></> : null}
        {extra != null && <> · adds about <b className="text-[#050a44] tabular-nums">{extra.toFixed(1)} km</b> in a straight line</>}
        {pending.at !== pending.best && <> · <button type="button" className="font-bold underline text-[#050a44]" onClick={() => onChange({ at: pending.best })}>use best fit</button></>}
        . Drag the gold pin to adjust the spot.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="gold" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5" /> Add stop
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
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
