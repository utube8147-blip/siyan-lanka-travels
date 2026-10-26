'use client';
// Staff area → Trips → Test passengers: fill a departure with pretend
// passengers to try the conductor app (boarding, cash, tonight's stops, map),
// then delete them again. Demo mode, or test mode on your own computer
// (NEXT_PUBLIC_MOCK_VERIFICATION=true); test bookings are marked and only
// those can be deleted here.

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bus, FlaskConical, Plus, Shuffle, Trash2, UserRound } from 'lucide-react';
import { useStore } from '@/lib/store';
import { mockVerificationOn } from '@/lib/mockVerification';
import { busSeatMap, seatIdsOf } from '@/lib/seatLayout';
import { addDays, formatDateLabel, formatLKR, formatTime12, genId, genRef, routeLabel, runsOn, segmentFare, takenSeats, todayISO } from '@/lib/trips';
import type { Booking, Gender } from '@/lib/types';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';

const FIRST_M = ['Kasun', 'Nimal', 'Ruwan', 'Fazil', 'Arun', 'Imran', 'Sajith', 'Pradeep', 'Rizwan', 'Dinesh', 'Mohamed', 'Tharindu'];
const FIRST_F = ['Ayesha', 'Nadeesha', 'Fathima', 'Kavya', 'Shalini', 'Dilini', 'Rukshana', 'Priya', 'Hasini', 'Zainab'];
const LAST = ['Perera', 'Fernando', 'Silva', 'Rahman', 'Kumar', 'Jayasinghe', 'Nazeer', 'Wickramasinghe', 'Sivakumar', 'Bandara', 'Hameed'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

type StopsMode = 'mixed' | 'ends' | 'chosen';
type PayMode = 'mixed' | 'paid' | 'bus';

export default function TestPassengersPage() {
  const { data, mode, addTestBookings, deleteTestBookings } = useStore();
  const { toast, Toast } = useToast();
  const allowed = mode === 'demo' || mockVerificationOn();

  const schedules = data.schedules.filter((s) => s.active && !s.archived);
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? '');
  const schedule = schedules.find((s) => s.id === scheduleId);
  const route = data.routes.find((r) => r.id === schedule?.routeId);
  const bus = data.buses.find((b) => b.id === schedule?.busId);
  // The next fortnight's dates this departure runs on (today first).
  const dates = useMemo(() => {
    if (!schedule) return [];
    const out: string[] = [];
    for (let i = -1; i < 21 && out.length < 10; i++) {
      const d = addDays(todayISO(), i);
      if (runsOn(schedule, d)) out.push(d);
    }
    return out;
  }, [schedule]);
  const [date, setDate] = useState('');
  useEffect(() => setDate((d) => (dates.includes(d) ? d : dates.find((x) => x >= todayISO()) ?? dates[0] ?? '')), [dates]);

  const stops = (route?.stops ?? []).filter((s) => !s.hidden);
  const [count, setCount] = useState(6);
  const [stopsMode, setStopsMode] = useState<StopsMode>('mixed');
  const [fromName, setFromName] = useState('');
  const [toName, setToName] = useState('');
  const [payMode, setPayMode] = useState<PayMode>('mixed');
  const [onRequest, setOnRequest] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFromName(stops[0]?.name ?? '');
    setToName(stops[stops.length - 1]?.name ?? '');
  }, [route?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const seats = bus ? seatIdsOf(busSeatMap(bus)) : [];
  const taken = schedule && date ? takenSeats(data.bookings, schedule.id, date) : new Set<string>();
  const free = seats.filter((s) => !taken.has(s));
  const tests = data.bookings.filter((b) => b.isTest && b.scheduleId === scheduleId && b.date === date && b.status !== 'cancelled');
  const testSeats = tests.reduce((n, b) => n + b.seats.length, 0);

  const add = async () => {
    if (!schedule || !route || !bus || !date) return;
    const pool = [...free].filter((s) => !(bus.reservedSeats ?? []).includes(s));
    const made: Booking[] = [];
    const idx = (n: string) => route.stops.findIndex((s) => s.name === n);
    const usable = stops.filter((s) => onRequest || !s.optional);
    for (let k = 0; k < count && pool.length; k++) {
      const female = Math.random() < 0.4;
      const gender: Gender = female ? 'Female' : 'Male';
      const seatChoices = pool.filter((s) => female || !bus.ladiesSeats.includes(s));
      if (!seatChoices.length) break;
      const seat = pick(seatChoices);
      pool.splice(pool.indexOf(seat), 1);
      let fi: number;
      let ti: number;
      if (stopsMode === 'chosen') {
        fi = idx(fromName);
        ti = idx(toName);
      } else if (stopsMode === 'ends') {
        fi = idx(stops[0].name);
        ti = idx(stops[stops.length - 1].name);
      } else {
        // Most ride end to end; the rest get on or off somewhere on the way.
        const a = Math.random() < 0.6 ? usable[0] : pick(usable.slice(0, -1));
        const later = usable.filter((s) => idx(s.name) > idx(a.name));
        const b = Math.random() < 0.5 ? later[later.length - 1] : pick(later);
        fi = idx(a.name);
        ti = idx(b.name);
      }
      if (fi < 0 || ti <= fi) return toast('Choose a drop-off after the boarding stop.', 'error');
      const pay = payMode === 'mixed' ? (Math.random() < 0.6 ? 'paid' : 'bus') : payMode;
      const fare = segmentFare(route, fi, ti);
      const name = `${female ? pick(FIRST_F) : pick(FIRST_M)} ${pick(LAST)}`;
      const phone = `+9477${String(Math.floor(1000000 + Math.random() * 8999999))}`;
      made.push({
        id: genId('test'),
        ref: genRef(),
        scheduleId: schedule.id,
        date,
        from: route.stops[fi].name,
        to: route.stops[ti].name,
        seats: [seat],
        passenger: { name, gender, phone },
        contact: { email: '', phone },
        channel: 'counter',
        fare,
        fee: 0,
        discount: 0,
        total: fare,
        status: 'confirmed',
        paymentMethod: pay === 'paid' ? 'cash' : 'bus',
        paymentStatus: pay === 'paid' ? 'paid' : 'unpaid',
        createdAt: new Date().toISOString(),
        isTest: true,
      });
    }
    if (!made.length) return toast('No free seats left on this trip.', 'error');
    setBusy(true);
    const r = await addTestBookings(made);
    setBusy(false);
    toast(r.ok ? `${made.length} test ${made.length === 1 ? 'passenger' : 'passengers'} added` : r.reason ?? 'Could not add', r.ok ? 'ok' : 'error');
  };
  const remove = async (ids: string[]) => {
    setBusy(true);
    const r = await deleteTestBookings(ids);
    setBusy(false);
    toast(r.ok ? (ids.length === 1 ? 'Test passenger deleted' : `${ids.length} test passengers deleted`) : r.reason ?? 'Could not delete', r.ok ? 'ok' : 'error');
  };

  if (!allowed) {
    return (
      <>
        <PageHeader title="Test passengers" />
        <Card className="p-6 text-[14px] text-[#46464f] space-y-2">
          <p className="font-bold text-[#050a44]">Only for testing on your computer.</p>
          <p>Put <code className="px-1.5 py-0.5 rounded bg-[#f2f4f6]">NEXT_PUBLIC_MOCK_VERIFICATION=true</code> in <code className="px-1.5 py-0.5 rounded bg-[#f2f4f6]">.env.local</code>, restart <code>npm run dev</code> and open this page on localhost. It never works on the live site.</p>
        </Card>
      </>
    );
  }

  const seg = (on: boolean) => `flex-1 min-h-10 px-2 py-1.5 rounded-lg text-[13px] font-bold border ${on ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white border-[#c7c5d1] text-[#46464f]'}`;

  return (
    <>
      <PageHeader
        title="Test passengers"
        description="Fill a departure with pretend passengers to try the conductor app: boarding, cash, tonight's stops and the map. They're marked as test bookings; delete them here when you're done."
        actions={
          <Link href="/conductor" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-[#feb700] text-[#050a44] text-[13px] font-bold">
            <Bus className="w-4 h-4" /> Open the conductor app
          </Link>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6 items-start">
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-[#050a44]">
            <FlaskConical className="w-5 h-5" />
            <p className="text-[15px] font-bold">Add passengers</p>
          </div>
          <Field label="Departure">
            <select className={inputClass} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
              {schedules.map((s) => {
                const r = data.routes.find((x) => x.id === s.routeId);
                const b = data.buses.find((x) => x.id === s.busId);
                return <option key={s.id} value={s.id}>{`${formatTime12(s.departure)} · ${routeLabel(r)} · ${b?.name ?? ''}`}</option>;
              })}
            </select>
          </Field>
          <Field label="Date" hint={bus ? `${free.length} of ${seats.length} seats free on this trip` : undefined}>
            <select className={inputClass} value={date} onChange={(e) => setDate(e.target.value)}>
              {dates.map((d) => <option key={d} value={d}>{formatDateLabel(d)}{d === todayISO() ? ' (today)' : ''}</option>)}
            </select>
          </Field>
          <Field label="How many">
            <input type="number" min={1} max={40} className={inputClass} value={count} onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} />
          </Field>
          <div>
            <p className="text-[12px] font-bold text-[#46464f] mb-1.5 px-1">Where they get on and off</p>
            <div className="flex gap-2">
              <button type="button" className={seg(stopsMode === 'mixed')} onClick={() => setStopsMode('mixed')}><Shuffle className="w-3.5 h-3.5 inline mr-1" />Mixed</button>
              <button type="button" className={seg(stopsMode === 'ends')} onClick={() => setStopsMode('ends')}>End to end</button>
              <button type="button" className={seg(stopsMode === 'chosen')} onClick={() => setStopsMode('chosen')}>Choose</button>
            </div>
            {stopsMode === 'chosen' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <select aria-label="Gets on at" className={inputClass} value={fromName} onChange={(e) => setFromName(e.target.value)}>
                  {stops.slice(0, -1).map((s) => <option key={s.name}>{s.name}</option>)}
                </select>
                <select aria-label="Gets off at" className={inputClass} value={toName} onChange={(e) => setToName(e.target.value)}>
                  {stops.slice(1).map((s) => <option key={s.name}>{s.name}</option>)}
                </select>
              </div>
            )}
            {stopsMode === 'mixed' && stops.some((s) => s.optional) && (
              <label className="flex items-center gap-2 mt-2 px-1 text-[13px] font-semibold text-[#050a44]">
                <input type="checkbox" checked={onRequest} onChange={(e) => setOnRequest(e.target.checked)} className="accent-[#7c3aed]" />
                Some to or from on-request stops
              </label>
            )}
          </div>
          <div>
            <p className="text-[12px] font-bold text-[#46464f] mb-1.5 px-1">Paying</p>
            <div className="flex gap-2">
              <button type="button" className={seg(payMode === 'mixed')} onClick={() => setPayMode('mixed')}>Mixed</button>
              <button type="button" className={seg(payMode === 'paid')} onClick={() => setPayMode('paid')}>All paid</button>
              <button type="button" className={seg(payMode === 'bus')} onClick={() => setPayMode('bus')}>All pay on bus</button>
            </div>
          </div>
          <Button variant="gold" className="w-full" disabled={busy || !free.length || !date} onClick={add}>
            <Plus className="w-4 h-4" /> Add {count} test {count === 1 ? 'passenger' : 'passengers'}
          </Button>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#edeef0]">
            <div>
              <p className="text-[15px] font-bold text-[#050a44]">On this trip</p>
              <p className="text-[12px] text-[#46464f]">{tests.length} test {tests.length === 1 ? 'booking' : 'bookings'} · {testSeats} {testSeats === 1 ? 'seat' : 'seats'}{date ? ` · ${formatDateLabel(date)}` : ''}</p>
            </div>
            {tests.length > 0 && (
              <Button variant="danger" disabled={busy} onClick={() => window.confirm(`Delete all ${tests.length} test passengers on this trip?`) && remove(tests.map((b) => b.id))}>
                <Trash2 className="w-4 h-4" /> Delete all
              </Button>
            )}
          </div>
          {tests.length === 0 ? (
            <p className="px-5 py-10 text-center text-[14px] text-[#6b6d78]">No test passengers on this trip yet.</p>
          ) : (
            <ul className="divide-y divide-[#edeef0]">
              {tests.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-[#f2f4f6] flex items-center justify-center text-[#46464f]"><UserRound className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-bold text-[#050a44] truncate">{b.passenger.name} · {b.seats.join(', ')}</span>
                    <span className="block text-[12px] text-[#46464f] truncate">{b.from} → {b.to} · {formatLKR(b.total)} · {b.paymentStatus === 'paid' ? 'paid' : 'pays on the bus'} · {b.status}</span>
                  </span>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${b.passenger.name}`} disabled={busy} onClick={() => remove([b.id])}>
                    <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Toast />
    </>
  );
}
