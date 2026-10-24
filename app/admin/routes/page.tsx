'use client';
// app/admin/routes/page.tsx — routes (stops, times, fares) and the timetable
// (which bus leaves when, on which days).

import { useState } from 'react';
import Link from 'next/link';
import { Map as MapIcon, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { Route, Schedule, Weekday } from '@/lib/types';
import { addDays, describeRuns, formatDuration, formatLKR, formatTime12, fromMinutes, genId, isAlternating, routeLabel, scheduleConflicts, todayISO, toMinutes, dateLocale } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, WEEKDAYS, formatDays, inputClass, useToast, stackTable } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';
import { tx } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
export default function RoutesPage() {
  const { data, saveRoute, deleteRoute, saveSchedule, deleteSchedule } = useStore();
  const { toast, Toast } = useToast();
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const reverseOf = (r: Route): Route => {
    const last = r.stops[r.stops.length - 1];
    return {
      id: genId('route'),
      active: true,
      flatFare: r.flatFare !== false,
      // Keep each stop's map pin and waiting details: they're the same places.
      stops: [...r.stops].reverse().map((s) => ({ ...s, offsetMin: last.offsetMin - s.offsetMin, fareFromStart: last.fareFromStart - s.fareFromStart })),
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
        title={tx('Routes & timetable')}
        description={tx('Stops, travel times and fares for each direction, and which bus runs when. Passengers only pay for the stretch they ride.')}
        actions={
          <>
            <Link href="/admin/routes/new" className="inline-flex items-center justify-center gap-1.5 rounded-xl font-bold h-10 px-4 text-[13px] bg-white border border-[#c7c5d1] text-[#050a44] hover:bg-[#f2f4f6]">
              <Plus className="w-4 h-4" />{' '}{tx('New route')}</Link>
            <Button variant="gold" disabled={!data.routes.length || !data.buses.length} onClick={() => setEditingSchedule(newSchedule())}>
              <Plus className="w-4 h-4" />{' '}{tx('Add departure')}</Button>
          </>
        }
      />

      <Card className="mb-6 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#edeef0]">
          <h2 className="text-[16px] font-bold text-[#050a44]">{tx('Timetable')}</h2>
          <p className="text-[12px] text-[#46464f]">{tx('Times are when the bus leaves the first stop of its route.')}</p>
        </div>
        {data.schedules.length === 0 ? (
          <p className="p-5 text-[14px] text-[#46464f]">{tx('No departures yet. Add one so passengers can book.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">{tx('Leaves')}</th>
                  <th className="px-4 py-2.5">{tx('Route')}</th>
                  <th className="px-4 py-2.5">{tx('Bus')}</th>
                  <th className="px-4 py-2.5">{tx('Runs on')}</th>
                  <th className="px-4 py-2.5">{tx('Status')}</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">{tx('Actions')}</span>
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
                        <td className="px-4 py-3 whitespace-nowrap">{bus ? `${bus.name} · ${bus.regNo}` : tx('No bus')}</td>
                        <td className="px-4 py-3">
                          {describeRuns(s)}
                          {conflicts.length > 0 && s.active && <p className="text-[11px] font-bold text-[#ba1a1a] mt-0.5">{tx('Clashes with another run of this bus')}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge value={s.active ? 'active' : 'paused'} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="secondary" onClick={() => setEditingSchedule(structuredClone(s))}>{tx('Edit')}</Button>
                            <Button size="sm" variant="ghost" onClick={async () => {
                                const res = await saveSchedule({ ...s, active: !s.active });
                                if (!res.ok) toast(res.reason ?? tx('Could not update'), 'error');
                              }}>
                              {s.active ? tx('Pause') : tx('Resume')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={tx('Delete departure')}
                              onClick={async () => {
                                const res = await deleteSchedule(s.id);
                                toast(res.ok ? tx('Departure deleted') : res.reason ?? tx('Could not delete'), res.ok ? 'ok' : 'error');
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
                <p className="text-[12px] text-[#46464f]">{tx('{length} stops · {formatDuration} ·', { length: r.stops.length, formatDuration: formatDuration(r.stops[r.stops.length - 1]?.offsetMin ?? 0) })}{' '}{r.flatFare !== false ? tx('{amount} per ticket, any stops', { amount: formatLKR(r.stops[r.stops.length - 1]?.fareFromStart ?? 0) }) : tx('{amount} end to end, less for shorter trips', { amount: formatLKR(r.stops[r.stops.length - 1]?.fareFromStart ?? 0) })}
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
              <Link href={`/admin/routes/${r.id}`} className="inline-flex items-center justify-center gap-1.5 rounded-xl font-bold h-8 px-3 text-[12px] bg-white border border-[#c7c5d1] text-[#050a44] hover:bg-[#f2f4f6]">
                <MapIcon className="w-3.5 h-3.5" />{' '}{tx('Edit route & map')}</Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const res = await saveRoute(reverseOf(r));
                  if (!res.ok) return toast(res.reason ?? tx('Could not create route'), 'error');
                  toast(tx('Return route created. Check the times and fares, then add a departure.'));
                }}
              >{tx('Create return route')}</Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const res = await deleteRoute(r.id);
                  toast(res.ok ? tx('Route deleted') : res.reason ?? tx('Could not delete'), res.ok ? 'ok' : 'error');
                }}
              >
                <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {editingSchedule && (
        <ScheduleForm
          schedule={editingSchedule}
          onClose={() => setEditingSchedule(null)}
          onSave={async (s, also) => {
            // `also`: the same bus's other departure, moved to the alternate days in the same save.
            for (const one of [s, ...also]) {
              const res = await saveSchedule(one);
              if (!res.ok) return toast(res.reason ?? tx('Could not save'), 'error');
            }
            setEditingSchedule(null);
            toast(also.length ? tx('Timetable updated: both departures now run on alternate days') : tx('Timetable updated'));
          }}
        />
      )}
      <Toast />
    </>
  );
}

/** "Sunday 4 October 2026": unambiguous, whatever order the date box uses. */
const longDate = (iso: string) => fmtDate(new Date(`${iso}T00:00:00`), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
      title={data.schedules.some((x) => x.id === s.id) ? tx('Edit departure') : tx('Add departure')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tx('Cancel')}</Button>
          {/* Alternate-day departures keep all weekdays ticked underneath; the database then checks the every-N-days rule. */}
          <Button disabled={!valid} onClick={() => onSave(alternating ? { ...s, days: [0, 1, 2, 3, 4, 5, 6] } : { ...s, everyDays: null, startDate: null }, pairing.map(onAlternateDays))}>{tx('Save departure')}</Button>
        </>
      }
    >
      <Field label={tx('Route')}>
        <select className={inputClass} value={s.routeId} onChange={(e) => setS({ ...s, routeId: e.target.value })}>
          {data.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {routeLabel(r)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('Bus')}>
          <select className={inputClass} value={s.busId} onChange={(e) => setS({ ...s, busId: e.target.value })}>
            {data.buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.regNo}
                {b.status !== 'active' ? ` (${b.status})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tx('Leaves first stop at')} hint={route ? (arrive >= 1440 ? tx('Arrives {time} next day', { time: formatTime12(fromMinutes(arrive)) }) : tx('Arrives {time}', { time: formatTime12(fromMinutes(arrive)) })) : undefined}>
          <input type="time" className={inputClass} value={s.departure} onChange={(e) => e.target.value && setS({ ...s, departure: e.target.value })} />
        </Field>
      </div>
      <Field label={tx('Runs')}>
        <div className="flex gap-2 mb-2">
          {([false, true] as const).map((alt) => (
            <button
              key={String(alt)}
              type="button"
              aria-pressed={alternating === alt}
              onClick={() => setS((p) => (alt ? { ...p, everyDays: p.everyDays && p.everyDays > 1 ? p.everyDays : 2, startDate: p.startDate || todayISO() } : { ...p, everyDays: null, startDate: null }))}
              className={`flex-1 h-10 rounded-lg text-[13px] font-bold border ${alternating === alt ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}
            >
              {alt ? tx('Every other day') : tx('On set weekdays')}
            </button>
          ))}
        </div>
        {alternating ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-1">{tx('Runs every')}</span>
              <select className={inputClass} value={s.everyDays ?? 2} onChange={(e) => setS({ ...s, everyDays: Number(e.target.value) })}>
                <option value={2}>{tx('2 days (every other day)')}</option>
                <option value={3}>{tx('3 days')}</option>
                <option value={4}>{tx('4 days')}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold text-[#686873] mb-1">{tx('First run on')}</span>
              <input type="date" className={inputClass} value={s.startDate ?? ''} onChange={(e) => e.target.value && setS({ ...s, startDate: e.target.value })} />
              {/* Spelled out, because the date box shows month/day or day/month depending on the computer. */}
              {s.startDate && <span className="block text-[12px] font-semibold text-[#050a44] mt-1">{longDate(s.startDate)}</span>}
            </label>
            <p className="col-span-2 text-[12px] text-[#6b6d78]">{tx('For one bus going out one night and back the next: set the outward departure to start on one date and the return departure to start the day after. The pattern keeps going without a gap at the end of the week.')}</p>
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
              {tx(WEEKDAYS[d])}
            </button>
          ))}
        </div>
        )}
      </Field>
      <label className="flex items-center gap-2 text-[13px] font-semibold text-[#050a44]">
        <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} className="w-4 h-4 accent-[#050a44]" />{tx('Open for booking')}</label>
      {pairing.length > 0 && (
        <div className="rounded-xl bg-[#e8f6ea] border border-[#006e1c]/25 p-3 text-[13px] text-[#0b4a1a] space-y-1">
          <p className="font-bold">{tx('Saving will also change:')}</p>
          {pairing.map((o) => (
            <p key={o.id}>
              {formatTime12(o.departure)} {routeLabel(data.routes.find((r) => r.id === o.routeId))} → {describeRuns(onAlternateDays(o)).toLowerCase()} ({longDate(onAlternateDays(o).startDate!)}){' '}
              <button type="button" className="underline font-bold" onClick={() => setPaired((p) => p.filter((id) => id !== o.id))}>{tx('Undo')}</button>
            </p>
          ))}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="rounded-xl bg-[#ba1a1a]/5 border border-[#ba1a1a]/20 p-3 text-[13px] text-[#93000a]">
          <p className="font-bold">{tx('This bus is already on the road then.')}</p>
          <ul className="mt-1 space-y-2">
            {conflicts.map((c) => (
              <li key={c.id}>
                {formatTime12(c.departure)} {routeLabel(data.routes.find((r) => r.id === c.routeId))} · {describeRuns(c)}
                {alternating && !paired.includes(c.id) && (
                  <button type="button" onClick={() => setPaired((p) => [...p, c.id])} className="mt-1 block w-full sm:w-auto px-3 py-2 rounded-lg bg-[#050a44] text-white text-[13px] font-bold text-left">{tx('Move that departure to the alternate days too (first run {longDate})', { longDate: longDate(addDays(s.startDate ?? todayISO(), 1)) })}</button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            {alternating
              ? tx('A bus that goes out one night and back the next needs both departures on "every other day", one day apart. Use the button above to change the other one in the same save, or pick other times or another bus.')
              : tx('Pick other days or times (leaving an hour to turn around), or use another bus.')}
          </p>
        </div>
      )}
    </Modal>
  );
}
