'use client';
// Branches — the places you sell from, and what each one sold and collected.
// Super admins only. People are put in a branch on Accounts & roles.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus } from 'lucide-react';
import { useBranches, useBranchSales, type Branch, type BranchSalesRow } from '@/lib/branches';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { addDays, formatDateLabel, formatLKR, todayISO } from '@/lib/trips';
import { AdminOnly } from '@/components/admin/AdminOnly';
import { Button, Card, Field, Modal, PageHeader, inputClass, useToast, stackTable } from '@/components/admin/ui';

export default function BranchesPage() {
  return (
    <AdminOnly>
      <Branches />
    </AdminOnly>
  );
}

type Draft = Omit<Branch, 'id'> & { id?: string };
const EMPTY: Draft = { name: '', address: '', phone: '', takesPayments: true, active: true };

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Other dates' },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

function Branches() {
  const { branches, error, save } = useBranches();
  const { toast, Toast } = useToast();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayISO();
  const [range, setRange] = useState<RangeId>('today');
  const [customFrom, setCustomFrom] = useState(addDays(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const [from, to] = useMemo(() => {
    if (range === 'yesterday') return [addDays(today, -1), addDays(today, -1)];
    if (range === '7') return [addDays(today, -6), today];
    if (range === 'month') return [`${today.slice(0, 8)}01`, today];
    if (range === 'custom') return customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return [today, today];
  }, [range, today, customFrom, customTo]);
  const sales = useBranchSales(from, to);

  const submit = async () => {
    if (!editing) return;
    setBusy(true);
    const r = await save(editing);
    setBusy(false);
    if (!r.ok) return toast(r.reason, 'error');
    toast(editing.id ? 'Branch saved' : `${editing.name.trim()} added`);
    setEditing(null);
  };

  return (
    <>
      <PageHeader
        title="Branches"
        description="Every place you sell tickets from. Each staff account belongs to one branch, so every sale and every payment is counted for the right place."
        actions={<Button onClick={() => setEditing(EMPTY)}><Plus className="w-4 h-4" /> Add a branch</Button>}
      />

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-[#ba1a1a]/10 text-[#ba1a1a] text-[13px] font-semibold px-4 py-3">
          Branches aren&apos;t set up in the database yet. Run migration 25 (supabase/migrations/20261025000000_branches.sql) in the Supabase SQL Editor, then reload.
        </p>
      )}

      <Card className="overflow-hidden mb-8">
        {!branches ? (
          <div className="h-24 skeleton" />
        ) : branches.length === 0 ? (
          <p className="p-6 text-[14px] text-[#46464f]">No branches yet. Add the first place you sell from.</p>
        ) : (
          <ul className="divide-y divide-[#edeef0]">
            {branches.map((b) => (
              <li key={b.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 ${b.active ? '' : 'opacity-60'}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-[#050a44]">{b.name}</p>
                  <p className="text-[12px] text-[#6b6d78]">{[b.address, b.phone].filter(Boolean).join(', ') || 'No address yet'}</p>
                </div>
                <p className="text-[12px] font-semibold text-[#46464f]">
                  {!b.active ? 'Closed' : b.takesPayments ? 'Passengers can pay held seats here' : 'Sells only, held seats are not paid here'}
                </p>
                <Button variant="secondary" size="sm" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-[12px] text-[#6b6d78] -mt-5 mb-8">
        Put each person in their branch on <Link href="/admin/accounts" className="font-semibold text-[#050a44] underline">Accounts &amp; roles</Link>. A sale stays with the branch it was made at, even if that person moves later.
      </p>

      <h2 className="text-[18px] font-extrabold text-[#050a44] mb-1">Sales and cash by branch</h2>
      <p className="text-[13px] text-[#46464f] mb-4 max-w-2xl">
        Sold is what each branch booked in these days. Cash and other payments are what its people recorded as paid in these days, which can include seats booked online and paid at the counter.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setRange(r.id)} aria-pressed={range === r.id}
            className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${range === r.id ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}>
            {r.label}
          </button>
        ))}
        {range === 'custom' && (
          <span className="flex items-center gap-2">
            <input type="date" aria-label="From" max={today} value={customFrom} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} className={`${inputClass} !w-auto !py-1.5`} />
            <span className="text-[13px] text-[#46464f]">to</span>
            <input type="date" aria-label="To" max={today} value={customTo} onChange={(e) => e.target.value && setCustomTo(e.target.value)} className={`${inputClass} !w-auto !py-1.5`} />
          </span>
        )}
        <span className="ml-auto text-[12px] font-semibold text-[#6b6d78]">
          {from === to ? formatDateLabel(from, false) : `${formatDateLabel(from, false)} to ${formatDateLabel(to, false)}`}
        </span>
      </div>

      <Card className="overflow-hidden">
        {!isSupabaseConfigured ? (
          <p className="p-6 text-[14px] text-[#46464f]">The report needs the database. In demo mode there is nothing to add up.</p>
        ) : sales.error ? (
          <p className="p-6 text-[14px] text-[#ba1a1a]">{sales.error}</p>
        ) : !sales.rows ? (
          <div className="h-40 skeleton" />
        ) : sales.rows.length === 0 ? (
          <p className="p-6 text-[14px] text-[#46464f]">Nothing was sold or paid in these days.</p>
        ) : (
          <SalesTable rows={sales.rows} />
        )}
      </Card>

      {editing && (
        <Modal
          title={editing.id ? `Edit ${editing.name}` : 'Add a branch'}
          onClose={() => setEditing(null)}
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={busy || editing.name.trim().length < 2} onClick={submit}>{busy ? 'Saving…' : editing.id ? 'Save branch' : 'Add branch'}</Button></>}
        >
          <Field label="Name" hint="Short, as passengers know it: it appears in the pay-at-the-counter text. For example Kalmunai.">
            <input className={inputClass} value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Address"><input className={inputClass} value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="Street, town" /></Field>
          <Field label="Phone"><input className={inputClass} type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="077 123 4567" /></Field>
          <label className="flex items-start gap-3 text-[14px] text-[#050a44]">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#050a44]" checked={editing.takesPayments} onChange={(e) => setEditing({ ...editing, takesPayments: e.target.checked })} />
            <span><b className="font-semibold">Passengers can pay held seats here</b><span className="block text-[12px] text-[#6b6d78]">Named when someone books online and chooses pay at the counter.</span></span>
          </label>
          {editing.id && (
            <label className="flex items-start gap-3 text-[14px] text-[#050a44]">
              <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#050a44]" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              <span><b className="font-semibold">Open</b><span className="block text-[12px] text-[#6b6d78]">Untick to close a branch. Its past sales stay in the report.</span></span>
            </label>
          )}
        </Modal>
      )}
      <Toast />
    </>
  );
}

function SalesTable({ rows }: { rows: BranchSalesRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sum = (k: 'bookings' | 'seats' | 'value' | 'cash' | 'other' | 'refunded') => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const money = (n: number) => (n ? formatLKR(n) : '—');
  const num = 'px-4 py-3 text-right tabular-nums whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] stack-table" ref={stackTable}>
        <thead>
          <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
            <th className="px-4 py-2.5">Branch</th>
            <th className="px-4 py-2.5 text-right">Bookings</th>
            <th className="px-4 py-2.5 text-right">Seats</th>
            <th className="px-4 py-2.5 text-right">Sold</th>
            <th className="px-4 py-2.5 text-right">Cash taken</th>
            <th className="px-4 py-2.5 text-right">Other payments</th>
            <th className="px-4 py-2.5 text-right">Cash refunds</th>
            <th className="px-4 py-2.5 text-right">Cash to hand in</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edeef0]">
          {rows.map((r) => {
            const expanded = open === r.key;
            return (
              <FragmentRows key={r.key}>
                <tr className={r.key === 'none' ? 'bg-[#feb700]/10' : ''}>
                  <td className="px-4 py-3">
                    {r.people.length > 0 ? (
                      <button onClick={() => setOpen(expanded ? null : r.key)} aria-expanded={expanded} className="text-left font-bold text-[#050a44] underline decoration-[#c7c5d1] underline-offset-4">
                        {r.name}
                      </button>
                    ) : (
                      <span className="font-bold text-[#050a44]">{r.name}</span>
                    )}
                    <span className="block text-[12px] text-[#6b6d78]">
                      {r.key === 'online' ? 'Passengers booking themselves' : r.key === 'none' ? 'Staff with no branch yet: set it on Accounts & roles' : `${r.people.length} ${r.people.length === 1 ? 'person' : 'people'}`}
                    </span>
                  </td>
                  <td className={num}>{r.bookings || '—'}</td>
                  <td className={num}>{r.seats || '—'}</td>
                  <td className={`${num} font-bold text-[#050a44]`}>{money(r.value)}</td>
                  <td className={num}>{money(r.cash)}</td>
                  <td className={num}>{money(r.other)}</td>
                  <td className={num}>{money(r.refunded)}</td>
                  <td className={`${num} font-bold text-[#050a44]`}>{r.key === 'online' ? '—' : formatLKR(r.cash - r.refunded)}</td>
                </tr>
                {expanded &&
                  r.people.map((p) => (
                    <tr key={p.id} className="bg-[#f8f9fb] text-[#46464f]">
                      <td className="px-4 py-2 pl-8">{p.name} <span className="text-[12px] text-[#6b6d78]">{p.role === 'conductor' ? 'conductor' : p.role === 'admin' ? 'super admin' : 'office'}</span></td>
                      <td className={num.replace('py-3', 'py-2')}>{p.bookings || '—'}</td>
                      <td className={num.replace('py-3', 'py-2')}>{p.seats || '—'}</td>
                      <td className={num.replace('py-3', 'py-2')}>{money(p.value)}</td>
                      <td className={num.replace('py-3', 'py-2')}>{money(p.cash)}</td>
                      <td className={num.replace('py-3', 'py-2')}>{money(p.other)}</td>
                      <td className={num.replace('py-3', 'py-2')}>{money(p.refunded)}</td>
                      <td className={num.replace('py-3', 'py-2')}>{formatLKR(p.cash - p.refunded)}</td>
                    </tr>
                  ))}
              </FragmentRows>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#c7c5d1] font-bold text-[#050a44]">
            <td className="px-4 py-3">Total</td>
            <td className={num}>{sum('bookings')}</td>
            <td className={num}>{sum('seats')}</td>
            <td className={num}>{formatLKR(sum('value'))}</td>
            <td className={num}>{formatLKR(sum('cash'))}</td>
            <td className={num}>{formatLKR(sum('other'))}</td>
            <td className={num}>{formatLKR(sum('refunded'))}</td>
            <td className={num}>{formatLKR(sum('cash') - sum('refunded'))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
