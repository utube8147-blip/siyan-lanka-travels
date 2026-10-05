'use client';
// The trip sheet on "Close this trip": the same boxes, in the same order, as
// the paper sheet the conductor fills in on the road (printed with the
// passenger list). Odometer at the start and end, fuel put in, and other
// costs. Each number is checked as it is typed. This component only holds
// what is being typed; the closing screen saves it.

import { Fuel, Plus, Trash2 } from 'lucide-react';
import { checkReading, type OdoLog } from '@/lib/odometer';
import { ROAD_COST_LABEL, newCost, newFuel, type CostDraft, type FuelDraft, type RoadCostKind, type SavedCost, type TripSheetDraft } from '@/lib/tripSheet';
import { formatDateLabel, formatLKR } from '@/lib/trips';
import { Button, inputClass } from '@/components/admin/ui';

const km = (n: number) => `${n.toLocaleString('en-LK')} km`;
const toNum = (v: string, whole = true): number | '' => (v === '' ? '' : Math.max(0, whole ? Math.round(Number(v)) : Number(v)));

/** The odometer boxes checked against the bus's other readings and against each other. */
export function odometerState(logs: OdoLog[], busId: string, tripDate: string, today: string, d: TripSheetDraft) {
  const day = (iso: string) => formatDateLabel(iso, false);
  const start = checkReading(logs, busId, tripDate, d.start, day);
  const end = checkReading(logs, busId, today, d.end, day);
  let endProblem = end.problem;
  let endWarning = end.warning;
  if (!endProblem && typeof d.start === 'number' && typeof d.end === 'number') {
    if (d.end < d.start) endProblem = 'Lower than the reading at the start. Check both numbers.';
    else if (d.end - d.start > 3000) endProblem = `That makes the trip ${km(d.end - d.start)}. Check both numbers.`;
    else if (d.end - d.start > 1500) endWarning = `That makes the trip ${km(d.end - d.start)}. Check it before you close.`;
  }
  const distance = typeof d.start === 'number' && typeof d.end === 'number' && !start.problem && !endProblem ? d.end - d.start : null;
  return { start, end, startProblem: start.problem, endProblem, endWarning, distance, missing: d.start === '' || d.end === '', problem: !!start.problem || !!endProblem };
}

export function TripSheet({
  draft,
  onChange,
  logs,
  busId,
  busLabel,
  tripDate,
  today,
  saved,
  costsAvailable,
  forSomeone = false,
}: {
  draft: TripSheetDraft;
  onChange: (next: TripSheetDraft) => void;
  logs: OdoLog[];
  busId: string;
  busLabel: string;
  tripDate: string;
  today: string;
  saved: SavedCost[];
  /** False when the database can't store trip costs yet: only the odometer is asked for. */
  costsAvailable: boolean;
  /** The office typing in a conductor's sheet: the wording says "the trip cash", not "I". */
  forSomeone?: boolean;
}) {
  const odo = odometerState(logs, busId, tripDate, today, draft);
  const last = odo.start.before;
  const setFuel = (key: string, patch: Partial<FuelDraft>) => onChange({ ...draft, fuels: draft.fuels.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  const setCost = (key: string, patch: Partial<CostDraft>) => onChange({ ...draft, costs: draft.costs.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const label = 'block text-[13px] font-semibold text-[#050a44]';
  const hint = (bad: boolean, warn = false) => `block text-[12px] mt-1 ${bad ? 'font-semibold text-[#ba1a1a]' : warn ? 'font-semibold text-[#9a5b00]' : 'text-[#6b6d78]'}`;
  const fromCash = (checked: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-[13px] text-[#050a44]">
      <input type="checkbox" className="w-4 h-4 accent-[#050a44]" checked={checked} onChange={(e) => set(e.target.checked)} />
      {forSomeone ? 'Paid from the trip cash' : 'Paid from the cash I collected'}
    </label>
  );

  return (
    <div className="space-y-4">
      {/* 1. Odometer */}
      <fieldset className="rounded-xl border border-[#e1e2e4] p-4 space-y-3">
        <legend className="px-1 text-[12px] font-bold text-[#46464f]">1. Odometer, {busLabel}</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>At the start (km)</span>
            <input type="number" min={0} inputMode="numeric" className={`${inputClass} mt-1 ${odo.startProblem ? '!border-[#ba1a1a]' : ''}`} value={draft.start} aria-invalid={!!odo.startProblem}
              onChange={(e) => onChange({ ...draft, start: toNum(e.target.value) })} />
          </label>
          <label className="block">
            <span className={label}>At the end (km)</span>
            <input type="number" min={0} inputMode="numeric" className={`${inputClass} mt-1 ${odo.endProblem ? '!border-[#ba1a1a]' : ''}`} value={draft.end} aria-invalid={!!odo.endProblem}
              onChange={(e) => onChange({ ...draft, end: toNum(e.target.value) })} />
          </label>
        </div>
        {last && draft.start === '' && (
          <button type="button" onClick={() => onChange({ ...draft, start: last.km })} className="text-[13px] font-semibold text-[#050a44] underline underline-offset-4">
            Start is the last reading: {km(last.km)} ({formatDateLabel(last.date, false)})
          </button>
        )}
        <p className={hint(!!(odo.startProblem || odo.endProblem), !!(odo.start.warning || odo.endWarning))} role={odo.problem ? 'alert' : undefined}>
          {odo.startProblem
            ? `Start: ${odo.startProblem}`
            : odo.endProblem
              ? `End: ${odo.endProblem}`
              : odo.start.warning ?? odo.endWarning ?? (odo.distance !== null
                ? `This trip: ${km(odo.distance)}.`
                : forSomeone ? 'Copy both numbers from the trip sheet.' : 'Read both numbers off the dashboard: before setting off and after arriving.')}
        </p>
      </fieldset>

      {costsAvailable && (
        <>
          {/* 2. Fuel */}
          <fieldset className="rounded-xl border border-[#e1e2e4] p-4 space-y-3">
            <legend className="px-1 text-[12px] font-bold text-[#46464f]">2. Fuel put in on this trip</legend>
            {draft.fuels.length === 0 && <p className="text-[13px] text-[#6b6d78]">None typed in. If no fuel was bought, leave this empty.</p>}
            {draft.fuels.map((f) => (
              <div key={f.key} className="rounded-lg bg-[#f8f9fb] p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className={label}>Litres</span>
                    <input type="number" min={0} step="0.1" inputMode="decimal" className={`${inputClass} mt-1`} value={f.litres} onChange={(e) => setFuel(f.key, { litres: toNum(e.target.value, false) })} /></label>
                  <label className="block"><span className={label}>Paid (LKR)</span>
                    <input type="number" min={0} inputMode="numeric" className={`${inputClass} mt-1`} value={f.amount} onChange={(e) => setFuel(f.key, { amount: toNum(e.target.value) })} /></label>
                  <label className="block"><span className={label}>Filling station</span>
                    <input className={`${inputClass} mt-1`} value={f.station} onChange={(e) => setFuel(f.key, { station: e.target.value })} placeholder="e.g. Ceypetco Dambulla" /></label>
                  <label className="block"><span className={label}>Odometer at the pump</span>
                    <input type="number" min={0} inputMode="numeric" className={`${inputClass} mt-1`} value={f.odometerKm} onChange={(e) => setFuel(f.key, { odometerKm: toNum(e.target.value) })} placeholder="If you noted it" /></label>
                </div>
                <div className="flex items-center justify-between gap-3">
                  {fromCash(f.fromCash, (v) => setFuel(f.key, { fromCash: v }))}
                  <button type="button" onClick={() => onChange({ ...draft, fuels: draft.fuels.filter((x) => x.key !== f.key) })} aria-label="Remove this fuel entry" className="p-2 text-[#ba1a1a]"><Trash2 className="w-4 h-4" /></button>
                </div>
                {typeof f.litres === 'number' && f.litres > 0 && typeof f.amount === 'number' && f.amount > 0 && <p className="text-[12px] text-[#6b6d78]">{formatLKR(Math.round(f.amount / f.litres))} per litre.</p>}
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...draft, fuels: [...draft.fuels, newFuel()] })}><Fuel className="w-3.5 h-3.5" /> Add fuel</Button>
          </fieldset>

          {/* 3. Other costs */}
          <fieldset className="rounded-xl border border-[#e1e2e4] p-4 space-y-3">
            <legend className="px-1 text-[12px] font-bold text-[#46464f]">3. Tolls and other costs</legend>
            {draft.costs.length === 0 && <p className="text-[13px] text-[#6b6d78]">None typed in. Add highway tolls, parking, cleaning or anything else you paid for.</p>}
            {draft.costs.map((c) => (
              <div key={c.key} className="rounded-lg bg-[#f8f9fb] p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block"><span className={label}>What for</span>
                    <select className={`${inputClass} mt-1`} value={c.kind} onChange={(e) => setCost(c.key, { kind: e.target.value as RoadCostKind })}>
                      {(['toll', 'parking', 'cleaning', 'other'] as const).map((k) => <option key={k} value={k}>{ROAD_COST_LABEL[k]}</option>)}
                    </select></label>
                  <label className="block"><span className={label}>Paid (LKR)</span>
                    <input type="number" min={0} inputMode="numeric" className={`${inputClass} mt-1`} value={c.amount} onChange={(e) => setCost(c.key, { amount: toNum(e.target.value) })} /></label>
                </div>
                <label className="block"><span className={label}>{c.kind === 'other' ? 'What was it?' : 'Note'}</span>
                  <input className={`${inputClass} mt-1`} value={c.note} onChange={(e) => setCost(c.key, { note: e.target.value })} placeholder={c.kind === 'other' ? 'e.g. puncture repair at Habarana' : c.kind === 'toll' ? 'e.g. Kadawatha to Kurunegala' : 'Optional'} /></label>
                <div className="flex items-center justify-between gap-3">
                  {fromCash(c.fromCash, (v) => setCost(c.key, { fromCash: v }))}
                  <button type="button" onClick={() => onChange({ ...draft, costs: draft.costs.filter((x) => x.key !== c.key) })} aria-label="Remove this cost" className="p-2 text-[#ba1a1a]"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => onChange({ ...draft, costs: [...draft.costs, newCost()] })}><Plus className="w-3.5 h-3.5" /> Add a cost</Button>
          </fieldset>

          {saved.length > 0 && <SavedCosts saved={saved} />}
        </>
      )}
    </div>
  );
}

/** Costs already saved against the trip, so nobody types them twice. */
export function SavedCosts({ saved }: { saved: SavedCost[] }) {
  return (
    <div className="rounded-xl bg-[#e8f6ea] px-4 py-3">
      <p className="text-[12px] font-bold text-[#050a44]">Already saved for this trip</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-[#46464f]">
        {saved.map((s) => (
          <li key={s.id} className="flex justify-between gap-3">
            <span className="min-w-0">
              {ROAD_COST_LABEL[s.category as RoadCostKind | 'fuel'] ?? s.category}
              {s.litres ? `, ${s.litres} L` : ''}{s.vendor ? `, ${s.vendor}` : ''}{s.description ? `, ${s.description}` : ''}
              <span className="text-[#6b6d78]">{s.fromTakings ? ' (from the trip cash)' : ''}{!s.mine && s.by ? ` by ${s.by}` : ''}</span>
            </span>
            <span className="font-semibold tabular-nums shrink-0">{formatLKR(s.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
