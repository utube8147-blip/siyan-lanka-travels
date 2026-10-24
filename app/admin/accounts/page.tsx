'use client';
// Accounts & roles — everyone who has signed up. Super admins decide who is a
// passenger, staff (operations) or super admin (everything).

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useErp, type AccountRole } from '@/lib/erp';
import { useBranches } from '@/lib/branches';
import { formatDateLabel } from '@/lib/trips';
import { AdminOnly } from '@/components/admin/AdminOnly';
import { Card, PageHeader, inputClass, useToast, stackTable } from '@/components/admin/ui';
import { tx, N_ } from '@/lib/i18n';

const ROLE_LABEL: Record<AccountRole, string> = { passenger: N_('Passenger'), conductor: N_('Conductor'), staff: N_('Staff'), admin: N_('Super admin') };

export default function AccountsPage() {
  return (
    <AdminOnly>
      <Accounts />
    </AdminOnly>
  );
}

function Accounts() {
  const { user } = useAuth();
  const erp = useErp({ admin: true });
  const { toast, Toast } = useToast();
  const { branches } = useBranches();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | AccountRole>('all');
  const rows = useMemo(
    () => (erp.data?.accounts ?? []).filter((a) => (role === 'all' || a.role === role) && `${a.fullName} ${a.email} ${a.phone}`.toLowerCase().includes(q.toLowerCase())),
    [erp.data, q, role],
  );
  const count = (r: AccountRole) => (erp.data?.accounts ?? []).filter((a) => a.role === r).length;

  return (
    <>
      <PageHeader title={tx('Accounts & roles')} description={tx('Conductors use the phone conductor page (boarding, cash, trip updates). Staff run departures, bookings, buses and the timetable. Super admins also see finance, crew, accounts and settings. Give each staff member their branch so their sales and cash are counted for the right place.')} />
      <AddStaff onAdded={(msg) => { toast(msg, 'ok'); erp.reload(); }} onError={(msg) => toast(msg, 'error')} />
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'admin', 'staff', 'conductor', 'passenger'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            aria-pressed={role === r}
            className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${role === r ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}
          >
            {r === 'all' ? tx('Everyone ({v})', { v: erp.data?.accounts.length ?? 0 }) : `${tx(ROLE_LABEL[r])} (${count(r)})`}
          </button>
        ))}
        <div className="relative ml-auto min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6d78]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('Name, email or phone')} aria-label={tx('Search accounts')} className={`${inputClass} pl-9`} />
        </div>
      </div>
      <Card className="overflow-hidden">
        {erp.error ? (
          <p className="p-6 text-[14px] text-[#ba1a1a]">{erp.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">{tx('Person')}</th>
                  <th className="px-4 py-2.5">{tx('Joined')}</th>
                  <th className="px-4 py-2.5">{tx('Last sign-in')}</th>
                  <th className="px-4 py-2.5">{tx('Role')}</th>
                  <th className="px-4 py-2.5">{tx('Branch')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">{a.fullName || '—'}{a.id === user?.id && <span className="text-[#6b6d78] font-normal">{tx('(you)')}</span>}</p>
                      <p className="text-[12px] text-[#6b6d78]">{a.email}{a.phone ? ` · ${a.phone}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateLabel(a.createdAt.slice(0, 10), false)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{a.lastSignIn ? formatDateLabel(a.lastSignIn.slice(0, 10), false) : '—'}</td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={tx('Role for {v}', { v: a.fullName || a.email })}
                        value={a.role}
                        disabled={a.id === user?.id}
                        onChange={async (e) => {
                          const next = e.target.value as AccountRole;
                          const r = await erp.setRole(a.id, next);
                          toast(r.ok ? tx('{name} is now {role}', { name: a.fullName || a.email, role: tx(ROLE_LABEL[next]) }) : r.reason ?? tx('Could not change role'), r.ok ? 'ok' : 'error');
                        }}
                        className={`${inputClass} !w-auto !py-1.5`}
                      >
                        {(Object.keys(ROLE_LABEL) as AccountRole[]).map((r) => <option key={r} value={r}>{tx(ROLE_LABEL[r])}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {a.role === 'passenger' ? (
                        <span className="text-[#6b6d78]">—</span>
                      ) : (
                        <select
                          aria-label={tx('Branch for {v}', { v: a.fullName || a.email })}
                          value={a.branchId ?? ''}
                          onChange={async (e) => {
                            const next = e.target.value || null;
                            const r = await erp.setBranch(a.id, next);
                            const name = branches?.find((b) => b.id === next)?.name;
                            toast(r.ok ? (name ? tx('{v} is now at {name}', { v: a.fullName || a.email, name }) : tx('{v} has no branch', { v: a.fullName || a.email })) : r.reason ?? tx('Could not change the branch'), r.ok ? 'ok' : 'error');
                          }}
                          className={`${inputClass} !w-auto !py-1.5 ${a.branchId ? '' : '!text-[#9a5b00]'}`}
                        >
                          <option value="">{tx('No branch')}</option>
                          {(branches ?? []).filter((b) => b.active || b.id === a.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-[12px] text-[#6b6d78] mt-3">{tx('Staff sign in with their email and password at')}{' '}<code>/staff/login</code>{tx('; passengers sign in with their mobile number. Add or rename branches on')}{' '}<Link href="/admin/branches" className="font-semibold text-[#050a44] underline">{tx('Branches')}</Link>.
      </p>
      <Toast />
    </>
  );
}

/** Invite a staff member by email: they get a link to choose their password. */
function AddStaff({ onAdded, onError }: { onAdded: (msg: string) => void; onError: (msg: string) => void }) {
  const { mode } = useAuth();
  const { branches } = useBranches();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'conductor' | 'admin'>('staff');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open)
    return (
      <div className="mb-4">
        <button onClick={() => setOpen(true)} className="h-10 px-4 rounded-lg bg-[#050a44] text-white text-[13px] font-bold">{tx('Add a staff member')}</button>
      </div>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'demo') return onError(tx('Demo mode: connect Supabase to invite real staff.'));
    setBusy(true);
    const res = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fullName: name, role, branchId: branch || null }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { ok?: boolean; invited?: boolean; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json?.ok) return onError(json?.error ?? tx('Couldn\'t add them. Check your connection and try again.'));
    onAdded(json.invited ? tx('Invite sent to {email}. They choose a password from the email, then sign in at /staff/login.', { email }) : tx('{email} already had an account; it now has staff access.', { email }));
    setName('');
    setEmail('');
    setOpen(false);
  };

  return (
    <Card className="p-4 mb-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
        <label className="block">
          <span className="text-[12px] font-bold text-[#46464f]">{tx('Full name')}</span>
          <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label className="block">
          <span className="text-[12px] font-bold text-[#46464f]">{tx('Work email')}</span>
          <input className={`${inputClass} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-[12px] font-bold text-[#46464f]">{tx('Role')}</span>
          <select className={`${inputClass} mt-1`} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="staff">{ROLE_LABEL.staff}</option>
            <option value="conductor">{ROLE_LABEL.conductor}</option>
            <option value="admin">{ROLE_LABEL.admin}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] font-bold text-[#46464f]">{tx('Branch')}</span>
          <select className={`${inputClass} mt-1`} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">{tx('No branch')}</option>
            {(branches ?? []).filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="h-10 px-4 rounded-lg border border-[#c7c5d1] text-[13px] font-bold text-[#46464f]">{tx('Cancel')}</button>
          <button disabled={busy} className="flex-1 h-10 px-4 rounded-lg bg-[#050a44] text-white text-[13px] font-bold disabled:opacity-50">
            {busy ? tx('Sending…') : tx('Send invite')}
          </button>
        </div>
      </form>
      <p className="text-[12px] text-[#6b6d78] mt-3">{tx('They get an email with a link to choose their password, then sign in at /staff/login with that email.')}</p>
    </Card>
  );
}
