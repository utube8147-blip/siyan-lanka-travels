'use client';
// Close the day: the cash THIS person should be holding (cash they took at
// the counter or on the bus, less cash refunds they paid out) against what
// they count. A day that is short or over can't be closed without a note,
// and the super admins are told. The expected figure comes from the database
// (migration 15); in demo mode it is worked out in the browser.
//
// The odometer reading is taken in the same step: closing a trip asks for the
// bus's reading (the conductor is standing next to it), closing an office day
// offers it for each bus. It is checked against the last reading as it is
// typed, so a slipped digit is caught before anything is saved. The Odometer
// page keeps the history and is where office staff correct a reading.
//
// Closing a TRIP is the conductor's whole trip sheet (migration 27), in the
// order of the paper sheet printed with the passenger list: odometer at the
// start and end, fuel put in, tolls and other costs, then the cash. Costs paid
// from the cash collected come off the cash to hand in.
//
// Who closes what (migration 28): the conductor does NOT fill this in. They
// write the paper trip sheet on the road and hand it in with the cash; the
// booking centre opens the trip here, picks the conductor and types the sheet
// in for them. A conductor who opens this page only sees how much cash they
// should be holding.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { useCashCounts, useCashOverview, useCashSummary, useCashUnclosed, useTripCashPeople, type CashPerson } from '@/lib/extras';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { checkReading, useOdometer } from '@/lib/odometer';
import Link from 'next/link';
import { costProblems, emptySheet, pendingFromCash, useTripSheet, ROAD_COST_LABEL, type TripSheetDraft } from '@/lib/tripSheet';
import { SavedCosts, TripSheet, odometerState } from '@/components/staff/TripSheet';
import { addDays, formatDateLabel, formatLKR, formatTime12, listRuns, routeLabel, todayISO } from '@/lib/trips';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';

/** "Balanced" / "Short by LKR 500" / "Over by LKR 200" with its colour. */
function Difference({ expected, counted, className = '' }: { expected: number; counted: number; className?: string }) {
  const d = counted - expected;
  return (
    <span className={`font-bold ${d === 0 ? 'text-[#006e1c]' : d < 0 ? 'text-[#ba1a1a]' : 'text-[#9a5b00]'} ${className}`}>
      {d === 0 ? 'Balanced' : `${d < 0 ? 'Short' : 'Over'} by ${formatLKR(Math.abs(d))}`}
    </span>
  );
}

const km = (n: number) => `${n.toLocaleString('en-LK')} km`;
/** One person's cash for a trip or a day: closed (with the result) or still open. */
function PersonRow({ p }: { p: CashPerson }) {
  const role = p.role === 'conductor' ? 'conductor' : p.role === 'admin' ? 'super admin' : 'office';
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
      <span className="font-semibold text-[#050a44]">{p.name}</span>
      <span className="text-[12px] text-[#6b6d78]">{role}</span>
      {p.closed ? (
        <>
          <span className="text-[#46464f] tabular-nums">should have {formatLKR(p.recorded_expected ?? p.expected)} · counted {formatLKR(p.counted ?? 0)}</span>
          <Difference expected={p.recorded_expected ?? p.expected} counted={p.counted ?? 0} />
          {p.notes && <span className="basis-full text-[12px] text-[#46464f]">Note: {p.notes}</span>}
        </>
      ) : (
        <span className="font-bold text-[#9a5b00]">Not closed yet · should have {formatLKR(p.expected)}</span>
      )}
    </li>
  );
}

export default function CashPage() {
  const { user } = useAuth();
  const { data, ready } = useStore();
  const { counts, save } = useCashCounts();
  const odometer = useOdometer();
  const [readings, setReadings] = useState<Record<string, number | ''>>({});
  const [savingOdo, setSavingOdo] = useState(false);
  const [sheet, setSheet] = useState<TripSheetDraft>(emptySheet);
  // Readings already saved in this sitting (a retry after a refused cost must not log them again).
  const startSaved = useRef<number | null>(null);
  const endSaved = useRef<number | null>(null);
  const { toast, Toast } = useToast();
  const today = todayISO();
  // What is being closed. From the conductor screen: the departure chosen there
  // (?date=…&schedule=…), because a night bus spans two dates. Otherwise a day,
  // today by default, and any earlier day can be picked.
  const [date, setDate] = useState(today);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get('date');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
    setScheduleId(q.get('schedule'));
  }, []);
  const schedule = scheduleId ? data.schedules.find((s) => s.id === scheduleId) : undefined;
  const tripLabel = schedule ? `${formatTime12(schedule.departure)} ${routeLabel(data.routes.find((r) => r.id === schedule.routeId))}` : null;
  const [counted, setCounted] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const isAdmin = user?.role === 'admin';
  // Conductors hand in the paper sheet; office staff close the trip for them.
  const isConductor = user?.role === 'conductor';
  // Only once we know who is signed in and the timetable has loaded (never on the server's first paint).
  const canClose = !!user && ready && !isConductor;
  /** Trip mode, office: whose cash is being closed (a conductor). null = your own. */
  const [person, setPerson] = useState<string | null>(null);

  // Database: this person's own takings and refunds. Re-read whenever a payment is recorded.
  const paidCount = data.bookings.filter((b) => b.paymentStatus === 'paid').length;
  const tripBus = schedule ? data.buses.find((b) => b.id === schedule.busId) : undefined;
  const tripSheet = useTripSheet(scheduleId, date, tripBus?.id ?? null);
  const cashPeople = useTripCashPeople(scheduleId, date, canClose, `${paidCount}-${counts.length}-${tripSheet.saved.length}`);
  // Start on whoever took cash and isn't closed yet (the list comes in that order).
  useEffect(() => {
    if (!scheduleId || person || !cashPeople.people?.length) return;
    setPerson((cashPeople.people.find((p) => !p.closed) ?? cashPeople.people[0]).id);
  }, [scheduleId, person, cashPeople.people]);
  const forUser = scheduleId && canClose && person && person !== user?.id ? person : null;
  const whose = forUser ? cashPeople.people?.find((p) => p.id === forUser)?.name ?? 'the conductor' : null;
  // …and whenever a trip cost is saved, because that changes the cash to hand in.
  const summaryState = useCashSummary(date, scheduleId, `${paidCount}-${tripSheet.saved.length}`, forUser);
  const summaryError = summaryState === 'error';
  const summary = summaryState === 'error' ? null : summaryState;
  // Earlier days / trips where this person took cash and never closed; and, for the super admin, the whole day bus by bus.
  const unclosed = useCashUnclosed(`${paidCount}-${counts.length}`);
  const overview = useCashOverview(date, isAdmin && !scheduleId, `${paidCount}-${counts.length}`);
  const tripName = (id: string | null) => {
    const sc = id ? data.schedules.find((x) => x.id === id) : undefined;
    return sc ? `${formatTime12(sc.departure)} ${routeLabel(data.routes.find((r) => r.id === sc.routeId))}` : '';
  };
  // A different day or trip starts with an empty count.
  useEffect(() => {
    setCounted('');
    setNotes('');
    setReadings({});
    setSheet(emptySheet());
    setPerson(null);
    startSaved.current = null;
    endSaved.current = null;
  }, [date, scheduleId]);

  // Demo mode (no database): cash sales made today.
  const demoSales = useMemo(
    () =>
      data.bookings.filter(
        (b) => b.status !== 'cancelled' && !b.id.startsWith('avail-') && b.paymentMethod === 'cash' && b.paymentStatus === 'paid' && (scheduleId ? b.scheduleId === scheduleId && b.date === date : b.createdAt.slice(0, 10) === date),
      ),
    [data.bookings, date, scheduleId],
  );
  const taken = isSupabaseConfigured
    ? summary?.taken ?? []
    : demoSales.map((b) => ({ ref: b.ref, name: b.passenger.name, seats: b.seats, from: b.from, to: b.to, amount: b.total, at: b.createdAt, where: b.channel }));
  const refunds = summary?.refunds ?? [];
  const takenTotal = taken.reduce((n, t) => n + t.amount, 0);
  const refundTotal = refunds.reduce((n, r) => n + r.amount, 0);
  // From the database this is already less the refunds and the costs saved so far; in demo mode it is worked out here.
  const expectedSaved = isSupabaseConfigured ? summary?.expected ?? 0 : takenTotal;
  const loading = isSupabaseConfigured && !summary && !summaryError;
  // The trip sheet (trips only). Costs typed but not saved yet already count
  // against the cash to hand in, so the figure doesn't jump when closing.
  const useSheet = !!scheduleId && !!tripBus && !odometer.error;
  const costsAvailable = useSheet && !tripSheet.unavailable;
  const paidOut = isSupabaseConfigured ? summary?.paid_out ?? [] : tripSheet.saved.filter((x) => x.fromTakings).map((x) => ({ id: x.id, category: x.category, amount: x.amount, litres: x.litres, detail: `${x.vendor} ${x.description}`.trim() }));
  const paidOutSaved = paidOut.reduce((n, x) => n + x.amount, 0);
  const paidOutTyped = costsAvailable ? pendingFromCash(sheet) : 0;
  const sheetOdo = useSheet && tripBus ? odometerState(odometer.logs, tripBus.id, date, today, sheet) : null;
  const sheetProblems = costsAvailable ? costProblems(sheet) : [];

  const expected = isSupabaseConfigured ? expectedSaved - paidOutTyped : expectedSaved - paidOutSaved - paidOutTyped;

  const closedToday = counts.find((c) => c.date === date && (c.scheduleId ?? null) === scheduleId && (forUser ? c.personId === forUser : c.mine !== false));
  const diff = typeof counted === 'number' ? counted - expected : 0;
  const needsNote = typeof counted === 'number' && diff !== 0;
  // Odometer: a trip is closed next to its bus, so its reading is asked for
  // (dated today, when it is read). A day closed at the office offers every
  // bus on the road, dated that day, and can be left empty.
  const odoDate = scheduleId ? today : date;
  const odoBuses = scheduleId ? data.buses.filter((b) => b.id === schedule?.busId) : data.buses.filter((b) => b.status === 'active');
  const odoRows = odoBuses.map((bus) => ({ bus, value: readings[bus.id] ?? '', ...checkReading(odometer.logs, bus.id, odoDate, readings[bus.id] ?? '', (d) => formatDateLabel(d, false)) }));
  const odoProblem = odoRows.some((r) => r.problem);
  const odoMissing = !!scheduleId && odometer.ready && !odometer.error && odoRows.some((r) => !r.logged && r.value === '');
  const odoTyped = odoRows.filter((r) => typeof r.value === 'number' && !r.problem);
  /** Saves the readings typed in. Stops at the first one the database refuses. */
  const saveReadings = async () => {
    for (const r of odoTyped) {
      const res = await odometer.add(r.bus.id, odoDate, r.value as number, scheduleId ? `Closing trip ${tripLabel ?? ''}`.trim() : 'Closing the day');
      if (!res.ok) return { ok: false as const, reason: `${r.bus.regNo}: ${res.reason ?? 'the reading could not be saved'}` };
      setReadings((p) => ({ ...p, [r.bus.id]: '' }));
    }
    return { ok: true as const };
  };
  /** Trip sheet: start reading, each cost, then the end reading. Whatever is saved is removed from the form straight away. */
  const saveTripSheet = async () => {
    if (!tripBus) return { ok: true as const };
    const note = `Trip ${tripLabel ?? ''}`.trim();
    let d = sheet;
    const keep = (next: TripSheetDraft) => {
      d = next;
      setSheet(next);
    };
    const endKm = d.end;
    if (typeof d.start === 'number' && startSaved.current !== d.start) {
      const r = await odometer.add(tripBus.id, date, d.start, `${note}: start`);
      if (!r.ok) return { ok: false as const, reason: `Odometer at the start: ${r.reason ?? 'could not be saved'}` };
      startSaved.current = d.start;
    }
    for (const f of d.fuels) {
      const r = await tripSheet.add({ category: 'fuel', amount: f.amount as number, litres: f.litres as number, odometerKm: typeof f.odometerKm === 'number' ? f.odometerKm : null, vendor: f.station.trim(), fromCash: f.fromCash, takingsOf: forUser });
      if (!r.ok) return { ok: false as const, reason: `Fuel: ${r.reason}` };
      keep({ ...d, fuels: d.fuels.filter((x) => x.key !== f.key) });
    }
    for (const c of d.costs) {
      const r = await tripSheet.add({ category: c.kind, amount: c.amount as number, description: c.note.trim(), fromCash: c.fromCash, takingsOf: forUser });
      if (!r.ok) return { ok: false as const, reason: `${ROAD_COST_LABEL[c.kind]}: ${r.reason}` };
      keep({ ...d, costs: d.costs.filter((x) => x.key !== c.key) });
    }
    if (typeof endKm === 'number' && endSaved.current !== endKm) {
      const r = await odometer.add(tripBus.id, today, endKm, `${note}: end`);
      if (!r.ok) return { ok: false as const, reason: `Odometer at the end: ${r.reason ?? 'could not be saved'}` };
      endSaved.current = endKm;
    }
    return { ok: true as const };
  };
  const odoSection =
    odoRows.length === 0 || odometer.error ? null : (
      <fieldset className="rounded-xl border border-[#e1e2e4] p-4 space-y-3">
        <legend className="px-1 text-[12px] font-bold text-[#46464f]">Odometer {odoRows.every((r) => r.logged) ? '' : scheduleId ? '(needed to close this trip)' : '(if you have it)'}</legend>
        {odoRows.map((r) => (
          <div key={r.bus.id}>
            {r.logged ? (
              <p className="text-[14px] text-[#46464f]">
                <b className="font-semibold text-[#050a44]">{r.bus.regNo}</b>: {km(r.logged.km)} logged {odoDate === today ? 'today' : 'that day'}{r.logged.by ? ` by ${r.logged.by}` : ''}.
              </p>
            ) : (
              <label className="block">
                <span className="text-[13px] font-semibold text-[#050a44]">{r.bus.regNo} reading now (km)</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className={`${inputClass} mt-1 ${r.problem ? '!border-[#ba1a1a]' : ''}`}
                  value={r.value}
                  placeholder={r.before ? `More than ${r.before.km.toLocaleString('en-LK')}` : 'The number on the dashboard'}
                  aria-invalid={!!r.problem}
                  aria-describedby={`odo-${r.bus.id}`}
                  onChange={(e) => setReadings((p) => ({ ...p, [r.bus.id]: e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value))) }))}
                />
                <span id={`odo-${r.bus.id}`} className={`block text-[12px] mt-1 ${r.problem ? 'font-semibold text-[#ba1a1a]' : r.warning ? 'font-semibold text-[#9a5b00]' : 'text-[#6b6d78]'}`}>
                  {r.problem ?? r.warning ?? (r.distance !== null
                    ? `${km(r.distance)} since the last reading${r.before ? ` (${km(r.before.km)}, ${formatDateLabel(r.before.date, false)})` : ''}.`
                    : r.before
                      ? `Last reading: ${km(r.before.km)} on ${formatDateLabel(r.before.date, false)}.`
                      : 'First reading for this bus: it sets the starting point.')}
                </span>
              </label>
            )}
          </div>
        ))}
      </fieldset>
    );

  // Office: the departures that leave on the chosen day or left the evening before (a night bus arrives the next morning).
  const tripsToClose = useMemo(() => (canClose ? listRuns(data, addDays(date, -1), 2).filter((r) => r.date <= today) : []), [canClose, data, date, today]);

  const whereLabel: Record<string, string> = { counter: 'counter sale', phone: 'phone sale', collected: 'collected for an online booking' };

  return (
    <>
      <PageHeader
        title={isConductor ? 'Your cash' : scheduleId ? 'Close this trip' : 'Close the day'}
        description={`${isConductor ? 'The cash you should be holding' : scheduleId ? 'Type in the conductor\'s trip sheet and the cash handed in' : 'Cash count and odometer'} for ${formatDateLabel(date)}${tripLabel ? ` · ${tripLabel}` : ''}${user ? ` · ${user.user_metadata.full_name}` : ''}.`}
      />
      {summaryError && (
        <p role="alert" className="mb-4 rounded-xl bg-[#ba1a1a]/10 border border-[#ba1a1a]/25 text-[#93000a] text-[14px] font-semibold px-4 py-3">
          The cash figures couldn&apos;t be loaded. The database is missing the latest update: run supabase/setup.sql in the Supabase SQL Editor, then reload this page.
        </p>
      )}
      {unclosed.length > 0 && canClose && (
        <div role="alert" className="mb-4 rounded-xl bg-[#feb700]/15 border border-[#feb700]/50 px-4 py-3">
          <p className="text-[14px] font-bold text-[#050a44]">
            You have {unclosed.length} unfinished cash count{unclosed.length === 1 ? '' : 's'}
          </p>
          <p className="text-[13px] text-[#46464f]">You took cash on these and didn&apos;t close them. Pick one to finish it now.</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {unclosed.map((u) => {
              const on = u.date === date && (u.schedule_id ?? null) === scheduleId;
              return (
                <button
                  key={`${u.kind}-${u.date}-${u.schedule_id}`}
                  onClick={() => {
                    setDate(u.date);
                    setScheduleId(u.schedule_id ?? null);
                  }}
                  aria-pressed={on}
                  className={`px-3 py-2 rounded-lg text-[13px] font-bold border text-left ${on ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}
                >
                  {formatDateLabel(u.date, false)}
                  {u.kind === 'trip' ? ` · ${tripName(u.schedule_id)}` : ''}
                  <span className="block text-[12px] font-semibold opacity-80">{formatLKR(u.amount)} · {u.payments} payment{u.payments === 1 ? '' : 's'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {scheduleId && canClose && (
        <div className="mb-4">
          <Button size="sm" variant="secondary" onClick={() => setScheduleId(null)}>← Back to the whole day</Button>
        </div>
      )}
      {!scheduleId && (
        <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
          <label className="text-[13px] font-bold text-[#050a44]" htmlFor="cash-date">Day</label>
          <input id="cash-date" type="date" max={today} className={`${inputClass} !w-auto`} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {date !== today && <Button size="sm" variant="secondary" onClick={() => setDate(today)}>Today</Button>}
          <span className="text-[12px] text-[#6b6d78]">Pick the day you want to count. It shows the cash you personally took that day.</span>
        </Card>
      )}
      {!scheduleId && canClose && tripsToClose.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#edeef0]">
            <h2 className="text-[15px] font-semibold text-[#050a44]">Trips to close from the conductor&apos;s sheet</h2>
            <p className="text-[12px] text-[#6b6d78] mt-0.5">When the conductor hands in the paper trip sheet and the cash, open the trip and type it in.</p>
          </div>
          <ul className="divide-y divide-[#edeef0]">
            {tripsToClose.map((r) => {
              const done = counts.some((c) => c.scheduleId === r.schedule.id && c.date === r.date);
              return (
                <li key={`${r.schedule.id}|${r.date}`} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[14px] text-[#050a44]">
                    <b className="font-semibold">{formatDateLabel(r.date, false)}, {formatTime12(r.schedule.departure)}</b> {routeLabel(r.route)}
                    <span className="text-[#6b6d78]"> {r.bus.regNo}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {done && <span className="text-[12px] font-bold text-[#006e1c]">Closed</span>}
                    <Button size="sm" variant={done ? 'secondary' : 'primary'} onClick={() => { setDate(r.date); setScheduleId(r.schedule.id); }}>{done ? 'Open' : 'Enter the trip sheet'}</Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {scheduleId && canClose && (cashPeople.people?.length ?? 0) > 0 && (
        <Card className="p-4 mb-4">
          <p className="text-[13px] font-bold text-[#050a44] mb-2">Whose trip sheet and cash is this?</p>
          <div className="flex flex-wrap gap-2">
            {cashPeople.people!.map((p) => (
              <button key={p.id} onClick={() => setPerson(p.id)} aria-pressed={person === p.id}
                className={`px-3 py-2 rounded-lg text-[13px] font-bold border text-left ${person === p.id ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}>
                {p.name}
                <span className="block text-[12px] font-semibold opacity-80">
                  {p.closed ? 'Closed' : p.took_cash ? `should hand in ${formatLKR(p.expected)}` : 'took no cash'}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}
      {scheduleId && canClose && cashPeople.unavailable && (
        <p role="alert" className="mb-4 rounded-xl bg-[#feb700]/15 border border-[#feb700]/50 text-[13px] font-semibold text-[#050a44] px-4 py-3">
          To close a trip for the conductor, run migration 28 (supabase/migrations/20261028000000_office_closes_trips.sql) in the Supabase SQL Editor. Until then this page closes only your own cash.
        </p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-6">
        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] font-bold text-[#46464f]">{whose ? `Cash ${whose} should hand in` : 'Cash you should have'}</p>
              <p className="text-[26px] font-semibold text-[#050a44] tabular-nums">{loading ? '…' : formatLKR(expected)}</p>
              <p className="text-[12px] text-[#6b6d78]">
                {taken.length} cash payment{taken.length === 1 ? '' : 's'} {whose ? 'taken' : 'you took'} {scheduleId ? 'for this trip' : date === today ? 'today' : 'that day'}
                {refundTotal > 0 && <>, less {formatLKR(refundTotal)} refunded in cash</>}
                {paidOutSaved + paidOutTyped > 0 && <>, less {formatLKR(paidOutSaved + paidOutTyped)} paid out of it for the trip</>}
              </p>
            </div>
            {closedToday && (
              <div>
                <p className="text-[12px] font-bold text-[#46464f]">{whose ? 'Handed in' : 'You counted'}</p>
                <p className="text-[26px] font-semibold text-[#050a44] tabular-nums">{formatLKR(closedToday.counted)}</p>
                <Difference expected={closedToday.expected} counted={closedToday.counted} className="text-[12px]" />
              </div>
            )}
          </div>
          {!closedToday && isConductor ? (
            <p className="text-[14px] text-[#46464f]">
              Hand this cash in with your paper trip sheet. If you paid for fuel, tolls or anything else out of it, write that on the sheet: the booking centre takes it off and closes the trip.
            </p>
          ) : !closedToday ? (
            <>
              {useSheet && tripBus && (
                <TripSheet draft={sheet} onChange={setSheet} logs={odometer.logs} busId={tripBus.id} busLabel={tripBus.regNo} tripDate={date} today={today} saved={tripSheet.saved} costsAvailable={costsAvailable} forSomeone={!!whose} />
              )}
              {useSheet && <p className="text-[12px] font-bold text-[#46464f] px-1 -mb-2">{costsAvailable ? '4' : '2'}. Cash</p>}
              <Field label={whose ? 'Cash handed in (LKR)' : 'Cash you counted (LKR)'} hint={whose ? `Count the cash ${whose} handed in with the trip sheet, then enter the total.` : `Count the notes and coins you are holding from ${scheduleId ? 'this trip' : date === today ? "today's sales" : "that day's sales"}, then enter the total.`}>
                <input type="number" min={0} inputMode="numeric" className={inputClass} value={counted} onChange={(e) => setCounted(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} />
              </Field>
              {typeof counted === 'number' && (
                <div className={`rounded-xl px-4 py-3 text-[14px] ${diff === 0 ? 'bg-[#e8f6ea]' : diff < 0 ? 'bg-[#ba1a1a]/10' : 'bg-[#feb700]/15'}`}>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[11px] font-bold text-[#46464f]">Should have</p>
                      <p className="font-bold text-[#050a44] tabular-nums">{formatLKR(expected)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-[#46464f]">Counted</p>
                      <p className="font-bold text-[#050a44] tabular-nums">{formatLKR(counted)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-[#46464f]">Difference</p>
                      <Difference expected={expected} counted={counted} />
                    </div>
                  </div>
                  {diff !== 0 && (
                    <p className="mt-2 text-[13px] font-semibold text-[#050a44]">
                      {diff < 0 ? 'There is less cash than there should be.' : 'There is more cash than there should be.'} Count again; if it is still {diff < 0 ? 'short' : 'over'}, write what happened below. The super admin is told.
                    </p>
                  )}
                </div>
              )}
              {useSheet && tripBus ? null : odoSection}
              <Field label={needsNote ? 'What happened? (needed to close the day)' : 'Notes'}>
                <textarea
                  className={`${inputClass} min-h-[72px] py-2`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={needsNote ? (diff < 0 ? 'e.g. gave LKR 500 change by mistake to seat 12' : 'e.g. passenger in seat 7 paid twice, to be returned') : 'Optional'}
                />
              </Field>
              {needsNote && notes.trim().length < 3 && <p className="text-[12px] font-semibold text-[#ba1a1a]">Write a note to close a day that is {diff < 0 ? 'short' : 'over'}.</p>}
              {!useSheet && odoMissing && counted !== '' && <p className="text-[12px] font-semibold text-[#ba1a1a]">Enter the odometer reading to close this trip.</p>}
              {useSheet && sheetOdo?.missing && counted !== '' && <p className="text-[12px] font-semibold text-[#ba1a1a]">Enter the odometer at the start and at the end to close this trip.</p>}
              {sheetProblems.length > 0 && (
                <ul className="text-[12px] font-semibold text-[#ba1a1a] space-y-0.5" role="alert">
                  {sheetProblems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
              <Button variant="gold" disabled={loading || savingOdo || counted === '' || (needsNote && notes.trim().length < 3) || (useSheet ? !sheetOdo || sheetOdo.missing || sheetOdo.problem || sheetProblems.length > 0 || !tripSheet.ready : odoProblem || odoMissing)} onClick={async () => {
                // Readings and costs first, the cash last: if anything is refused nothing is closed and the number can be fixed.
                // Each part is cleared from the form once saved, so pressing Close again never saves it twice.
                setSavingOdo(true);
                const odo = useSheet && tripBus ? await saveTripSheet() : await saveReadings();
                setSavingOdo(false);
                if (!odo.ok) return toast(odo.reason, 'error');
                const r = await save({ date, scheduleId, expected, counted: Number(counted), notes: notes.trim() }, forUser);
                if (r.ok) setCounted('');
                toast(r.ok ? (diff === 0 ? 'Closed. Balanced.' : `Closed: ${diff < 0 ? 'short' : 'over'} by ${formatLKR(Math.abs(diff))}. The super admin has been told.`) : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
              }}>
                {scheduleId ? 'Close this trip' : 'Close the day'}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[14px] text-[#46464f]">{isConductor ? 'The booking centre has closed this trip' : whose ? `This trip is closed for ${whose}` : `You have closed this ${scheduleId ? 'trip' : 'day'}`}{closedToday.notes ? `. Note: ${closedToday.notes}` : '.'}</p>
              {useSheet && tripSheet.saved.length > 0 && <SavedCosts saved={tripSheet.saved} />}
              {/* Closed before the reading was taken: it can still be added here. */}
              {canClose && odoSection}
              {canClose && odoRows.some((r) => !r.logged) && !odometer.error && (
                <Button variant="secondary" disabled={savingOdo || odoProblem || odoTyped.length === 0} onClick={async () => {
                  setSavingOdo(true);
                  const odo = await saveReadings();
                  setSavingOdo(false);
                  toast(odo.ok ? 'Odometer reading saved' : odo.reason, odo.ok ? 'ok' : 'error');
                }}>
                  Save the reading
                </Button>
              )}
            </>
          )}
          {!odometer.error && canClose && (
            <p className="text-[12px] text-[#6b6d78]">
              Typed a wrong reading? <Link href={user?.role === 'conductor' ? '/conductor/odometer' : '/admin/odometer'} className="font-semibold text-[#050a44] underline">Odometer</Link> has the history; office staff can remove a reading there.
            </p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0] flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-[#050a44]">{whose ? `Cash ${whose} took` : 'Cash you took'} {scheduleId ? 'for this trip' : date === today ? 'today' : 'that day'}</h2>
            <span className="text-[14px] font-bold text-[#050a44] tabular-nums">{formatLKR(takenTotal)}</span>
          </div>
          {taken.length === 0 ? <p className="p-5 text-[14px] text-[#46464f]">None yet.</p> : (
            <ul className="divide-y divide-[#edeef0] max-h-[420px] overflow-y-auto">
              {taken.map((t) => (
                <li key={`${t.ref}-${t.at}`} className="px-5 py-3 flex justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    <span className="block font-semibold text-[#050a44]">{t.name} · {t.seats.join(', ')}</span>
                    <span className="text-[#6b6d78]">{t.from} → {t.to} · {t.ref} · {whereLabel[t.where] ?? t.where}</span>
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">{formatLKR(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {paidOut.length > 0 && (
            <>
              <div className="px-5 py-3 border-t border-[#edeef0] flex items-baseline justify-between gap-3 bg-[#f8f9fb]">
                <h3 className="text-[13px] font-bold text-[#050a44]">Paid out of this cash for the trip</h3>
                <span className="text-[13px] font-bold text-[#ba1a1a] tabular-nums">− {formatLKR(paidOutSaved)}</span>
              </div>
              <ul className="divide-y divide-[#edeef0]">
                {paidOut.map((x) => (
                  <li key={x.id} className="px-5 py-2.5 flex justify-between gap-3 text-[13px]">
                    <span className="text-[#46464f]">{ROAD_COST_LABEL[x.category as keyof typeof ROAD_COST_LABEL] ?? x.category}{x.litres ? `, ${x.litres} L` : ''}{x.detail ? `, ${x.detail}` : ''}</span>
                    <span className="tabular-nums shrink-0">− {formatLKR(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {refunds.length > 0 && (
            <>
              <div className="px-5 py-3 border-t border-[#edeef0] flex items-baseline justify-between gap-3 bg-[#f8f9fb]">
                <h3 className="text-[13px] font-bold text-[#050a44]">Cash refunds you paid out</h3>
                <span className="text-[13px] font-bold text-[#ba1a1a] tabular-nums">− {formatLKR(refundTotal)}</span>
              </div>
              <ul className="divide-y divide-[#edeef0]">
                {refunds.map((r) => (
                  <li key={`${r.ref}-${r.at}`} className="px-5 py-2.5 flex justify-between gap-3 text-[13px]">
                    <span className="text-[#46464f]">{r.name || 'Passenger'} · {r.ref}</span>
                    <span className="tabular-nums shrink-0">− {formatLKR(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {isAdmin && !scheduleId && overview && (
        <Card className="mt-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0]">
            <h2 className="text-[16px] font-semibold text-[#050a44]">All buses and trips on {formatDateLabel(date, false)}</h2>
            <p className="text-[12px] text-[#6b6d78] mt-0.5">Every departure that day: what was sold, how it was paid, who took the cash and whether they have closed it.</p>
          </div>
          {overview.trips.length === 0 ? (
            <p className="p-5 text-[14px] text-[#46464f]">No departures on this day.</p>
          ) : (
            <ul className="divide-y divide-[#edeef0]">
              {overview.trips.map((t) => (
                <li key={t.schedule_id} className="px-5 py-4 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-[14px] font-bold text-[#050a44]">
                      {formatTime12(t.departure)} · {t.route}
                      <span className="font-medium text-[#46464f]"> · {t.bus}</span>
                    </p>
                    <p className="text-[13px] font-semibold text-[#46464f]">{t.seats} of {t.capacity} seats sold</p>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                    <span>Cash <b className="text-[#050a44] tabular-nums">{formatLKR(t.cash)}</b></span>
                    <span>Bank / online <b className="text-[#050a44] tabular-nums">{formatLKR(t.other_paid)}</b></span>
                    <span className={t.unpaid > 0 ? 'text-[#ba1a1a]' : ''}>Not paid yet <b className="tabular-nums">{formatLKR(t.unpaid)}</b></span>
                  </div>
                  {t.people.length === 0 ? (
                    <p className="text-[12px] text-[#6b6d78]">{t.cash > 0 ? 'Cash was taken, but there is no record of who took it (recorded before cash closing was tracked).' : 'No cash taken for this trip.'}</p>
                  ) : (
                    <ul className="space-y-1">
                      {t.people.map((p) => <PersonRow key={p.name + p.role} p={p} />)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="px-5 py-4 border-t border-[#edeef0] bg-[#f8f9fb]">
            <h3 className="text-[13px] font-bold text-[#050a44] mb-1.5">Office cash taken on this day</h3>
            {overview.days.length === 0 ? (
              <p className="text-[12px] text-[#6b6d78]">No office staff took cash on this day.</p>
            ) : (
              <ul className="space-y-1">
                {overview.days.map((p) => <PersonRow key={p.name + p.role} p={p} />)}
              </ul>
            )}
          </div>
        </Card>
      )}

      {counts.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0]">
            <h2 className="text-[16px] font-semibold text-[#050a44]">{isAdmin ? 'Closed days and trips: everyone' : 'Your past days and trips'}</h2>
            {isAdmin && <p className="text-[12px] text-[#6b6d78] mt-0.5">Each person closes their own cash. Days that were short or over are marked, with the note they left.</p>}
          </div>
          <ul className="divide-y divide-[#edeef0]">
            {counts.slice(0, isAdmin ? 60 : 14).map((c) => (
              <li key={c.id} className={`px-5 py-3 text-[13px] ${c.counted !== c.expected ? 'bg-[#ba1a1a]/[0.04]' : ''}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-semibold text-[#050a44]">
                    {formatDateLabel(c.date, false)}
                    {c.scheduleId ? <span className="font-medium text-[#46464f]"> · trip {(() => { const sc = data.schedules.find((x) => x.id === c.scheduleId); return sc ? `${formatTime12(sc.departure)} ${routeLabel(data.routes.find((r) => r.id === sc.routeId))}` : ''; })()}</span> : null}
                    {isAdmin && c.by ? <span className="font-medium text-[#46464f]"> · {c.by}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-4">
                    <span className="tabular-nums text-[#46464f]">should have {formatLKR(c.expected)} · counted {formatLKR(c.counted)}</span>
                    <Difference expected={c.expected} counted={c.counted} />
                  </span>
                </div>
                {c.notes && <p className="text-[12px] text-[#46464f] mt-1">Note: {c.notes}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Toast />
    </>
  );
}
