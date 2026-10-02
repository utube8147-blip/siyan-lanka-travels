'use client';
// app/admin/payouts/page.tsx — refunds and resale payouts the company owes.
// The database adds a row whenever a paid booking is cancelled with a refund,
// made cheaper, or resold. Office staff send the money (bank transfer or cash
// at the counter) and tick it off here; the passenger is told automatically.

import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { cancelPayout, hasPayee, markPayoutPaid, usePayouts, type Payout, type PayoutMethod } from '@/lib/money';
import { formatLKR } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, useToast } from '@/components/admin/ui';

type Tab = 'pending' | 'paid' | 'cancelled';
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const METHODS: { id: PayoutMethod; label: string }[] = [
  { id: 'bank', label: 'Bank transfer' },
  { id: 'cash', label: 'Cash at the counter' },
  { id: 'gateway', label: 'Refunded on the card (payment gateway)' },
  { id: 'other', label: 'Other' },
];

export default function PayoutsPage() {
  const { payouts, ready, reload } = usePayouts('all');
  const { toast, Toast } = useToast();
  const [tab, setTab] = useState<Tab>('pending');
  const [paying, setPaying] = useState<Payout | null>(null);
  const [method, setMethod] = useState<PayoutMethod>('bank');
  const [reference, setReference] = useState('');
  const [dropping, setDropping] = useState<Payout | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => payouts.filter((p) => p.status === tab), [payouts, tab]);
  const owed = useMemo(() => payouts.filter((p) => p.status === 'pending').reduce((n, p) => n + p.amount, 0), [payouts]);
  const count = (t: Tab) => payouts.filter((p) => p.status === t).length;

  const exportCsv = () => {
    const header = ['Type', 'Booking', 'Passenger', 'Phone', 'Amount (LKR)', 'Bank', 'Branch', 'Account no', 'Account name', 'Status', 'Created', 'Paid', 'Method', 'Reference', 'Notes'];
    const lines = rows.map((p) => [p.kind, p.bookingRef, p.name, p.phone, p.amount, p.payee.bank, p.payee.branch, p.payee.account_no, p.payee.account_name, p.status, p.createdAt, p.paidAt ?? '', p.method, p.reference, p.notes]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payouts-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pay = async () => {
    if (!paying) return;
    setBusy(true);
    const r = await markPayoutPaid(paying.id, method, reference.trim());
    setBusy(false);
    toast(r.ok ? `${formatLKR(paying.amount)} to ${paying.name} marked paid` : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
    if (r.ok) {
      setPaying(null);
      setReference('');
      reload();
    }
  };
  const drop = async () => {
    if (!dropping) return;
    setBusy(true);
    const r = await cancelPayout(dropping.id, reason.trim());
    setBusy(false);
    toast(r.ok ? 'Removed from the list' : r.reason ?? 'Could not save', r.ok ? 'ok' : 'error');
    if (r.ok) {
      setDropping(null);
      setReason('');
      reload();
    }
  };
  const copy = (p: Payout) => {
    navigator.clipboard?.writeText(`${p.payee.account_name}\n${p.payee.bank}${p.payee.branch ? `, ${p.payee.branch}` : ''}\n${p.payee.account_no}\nLKR ${p.amount}\n${p.bookingRef}`);
    toast('Account details copied');
  };

  const pill = (active: boolean) =>
    `px-3 h-9 rounded-lg text-[13px] font-bold border ${active ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1] hover:bg-[#f2f4f6]'}`;

  return (
    <>
      <PageHeader
        title="Refunds & payouts"
        description="Money owed to passengers: refunds for cancelled or changed bookings, and sale money for resold seats. Send it, then mark it paid here."
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      <Card className="p-4 mb-4 flex flex-wrap items-center gap-2">
        {(['pending', 'paid', 'cancelled'] as const).map((t) => (
          <button key={t} className={pill(tab === t)} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'pending' ? 'To pay' : t === 'paid' ? 'Paid' : 'Not owed'} ({count(t)})
          </button>
        ))}
        <span className="ml-auto text-[14px] font-semibold text-[#46464f]">
          Owed now: <b className="text-[#050a44] tabular-nums">{formatLKR(owed)}</b>
        </span>
      </Card>

      <Card className="overflow-hidden">
        {!ready ? (
          <div className="skeleton h-40" />
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-[14px] text-[#46464f]">{tab === 'pending' ? 'Nothing to pay right now.' : 'Nothing here yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Passenger</th>
                  <th className="px-4 py-2.5">For</th>
                  <th className="px-4 py-2.5">Pay to</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">{tab === 'pending' ? '' : 'Paid'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {rows.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">{p.name}</p>
                      <p className="text-[12px] text-[#46464f]">{p.phone || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={p.kind === 'resale' ? 'online' : 'held'} label={p.kind === 'resale' ? 'Resale payout' : 'Refund'} />
                      <p className="font-semibold text-[#050a44] mt-1">{p.bookingRef || '—'}</p>
                      <p className="text-[12px] text-[#46464f]">{p.trip}</p>
                      <p className="text-[12px] text-[#6b6d78] max-w-[260px]">{p.notes}</p>
                      <p className="text-[11px] text-[#6b6d78]">Since {day(p.createdAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {hasPayee(p.payee) ? (
                        <div className="text-[12px] text-[#46464f]">
                          <p className="font-semibold text-[#050a44]">{p.payee.account_name}</p>
                          <p>
                            {p.payee.bank}
                            {p.payee.branch && `, ${p.payee.branch}`}
                          </p>
                          <p className="font-bold text-[#050a44] tabular-nums">{p.payee.account_no}</p>
                          {tab === 'pending' && (
                            <button onClick={() => copy(p)} className="mt-1 inline-flex items-center gap-1 underline font-bold text-[#050a44]">
                              <Copy className="w-3 h-3" /> Copy
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-[12px] text-[#7c5800] font-semibold max-w-[180px]">
                          {p.userId ? 'No bank account given yet. The passenger adds it in My trips, or pay cash at the counter.' : 'Counter booking: refund in cash.'}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap text-[#050a44]">{formatLKR(p.amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tab === 'pending' ? (
                        <div className="flex flex-col gap-1.5 items-start">
                          <Button size="sm" variant="gold" onClick={() => { setPaying(p); setMethod(hasPayee(p.payee) ? 'bank' : 'cash'); }}>
                            <Check className="w-3.5 h-3.5" /> Mark paid
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDropping(p)}>
                            Not owed
                          </Button>
                        </div>
                      ) : tab === 'paid' ? (
                        <div className="text-[12px] text-[#46464f]">
                          <p className="font-semibold text-[#006e1c]">{day(p.paidAt)}</p>
                          <p>{METHODS.find((m) => m.id === p.method)?.label ?? p.method}</p>
                          {p.reference && <p>Ref {p.reference}</p>}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {paying && (
        <Modal
          title={`Pay ${formatLKR(paying.amount)} to ${paying.name}`}
          onClose={() => setPaying(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPaying(null)}>Back</Button>
              <Button variant="gold" onClick={pay} disabled={busy}>{busy ? 'Saving…' : 'Mark paid'}</Button>
            </>
          }
        >
          <p className="text-[13px] text-[#46464f]">Send the money first, then record it here. The passenger gets a message saying it has been paid.</p>
          <Field label="How was it paid?">
            <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)}>
              {METHODS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Reference" hint="Bank transfer number, receipt number or gateway refund id.">
            <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </Modal>
      )}

      {dropping && (
        <Modal
          title={`Remove ${formatLKR(dropping.amount)} for ${dropping.name}?`}
          onClose={() => setDropping(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDropping(null)}>Back</Button>
              <Button variant="danger" onClick={drop} disabled={busy || reason.trim().length < 3}>Not owed</Button>
            </>
          }
        >
          <p className="text-[13px] text-[#46464f]">Use this only when nothing is owed, for example it was already settled another way. It stays on record under &ldquo;Not owed&rdquo;.</p>
          <Field label="Why?">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. refunded in cash on the day" />
          </Field>
        </Modal>
      )}
      <Toast />
    </>
  );
}
