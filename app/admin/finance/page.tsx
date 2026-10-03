'use client';
// Finance — profit & loss for a chosen period, bus and route. Ticket income
// comes straight from bookings (by travel date, minus refunds); other income
// (charters, parcels…) and expenses from the ERP tables; refunds from
// payouts; cash differences from Close the day. Occupancy and booking
// patterns are on the Analytics page.

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { CATEGORY_LABEL, RUNNING_COSTS, useErp, type Income, type IncomeCategory } from '@/lib/erp';
import { addDays, formatDateLabel, formatLKR, formatTime12, netRevenue, routeLabel, todayISO } from '@/lib/trips';
import { PAY_LABEL, bookingsIn, buckets, change, daysIn, groupSum, inRange, presetDates, previous, runsIn, toDate, type Range } from '@/lib/analytics';
import { Bars, CHART, Empty, Panel, RangeFilter, Stat } from '@/components/admin/charts';
import { usePayouts } from '@/lib/money';
import { useCashCounts } from '@/lib/extras';
import { AdminOnly, BarList } from '@/components/admin/AdminOnly';
import { Button, Card, Field, Modal, PageHeader, inputClass, useToast, stackTable } from '@/components/admin/ui';
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
  const { payouts } = usePayouts('all');
  const { counts } = useCashCounts();
  const { toast, Toast } = useToast();
  const [range, setRange] = useState<Range>({ ...presetDates('month'), busId: '', routeId: '' });
  const [addingIncome, setAddingIncome] = useState<Income | null>(null);

  const fig = useMemo(() => {
    const expenses = erp.data?.expenses ?? [];
    const incomes = erp.data?.income ?? [];
    // Everything for one period, with the bus / route filter. Ticket income is by travel date, after refunds.
    // Costs and other income belong to a bus (or to nobody), never to a route, so the route filter leaves them out.
    const period = (r: Range) => {
      const bks = bookingsIn(data, r);
      const tickets = bks.reduce((n, b) => n + netRevenue(b), 0);
      const exp = r.routeId ? [] : expenses.filter((e) => inRange(e.spentOn, r) && (!r.busId || e.busId === r.busId));
      const inc = r.routeId ? [] : incomes.filter((i) => inRange(i.receivedOn, r) && (!r.busId || i.busId === r.busId));
      const other = inc.reduce((n, i) => n + i.amount, 0);
      const costs = exp.reduce((n, e) => n + e.amount, 0);
      return { bks, exp, inc, tickets, other, costs, profit: tickets + other - costs };
    };
    const cur = period(range);
    // Changes compare the period so far with the same number of days before it.
    const cmp = period(toDate(range));
    const prev = period(previous(toDate(range)));

    const bk = buckets(range);
    const over = bk.map((x) => period({ ...range, from: x.from, to: x.to }));

    const byCat = groupSum(cur.exp, (e) => CATEGORY_LABEL[e.category], (e) => e.amount).map((x) => ({ label: x.label, value: x.value }));

    // per departure: ticket income vs that day's running costs for the bus
    const runs = runsIn(data, range).map((r) => {
      const running = expenses.filter((e) => e.busId === r.busId && e.spentOn === r.date && RUNNING_COSTS.includes(e.category)).reduce((n, e) => n + e.amount, 0);
      return { ...r, running, net: r.income - running };
    });

    // how the tickets were paid, and what is still owed
    const paid = cur.bks.filter((b) => b.paymentStatus === 'paid' && b.status !== 'cancelled');
    const byMethod = groupSum(paid, (b) => PAY_LABEL[b.paymentMethod ?? ''] ?? 'Other', (b) => b.total).map((x) => ({ label: x.label, value: x.value, hint: `${x.count} booking${x.count === 1 ? '' : 's'}` }));
    const owedList = cur.bks.filter((b) => b.paymentStatus === 'unpaid' && (b.status === 'held' || b.status === 'boarded'));
    const owed = groupSum(owedList, (b) => PAY_LABEL[b.paymentMethod ?? ''] ?? 'Other', (b) => b.total).map((x) => ({ label: x.label, value: x.value, hint: `${x.count} booking${x.count === 1 ? '' : 's'}` }));

    // refunds and resale payouts raised in the period
    const pay = payouts.filter((p) => p.status !== 'cancelled' && inRange(p.createdAt.slice(0, 10), range));
    const refundsPaid = pay.filter((p) => p.status === 'paid').reduce((n, p) => n + p.amount, 0);
    const refundsPending = pay.filter((p) => p.status === 'pending').reduce((n, p) => n + p.amount, 0);

    // cash that didn't match when a day or trip was closed
    const diffs = counts.filter((c) => inRange(c.date, range) && c.counted !== c.expected);
    const byPerson = groupSum(diffs, (c) => c.by ?? 'Staff', (c) => c.counted - c.expected);
    const short = diffs.filter((c) => c.counted < c.expected).reduce((n, c) => n + (c.expected - c.counted), 0);
    const overCash = diffs.filter((c) => c.counted > c.expected).reduce((n, c) => n + (c.counted - c.expected), 0);

    return { cur, cmp, prev, bk, over, byCat, runs, byMethod, owed, owedTotal: owedList.reduce((n, b) => n + b.total, 0), refundsPaid, refundsPending, refundCount: pay.length, diffs, byPerson, short, overCash };
  }, [range, data, erp.data, payouts, counts]);

  const income = fig.cur.tickets + fig.cur.other;
  const tripName = (r: { scheduleId: string; routeId: string; departure: string }) => `${formatTime12(r.departure)} ${routeLabel(data.routes.find((x) => x.id === r.routeId))}`;
  // newest first in the table; oldest first (left to right) in the chart, capped so the bars stay readable
  const chartRuns = fig.runs.slice(-40);

  return (
    <>
      <PageHeader
        title="Finance"
        description="Profit and loss from real bookings, other income and every expense."
        actions={
          <Button variant="secondary" onClick={() => setAddingIncome({ id: uuid(), receivedOn: todayISO(), category: 'charter', amount: 0, busId: data.buses[0]?.id, description: '' })}>
            <Plus className="w-4 h-4" /> Other income
          </Button>
        }
      />
      <RangeFilter value={range} onChange={setRange} />
      {range.routeId && (
        <p className="-mt-3 mb-5 text-[12px] text-[#6b6d78]">Showing ticket income for this route only. Expenses and other income aren&apos;t tied to a route, so they are left out while a route is selected.</p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Ticket income" value={formatLKR(fig.cur.tickets)} delta={change(fig.cmp.tickets, fig.prev.tickets)} note="by travel date, after refunds" />
        <Stat label="Other income" value={formatLKR(fig.cur.other)} delta={change(fig.cmp.other, fig.prev.other)} note="charters, parcels, ads" />
        <Stat label="Expenses" value={formatLKR(fig.cur.costs)} delta={change(fig.cmp.costs, fig.prev.costs)} goodWhenUp={false} />
        <Stat
          label={fig.cur.profit >= 0 ? 'Profit' : 'Loss'}
          value={formatLKR(fig.cur.profit)}
          tone={fig.cur.profit >= 0 ? 'good' : 'bad'}
          delta={change(fig.cmp.profit, fig.prev.profit)}
          note={income > 0 ? `${Math.round((fig.cur.profit / income) * 100)}% margin` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6 mb-6">
        <Panel title="Income, expenses and profit over time" hint={`Each shaded column is one ${fig.bk.length && fig.bk[0].from === fig.bk[0].to ? 'day' : daysIn(range) <= 120 ? 'week' : 'month'}. Profit is income minus expenses: green above the line, red (a loss) below it.`}>
          <Bars
            label="Income, expenses and profit over the chosen period"
            labels={fig.bk.map((x) => x.label)}
            titles={fig.bk.map((x) => x.title)}
            format={formatLKR}
            series={[
              { name: 'Income', color: CHART.income, values: fig.over.map((x) => x.tickets + x.other) },
              { name: 'Expenses', color: CHART.expenses, values: fig.over.map((x) => x.costs) },
              // Profit = income minus expenses for that day / week / month: green above the line, red below it.
              { name: 'Profit', color: CHART.profit, negativeColor: CHART.loss, negativeName: 'Loss', values: fig.over.map((x) => x.profit) },
            ]}
          />
        </Panel>
        <Panel title="Where the money went" hint="Expenses in the period, by category.">
          {fig.byCat.length ? <BarList rows={fig.byCat} format={formatLKR} /> : <Empty>No expenses in this period.</Empty>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="How tickets were paid" hint="Bookings in the period that are paid, by the way the money came in.">
          {fig.byMethod.length ? <BarList rows={fig.byMethod} format={formatLKR} /> : <Empty>No paid bookings in this period.</Empty>}
        </Panel>
        <Panel title={`Still owed to you: ${formatLKR(fig.owedTotal)}`} hint="Seats held or already on board that haven't been paid for yet.">
          {fig.owed.length ? <BarList rows={fig.owed} format={formatLKR} /> : <Empty>Nothing outstanding in this period.</Empty>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="Refunds and payouts" hint="Money owed back to passengers, raised in this period (refunds and resale payouts).">
          {fig.refundCount === 0 ? (
            <Empty>None in this period.</Empty>
          ) : (
            <BarList
              rows={[
                { label: 'Paid out', value: fig.refundsPaid },
                { label: 'Still to pay', value: fig.refundsPending },
              ]}
              format={formatLKR}
            />
          )}
        </Panel>
        <Panel title="Cash that didn't match" hint="Days and trips that were closed short or over, from Close the day.">
          {fig.diffs.length === 0 ? (
            <Empty>Every cash count in this period balanced.</Empty>
          ) : (
            <>
              <p className="text-[14px] mb-3">
                Short <b className="text-[#ba1a1a] tabular-nums">{formatLKR(fig.short)}</b> · Over <b className="text-[#9a5b00] tabular-nums">{formatLKR(fig.overCash)}</b> · {fig.diffs.length} count{fig.diffs.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-1.5 text-[13px]">
                {fig.byPerson.map((p) => (
                  <li key={p.label} className="flex justify-between gap-3">
                    <span className="font-semibold text-[#050a44]">{p.label} <span className="font-normal text-[#6b6d78]">· {p.count} time{p.count === 1 ? '' : 's'}</span></span>
                    <span className={`font-bold tabular-nums ${p.value < 0 ? 'text-[#ba1a1a]' : 'text-[#9a5b00]'}`}>{p.value < 0 ? '−' : '+'} {formatLKR(Math.abs(p.value))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <Card className="overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-[#edeef0]">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Profit per trip</h2>
          <p className="text-[12px] text-[#46464f]">Ticket income minus that day&apos;s fuel, tolls, parking and cleaning for the bus. Green made money; red lost money.</p>
        </div>
        {fig.runs.length === 0 ? (
          <p className="p-5 text-[14px] text-[#46464f]">No departures in this period yet.</p>
        ) : (
          <>
            <div className="p-5 border-b border-[#edeef0]">
              <Bars
                label="Profit for each trip in the period"
                height={150}
                labels={chartRuns.map((r) => formatDateLabel(r.date, false).replace(/^\w+,?\s*/, ''))}
                titles={chartRuns.map((r) => `${formatDateLabel(r.date, false)} · ${tripName(r)}`)}
                format={formatLKR}
                series={[
                  // one bar per trip, centred in its column: green when it made money, red when it lost
                  { name: 'Made money', color: CHART.profit, negativeColor: CHART.loss, negativeName: 'Lost money', values: chartRuns.map((r) => r.net) },
                ]}
              />
              {fig.runs.length > chartRuns.length && <p className="text-[12px] text-[#6b6d78] mt-2">The chart shows the latest {chartRuns.length} trips; the table has all {fig.runs.length}.</p>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] stack-table" ref={stackTable}>
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
                  {[...fig.runs].reverse().map((r) => (
                    <tr key={r.key}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-[#050a44]">{formatDateLabel(r.date, false)} · {tripName(r)}</p>
                        <p className="text-[12px] text-[#6b6d78]">{data.buses.find((b) => b.id === r.busId)?.regNo}</p>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{r.sold}/{r.capacity}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatLKR(r.income)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{r.running ? formatLKR(r.running) : <span className="text-[#6b6d78]">not logged</span>}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${r.net >= 0 ? 'text-[#006e1c]' : 'text-[#ba1a1a]'}`}>{formatLKR(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-[#edeef0]">
          <h2 className="text-[16px] font-semibold text-[#050a44]">Other income in this period</h2>
        </div>
        {fig.cur.inc.length === 0 ? (
          <p className="p-5 text-[14px] text-[#46464f]">None recorded. Add charters, parcel income or advertising here.</p>
        ) : (
          <ul className="divide-y divide-[#edeef0]">
            {fig.cur.inc.map((i) => (
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
