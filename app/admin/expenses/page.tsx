'use client';
// Expenses & fuel — staff log running costs (fuel, tolls, parking, cleaning)
// from the road; super admins see and log everything (service, repairs,
// salaries, insurance…). Fuel with odometer readings feeds fuel efficiency.

import { useMemo, useState } from 'react';
import { Fuel, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { CATEGORY_LABEL, EXPENSE_CATEGORIES, RUNNING_COSTS, useErp, type Expense, type ExpenseCategory } from '@/lib/erp';
import { compressPhoto, formatDateLabel, formatLKR, genId, todayISO } from '@/lib/trips';
import { Camera } from 'lucide-react';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, useToast, stackTable } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';

const blank = (category: ExpenseCategory, busId: string): Expense => ({
  id: uuid(), spentOn: todayISO(), category, amount: 0, busId, description: '', vendor: '', paymentMethod: 'cash',
  litres: null, odometerKm: null, nextDueDate: null, nextDueKm: null,
});

export default function ExpensesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: store } = useStore();
  const erp = useErp({ admin: isAdmin });
  const { toast, Toast } = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [cat, setCat] = useState<'all' | ExpenseCategory>('all');
  const [editing, setEditing] = useState<Expense | null>(null);
  const allowed = isAdmin ? EXPENSE_CATEGORIES : RUNNING_COSTS;
  const busName = (id?: string | null) => store.buses.find((b) => b.id === id)?.regNo ?? '—';

  const rows = useMemo(
    () => (erp.data?.expenses ?? []).filter((e) => e.spentOn.startsWith(month) && (cat === 'all' || e.category === cat)).sort((a, b) => b.spentOn.localeCompare(a.spentOn)),
    [erp.data, month, cat],
  );
  const total = rows.reduce((n, e) => n + e.amount, 0);
  const fuelLitres = rows.filter((e) => e.category === 'fuel').reduce((n, e) => n + (e.litres ?? 0), 0);

  const save = async (e: Expense) => {
    const r = await erp.expenses.save(e);
    if (!r.ok) return toast(r.reason ?? 'Could not save', 'error');
    setEditing(null);
    toast(`${CATEGORY_LABEL[e.category]} ${formatLKR(e.amount)} saved`);
  };

  return (
    <>
      <PageHeader
        title="Expenses & fuel"
        description={isAdmin ? 'Every cost of running the business. Fuel and service entries with odometer readings power Fleet health.' : 'Log fuel, tolls, parking and cleaning as you spend them.'}
        actions={
          <>
            <Button variant="gold" onClick={() => setEditing(blank('fuel', store.buses[0]?.id ?? ''))}>
              <Fuel className="w-4 h-4" /> Log fuel
            </Button>
            <Button variant="secondary" onClick={() => setEditing(blank(isAdmin ? 'service' : 'toll', store.buses[0]?.id ?? ''))}>
              <Plus className="w-4 h-4" /> Other expense
            </Button>
          </>
        }
      />

      <Card className="p-4 mb-4 flex flex-wrap items-center gap-3">
        <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputClass} !w-auto`} />
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} className={`${inputClass} !w-auto`}>
          <option value="all">All categories</option>
          {allowed.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <div className="ml-auto text-right">
          <p className="text-[12px] font-semibold text-[#6b6d78]">Total this month</p>
          <p className="text-[20px] font-semibold text-[#050a44] tabular-nums">{formatLKR(total)}</p>
          {fuelLitres > 0 && <p className="text-[12px] text-[#6b6d78]">{fuelLitres.toFixed(0)} L diesel</p>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {!erp.data ? (
          <div className="p-6 skeleton h-40" />
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-[14px] text-[#46464f]">Nothing logged for this month yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Details</th>
                  <th className="px-4 py-2.5">Bus</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {rows.slice(0, 300).map((e) => (
                  <tr key={e.id} className="hover:bg-[#f8f9fb]">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateLabel(e.spentOn, false)}</td>
                    <td className="px-4 py-3"><Badge value={e.category} label={CATEGORY_LABEL[e.category]} /></td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">
                        {e.description || e.vendor || '—'}
                        {(e.receiptUrl || e.receiptPath?.startsWith('data:')) && (
                          <a href={e.receiptUrl ?? e.receiptPath!} target="_blank" rel="noopener" className="ml-2 text-[11px] font-bold text-[#7c5800] underline">receipt</a>
                        )}
                      </p>
                      <p className="text-[12px] text-[#6b6d78]">
                        {[e.vendor && e.description ? e.vendor : '', e.litres ? `${e.litres} L` : '', e.odometerKm ? `${e.odometerKm.toLocaleString()} km` : '', e.nextDueKm ? `next at ${e.nextDueKm.toLocaleString()} km` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{busName(e.busId)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap">{formatLKR(e.amount)}</td>
                    <td className="px-4 py-3">
                      {isAdmin && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Delete expense"
                            onClick={async () => {
                              const r = await erp.expenses.remove(e.id);
                              toast(r.ok ? 'Deleted' : r.reason ?? 'Could not delete', r.ok ? 'ok' : 'error');
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <ExpenseForm upload={erp.uploadReceipt} expense={editing} allowed={allowed} buses={store.buses.map((b) => ({ id: b.id, label: `${b.name} · ${b.regNo}` }))} onClose={() => setEditing(null)} onSave={save} />}
      <Toast />
    </>
  );
}

function ExpenseForm({ expense, allowed, buses, onClose, onSave, upload }: { upload: (dataUrl: string) => Promise<string>; expense: Expense; allowed: readonly ExpenseCategory[]; buses: { id: string; label: string }[]; onClose: () => void; onSave: (e: Expense) => void }) {
  const [e, setE] = useState<Expense>(expense);
  const set = <K extends keyof Expense>(k: K, v: Expense[K]) => setE((p) => ({ ...p, [k]: v }));
  const isFuel = e.category === 'fuel';
  const isService = ['service', 'repair', 'tyres'].includes(e.category);
  const valid = e.amount > 0 && e.spentOn && (!isFuel || (e.litres ?? 0) > 0);
  const num = (v: string) => (v === '' ? null : Number(v));
  const [photo, setPhoto] = useState<string | null>(expense.receiptUrl ?? (expense.receiptPath?.startsWith('data:') ? expense.receiptPath : null));
  const [busy, setBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  return (
    <Modal
      title={isFuel ? 'Log fuel' : 'Expense'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            try {
              setBusy(true);
              const receiptPath = photo?.startsWith('data:') ? await upload(photo) : e.receiptPath;
              onSave({ ...e, receiptPath });
            } catch {
              setPhotoErr('Could not upload the receipt. Try again.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select className={inputClass} value={e.category} onChange={(x) => set('category', x.target.value as ExpenseCategory)}>
            {allowed.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className={inputClass} value={e.spentOn} max={todayISO()} onChange={(x) => set('spentOn', x.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (LKR)">
          <input type="number" min={0} inputMode="numeric" className={inputClass} value={e.amount || ''} onChange={(x) => set('amount', Number(x.target.value))} />
        </Field>
        <Field label="Bus">
          <select className={inputClass} value={e.busId ?? ''} onChange={(x) => set('busId', x.target.value || null)}>
            <option value="">Not for a bus</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {(isFuel || isService) && (
        <div className="grid grid-cols-2 gap-3">
          {isFuel && (
            <Field label="Litres">
              <input type="number" step="0.1" min={0} inputMode="decimal" className={inputClass} value={e.litres ?? ''} onChange={(x) => set('litres', num(x.target.value))} />
            </Field>
          )}
          <Field label="Odometer (km)" hint="Needed for fuel efficiency and service reminders">
            <input type="number" min={0} inputMode="numeric" className={inputClass} value={e.odometerKm ?? ''} onChange={(x) => set('odometerKm', num(x.target.value))} />
          </Field>
        </div>
      )}
      {isFuel && e.litres && e.amount ? <p className="text-[12px] text-[#6b6d78]">That&apos;s {formatLKR(Math.round(e.amount / e.litres))} per litre.</p> : null}
      {e.category === 'service' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Next service at (km)">
            <input type="number" min={0} className={inputClass} value={e.nextDueKm ?? ''} onChange={(x) => set('nextDueKm', num(x.target.value))} />
          </Field>
          <Field label="…or by date">
            <input type="date" className={inputClass} value={e.nextDueDate ?? ''} onChange={(x) => set('nextDueDate', x.target.value || null)} />
          </Field>
        </div>
      )}
      <Field label="Details">
        <input className={inputClass} value={e.description} onChange={(x) => set('description', x.target.value)} placeholder={isFuel ? 'Optional' : 'e.g. Oil change and brake pads'} />
      </Field>
      <Field label="Receipt photo" hint="Snap the bill so the owner can check it later">
        <div className="flex items-center gap-3">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Receipt" className="w-16 h-16 object-cover rounded-lg border border-[#e1e2e4]" />
          ) : null}
          <label className="inline-flex items-center gap-2 px-3 h-10 rounded-lg border border-[#c7c5d1] text-[13px] font-bold text-[#050a44] cursor-pointer hover:bg-[#f2f4f6]">
            <Camera className="w-4 h-4" /> {photo ? 'Replace' : 'Add photo'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (x) => {
              const f = x.target.files?.[0];
              if (!f) return;
              try { setPhoto(await compressPhoto(f, 1200)); setPhotoErr(null); } catch (err) { setPhotoErr(err instanceof Error ? err.message : 'Could not read photo'); }
            }} />
          </label>
        </div>
        {photoErr && <p className="text-[12px] text-[#ba1a1a] mt-1">{photoErr}</p>}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid to">
          <input className={inputClass} value={e.vendor} onChange={(x) => set('vendor', x.target.value)} placeholder="Shop / station" />
        </Field>
        <Field label="Paid by">
          <select className={inputClass} value={e.paymentMethod} onChange={(x) => set('paymentMethod', x.target.value as Expense['paymentMethod'])}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
