'use client';
// The passenger's refunds and resale payouts: what is owed, whether it has
// been paid, and the bank account to send it to.

import { useState } from 'react';
import { Banknote, Check, Hourglass } from 'lucide-react';
import { EMPTY_PAYEE, hasPayee, setPayoutDetails, usePayouts, type Payee, type Payout } from '@/lib/money';
import { formatLKR } from '@/lib/trips';

const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const input = 'w-full h-10 px-3 rounded-xl bg-[#f2f4f6] text-[14px] font-medium outline-none focus:ring-1 focus:ring-[#050a44]';

export function PayoutsCard() {
  const { payouts, reload } = usePayouts('mine');
  // Pending ones always; paid ones for a month so the passenger can see it landed.
  const recent = payouts.filter((p) => p.status === 'pending' || (p.status === 'paid' && p.paidAt && Date.now() - new Date(p.paidAt).getTime() < 30 * 86_400_000));
  if (recent.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-[#c7c5d1] shadow-sm overflow-hidden" aria-label="Refunds and payouts">
      <div className="px-5 py-4 border-b border-[#edeef0] flex items-center gap-2">
        <Banknote className="w-4 h-4 text-[#7c5800]" />
        <h3 className="text-[15px] font-bold text-[#050a44]">Refunds &amp; payouts</h3>
      </div>
      <ul className="divide-y divide-[#edeef0]">
        {recent.map((p) => (
          <PayoutRow key={p.id} payout={p} onSaved={reload} />
        ))}
      </ul>
    </section>
  );
}

function PayoutRow({ payout: p, onSaved }: { payout: Payout; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Payee>(hasPayee(p.payee) ? p.payee : EMPTY_PAYEE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Payee) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await setPayoutDetails(p.id, form);
    setBusy(false);
    if (!r.ok) return setError(r.reason ?? "Couldn't save.");
    setEditing(false);
    onSaved();
  };
  const needsAccount = p.status === 'pending' && !hasPayee(p.payee);
  return (
    <li className="px-5 py-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-semibold text-[#050a44]">
          {p.kind === 'resale' ? 'Resale payout' : 'Refund'}
          {p.bookingRef && <> · {p.bookingRef}</>}
        </p>
        <p className="text-[15px] font-bold text-[#050a44] tabular-nums">{formatLKR(p.amount)}</p>
      </div>
      {p.trip && <p className="text-[12px] text-[#6b6d78]">{p.trip}</p>}
      {p.status === 'paid' ? (
        <p className="text-[13px] font-semibold text-[#006e1c] flex items-center gap-1.5">
          <Check className="w-4 h-4" /> Paid {day(p.paidAt)}
          {p.method === 'bank' ? ' to your bank account' : p.method === 'cash' ? ' in cash' : ''}
          {p.reference && <span className="text-[#46464f] font-medium">· ref {p.reference}</span>}
        </p>
      ) : (
        <p className="text-[13px] text-[#7c5800] font-semibold flex items-center gap-1.5">
          <Hourglass className="w-4 h-4" />
          {needsAccount ? 'Tell us where to send it.' : 'Being processed. Bank refunds usually take 3 to 5 working days.'}
        </p>
      )}
      {p.status === 'pending' && !editing && (
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {hasPayee(p.payee) && (
            <span className="text-[#46464f]">
              To {p.payee.bank} · {p.payee.account_no.replace(/.(?=.{4})/g, '•')} · {p.payee.account_name}
            </span>
          )}
          <button onClick={() => setEditing(true)} className={needsAccount ? 'px-3 h-9 rounded-lg bg-[#050a44] text-white font-bold' : 'underline font-bold text-[#050a44]'}>
            {needsAccount ? 'Add bank account' : 'Change'}
          </button>
        </div>
      )}
      {editing && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <input className={input} placeholder="Bank (e.g. Bank of Ceylon)" aria-label="Bank" value={form.bank} onChange={set('bank')} />
          <input className={input} placeholder="Branch" aria-label="Branch" value={form.branch} onChange={set('branch')} />
          <input className={input} placeholder="Account number" aria-label="Account number" inputMode="numeric" value={form.account_no} onChange={set('account_no')} />
          <input className={input} placeholder="Name on the account" aria-label="Name on the account" value={form.account_name} onChange={set('account_name')} />
          {error && <p className="sm:col-span-2 text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <div className="sm:col-span-2 flex gap-2">
            <button onClick={save} disabled={busy} className="px-4 h-10 rounded-xl bg-[#050a44] text-white text-[13px] font-bold disabled:opacity-50">
              {busy ? 'Saving…' : 'Save account'}
            </button>
            <button onClick={() => setEditing(false)} className="px-4 h-10 rounded-xl border border-[#c7c5d1] text-[#050a44] text-[13px] font-bold">
              Not now
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
