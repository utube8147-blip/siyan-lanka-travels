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

const ROLE_LABEL: Record<AccountRole, string> = { passenger: 'Passenger', conductor: 'Conductor', staff: 'Staff', admin: 'Super admin' };

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
      <PageHeader title="Accounts & roles" description="Conductors use the phone conductor page (boarding, cash, trip updates). Staff run departures, bookings, buses and the timetable. Super admins also see finance, crew, accounts and settings. Give each staff member their branch so their sales and cash are counted for the right place." />
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'admin', 'staff', 'conductor', 'passenger'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            aria-pressed={role === r}
            className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${role === r ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}
          >
            {r === 'all' ? `Everyone (${erp.data?.accounts.length ?? 0})` : `${ROLE_LABEL[r]} (${count(r)})`}
          </button>
        ))}
        <div className="relative ml-auto min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6d78]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" aria-label="Search accounts" className={`${inputClass} pl-9`} />
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
                  <th className="px-4 py-2.5">Person</th>
                  <th className="px-4 py-2.5">Joined</th>
                  <th className="px-4 py-2.5">Last sign-in</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Branch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">{a.fullName || '—'}{a.id === user?.id && <span className="text-[#6b6d78] font-normal"> (you)</span>}</p>
                      <p className="text-[12px] text-[#6b6d78]">{a.email}{a.phone ? ` · ${a.phone}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateLabel(a.createdAt.slice(0, 10), false)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{a.lastSignIn ? formatDateLabel(a.lastSignIn.slice(0, 10), false) : '—'}</td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role for ${a.fullName || a.email}`}
                        value={a.role}
                        disabled={a.id === user?.id}
                        onChange={async (e) => {
                          const next = e.target.value as AccountRole;
                          const r = await erp.setRole(a.id, next);
                          toast(r.ok ? `${a.fullName || a.email} is now ${ROLE_LABEL[next]}` : r.reason ?? 'Could not change role', r.ok ? 'ok' : 'error');
                        }}
                        className={`${inputClass} !w-auto !py-1.5`}
                      >
                        {(Object.keys(ROLE_LABEL) as AccountRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {a.role === 'passenger' ? (
                        <span className="text-[#6b6d78]">—</span>
                      ) : (
                        <select
                          aria-label={`Branch for ${a.fullName || a.email}`}
                          value={a.branchId ?? ''}
                          onChange={async (e) => {
                            const next = e.target.value || null;
                            const r = await erp.setBranch(a.id, next);
                            const name = branches?.find((b) => b.id === next)?.name;
                            toast(r.ok ? (name ? `${a.fullName || a.email} is now at ${name}` : `${a.fullName || a.email} has no branch`) : r.reason ?? 'Could not change the branch', r.ok ? 'ok' : 'error');
                          }}
                          className={`${inputClass} !w-auto !py-1.5 ${a.branchId ? '' : '!text-[#9a5b00]'}`}
                        >
                          <option value="">No branch</option>
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
      <p className="text-[12px] text-[#6b6d78] mt-3">
        To add staff: ask them to create an account on the website, then set their role here. They sign in at <code>/staff/login</code>. Add or rename branches on <Link href="/admin/branches" className="font-semibold text-[#050a44] underline">Branches</Link>.
      </p>
      <Toast />
    </>
  );
}
