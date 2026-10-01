'use client';
// Parcel & charter requests from customers: quote, confirm, complete. When a
// job is done, a super admin can record the money as income in one tap.

import { useState } from 'react';
import { Phone, Package, BusFront } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useServiceRequests, type ServiceRequest } from '@/lib/extras';
import { useErp } from '@/lib/erp';
import { useStore } from '@/lib/store';
import { formatDateLabel, formatLKR, genId, todayISO } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';

const NEXT: Record<ServiceRequest['status'], ServiceRequest['status'][]> = {
  new: ['quoted', 'cancelled'], quoted: ['confirmed', 'cancelled'], confirmed: ['done', 'cancelled'], done: [], cancelled: [],
};

export default function RequestsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { requests, update } = useServiceRequests();
  const erp = useErp({ admin: isAdmin });
  const { data } = useStore();
  const { toast, Toast } = useToast();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [quoting, setQuoting] = useState<ServiceRequest | null>(null);
  const rows = requests.filter((r) => filter === 'all' || !['done', 'cancelled'].includes(r.status));

  const move = async (r: ServiceRequest, status: ServiceRequest['status']) => {
    if (status === 'quoted') return setQuoting(r);
    const res = await update(r.id, { status });
    if (!res.ok) return toast(res.reason ?? 'Could not update', 'error');
    if (status === 'done' && isAdmin && r.quoteAmount) {
      await erp.income.save({ id: uuid(), receivedOn: todayISO(), category: r.kind === 'parcel' ? 'parcel' : 'charter', amount: r.quoteAmount, busId: data.buses[0]?.id ?? null, description: `${r.kind === 'parcel' ? 'Parcel' : 'Charter'}: ${r.name}, ${r.details.from} → ${r.details.to}` });
      toast(`Done · ${formatLKR(r.quoteAmount)} recorded as income`);
    } else toast(`Marked ${status}`);
  };

  return (
    <>
      <PageHeader title="Parcel & hire requests" description="Customers ask from the Parcels & bus hire page. Call them, send a quote, and mark the job done." />
      <div className="flex gap-2 mb-4">
        {(['open', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`px-3 h-9 rounded-lg text-[13px] font-bold border ${filter === f ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1]'}`}>
            {f === 'open' ? `Open (${requests.filter((r) => !['done', 'cancelled'].includes(r.status)).length})` : `All (${requests.length})`}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-[14px] text-[#46464f]">No requests right now.</Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((r) => (
            <Card key={r.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {r.kind === 'parcel' ? <Package className="w-5 h-5 text-[#7c5800]" /> : <BusFront className="w-5 h-5 text-[#7c5800]" />}
                  <div>
                    <p className="text-[15px] font-semibold text-[#050a44]">{r.kind === 'parcel' ? 'Parcel' : 'Bus hire'} · {String(r.details.from)} → {String(r.details.to)}</p>
                    <p className="text-[12px] text-[#6b6d78]">{r.details.date ? formatDateLabel(String(r.details.date), false) : ''} · asked {new Date(r.createdAt).toLocaleDateString('en-GB')}</p>
                  </div>
                </div>
                <Badge value={r.status} />
              </div>
              <p className="text-[13px] text-[#46464f]">
                {r.kind === 'parcel'
                  ? `${r.details.contents ?? ''}${r.details.weightKg ? ` · ~${r.details.weightKg} kg` : ''}${r.details.receiverName ? ` · to ${r.details.receiverName} ${r.details.receiverPhone ?? ''}` : ''}`
                  : `${r.details.people ?? '?'} people · ${r.details.days ?? 1} day(s)${r.details.notes ? ` · ${r.details.notes}` : ''}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`tel:${r.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-[#f2f4f6] text-[12px] font-bold text-[#050a44]"><Phone className="w-3.5 h-3.5" /> {r.name} · {r.phone}</a>
                {r.quoteAmount ? <span className="text-[13px] font-semibold text-[#050a44]">Quote {formatLKR(r.quoteAmount)}</span> : null}
                <span className="ml-auto flex gap-1.5">
                  {NEXT[r.status].map((s) => (
                    <Button key={s} size="sm" variant={s === 'cancelled' ? 'ghost' : 'secondary'} onClick={() => move(r, s)}>
                      {s === 'quoted' ? 'Send quote' : s === 'confirmed' ? 'Confirmed' : s === 'done' ? 'Done' : 'Cancel'}
                    </Button>
                  ))}
                </span>
              </div>
              {r.staffNotes && <p className="text-[12px] text-[#6b6d78]">Note: {r.staffNotes}</p>}
            </Card>
          ))}
        </div>
      )}
      {quoting && <QuoteModal r={quoting} onClose={() => setQuoting(null)} onSave={async (amount, notes) => {
        const res = await update(quoting.id, { status: 'quoted', quoteAmount: amount, staffNotes: notes });
        if (!res.ok) return toast(res.reason ?? 'Could not save', 'error');
        setQuoting(null);
        toast(`Quote ${formatLKR(amount)} saved. Call or text ${quoting.name} with it.`);
      }} />}
      <Toast />
    </>
  );
}

function QuoteModal({ r, onClose, onSave }: { r: ServiceRequest; onClose: () => void; onSave: (amount: number, notes: string) => void }) {
  const [amount, setAmount] = useState(r.quoteAmount ?? 0);
  const [notes, setNotes] = useState(r.staffNotes);
  return (
    <Modal title={`Quote for ${r.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!(amount > 0)} onClick={() => onSave(amount, notes)}>Save quote</Button></>}>
      <Field label="Price (LKR)"><input type="number" min={0} className={inputClass} value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
      <Field label="Note (for staff)"><input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. includes driver's meals" /></Field>
    </Modal>
  );
}
