'use client';
// Fleet health — per bus: odometer, fuel efficiency, next service, and
// paperwork (insurance, revenue licence, route permit…) with expiry warnings.

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { CATEGORY_LABEL, DOCUMENT_LABEL, daysUntil, fuelEfficiency, latestOdometer, nextService, useErp, type BusDocument, type DocumentKind, type Expense, type ExpenseCategory } from '@/lib/erp';
import { formatDateLabel, formatLKR, genId, todayISO, addDays } from '@/lib/trips';
import { AdminOnly, ExpiryBadge } from '@/components/admin/AdminOnly';
import { Button, Card, Field, Modal, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';

export default function FleetHealthPage() {
  return (
    <AdminOnly>
      <FleetHealth />
    </AdminOnly>
  );
}

function FleetHealth() {
  const { data } = useStore();
  const erp = useErp({ admin: true });
  const { toast, Toast } = useToast();
  const [doc, setDoc] = useState<BusDocument | null>(null);
  // What was paid for the document being added / renewed. Saved as an expense so it shows in Finance.
  const [paid, setPaid] = useState<{ amount: number | ''; on: string; method: Expense['paymentMethod'] }>({ amount: '', on: todayISO(), method: 'bank' });
  const openDoc = (d: BusDocument) => {
    setPaid({ amount: '', on: todayISO(), method: 'bank' });
    setDoc(d);
  };
  const exps = erp.data?.expenses ?? [];

  return (
    <>
      <PageHeader title="Fleet health" description="Service due, fuel efficiency and paperwork for every bus. Fed by fuel and service entries in Expenses." />
      <div className="space-y-6">
        {data.buses.map((bus) => {
          const odo = latestOdometer(exps, bus.id);
          const eff = fuelEfficiency(exps, bus.id);
          const svc = nextService(exps, bus.id);
          const kmLeft = svc?.nextDueKm && odo ? svc.nextDueKm - odo : null;
          const docs = (erp.data?.documents ?? []).filter((d) => d.busId === bus.id).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
          return (
            <Card key={bus.id} className="overflow-hidden">
              <div className="px-5 py-4 border-b border-[#edeef0] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[17px] font-semibold text-[#050a44]">{bus.name} · {bus.regNo}</h2>
                  <p className="text-[12px] text-[#6b6d78]">{bus.type} · {bus.status}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => openDoc({ id: uuid(), busId: bus.id, kind: 'insurance', number: '', expiresOn: addDays(todayISO(), 365), notes: '' })}>
                  <Plus className="w-4 h-4" /> Add document
                </Button>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#edeef0]">
                <Stat label="Odometer" value={odo ? `${odo.toLocaleString()} km` : '—'} note="latest fuel/service entry" />
                <Stat label="Fuel efficiency" value={eff ? `${eff.kmPerLitre.toFixed(1)} km/L` : '—'} note={eff ? `${formatLKR(Math.round(eff.costPerKm))} per km` : 'log fuel with odometer'} />
                <Stat
                  label="Next service"
                  value={kmLeft != null ? (kmLeft <= 0 ? 'Overdue' : `in ${kmLeft.toLocaleString()} km`) : svc?.nextDueDate ? formatDateLabel(svc.nextDueDate, false) : '—'}
                  note={svc ? `last ${formatDateLabel(svc.spentOn, false)}` : 'log a service'}
                  warn={kmLeft != null && kmLeft < 1500}
                />
                <Stat label="Paperwork" value={`${docs.filter((d) => daysUntil(d.expiresOn) < 0).length} expired`} note={`${docs.filter((d) => { const x = daysUntil(d.expiresOn); return x >= 0 && x <= 30; }).length} due within 30 days`} warn={docs.some((d) => daysUntil(d.expiresOn) <= 30)} />
              </div>
              {docs.length > 0 && (
                <ul className="divide-y divide-[#edeef0] border-t border-[#edeef0]">
                  {docs.map((d) => (
                    <li key={d.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-[#050a44]">{DOCUMENT_LABEL[d.kind]}</p>
                        <p className="text-[12px] text-[#6b6d78] truncate">{[d.number, d.notes].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      <ExpiryBadge date={d.expiresOn} />
                      <Button size="sm" variant="ghost" onClick={() => openDoc(d)}>Renew</Button>
                      <Button size="sm" variant="ghost" aria-label="Delete document" onClick={async () => {
                        const r = await erp.documents.remove(d.id);
                        toast(r.ok ? 'Removed' : r.reason ?? 'Could not remove', r.ok ? 'ok' : 'error');
                      }}>
                        <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      {doc && (
        <Modal
          title={DOCUMENT_LABEL[doc.kind]}
          onClose={() => setDoc(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDoc(null)}>Cancel</Button>
              <Button disabled={!doc.expiresOn} onClick={async () => {
                const r = await erp.documents.save(doc);
                if (!r.ok) return toast(r.reason ?? 'Could not save', 'error');
                // A cost was entered: record it under Expenses (Insurance / Licence / Permit) for this bus.
                if (typeof paid.amount === 'number' && paid.amount > 0) {
                  const bus = data.buses.find((b) => b.id === doc.busId);
                  const e = await erp.expenses.save({
                    id: uuid(),
                    spentOn: paid.on,
                    category: DOC_EXPENSE[doc.kind],
                    amount: paid.amount,
                    busId: doc.busId,
                    description: `${DOCUMENT_LABEL[doc.kind]}${doc.number ? ` ${doc.number}` : ''}${bus ? ` · ${bus.regNo}` : ''}, valid to ${formatDateLabel(doc.expiresOn, false)}`,
                    vendor: doc.notes,
                    paymentMethod: paid.method,
                  });
                  setDoc(null);
                  return toast(e.ok ? `Saved. ${formatLKR(paid.amount)} added to Expenses.` : `Document saved, but the expense wasn't: ${e.reason ?? 'try adding it in Expenses'}`, e.ok ? 'ok' : 'error');
                }
                setDoc(null);
                toast('Saved');
              }}>Save</Button>
            </>
          }
        >
          <Field label="Document">
            <select className={inputClass} value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value as DocumentKind })}>
              {Object.entries(DOCUMENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number">
              <input className={inputClass} value={doc.number} onChange={(e) => setDoc({ ...doc, number: e.target.value })} />
            </Field>
            <Field label="Expires on">
              <input type="date" className={inputClass} value={doc.expiresOn} onChange={(e) => setDoc({ ...doc, expiresOn: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <input className={inputClass} value={doc.notes} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} placeholder="e.g. insurer, cover type" />
          </Field>
          <div className="rounded-xl bg-[#f2f4f6] p-3 space-y-3">
            <p className="text-[13px] font-bold text-[#050a44]">What did it cost?</p>
            <p className="text-[12px] text-[#46464f] -mt-2">Enter the amount paid and it is added to Expenses under {CATEGORY_LABEL[DOC_EXPENSE[doc.kind]]} for this bus, so it counts in Finance. Leave it empty if you already entered it there.</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Amount paid (LKR)">
                <input type="number" min={0} inputMode="numeric" className={inputClass} value={paid.amount} onChange={(e) => setPaid({ ...paid, amount: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} placeholder="Optional" />
              </Field>
              <Field label="Paid on">
                <input type="date" max={todayISO()} className={inputClass} value={paid.on} onChange={(e) => e.target.value && setPaid({ ...paid, on: e.target.value })} />
              </Field>
              <Field label="Paid by">
                <select className={inputClass} value={paid.method} onChange={(e) => setPaid({ ...paid, method: e.target.value as Expense['paymentMethod'] })}>
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
          </div>
        </Modal>
      )}
      <Toast />
    </>
  );
}

/** Which expense category a document's cost is filed under. */
const DOC_EXPENSE: Record<DocumentKind, ExpenseCategory> = {
  insurance: 'insurance',
  revenue_license: 'license',
  route_permit: 'permit',
  emission_test: 'license',
  fitness_certificate: 'license',
  other: 'other',
};

function Stat({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="p-4">
      <p className="text-[12px] font-bold text-[#46464f]">{label}</p>
      <p className={`text-[18px] font-semibold mt-1 ${warn ? 'text-[#ba1a1a]' : 'text-[#050a44]'}`}>{value}</p>
      <p className="text-[12px] text-[#6b6d78]">{note}</p>
    </div>
  );
}
