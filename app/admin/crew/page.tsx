'use client';
// Crew — drivers, conductors, cleaners: contacts, licence expiry, and each
// month's salaries settled person by person (components/admin/SalarySettlement).

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { SalarySettlement } from '@/components/admin/SalarySettlement';
import { useStore } from '@/lib/store';
import { useErp, type CrewMember, type CrewRole } from '@/lib/erp';
import { formatLKR, genId, todayISO } from '@/lib/trips';
import { AdminOnly, ExpiryBadge } from '@/components/admin/AdminOnly';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, useToast, stackTable } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';
import { tx } from '@/lib/i18n';

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
  const crew = erp.data?.crew ?? [];

  return (
    <>
      <PageHeader
        title={tx('Crew')}
        description={tx('Who drives and works the buses, their licences and pay.')}
        actions={
          <>
            <Button variant="gold" onClick={() => setEditing({ id: uuid(), fullName: '', role: 'driver', phone: '', licenseNo: '', licenseExpires: null, monthlySalary: 0, busId: data.buses[0]?.id ?? null, active: true, notes: '' })}>
              <Plus className="w-4 h-4" />{' '}{tx('Add person')}</Button>
          </>
        }
      />
      <SalarySettlement crew={crew} saveExpense={erp.expenses.save} removeExpense={erp.expenses.remove} />

      <Card className="overflow-hidden">
        {crew.length === 0 ? (
          <p className="p-8 text-center text-[14px] text-[#46464f]">{tx('No crew yet. Add your drivers and conductors.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">{tx('Name')}</th>
                  <th className="px-4 py-2.5">{tx('Role')}</th>
                  <th className="px-4 py-2.5">{tx('Phone')}</th>
                  <th className="px-4 py-2.5">{tx('Licence')}</th>
                  <th className="px-4 py-2.5 text-right">{tx('Salary')}</th>
                  <th className="px-4 py-2.5"><span className="sr-only">{tx('Edit')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {crew.map((c) => (
                  <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">{c.fullName}</p>
                      <p className="text-[12px] text-[#6b6d78]">{data.buses.find((b) => b.id === c.busId)?.regNo ?? tx('Unassigned')}{c.notes ? ` · ${c.notes}` : ''}</p>
                    </td>
                    <td className="px-4 py-3"><Badge value={c.role} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="underline">{c.phone}</a> : '—'}</td>
                    <td className="px-4 py-3">{c.role === 'driver' ? <ExpiryBadge date={c.licenseExpires} /> : <span className="text-[#6b6d78]">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.monthlySalary ? formatLKR(c.monthlySalary) : '—'}{c.perTripPay ? <span className="block text-[11px] text-[#6b6d78]">{tx('+ {amount} a trip', { amount: formatLKR(c.perTripPay) })}</span> : null}</td>
                    <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>{tx('Edit')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <Modal
          title={editing.fullName || tx('New crew member')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>{tx('Cancel')}</Button>
              <Button disabled={editing.fullName.trim().length < 2} onClick={async () => {
                const r = await erp.crew.save({ ...editing, fullName: editing.fullName.trim() });
                if (!r.ok) return toast(r.reason ?? tx('Could not save'), 'error');
                setEditing(null);
                toast(tx('Saved'));
              }}>{tx('Save')}</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Full name')}><input className={inputClass} value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} /></Field>
            <Field label={tx('Role')}>
              <select className={inputClass} value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as CrewRole })}>
                {ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Phone')}><input className={inputClass} value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} inputMode="tel" /></Field>
            <Field label={tx('Bus')}>
              <select className={inputClass} value={editing.busId ?? ''} onChange={(e) => setEditing({ ...editing, busId: e.target.value || null })}>
                <option value="">{tx('Unassigned')}</option>
                {data.buses.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.regNo}</option>)}
              </select>
            </Field>
          </div>
          {editing.role === 'driver' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={tx('Licence no.')}><input className={inputClass} value={editing.licenseNo} onChange={(e) => setEditing({ ...editing, licenseNo: e.target.value })} /></Field>
              <Field label={tx('Licence expires')}><input type="date" className={inputClass} value={editing.licenseExpires ?? ''} onChange={(e) => setEditing({ ...editing, licenseExpires: e.target.value || null })} /></Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx('Monthly salary (LKR)')} hint={tx('0 if paid per trip')}><input type="number" min={0} className={inputClass} value={editing.monthlySalary || ''} onChange={(e) => setEditing({ ...editing, monthlySalary: Number(e.target.value) })} /></Field>
            <Field label={tx('Pay per trip (LKR)')} hint={tx('Added for each trip their bus runs. 0 if none.')}><input type="number" min={0} className={inputClass} value={editing.perTripPay || ''} onChange={(e) => setEditing({ ...editing, perTripPay: Number(e.target.value) })} /></Field>
            <Field label={tx('Status')}>
              <select className={inputClass} value={editing.active ? 'yes' : 'no'} onChange={(e) => setEditing({ ...editing, active: e.target.value === 'yes' })}>
                <option value="yes">{tx('Active')}</option>
                <option value="no">{tx('Left / inactive')}</option>
              </select>
            </Field>
          </div>
          <Field label={tx('Notes')}><input className={inputClass} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          {crew.some((c) => c.id === editing.id) && (
            <Button variant="danger" size="sm" onClick={async () => {
              const r = await erp.crew.remove(editing.id);
              if (!r.ok) return toast(r.reason ?? tx('Could not remove'), 'error');
              setEditing(null);
              toast(tx('Removed'));
            }}>{tx('Remove from crew')}</Button>
          )}
        </Modal>
      )}
      <Toast />
    </>
  );
}
