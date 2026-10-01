'use client';
// Finance — profit & loss. Ticket income comes straight from bookings (by
// travel date, minus refunds); other income (charters, parcels…) and expenses
// from the ERP tables.

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { CATEGORY_LABEL, monthKey, useErp, type Income, type IncomeCategory } from '@/lib/erp';
import { addDays, formatDateLabel, formatLKR, formatTime12, genId, listRuns, netRevenue, routeLabel, todayISO } from '@/lib/trips';
import { AdminOnly, BarList } from '@/components/admin/AdminOnly';
import { Button, Card, Field, Modal, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { uuid } from '@/lib/uuid';

const INCOME_LABEL: Record<IncomeCategory, string> = { charter: 'Charter / hire', parcel: 'Parcels', advertising: 'Advertising', other: 'Other' };

export default function FinancePage() {
  return (
    <AdminOnly>
      <Finance />
    </AdminOnly>
  );
}

function Finance() {
  const { data } = useStore();
  const erp = useErp({ admin: true });
  const { toast, Toast } = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [addingIncome, setAddingIncome] = useState<Income | null>(null);

  const real = data.bookings.filter((b) => !b.id.startsWith('avail-'));
  const fig = useMemo(() => {
    const inMonth = <T,>(list: T[], date: (x: T) => string, m = month) => list.filter((x) => monthKey(date(x)) === m);
    const calc = (m: string) => {
      const tickets = inMonth(real, (b) => b.date, m).reduce((n, b) => n + netRevenue(b), 0);
      const other = inMonth(erp.data?.income ?? [], (i) => i.receivedOn, m).reduce((n, i) => n + i.amount, 0);
      const costs = inMonth(erp.data?.expenses ?? [], (e) => e.spentOn, m).reduce((n, e) => n + e.amount, 0);
      return { tickets, other, costs, profit: tickets + other - costs };
    };
    const cur = calc(month);
    // last 6 months trend
    const months: string[] = [];
    const d = new Date(`${month}-01T00:00`);
    for (let i = 5; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    const trend = months.map((m) => ({ m, ...calc(m) }));
    const exp = inMonth(erp.data?.expenses ?? [], (e) => e.spentOn);
    const byCat = Object.entries(exp.reduce<Record<string, number>>((acc, e) => ((acc[e.category] = (acc[e.category] ?? 0) + e.amount), acc), {}))
      .map(([k, v]) => ({ label: CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL], value: v }))
      .sort((a, b) => b.value - a.value);
    // per departure: ticket income vs fuel/toll for that bus that day
    const runs = listRuns(data, `${month}-01`, 31).filter((r) => monthKey(r.date) === month && r.date <= todayISO());
    const perRun = runs.map((r) => {
      const income = real.filter((b) => b.scheduleId === r.schedule.id && b.date === r.date).reduce((n, b) => n + netRevenue(b), 0);
      const running = exp.filter((e) => e.busId === r.bus.id && e.spentOn === r.date && ['fuel', 'toll', 'parking', 'cleaning'].includes(e.category)).reduce((n, e) => n + e.amount, 0);
      return { r, income, running, net: income - running, seats: `${r.sold}/${r.capacity}` };
    });
    return { cur, trend, byCat, perRun };
  }, [month, real, erp.data, data]);

  const maxTrend = Math.max(1, ...fig.trend.flatMap((t) => [t.tickets + t.other, t.costs]));
  const monthIncome = (erp.data?.income ?? []).filter((i) => monthKey(i.receivedOn) === month);

  return (
    <>
      <PageHeader
        title="Finance"
        description="Profit and loss from real bookings, other income and every expense."
        actions={
          <>
            <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputClass} !w-auto`} />
            <Button variant="secondary" onClick={() => setAddingIncome({ id: uuid(), receivedOn: todayISO(), category: 'charter', amount: 0, busId: data.buses[0]?.id, description: '' })}>
              <Plus className="w-4 h-4" /> Other income
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { l: 'Ticket income', v: fig.cur.tickets, n: 'by travel date, after refunds' },
          { l: 'Other income', v: fig.cur.other, n: 'charters, parcels, ads' },
          { l: 'Expenses', v: fig.cur.costs, n: `${fig.byCat.length} categories` },
          { l: fig.cur.profit >= 0 ? 'Profit' : 'Loss', v: fig.cur.profit, n: fig.cur.tickets + fig.cur.other > 0 ? `${Math.round((fig.cur.profit / (fig.cur.tickets + fig.cur.other)) * 100)}% margin` : '—', strong: true },
        ].map((k) => (
          <Card key={k.l} className="p-5">
            <p className="text-[12px] font-bold text-[#46464f]">{k.l}</p>
            <p className={`text-[24px] font-semibold tabular-nums mt-1 ${k.strong ? (k.v >= 0 ? 'text-[#006e1c]' : 'text-[#ba1a1a]') : 'text-[#050a44]'}`}>{formatLKR(k.v)}</p>
            <p className="text-[12px] text-[#6b6d78] mt-1">{k.n}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6 mb-6">
        <Card className="p-5">
          <h2 className="text-[16px] font-semibold text-[#050a44] mb-4">Last 6 months</h2>
          <div className="flex items-end gap-3 h-48" role="img" aria-label="Income and expenses for the last six months">
            {fig.trend.map((t) => (
              <div key={t.m} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-full flex items-end justify-center gap-1 flex-1">
                  <div className="w-1/2 max-w-6 rounded-t bg-[#050a44]" style={{ height: `${((t.tickets + t.other) / maxTrend) * 100}%` }} title={`Income ${formatLKR(t.tickets + t.other)}`} />
                  <div className="w-1/2 max-w-6 rounded-t bg-[#feb700]" style={{ height: `${(t.costs / maxTrend) * 100}%` }} title={`Expenses ${formatLKR(t.costs)}`} />
                </div>
                <span className={`text-[11px] tabular-nums ${t.m === month ? 'font-bold text-[#050a44]' : 'text-[#6b6d78]'}`}>
                  {new Date(`${t.m}-01T00:00`).toLocaleDateString('en-GB', { month: 'short' })}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-[12px] text-[#46464f]">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#050a44]" /> Income</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#feb700]" /> Expenses</span>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[16px] font-semibold text-[#050a44] mb-4">Where the money went</h2>
          {fig.byCat.length ? <BarList rows={fig.byCat} format={formatLKR} /> : <p className="text-[14px] text-[#46464f]">No expenses this month.</p>}
        </Card>
      </div>

      <Card className="overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[#edeef0]">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Per departure</h2>
          <p className="text-[12px] text-[#46464f]">Ticket income minus that day&apos;s fuel, tolls, parking and cleaning for the bus.</p>
        </div>
        {fig.perRun.length === 0 ? (
          <p className="p-5 text-[14px] text-[#46464f]">No completed departures in this month yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Departure</th>
                  <th className="px-4 py-2.5">Seats</th>
                  <th className="px-4 py-2.5 text-right">Tickets</th>
                  <th className="px-4 py-2.5 text-right">Running costs</th>
                  <th className="px-4 py-2.5 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {fig.perRun.map(({ r, income, running, net, seats }) => (
                  <tr key={`${r.schedule.id}-${r.date}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#050a44]">{formatDateLabel(r.date, false)} · {formatTime12(r.schedule.departure)}</p>
                      <p className="text-[12px] text-[#6b6d78]">{routeLabel(r.route)} · {r.bus.regNo}</p>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{seats}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatLKR(income)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{running ? formatLKR(running) : <span className="text-[#6b6d78]">not logged</span>}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${net >= 0 ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>{formatLKR(net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-[#edeef0]">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Other income this month</h2>
        </div>
        {monthIncome.length === 0 ? (
          <p className="p-5 text-[14px] text-[#46464f]">None recorded. Add charters, parcel income or advertising here.</p>
        ) : (
          <ul className="divide-y divide-[#edeef0]">
            {monthIncome.map((i) => (
              <li key={i.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-[#050a44] truncate">{i.description || INCOME_LABEL[i.category]}</p>
                  <p className="text-[12px] text-[#6b6d78]">{INCOME_LABEL[i.category]} · {formatDateLabel(i.receivedOn, false)}</p>
                </div>
                <p className="font-semibold tabular-nums text-[#006e1c]">{formatLKR(i.amount)}</p>
                <Button size="sm" variant="ghost" aria-label="Delete income" onClick={async () => {
                  const r = await erp.income.remove(i.id);
                  toast(r.ok ? 'Deleted' : r.reason ?? 'Could not delete', r.ok ? 'ok' : 'error');
                }}>
                  <Trash2 className="w-4 h-4 text-[#ba1a1a]" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {addingIncome && (
        <IncomeForm
          income={addingIncome}
          buses={data.buses.map((b) => ({ id: b.id, label: `${b.name} · ${b.regNo}` }))}
          onClose={() => setAddingIncome(null)}
          onSave={async (i) => {
            const r = await erp.income.save(i);
            if (!r.ok) return toast(r.reason ?? 'Could not save', 'error');
            setAddingIncome(null);
            toast(`${formatLKR(i.amount)} income saved`);
          }}
        />
      )}
      <Toast />
    </>
  );
}

function IncomeForm({ income, buses, onClose, onSave }: { income: Income; buses: { id: string; label: string }[]; onClose: () => void; onSave: (i: Income) => void }) {
  const [i, setI] = useState(income);
  return (
    <Modal
      title="Other income"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!(i.amount > 0)} onClick={() => onSave(i)}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className={inputClass} value={i.category} onChange={(e) => setI({ ...i, category: e.target.value as IncomeCategory })}>
            {Object.entries(INCOME_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Date received">
          <input type="date" className={inputClass} value={i.receivedOn} max={addDays(todayISO(), 0)} onChange={(e) => setI({ ...i, receivedOn: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (LKR)">
          <input type="number" min={0} className={inputClass} value={i.amount || ''} onChange={(e) => setI({ ...i, amount: Number(e.target.value) })} />
        </Field>
        <Field label="Bus">
          <select className={inputClass} value={i.busId ?? ''} onChange={(e) => setI({ ...i, busId: e.target.value || null })}>
            <option value="">None</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Details">
        <input className={inputClass} value={i.description} onChange={(e) => setI({ ...i, description: e.target.value })} placeholder="e.g. Wedding hire, Kalmunai → Kandy" />
      </Field>
    </Modal>
  );
}
