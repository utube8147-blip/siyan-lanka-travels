'use client';
// Crew — drivers, conductors, cleaners: contacts, licence expiry, salaries.
// "Pay salaries" records this month's salary expenses in one go.

import { useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useErp, type CrewMember, type CrewRole } from '@/lib/erp';
import { formatLKR, genId, todayISO } from '@/lib/trips';
import { AdminOnly, ExpiryBadge } from '@/components/admin/AdminOnly';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, useToast, stackTable } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';

const ROLES: CrewRole[] = ['driver', 'conductor', 'cleaner', 'mechanic', 'office'];

export default function CrewPage() {
  return (
    <AdminOnly>
      <Crew />
    </AdminOnly>
  );
}

function Crew() {
  const { data } = useStore();
  const erp = useErp({ admin: true });
  const { toast, Toast } = useToast();
  const [editing, setEditing] = useState<CrewMember | null>(null);
  const [paying, setPaying] = useState(false);
  const crew = erp.data?.crew ?? [];
  const payroll = crew.filter((c) => c.active).reduce((n, c) => n + c.monthlySalary, 0);
  const month = todayISO().slice(0, 7);
  const paidThisMonth = (erp.data?.expenses ?? []).filter((e) => e.category === 'salary' && e.spentOn.startsWith(month));

  const paySalaries = async () => {
    for (const c of crew.filter((x) => x.active && x.monthlySalary > 0)) {
      const r = await erp.expenses.save({
        id: uuid(), spentOn: todayISO(), category: 'salary', amount: c.monthlySalary, busId: c.busId ?? null,
        description: `${c.role[0].toUpperCase() + c.role.slice(1)}: ${c.fullName}`, vendor: '', paymentMethod: 'bank',
      });
      if (!r.ok) return toast(r.reason ?? 'Could not record salaries', 'error');
    }
    setPaying(false);
    toast(`Salaries recorded: ${formatLKR(payroll)}`);
  };

  return (
    <>
      <PageHeader
        title="Crew"
        description="Who drives and works the buses, their licences and pay."
        actions={
          <>
            <Button variant="secondary" disabled={!payroll} onClick={() => setPaying(true)}>
              <Wallet className="w-4 h-4" /> Pay salaries
            </Button>
            <Button variant="gold" onClick={() => setEditing({ id: uuid(), fullName: '', role: 'driver', phone: '', licenseNo: '', licenseExpires: null, monthlySalary: 0, busId: data.buses[0]?.id ?? null, active: true, notes: '' })}>
              <Plus className="w-4 h-4" /> Add person
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-4 mb-5 max-w-xl">
        <Card className="p-4">
          <p className="text-[12px] font-bold text-[#46464f]">Monthly payroll</p>
          <p className="text-[22px] font-semibold text-[#050a44] tabular-nums">{formatLKR(payroll)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] font-bold text-[#46464f]">Paid this month</p>
          <p className="text-[22px] font-semibold text-[#050a44] tabular-nums">{formatLKR(paidThisMonth.reduce((n, e) => n + e.amount, 0))}</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        {crew.length === 0 ? (
          <p className="p-8 text-center text-[14px] text-[#46464f]">No crew yet. Add your drivers and conductors.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5">Licence</th>
                  <th className="px-4 py-2.5 text-right">Salary</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {crew.map((c) => (
                  <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">{c.fullName}</p>
                      <p className="text-[12px] text-[#6b6d78]">{data.buses.find((b) => b.id === c.busId)?.regNo ?? 'Unassigned'}{c.notes ? ` · ${c.notes}` : ''}</p>
                    </td>
                    <td className="px-4 py-3"><Badge value={c.role} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="underline">{c.phone}</a> : '—'}</td>
                    <td className="px-4 py-3">{c.role === 'driver' ? <ExpiryBadge date={c.licenseExpires} /> : <span className="text-[#6b6d78]">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.monthlySalary ? formatLKR(c.monthlySalary) : '—'}</td>
                    <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {paying && (
        <Modal
          title="Record this month's salaries?"
          onClose={() => setPaying(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPaying(false)}>Cancel</Button>
              <Button variant="gold" onClick={paySalaries}>Record {formatLKR(payroll)}</Button>
            </>
          }
        >
          <p className="text-[14px] text-[#46464f]">
            Adds a salary expense for each active person with a monthly salary, dated today.
            {paidThisMonth.length > 0 && <strong className="block mt-2 text-[#ba1a1a]">{paidThisMonth.length} salary payments are already recorded this month.</strong>}
          </p>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing.fullName || 'New crew member'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button disabled={editing.fullName.trim().length < 2} onClick={async () => {
                const r = await erp.crew.save({ ...editing, fullName: editing.fullName.trim() });
                if (!r.ok) return toast(r.reason ?? 'Could not save', 'error');
                setEditing(null);
                toast('Saved');
              }}>Save</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name"><input className={inputClass} value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} /></Field>
            <Field label="Role">
              <select className={inputClass} value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as CrewRole })}>
                {ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><input className={inputClass} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} inputMode="tel" /></Field>
            <Field label="Bus">
              <select className={inputClass} value={editing.busId ?? ''} onChange={(e) => setEditing({ ...editing, busId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {data.buses.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.regNo}</option>)}
              </select>
            </Field>
          </div>
          {editing.role === 'driver' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Licence no."><input className={inputClass} value={editing.licenseNo} onChange={(e) => setEditing({ ...editing, licenseNo: e.target.value })} /></Field>
              <Field label="Licence expires"><input type="date" className={inputClass} value={editing.licenseExpires ?? ''} onChange={(e) => setEditing({ ...editing, licenseExpires: e.target.value || null })} /></Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly salary (LKR)" hint="0 if paid per trip"><input type="number" min={0} className={inputClass} value={editing.monthlySalary || ''} onChange={(e) => setEditing({ ...editing, monthlySalary: Number(e.target.value) })} /></Field>
            <Field label="Status">
              <select className={inputClass} value={editing.active ? 'yes' : 'no'} onChange={(e) => setEditing({ ...editing, active: e.target.value === 'yes' })}>
                <option value="yes">Active</option>
                <option value="no">Left / inactive</option>
              </select>
            </Field>
          </div>
          <Field label="Notes"><input className={inputClass} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          {crew.some((c) => c.id === editing.id) && (
            <Button variant="danger" size="sm" onClick={async () => {
              const r = await erp.crew.remove(editing.id);
              if (!r.ok) return toast(r.reason ?? 'Could not remove', 'error');
              setEditing(null);
              toast('Removed');
            }}>Remove from crew</Button>
          )}
        </Modal>
      )}
      <Toast />
    </>
  );
}
