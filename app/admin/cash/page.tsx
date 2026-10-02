'use client';
// Close the day: the cash THIS person should be holding (cash they took at
// the counter or on the bus, less cash refunds they paid out) against what
// they count. A day that is short or over can't be closed without a note,
// and the super admins are told. The expected figure comes from the database
// (migration 15); in demo mode it is worked out in the browser.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { useCashCounts, useCashSummary } from '@/lib/extras';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { formatDateLabel, formatLKR, formatTime12, routeLabel, todayISO } from '@/lib/trips';
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

export default function CashPage() {
  const { user } = useAuth();
  const { data } = useStore();
  const { counts, save } = useCashCounts();
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

  // Database: this person's own takings and refunds. Re-read whenever a payment is recorded.
  const paidCount = data.bookings.filter((b) => b.paymentStatus === 'paid').length;
  const summary = useCashSummary(date, scheduleId, paidCount);
  // A different day or trip starts with an empty count.
  useEffect(() => {
    setCounted('');
    setNotes('');
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
  const expected = isSupabaseConfigured ? summary?.expected ?? 0 : takenTotal;
  const loading = isSupabaseConfigured && !summary;

  const closedToday = counts.find((c) => c.date === date && (c.scheduleId ?? null) === scheduleId && c.mine !== false);
  const diff = typeof counted === 'number' ? counted - expected : 0;
  const needsNote = typeof counted === 'number' && diff !== 0;
  const whereLabel: Record<string, string> = { counter: 'counter sale', phone: 'phone sale', collected: 'collected for an online booking' };

  return (
    <>
      <PageHeader
        title={scheduleId ? 'Close this trip' : 'Close the day'}
        description={`Cash count for ${formatDateLabel(date)}${tripLabel ? ` · ${tripLabel}` : ''}${user ? ` · ${user.user_metadata.full_name}` : ''}.`}
      />
      {!scheduleId && (
        <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
          <label className="text-[13px] font-bold text-[#050a44]" htmlFor="cash-date">Day</label>
          <input id="cash-date" type="date" max={today} className={`${inputClass} !w-auto`} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          {date !== today && <Button size="sm" variant="secondary" onClick={() => setDate(today)}>Today</Button>}
          <span className="text-[12px] text-[#6b6d78]">Cash you took on this day. Conductors close each trip from the conductor screen.</span>
        </Card>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-6">
        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] font-bold text-[#46464f]">Cash you should have</p>
              <p className="text-[26px] font-semibold text-[#050a44] tabular-nums">{loading ? '…' : formatLKR(expected)}</p>
              <p className="text-[12px] text-[#6b6d78]">
                {taken.length} cash payment{taken.length === 1 ? '' : 's'} you took {scheduleId ? 'for this trip' : date === today ? 'today' : 'that day'}
                {refundTotal > 0 && <>, less {formatLKR(refundTotal)} you refunded in cash</>}
              </p>
            </div>
            {closedToday && (
              <div>
                <p className="text-[12px] font-bold text-[#46464f]">You counted</p>
                <p className="text-[26px] font-semibold text-[#050a44] tabular-nums">{formatLKR(closedToday.counted)}</p>
                <Difference expected={closedToday.expected} counted={closedToday.counted} className="text-[12px]" />
              </div>
            )}
          </div>
          {!closedToday ? (
            <>
              <Field label="Cash you counted (LKR)" hint={`Count the notes and coins you are holding from ${scheduleId ? 'this trip' : date === today ? "today's sales" : "that day's sales"}, then enter the total.`}>
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
              <Field label={needsNote ? 'What happened? (needed to close the day)' : 'Notes'}>
                <textarea
                  className={`${inputClass} min-h-[72px] py-2`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={needsNote ? (diff < 0 ? 'e.g. gave LKR 500 change by mistake to seat 12' : 'e.g. passenger in seat 7 paid twice, to be returned') : 'Optional'}
                />
              </Field>
              {needsNote && notes.trim().length < 3 && <p className="text-[12px] font-semibold text-[#ba1a1a]">Write a note to close a day that is {diff < 0 ? 'short' : 'over'}.</p>}
              <Button variant="gold" disabled={loading || counted === '' || (needsNote && notes.trim().length < 3)} onClick={async () => {
                const r = await save({ date, scheduleId, expected, counted: Number(counted), notes: notes.trim() });
                toast(r.ok ? (diff === 0 ? 'Closed. Balanced.' : `Closed: ${diff < 0 ? 'short' : 'over'} by ${formatLKR(Math.abs(diff))}. The super admin has been told.`) : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
              }}>
                {scheduleId ? 'Close this trip' : 'Close the day'}
              </Button>
            </>
          ) : (
            <p className="text-[14px] text-[#46464f]">You have closed this {scheduleId ? 'trip' : 'day'}{closedToday.notes ? `. Note: ${closedToday.notes}` : '.'}</p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-[#edeef0] flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-[#050a44]">Cash you took {scheduleId ? 'for this trip' : date === today ? 'today' : 'that day'}</h2>
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
