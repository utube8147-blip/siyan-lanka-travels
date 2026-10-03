'use client';
// Salaries for one month, person by person (Staff area → Crew).
// For each crew member: what they earned, what they have already had, and
// what is still owed, with buttons to give an advance, add a bonus or a
// deduction, and pay the balance. See lib/payroll.ts for the sums.

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { runsIn } from '@/lib/analytics';
import type { CrewMember, Expense } from '@/lib/erp';
import { PAY_KIND_LABEL, settle, usePayroll, type PayEntry, type PayKind, type Settlement } from '@/lib/payroll';
import { formatDateLabel, formatLKR, todayISO } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, inputClass, stackTable, useToast } from './ui';

type Result = { ok: boolean; reason?: string };
type Draft = { member: CrewMember; kind: PayKind; amount: number | ''; paidOn: string; method: PayEntry['method']; notes: string };

export function SalarySettlement({ crew, saveExpense, removeExpense }: { crew: CrewMember[]; saveExpense: (e: Expense) => Promise<Result>; removeExpense: (id: string) => Promise<Result> }) {
  const { data } = useStore();
  const pay = usePayroll(saveExpense, removeExpense);
  const { toast, Toast } = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<CrewMember | null>(null);
  const [payingAll, setPayingAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const monthName = new Date(`${month}-01T00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const rows = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    return crew
      .filter((c) => c.active || pay.entries.some((e) => e.crewId === c.id && e.month === month))
      .map((c) => {
        // trips their bus ran in the month so far (only counted when they are paid per trip)
        const trips = c.busId && (c.perTripPay ?? 0) > 0 ? runsIn(data, { from: `${month}-01`, to: last, busId: c.busId, routeId: '' }).length : 0;
        return { member: c, s: settle(c, month, pay.entries, trips) };
      })
      .filter((r) => r.s.earned !== 0 || r.s.entries.length > 0);
  }, [crew, pay.entries, month, data]);

  const total = (f: (s: Settlement) => number) => rows.reduce((n, r) => n + f(r.s), 0);
  const owing = rows.filter((r) => r.s.balance > 0);
  const open = (member: CrewMember, kind: PayKind, amount: number | '' = '') => setDraft({ member, kind, amount, paidOn: todayISO(), method: 'cash', notes: '' });
  const moneyOut = (k: PayKind) => k === 'advance' || k === 'salary';

  const saveDraft = async () => {
    if (!draft || draft.amount === '') return;
    setBusy(true);
    const r = await pay.add(draft.member, { month, kind: draft.kind, amount: Number(draft.amount), paidOn: draft.paidOn, method: draft.method, notes: draft.notes.trim() });
    setBusy(false);
    toast(r.ok ? `${PAY_KIND_LABEL[draft.kind]} of ${formatLKR(Number(draft.amount))} recorded for ${draft.member.fullName}` : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
    if (r.ok) setDraft(null);
  };
  const payAll = async () => {
    setBusy(true);
    for (const r of owing) {
      const res = await pay.add(r.member, { month, kind: 'salary', amount: r.s.balance, paidOn: todayISO(), method: 'bank', notes: '' });
      if (!res.ok) {
        setBusy(false);
        return toast(`Stopped at ${r.member.fullName}: ${res.reason ?? 'could not save'}`, 'error');
      }
    }
    setBusy(false);
    setPayingAll(false);
    toast(`Salaries paid: ${formatLKR(total((s) => Math.max(0, s.balance)))}`);
  };

  return (
    <Card className="overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-[#edeef0] flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Salaries for {monthName}</h2>
          <p className="text-[12px] text-[#6b6d78]">Earned = monthly salary + pay per trip + bonuses − deductions. Balance = earned − advances − salary already paid.</p>
        </div>
        <input type="month" aria-label="Month" className={`${inputClass} !w-auto`} value={month} max={todayISO().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Button variant="gold" disabled={owing.length === 0} onClick={() => setPayingAll(true)}>Pay all balances</Button>
      </div>
      {pay.error && <p role="alert" className="px-5 py-3 text-[13px] font-semibold text-[#ba1a1a]">{pay.error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#edeef0] border-b border-[#edeef0]">
        {[
          { l: 'Earned', v: total((s) => s.earned) },
          { l: 'Advances given', v: total((s) => s.advance) },
          { l: 'Salary paid', v: total((s) => s.paid) },
          { l: 'Still to pay', v: total((s) => Math.max(0, s.balance)), warn: true },
        ].map((k) => (
          <div key={k.l} className="bg-white px-5 py-3">
            <p className="text-[11px] font-bold text-[#46464f]">{k.l}</p>
            <p className={`text-[18px] font-semibold tabular-nums ${k.warn && k.v > 0 ? 'text-[#9a5b00]' : 'text-[#050a44]'}`}>{formatLKR(k.v)}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-[14px] text-[#46464f]">Nobody has a salary set. Edit a crew member below and enter a monthly salary or a pay per trip.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] stack-table" ref={stackTable}>
            <thead>
              <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                <th className="px-4 py-2.5">Person</th>
                <th className="px-4 py-2.5 text-right">Earned</th>
                <th className="px-4 py-2.5 text-right">Advances</th>
                <th className="px-4 py-2.5 text-right">Paid</th>
                <th className="px-4 py-2.5 text-right">Balance</th>
                <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edeef0]">
              {rows.map(({ member: c, s }) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#050a44]">{c.fullName}</p>
                    <Badge value={c.role} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-semibold tabular-nums text-[#050a44]">{formatLKR(s.earned)}</p>
                    <p className="text-[11px] text-[#6b6d78]">
                      {[s.basic ? `salary ${formatLKR(s.basic)}` : '', s.tripPay ? `${s.trips} trips × ${formatLKR(c.perTripPay ?? 0)}` : '', s.bonus ? `bonus ${formatLKR(s.bonus)}` : '', s.deduction ? `less ${formatLKR(s.deduction)}` : ''].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.advance ? formatLKR(s.advance) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.paid ? formatLKR(s.paid) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {s.balance === 0 ? (
                      <span className="font-bold text-[#006e1c]">Settled</span>
                    ) : s.balance > 0 ? (
                      <span className="font-bold tabular-nums text-[#9a5b00]">{formatLKR(s.balance)} to pay</span>
                    ) : (
                      <span className="font-bold tabular-nums text-[#ba1a1a]">Overpaid {formatLKR(-s.balance)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5 md:justify-end">
                      {s.balance > 0 && <Button size="sm" variant="gold" onClick={() => open(c, 'salary', s.balance)}>Pay balance</Button>}
                      <Button size="sm" variant="secondary" onClick={() => open(c, 'advance')}>Advance</Button>
                      <Button size="sm" variant="secondary" onClick={() => open(c, 'bonus')}>Bonus</Button>
                      <Button size="sm" variant="secondary" onClick={() => open(c, 'deduction')}>Deduction</Button>
                      {s.entries.length > 0 && <Button size="sm" variant="ghost" onClick={() => setHistory(c)}>History ({s.entries.length})</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal
          title={`${PAY_KIND_LABEL[draft.kind]}: ${draft.member.fullName}`}
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="gold" disabled={busy || !(Number(draft.amount) > 0)} onClick={saveDraft}>{busy ? 'Saving…' : 'Save'}</Button>
            </>
          }
        >
          <p className="text-[13px] text-[#46464f]">
            {draft.kind === 'advance' && `Money given before the salary is due. It is taken off ${monthName}'s salary and added to Expenses.`}
            {draft.kind === 'salary' && `Pays ${monthName}'s salary (or part of it). It is added to Expenses.`}
            {draft.kind === 'bonus' && `Adds to what they earned for ${monthName}. Nothing is paid until you pay the balance.`}
            {draft.kind === 'deduction' && `Takes off what they earned for ${monthName}, for example a cash shortage or a fine.`}
          </p>
          <Field label="Kind">
            <select className={inputClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PayKind })}>
              {(Object.keys(PAY_KIND_LABEL) as PayKind[]).map((k) => <option key={k} value={k}>{PAY_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (LKR)">
              <input type="number" min={1} inputMode="numeric" className={inputClass} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} autoFocus />
            </Field>
            <Field label="Date">
              <input type="date" max={todayISO()} className={inputClass} value={draft.paidOn} onChange={(e) => e.target.value && setDraft({ ...draft, paidOn: e.target.value })} />
            </Field>
          </div>
          {moneyOut(draft.kind) && (
            <Field label="Paid by">
              <select className={inputClass} value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as PayEntry['method'] })}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </Field>
          )}
          <Field label="Note">
            <input className={inputClass} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder={draft.kind === 'deduction' ? 'e.g. cash short on 3 Oct' : 'Optional'} />
          </Field>
        </Modal>
      )}

      {history && (
        <Modal title={`${history.fullName}: ${monthName}`} onClose={() => setHistory(null)} footer={<Button variant="secondary" onClick={() => setHistory(null)}>Close</Button>}>
          <ul className="divide-y divide-[#edeef0]">
            {pay.entries.filter((e) => e.crewId === history.id && e.month === month).map((e) => (
              <li key={e.id} className="py-2.5 flex items-center gap-3 text-[13px]">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#050a44]">{PAY_KIND_LABEL[e.kind]} · {formatLKR(e.amount)}</p>
                  <p className="text-[12px] text-[#6b6d78]">{formatDateLabel(e.paidOn, false)}{moneyOut(e.kind) ? ` · ${e.method}` : ''}{e.notes ? ` · ${e.notes}` : ''}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label="Remove" onClick={async () => {
                  const r = await pay.remove(e);
                  toast(r.ok ? 'Removed' : r.reason ?? 'Could not remove', r.ok ? 'ok' : 'error');
                }}>
                  <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-[#6b6d78]">Removing an advance or a salary payment also removes it from Expenses.</p>
        </Modal>
      )}

      {payingAll && (
        <Modal
          title={`Pay everyone's balance for ${monthName}?`}
          onClose={() => setPayingAll(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPayingAll(false)}>Cancel</Button>
              <Button variant="gold" disabled={busy} onClick={payAll}>{busy ? 'Saving…' : `Pay ${formatLKR(total((s) => Math.max(0, s.balance)))}`}</Button>
            </>
          }
        >
          <p className="text-[14px] text-[#46464f]">Records a salary payment for each person with a balance, dated today, paid by bank. Pay the money first, then record it here.</p>
          <ul className="text-[13px] space-y-1">
            {owing.map((r) => (
              <li key={r.member.id} className="flex justify-between gap-3"><span>{r.member.fullName}</span><b className="tabular-nums text-[#050a44]">{formatLKR(r.s.balance)}</b></li>
            ))}
          </ul>
        </Modal>
      )}
      <Toast />
    </Card>
  );
}
