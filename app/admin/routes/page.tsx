'use client';
// app/admin/routes/page.tsx — routes (stops, times, fares) and the timetable
// (which bus leaves when, on which days).

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { compressPhoto } from '@/lib/trips';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

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
import type { Route, RouteStop, Schedule, Weekday } from '@/lib/types';
import { addDays, describeRuns, formatDuration, formatLKR, formatTime12, fromMinutes, genId, isAlternating, routeLabel, scheduleConflicts, todayISO, toMinutes } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, WEEKDAYS, formatDays, inputClass, useToast, stackTable } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';

export default function RoutesPage() {
  const { data, saveRoute, deleteRoute, saveSchedule, deleteSchedule } = useStore();
  const { toast, Toast } = useToast();
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const reverseOf = (r: Route): Route => {
    const last = r.stops[r.stops.length - 1];
    return {
      id: genId('route'),
      active: true,
      flatFare: r.flatFare !== false,
      stops: [...r.stops].reverse().map((s) => ({ name: s.name, offsetMin: last.offsetMin - s.offsetMin, fareFromStart: last.fareFromStart - s.fareFromStart })),
    };
  };

  const newSchedule = (): Schedule => ({
    id: genId('sch'),
    routeId: data.routes[0]?.id ?? '',
    busId: data.buses.find((b) => b.status === 'active')?.id ?? data.buses[0]?.id ?? '',
    departure: '21:00',
    days: [1, 2, 3, 4, 5, 6, 0],
    active: true,
  });

  return (
    <>
      <PageHeader
        title="Routes & timetable"
        description="Stops, travel times and fares for each direction, and which bus runs when. Passengers only pay for the stretch they ride."
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditingRoute({ id: genId('route'), active: true, stops: [{ name: '', offsetMin: 0, fareFromStart: 0 }, { name: '', offsetMin: 60, fareFromStart: 500 }] })}>
              <Plus className="w-4 h-4" /> New route
            </Button>
            <Button variant="gold" disabled={!data.routes.length || !data.buses.length} onClick={() => setEditingSchedule(newSchedule())}>
              <Plus className="w-4 h-4" /> Add departure
            </Button>
          </>
        }
      />

      <Card className="mb-6 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#edeef0]">
          <h2 className="text-[16px] font-bold text-[#050a44]">Timetable</h2>
          <p className="text-[12px] text-[#46464f]">Times are when the bus leaves the first stop of its route.</p>
        </div>
        {data.schedules.length === 0 ? (
          <p className="p-5 text-[14px] text-[#46464f]">No departures yet. Add one so passengers can book.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Leaves</th>
                  <th className="px-4 py-2.5">Route</th>
                  <th className="px-4 py-2.5">Bus</th>
                  <th className="px-4 py-2.5">Runs on</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {[...data.schedules]
                  .sort((a, b) => a.departure.localeCompare(b.departure))
                  .map((s) => {
                    const route = data.routes.find((r) => r.id === s.routeId);
                    const bus = data.buses.find((b) => b.id === s.busId);
                    const conflicts = scheduleConflicts(data, s);
                    return (
                      <tr key={s.id}>
                        <td className="px-4 py-3 font-extrabold text-[15px] text-[#050a44] tabular-nums whitespace-nowrap">{formatTime12(s.departure)}</td>
                        <td className="px-4 py-3 font-semibold text-[#050a44]">{routeLabel(route)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{bus ? `${bus.name} · ${bus.regNo}` : 'No bus'}</td>
                        <td className="px-4 py-3">
                          {describeRuns(s)}
                          {conflicts.length > 0 && s.active && <p className="text-[11px] font-bold text-[#ba1a1a] mt-0.5">Clashes with another run of this bus</p>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge value={s.active ? 'active' : 'paused'} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="secondary" onClick={() => setEditingSchedule(structuredClone(s))}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={async () => {
                                const res = await saveSchedule({ ...s, active: !s.active });
                                if (!res.ok) toast(res.reason ?? 'Could not update', 'error');
                              }}>
                              {s.active ? 'Pause' : 'Resume'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Delete departure"
                              onClick={async () => {
                                const res = await deleteSchedule(s.id);
                                toast(res.ok ? 'Departure deleted' : res.reason ?? 'Could not delete', res.ok ? 'ok' : 'error');
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {data.routes.map((r) => (
          <Card key={r.id} className="overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#edeef0]">
              <div>
                <h3 className="text-[16px] font-bold text-[#050a44]">{routeLabel(r)}</h3>
                <p className="text-[12px] text-[#46464f]">
                  {r.stops.length} stops · {formatDuration(r.stops[r.stops.length - 1]?.offsetMin ?? 0)} · {r.flatFare !== false ? `${formatLKR(r.stops[r.stops.length - 1]?.fareFromStart ?? 0)} per ticket, any stops` : `${formatLKR(r.stops[r.stops.length - 1]?.fareFromStart ?? 0)} end to end, less for shorter trips`}
                </p>
              </div>
              {!r.active && <Badge value="paused" />}
            </div>
            <ol className="px-5 py-3 text-[13px]">
              {r.stops.map((s, i) => (
                <li key={`${s.name}-${i}`} className="grid grid-cols-[18px_1fr_auto_auto] gap-3 items-center py-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${i === 0 || i === r.stops.length - 1 ? 'bg-[#050a44]' : 'bg-[#feb700]'}`} aria-hidden />
                  <span className="font-semibold text-[#050a44]">{s.name}</span>
                  <span className="text-[#46464f] tabular-nums">+{formatDuration(s.offsetMin)}</span>
                  <span className="font-bold text-[#050a44] tabular-nums w-[88px] text-right">{r.flatFare !== false ? '' : formatLKR(s.fareFromStart)}</span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2 px-5 pb-4">
              <Button size="sm" variant="secondary" onClick={() => setEditingRoute(structuredClone(r))}>
                Edit stops &amp; fares
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const res = await saveRoute(reverseOf(r));
                  if (!res.ok) return toast(res.reason ?? 'Could not create route', 'error');
                  toast('Return route created. Check the times and fares, then add a departure.');
                }}
              >
                Create return route
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const res = await deleteRoute(r.id);
                  toast(res.ok ? 'Route deleted' : res.reason ?? 'Could not delete', res.ok ? 'ok' : 'error');
                }}
              >
                <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {editingRoute && (
        <RouteForm
          route={editingRoute}
          onClose={() => setEditingRoute(null)}
          onSave={async (r) => {
            const res = await saveRoute(r);
            if (!res.ok) return toast(res.reason ?? 'Could not save', 'error');
            setEditingRoute(null);
            toast(`${routeLabel(r)} saved`);
          }}
        />
      )}
      {editingSchedule && (
        <ScheduleForm
          schedule={editingSchedule}
          onClose={() => setEditingSchedule(null)}
          onSave={async (s, also) => {
            // `also`: the same bus's other departure, moved to the alternate days in the same save.
            for (const one of [s, ...also]) {
              const res = await saveSchedule(one);
              if (!res.ok) return toast(res.reason ?? 'Could not save', 'error');
            }
            setEditingSchedule(null);
            toast(also.length ? 'Timetable updated: both departures now run on alternate days' : 'Timetable updated');
          }}
        />
      )}
      <Toast />
    </>
  );
}

function RouteForm({ route, onClose, onSave }: { route: Route; onClose: () => void; onSave: (r: Route) => void }) {
  const [stops, setStops] = useState<RouteStop[]>(route.stops);
  const [active, setActive] = useState(route.active);
  const update = (i: number, patch: Partial<RouteStop>) => setStops((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  // One price for the whole route (default), or a fare per stop.
  const [flat, setFlat] = useState(route.flatFare !== false);
  const [price, setPrice] = useState(route.stops[route.stops.length - 1]?.fareFromStart ?? 0);
  const move = (i: number, d: -1 | 1) =>
    setStops((p) => {
      const n = [...p];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

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

  return (
    <Modal
      wide
      title={route.stops[0]?.name ? `Edit ${routeLabel(route)}` : 'New route'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={problems.length > 0} onClick={() => onSave({ ...route, active, flatFare: flat, stops: (flat ? flatStops(stops, price) : stops).map((s) => ({ ...s, name: s.name.trim() })) })}>
            Save route
          </Button>
        </>
      }
    >
      <div className="rounded-xl bg-[#f2f4f6] p-4 space-y-3">
        <p className="text-[13px] font-bold text-[#050a44]">Ticket price</p>
        <div className="flex gap-2">
          {([true, false] as const).map((f) => (
            <button
              key={String(f)}
              type="button"
              aria-pressed={flat === f}
              onClick={() => setFlat(f)}
              className={`flex-1 min-h-10 px-2 py-1.5 rounded-lg text-[13px] font-bold border ${flat === f ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white border-[#c7c5d1] text-[#46464f]'}`}
            >
              {f ? 'One price for the whole route' : 'Price by distance (per stop)'}
            </button>
          ))}
        </div>
        {flat ? (
          <label className="block max-w-[260px]">
            <span className="block text-[11px] font-bold text-[#686873] mb-1">Price per seat (LKR)</span>
            <input type="number" min={0} step={50} className={inputClass} value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))} aria-label="Ticket price" />
            <span className="block text-[12px] text-[#6b6d78] mt-1">Every passenger pays this, wherever they get on or off.</span>
          </label>
        ) : (
          <p className="text-[12px] text-[#46464f]">Enter each stop&apos;s fare from the first stop below. A passenger riding Kurunegala → Batticaloa pays the difference.</p>
        )}
      </div>
      <p className="text-[13px] text-[#46464f]">
        For each stop, enter how long after leaving the first stop the bus gets there{flat ? '.' : ', and the fare from the first stop.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold text-[#46464f]">
              <th className="py-2 pr-2">Stop</th>
              <th className="py-2 pr-2">Arrives after (h:mm)</th>
              <th className={`py-2 pr-2 ${flat ? 'hidden' : ''}`}>Fare from start (LKR)</th>
              <th className="py-2">
                <span className="sr-only">Order</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {stops.map((s, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2 min-w-[200px]">
                  <input aria-label={`Stop ${i + 1} name`} className={inputClass} value={s.name} onChange={(e) => update(i, { name: e.target.value })} />
                  <details className="mt-1">
                    <summary className="text-[11px] font-bold text-[#7c5800] cursor-pointer">Where to wait{s.landmark ? ' ✓' : ''}</summary>
                    <div className="space-y-1.5 mt-1.5">
                      <input aria-label={`Stop ${i + 1} landmark`} className={inputClass} placeholder="Landmark, e.g. Clock tower roundabout" value={s.landmark ?? ''} onChange={(e) => update(i, { landmark: e.target.value })} />
                      <input aria-label={`Stop ${i + 1} map pin`} className={inputClass} placeholder="Map pin: lat, lng (copy from Google Maps)" value={s.lat != null ? `${s.lat}, ${s.lng}` : ''}
                        onChange={(e) => { const m = e.target.value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/); update(i, m ? { lat: Number(m[1]), lng: Number(m[2]) } : { lat: undefined, lng: undefined }); }} />
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
                </td>
                <td className="py-1 pr-2">
                  <input
                    aria-label={`Stop ${i + 1} time from start`}
                    type="time"
                    className={inputClass}
                    value={fromMinutes(s.offsetMin)}
                    disabled={i === 0}
                    onChange={(e) => update(i, { offsetMin: toMinutes(e.target.value || '00:00') })}
                  />
                </td>
                <td className={`py-1 pr-2 ${flat ? 'hidden' : ''}`}>
                  <input
                    aria-label={`Stop ${i + 1} fare`}
                    type="number"
                    min={0}
                    step={10}
                    className={inputClass}
                    value={s.fareFromStart}
                    disabled={i === 0}
                    onChange={(e) => update(i, { fareFromStart: Number(e.target.value) })}
                  />
                </td>
                <td className="py-1 whitespace-nowrap">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Remove stop" disabled={stops.length <= 2} onClick={() => setStops((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#686873]">Travel times over 24 hours aren&apos;t supported by the time picker.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const last = stops[stops.length - 1];
            setStops((p) => [...p, { name: '', offsetMin: last.offsetMin + 30, fareFromStart: last.fareFromStart + 100 }]);
          }}
        >
          <Plus className="w-4 h-4" /> Add stop at the end
        </Button>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-[#050a44]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-[#050a44]" />
          Route is open for booking
        </label>
      </div>
      {problems.length > 0 && (
        <ul className="text-[12px] font-semibold text-[#ba1a1a] space-y-0.5">
          {problems.slice(0, 4).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
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

/** "Sunday 4 October 2026": unambiguous, whatever order the date box uses. */
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function ScheduleForm({ schedule, onClose, onSave }: { schedule: Schedule; onClose: () => void; onSave: (s: Schedule, also: Schedule[]) => void }) {
  const { data } = useStore();
  const [s, setS] = useState<Schedule>(schedule);
  // Switching one bus from weekdays to every other day means changing BOTH of
  // its departures (out and back). Editing one at a time can't work: the first
  // always clashes with the other, which is still on weekdays. So the other
  // departure can be moved onto the alternate days here and saved together.
  const [paired, setPaired] = useState<string[]>([]);
  const onAlternateDays = (o: Schedule): Schedule => ({ ...o, everyDays: s.everyDays, startDate: addDays(s.startDate ?? todayISO(), 1), days: [0, 1, 2, 3, 4, 5, 6] });
  const pairing = isAlternating(s) ? data.schedules.filter((o) => paired.includes(o.id) && o.id !== s.id) : [];
  const view = { ...data, schedules: data.schedules.map((o) => (pairing.some((p) => p.id === o.id) ? onAlternateDays(o) : o)) };
  const conflicts = s.active ? scheduleConflicts(view, s) : [];
  const route = data.routes.find((r) => r.id === s.routeId);
  const arrive = route ? toMinutes(s.departure) + route.stops[route.stops.length - 1].offsetMin : 0;
  const alternating = isAlternating(s);
  const valid = s.routeId && s.busId && (alternating || s.days.length > 0) && conflicts.length === 0;
  const toggleDay = (d: Weekday) => setS((p) => ({ ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d] }));

  return (
    <Modal
      title={data.schedules.some((x) => x.id === s.id) ? 'Edit departure' : 'Add departure'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {/* Alternate-day departures keep all weekdays ticked underneath; the database then checks the every-N-days rule. */}
          <Button disabled={!valid} onClick={() => onSave(alternating ? { ...s, days: [0, 1, 2, 3, 4, 5, 6] } : { ...s, everyDays: null, startDate: null }, pairing.map(onAlternateDays))}>
            Save departure
          </Button>
        </>
      }
    >
      <Field label="Route">
        <select className={inputClass} value={s.routeId} onChange={(e) => setS({ ...s, routeId: e.target.value })}>
          {data.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {routeLabel(r)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bus">
          <select className={inputClass} value={s.busId} onChange={(e) => setS({ ...s, busId: e.target.value })}>
            {data.buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.regNo}
                {b.status !== 'active' ? ` (${b.status})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Leaves first stop at" hint={route ? `Arrives ${formatTime12(fromMinutes(arrive))}${arrive >= 1440 ? ' next day' : ''}` : undefined}>
          <input type="time" className={inputClass} value={s.departure} onChange={(e) => e.target.value && setS({ ...s, departure: e.target.value })} />
        </Field>
      </div>
      <Field label="Runs">
        <div className="flex gap-2 mb-2">
          {([false, true] as const).map((alt) => (
            <button
              key={String(alt)}
              type="button"
              aria-pressed={alternating === alt}
              onClick={() => setS((p) => (alt ? { ...p, everyDays: p.everyDays && p.everyDays > 1 ? p.everyDays : 2, startDate: p.startDate || todayISO() } : { ...p, everyDays: null, startDate: null }))}
              className={`flex-1 h-10 rounded-lg text-[13px] font-bold border ${alternating === alt ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}
            >
              {alt ? 'Every other day' : 'On set weekdays'}
            </button>
          ))}
        </div>
        {alternating ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-1">Runs every</span>
              <select className={inputClass} value={s.everyDays ?? 2} onChange={(e) => setS({ ...s, everyDays: Number(e.target.value) })}>
                <option value={2}>2 days (every other day)</option>
                <option value={3}>3 days</option>
                <option value={4}>4 days</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-1">First run on</span>
              <input type="date" className={inputClass} value={s.startDate ?? ''} onChange={(e) => e.target.value && setS({ ...s, startDate: e.target.value })} />
              {/* Spelled out, because the date box shows month/day or day/month depending on the computer. */}
              {s.startDate && <span className="block text-[12px] font-semibold text-[#050a44] mt-1">{longDate(s.startDate)}</span>}
            </label>
            <p className="col-span-2 text-[12px] text-[#6b6d78]">
              For one bus going out one night and back the next: set the outward departure to start on one date and the return departure to start the day after. The pattern keeps going without a gap at the end of the week.
            </p>
          </div>
        ) : (
        <div className="flex flex-wrap gap-1.5">
          {([1, 2, 3, 4, 5, 6, 0] as Weekday[]).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={s.days.includes(d)}
              onClick={() => toggleDay(d)}
              className={`w-12 h-10 rounded-lg text-[13px] font-bold border ${s.days.includes(d) ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}
            >
              {WEEKDAYS[d]}
            </button>
          ))}
        </div>
        )}
      </Field>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-[#050a44]">
        <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} className="w-4 h-4 accent-[#050a44]" />
        Open for booking
      </label>
      {pairing.length > 0 && (
        <div className="rounded-xl bg-[#e8f6ea] border border-[#006e1c]/25 p-3 text-[13px] text-[#0b4a1a] space-y-1">
          <p className="font-bold">Saving will also change:</p>
          {pairing.map((o) => (
            <p key={o.id}>
              {formatTime12(o.departure)} {routeLabel(data.routes.find((r) => r.id === o.routeId))} → {describeRuns(onAlternateDays(o)).toLowerCase()} ({longDate(onAlternateDays(o).startDate!)}){' '}
              <button type="button" className="underline font-bold" onClick={() => setPaired((p) => p.filter((id) => id !== o.id))}>Undo</button>
            </p>
          ))}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="rounded-xl bg-[#ba1a1a]/5 border border-[#ba1a1a]/20 p-3 text-[13px] text-[#93000a]">
          <p className="font-bold">This bus is already on the road then.</p>
          <ul className="mt-1 space-y-2">
            {conflicts.map((c) => (
              <li key={c.id}>
                {formatTime12(c.departure)} {routeLabel(data.routes.find((r) => r.id === c.routeId))} · {describeRuns(c)}
                {alternating && !paired.includes(c.id) && (
                  <button type="button" onClick={() => setPaired((p) => [...p, c.id])} className="mt-1 block w-full sm:w-auto px-3 py-2 rounded-lg bg-[#050a44] text-white text-[13px] font-bold text-left">
                    Move that departure to the alternate days too (first run {longDate(addDays(s.startDate ?? todayISO(), 1))})
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            {alternating
              ? 'A bus that goes out one night and back the next needs both departures on "every other day", one day apart. Use the button above to change the other one in the same save, or pick other times or another bus.'
              : 'Pick other days or times (leaving an hour to turn around), or use another bus.'}
          </p>
        </div>
      )}
    </Modal>
  );
}
