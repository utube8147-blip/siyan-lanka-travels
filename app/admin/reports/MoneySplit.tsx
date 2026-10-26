'use client';
// Staff area → Reports → Where the money goes: per month, what passengers paid
// and how it splits — the tickets (the bus company's), the card fees (kept by
// the payment gateway) and the platform fees (paid out to the platform at the
// end of the month). Counted on the day the money came in; test bookings left out.

import { useEffect, useMemo, useState } from 'react';
import { Card, PageHeader, inputClass } from '@/components/admin/ui';
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
      <PageHeader title="Where the money goes" description="Each month: what passengers paid, the platform payout, the payment gateway's cut and what the bus company keeps. Counted on the day the money came in; test bookings left out." />
      {error && <Card className="p-4 text-[14px] text-[#ba1a1a] font-semibold">{error}</Card>}

      {sel && (() => {
        const each = sel.bookings && sel.platform_fees % sel.bookings === 0 ? sel.platform_fees / sel.bookings : null;
        const pct = (v: number) => (sel.collected ? `${Math.round((v / sel.collected) * 100)}%` : '');
        const lines: { sign: string; k: string; v: number; dot: string; note?: string; strong?: boolean }[] = [
          { sign: '', k: 'Collected from passengers', v: sel.collected, dot: 'bg-[#64748b]', note: `${sel.bookings} booking${sel.bookings === 1 ? '' : 's'} · ${sel.seats} seat${sel.seats === 1 ? '' : 's'}` },
          { sign: '−', k: 'Card fees (kept by the payment gateway)', v: sel.gateway_fees, dot: 'bg-[#3b82f6]', note: pct(sel.gateway_fees) },
          { sign: '−', k: 'Platform fees (your payout)', v: sel.platform_fees, dot: 'bg-[#f59e0b]', note: pct(sel.platform_fees) },
          { sign: '=', k: 'Tickets (bus company)', v: sel.tickets, dot: 'bg-[#22c55e]', note: pct(sel.tickets), strong: true },
          ...(sel.refunds ? [
            { sign: '−', k: 'Refunds paid back to passengers', v: sel.refunds, dot: 'bg-[#ef4444]' },
            { sign: '=', k: 'Bus company keeps', v: sel.tickets - sel.refunds, dot: 'bg-[#22c55e]', strong: true },
          ] : []),
        ];
        return (
          <Card className="p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <h2 className="text-[18px] font-bold text-[#050a44]">{monthName(sel.month)}</h2>
              <select value={sel.month} onChange={(e) => setPick(e.target.value)} aria-label="Month" className={`${inputClass} !w-auto`}>
                {list.map((r) => <option key={r.month} value={r.month}>{monthName(r.month)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5">
              {/* The payout: what the platform is owed for the month */}
              <div className="rounded-2xl border border-[#f59e0b]/40 bg-[#f59e0b]/10 p-5 lg:self-start">
                <p className="text-[13px] font-semibold text-[#46464f]">Platform payout for {monthName(sel.month)}</p>
                <p className="text-[34px] leading-tight font-extrabold text-[#050a44] mt-1 tabular-nums">{formatLKR(sel.platform_fees)}</p>
                <p className="text-[13px] text-[#46464f] mt-2">
                  {each != null
                    ? <>The platform fee on {sel.bookings} paid booking{sel.bookings === 1 ? '' : 's'}: <b className="text-[#050a44]">{sel.bookings} × {formatLKR(each)}</b>.</>
                    : <>The platform fee on {sel.bookings} paid bookings (the fee changed during the month).</>}
                </p>
                <p className="text-[12px] text-[#46464f] mt-4 pt-3 border-t border-[#f59e0b]/30">Paid to the platform at the end of the month. Each booking pays the fee set in Settings when it was made; it isn&apos;t refunded if the trip is cancelled.</p>
              </div>
              {/* How the month's money splits */}
              <div>
                <p className="text-[13px] font-semibold text-[#46464f] mb-2">How it splits</p>
                <ul className="divide-y divide-[#edeef0] rounded-2xl border border-[#e1e2e4]">
                  {lines.map((l) => (
                    <li key={l.k} className={`flex items-center gap-3 px-4 py-3 ${l.strong ? 'font-bold' : ''}`}>
                      <span className="w-4 text-center text-[#46464f] font-bold">{l.sign}</span>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${l.dot}`} aria-hidden />
                      <span className="flex-1 min-w-0 text-[14px] text-[#050a44]">{l.k}{l.note && <span className="block text-[12px] font-normal text-[#46464f]">{l.note}</span>}</span>
                      <span className="text-[15px] tabular-nums text-[#050a44]">{formatLKR(l.v)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        );
      })()}

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-[14px] min-w-[720px]">
          <thead>
            <tr className="text-left text-[12px] font-bold text-[#46464f] bg-[#f8f9fb]">
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3 text-right">Bookings</th>
              <th className="px-4 py-3 text-right">Tickets</th>
              <th className="px-4 py-3 text-right">Card fees</th>
              <th className="px-4 py-3 text-right">Platform payout</th>
              <th className="px-4 py-3 text-right">Refunded</th>
              <th className="px-4 py-3 text-right">Collected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edeef0]">
            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-[#46464f]">{isSupabaseConfigured && rows === null && !error ? 'Loading…' : 'No paid bookings yet.'}</td></tr>}
            {list.map((r) => (
              <tr key={r.month} onClick={() => setPick(r.month)} className={`cursor-pointer ${r.month === sel?.month ? 'bg-[#f59e0b]/10' : 'hover:bg-[#f8f9fb]'}`}>
                <td className="px-4 py-3 font-semibold text-[#050a44]">{monthName(r.month)}</td>
                <td className="px-4 py-3 text-right">{r.bookings}</td>
                <td className="px-4 py-3 text-right">{formatLKR(r.tickets)}</td>
                <td className="px-4 py-3 text-right">{formatLKR(r.gateway_fees)}</td>
                <td className="px-4 py-3 text-right font-bold text-[#050a44]">{formatLKR(r.platform_fees)}</td>
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
                <td className="px-4 py-3 text-right">{formatLKR(total.platform)}</td>
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
