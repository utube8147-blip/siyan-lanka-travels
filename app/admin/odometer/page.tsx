'use client';
// Odometer — the daily reading for each bus. Counter staff ask the conductor
// (or the conductor enters it from the conductor app) once a day; the
// distance for the day is worked out from the reading before it. Readings
// entered with fuel or a service in Expenses appear here as well.

import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuth, isOfficeRole } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { useErp } from '@/lib/erp';
import { allReadings, dailyDistance, useOdometer } from '@/lib/odometer';
import { runsIn } from '@/lib/analytics';
import { addDays, formatDateLabel, todayISO } from '@/lib/trips';
import { Button, Card, Field, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { tx, txn } from '@/lib/i18n';

const num = (n: number) => n.toLocaleString('en-LK');

export default function OdometerPage() {
  const { user } = useAuth();
  const { data } = useStore();
  const office = isOfficeRole(user?.role);
  // Fuel / service readings come from Expenses, which only office staff can read.
  const erp = useErp({ admin: user?.role === 'admin' });
  const odo = useOdometer();
  const { toast, Toast } = useToast();
  const today = todayISO();
  const buses = data.buses.filter((b) => b.status !== 'retired');
  const [busId, setBusId] = useState('');
  const [date, setDate] = useState(today);
  const [km, setKm] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // From the conductor app: /conductor/odometer?bus=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('bus');
    if (q) setBusId(q);
  }, []);
  useEffect(() => {
    if (!busId && buses[0]) setBusId(buses[0].id);
  }, [busId, buses]);

  const readings = useMemo(() => allReadings(odo.logs, erp.data?.expenses ?? []), [odo.logs, erp.data]);
  const mine = readings.filter((r) => r.busId === busId);
  const perDay = useMemo(() => dailyDistance(readings, busId), [readings, busId]);
  const last = mine[mine.length - 1];
  const before = mine.filter((r) => r.date <= date).pop();
  const jump = typeof km === 'number' && before ? km - before.km : null;

  // Days in the last week when this bus ran but nobody logged a reading.
  const missing = useMemo(() => {
    if (!busId) return [];
    const ran = new Set(runsIn(data, { from: addDays(today, -7), to: addDays(today, -1), busId, routeId: '' }).map((r) => r.date));
    const logged = new Set(mine.map((r) => r.date));
    return [...ran].filter((d) => !logged.has(d)).sort();
  }, [data, busId, mine, today]);

  const save = async () => {
    if (!busId || km === '') return;
    setBusy(true);
    const r = await odo.add(busId, date, Number(km), notes.trim());
    setBusy(false);
    toast(r.ok ? (jump && jump > 0 ? tx('Reading saved: {km} km since the last one', { km: num(jump) }) : tx('Reading saved')) : r.reason ?? tx('Could not save'), r.ok ? 'ok' : 'error');
    if (r.ok) {
      setKm('');
      setNotes('');
    }
  };

  return (
    <>
      <PageHeader title={tx('Odometer')} description={tx('The reading on each bus\'s odometer, once a day. The distance driven is worked out from one reading to the next.')} />
      {odo.error && <p role="alert" className="mb-4 rounded-xl bg-[#ba1a1a]/10 border border-[#ba1a1a]/25 text-[#93000a] text-[14px] font-semibold px-4 py-3">{odo.error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-6">
        <Card className="p-5 space-y-4 self-start">
          <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Log a reading')}</h2>
          <Field label={tx('Bus')}>
            <select className={inputClass} value={busId} onChange={(e) => setBusId(e.target.value)}>
              {buses.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.regNo}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Day')}>
              <input type="date" max={today} className={inputClass} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <Field label={tx('Odometer reading (km)')}>
              <input type="number" min={1} inputMode="numeric" className={inputClass} value={km} onChange={(e) => setKm(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))} placeholder={last ? tx('more than {km}', { km: num(last.km) }) : 'e.g. 145030'} />
            </Field>
          </div>
          {before && (
            <p className={`text-[13px] ${jump != null && jump < 0 ? 'font-semibold text-[#ba1a1a]' : 'text-[#46464f]'}`}>{tx('Last reading before this:')}{' '}<b className="text-[#050a44] tabular-nums">{tx('{km} km', { km: num(before.km) })}</b>{' '}{tx('on {date}.', { date: formatDateLabel(before.date, false) })}{jump != null && jump >= 0 && <>{tx('This one adds')}{' '}<b className="text-[#050a44] tabular-nums">{tx('{jump} km', { jump: num(jump) })}</b>.</>}
              {jump != null && jump < 0 && tx(' An odometer only goes up: check the number.')}
            </p>
          )}
          <Field label={tx('Note')}>
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tx('Optional, e.g. told by the conductor')} />
          </Field>
          <Button variant="gold" disabled={busy || km === '' || !busId || (jump != null && jump < 0)} onClick={save}>{busy ? tx('Saving…') : tx('Save reading')}</Button>
          <p className="text-[12px] text-[#6b6d78]">{tx('Take the reading at the same point each day, for example when the bus is back at the stand. A reading entered with fuel in Expenses counts too, so it doesn\'t need entering twice.')}</p>
        </Card>

        <Card className="overflow-hidden self-start">
          <div className="px-5 py-4 border-b border-[#edeef0]">
            <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Readings')}{busId ? `: ${buses.find((b) => b.id === busId)?.regNo ?? ''}` : ''}</h2>
            <p className="text-[12px] text-[#6b6d78]">{tx('Newest first. “Driven” is the distance since the reading before.')}</p>
          </div>
          {missing.length > 0 && (
            <div role="alert" className="px-5 py-3 bg-[#feb700]/15 border-b border-[#feb700]/40">
              <p className="text-[13px] font-bold text-[#050a44]">{txn(missing.length, 'No reading for {n} day this bus ran', 'No reading for {n} days this bus ran')}</p>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {missing.map((d) => (
                  <button key={d} onClick={() => setDate(d)} className={`px-2.5 h-8 rounded-lg text-[12px] font-bold border ${date === d ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}>
                    {formatDateLabel(d, false)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mine.length === 0 ? (
            <p className="p-5 text-[14px] text-[#46464f]">{tx('No readings yet for this bus.')}</p>
          ) : (
            <ul className="divide-y divide-[#edeef0] max-h-[520px] overflow-y-auto">
              {[...mine].reverse().slice(0, 60).map((r, i, arr) => {
                const prev = arr[i + 1];
                const driven = prev ? r.km - prev.km : null;
                return (
                  <li key={r.id} className="px-5 py-3 flex items-center gap-3 text-[13px]">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#050a44]">{formatDateLabel(r.date, false)} · <span className="tabular-nums">{tx('{km} km', { km: num(r.km) })}</span></p>
                      <p className="text-[12px] text-[#6b6d78]">
                        {r.source === 'log' ? (r.by ? tx('Logged by {by}', { by: r.by }) : tx('Logged')) : r.source === 'fuel' ? tx('From a fuel entry') : tx('From a service entry')}
                        {r.notes ? ` · ${r.notes}` : ''}
                      </p>
                    </div>
                    <span className="tabular-nums font-bold text-[#050a44] shrink-0">{driven != null && driven > 0 ? tx('{driven} km driven', { driven: num(driven) }) : driven === 0 ? tx('no change') : tx('starting point')}</span>
                    {office && r.source === 'log' && (
                      <Button size="sm" variant="ghost" aria-label={tx('Remove reading')} onClick={async () => {
                        const res = await odo.remove(r.id);
                        toast(res.ok ? tx('Removed') : res.reason ?? tx('Could not remove'), res.ok ? 'ok' : 'error');
                      }}>
                        <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {perDay.size > 0 && (
            <p className="px-5 py-3 border-t border-[#edeef0] text-[12px] text-[#6b6d78]">{tx('Last 7 days:')}{' '}<b className="text-[#050a44] tabular-nums">{tx('{num} km', { num: num([...perDay.entries()].filter(([d]) => d >= addDays(today, -6)).reduce((n, [, v]) => n + v, 0)) })}</b>{tx('. The daily and monthly figures are on Analytics → Fleet & fuel.')}</p>
          )}
        </Card>
      </div>
      <Toast />
    </>
  );
}
