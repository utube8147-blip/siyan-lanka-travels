'use client';
// Staff area → Reports → Where the money goes: per month, what passengers paid
// and how it splits — the tickets (the bus company's), the card fees (kept by
// the payment gateway) and the platform fees (paid out to the platform at the
// end of the month). Counted on the day the money came in; test bookings left out.

import { useEffect, useMemo, useState } from 'react';
import { Card, PageHeader } from '@/components/admin/ui';
import { useStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { formatLKR } from '@/lib/trips';

interface Row { month: string; bookings: number; seats: number; tickets: number; gateway_fees: number; platform_fees: number; refunds: number; collected: number }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthName = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export default function MoneySplit() {
  const { data } = useStore();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() - 11, 1); return iso(d); }, []);
  const to = useMemo(() => iso(new Date()), []);

  // Demo mode: worked out from the bookings in this browser, the same way.
  const demoRows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>();
    for (const b of data.bookings) {
      if (b.isTest || b.status === 'held' || !(b.paymentStatus === 'paid' || b.paymentStatus === 'refunded')) continue;
      const m = `${b.createdAt.slice(0, 7)}-01`; // demo: booking day
      if (m < from.slice(0, 7)) continue;
      const r = by.get(m) ?? { month: m, bookings: 0, seats: 0, tickets: 0, gateway_fees: 0, platform_fees: 0, refunds: 0, collected: 0 };
      r.bookings++; r.seats += b.seats.length;
      r.tickets += b.total - b.fee - (b.gatewayFee ?? 0); r.gateway_fees += b.gatewayFee ?? 0; r.platform_fees += b.fee;
      r.refunds += b.paymentStatus === 'refunded' ? b.refund?.amount ?? 0 : 0; r.collected += b.total;
      by.set(m, r);
    }
    return [...by.values()].sort((a, b) => b.month.localeCompare(a.month));
  }, [data.bookings, from]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase().rpc('money_breakdown', { p_from: from, p_to: to }).then(({ data: d, error: e }) => {
      if (e) setError(/money_breakdown|schema cache|PGRST202/i.test(e.message) ? 'Run the latest database update to see this.' : e.message);
      else setRows(((d ?? []) as Row[]).map((r) => ({ ...r, bookings: +r.bookings, seats: +r.seats, tickets: +r.tickets, gateway_fees: +r.gateway_fees, platform_fees: +r.platform_fees, refunds: +r.refunds, collected: +r.collected })));
    });
  }, [from, to]);

  const list = isSupabaseConfigured ? rows ?? [] : demoRows;
  const [pick, setPick] = useState<string | null>(null);
  const sel = list.find((r) => r.month === pick) ?? list[0];
  const total = list.reduce((a, r) => ({ tickets: a.tickets + r.tickets, gateway: a.gateway + r.gateway_fees, platform: a.platform + r.platform_fees, collected: a.collected + r.collected }), { tickets: 0, gateway: 0, platform: 0, collected: 0 });

  return (
    <div className="space-y-6">
      <PageHeader title="Where the money goes" description="What passengers paid each month, split into the ticket, the card fee and the platform fee. Counted on the day the money came in; test bookings left out." />
      {error && <Card className="p-4 text-[14px] text-[#ba1a1a] font-semibold">{error}</Card>}

      {sel && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-[18px] font-bold text-[#050a44]">{monthName(sel.month)}</h2>
            <select value={sel.month} onChange={(e) => setPick(e.target.value)} className="h-10 px-3 rounded-xl border border-[#e1e2e4] bg-white text-[14px] font-semibold text-[#050a44]">
              {list.map((r) => <option key={r.month} value={r.month}>{monthName(r.month)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { k: 'Collected from passengers', v: sel.collected, note: `${sel.bookings} booking${sel.bookings === 1 ? '' : 's'} · ${sel.seats} seat${sel.seats === 1 ? '' : 's'}`, tone: 'bg-[#f2f4f6] text-[#050a44]' },
              { k: 'Tickets (bus company)', v: sel.tickets, note: sel.refunds ? `${formatLKR(sel.refunds)} refunded from this` : 'fares, bikes, less discounts', tone: 'bg-[#dcfce7] text-[#166534]' },
              { k: 'Card fees (payment gateway)', v: sel.gateway_fees, note: 'kept by the gateway', tone: 'bg-[#dbeafe] text-[#1e40af]' },
              { k: 'Platform fees (to pay out)', v: sel.platform_fees, note: 'paid to the platform at month end', tone: 'bg-[#fff3cc] text-[#7c5800]' },
            ].map((t) => (
              <div key={t.k} className={`rounded-2xl p-4 ${t.tone}`}>
                <p className="text-[12px] font-semibold opacity-80">{t.k}</p>
                <p className="text-[22px] font-extrabold mt-1">{formatLKR(t.v)}</p>
                <p className="text-[12px] opacity-80 mt-0.5">{t.note}</p>
              </div>
            ))}
          </div>
          {sel.collected > 0 && (
            <div className="mt-4">
              <div className="h-3 rounded-full overflow-hidden flex bg-[#f2f4f6]" aria-hidden>
                <span className="bg-[#16a34a]" style={{ width: `${(sel.tickets / sel.collected) * 100}%` }} />
                <span className="bg-[#2563eb]" style={{ width: `${(sel.gateway_fees / sel.collected) * 100}%` }} />
                <span className="bg-[#feb700]" style={{ width: `${(sel.platform_fees / sel.collected) * 100}%` }} />
              </div>
              <p className="text-[12px] text-[#46464f] mt-2">Platform payout for {monthName(sel.month)}: <b className="text-[#050a44]">{formatLKR(sel.platform_fees)}</b>{sel.refunds ? `. Refunds come out of the ticket part; the fees aren't refunded.` : '.'}</p>
            </div>
          )}
        </Card>
      )}

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-[14px] min-w-[720px]">
          <thead>
            <tr className="text-left text-[12px] font-bold text-[#46464f] bg-[#f8f9fb]">
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3 text-right">Bookings</th>
              <th className="px-4 py-3 text-right">Tickets</th>
              <th className="px-4 py-3 text-right">Card fees</th>
              <th className="px-4 py-3 text-right">Platform fees</th>
              <th className="px-4 py-3 text-right">Refunded</th>
              <th className="px-4 py-3 text-right">Collected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edeef0]">
            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-[#46464f]">{isSupabaseConfigured && rows === null && !error ? 'Loading…' : 'No paid bookings yet.'}</td></tr>}
            {list.map((r) => (
              <tr key={r.month} className={r.month === sel?.month ? 'bg-[#fff8e1]' : ''}>
                <td className="px-4 py-3 font-semibold text-[#050a44]">{monthName(r.month)}</td>
                <td className="px-4 py-3 text-right">{r.bookings}</td>
                <td className="px-4 py-3 text-right">{formatLKR(r.tickets)}</td>
                <td className="px-4 py-3 text-right">{formatLKR(r.gateway_fees)}</td>
                <td className="px-4 py-3 text-right font-bold text-[#7c5800]">{formatLKR(r.platform_fees)}</td>
                <td className="px-4 py-3 text-right">{r.refunds ? formatLKR(r.refunds) : '–'}</td>
                <td className="px-4 py-3 text-right font-bold text-[#050a44]">{formatLKR(r.collected)}</td>
              </tr>
            ))}
            {list.length > 1 && (
              <tr className="bg-[#f8f9fb] font-bold">
                <td className="px-4 py-3">Last 12 months</td>
                <td />
                <td className="px-4 py-3 text-right">{formatLKR(total.tickets)}</td>
                <td className="px-4 py-3 text-right">{formatLKR(total.gateway)}</td>
                <td className="px-4 py-3 text-right text-[#7c5800]">{formatLKR(total.platform)}</td>
                <td />
                <td className="px-4 py-3 text-right">{formatLKR(total.collected)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
