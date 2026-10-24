'use client';
// Analytics — one filter bar (period, bus, route) and six tabs:
//   Overview · Income · Expenses · Buses & seats · Passengers · Fleet & fuel
// Everything is worked out in the browser from data the staff area already
// loads: bookings (by TRAVEL date), expenses, other income and the timetable.
// The day-to-day profit and loss statement is on the Finance page.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { AdminOnly, BarList } from '@/components/admin/AdminOnly';
import { Card, PageHeader, stackTable } from '@/components/admin/ui';
import { Bars, CHART, Empty, HeatGrid, Lines, Panel, Pie, RangeFilter, Stat, Tabs } from '@/components/admin/charts';
import { CATEGORY_LABEL, RUNNING_COSTS, useErp } from '@/lib/erp';
import {
  CHANNEL_LABEL, LEAD_BANDS, WEEKDAY_SHORT, bookingsIn, buckets, change, daysIn, fillPct, fleetFigures, groupSum, inRange, incomeSource,
  isPaidBooking, leadDays, presetDates, previous, routeKm, runsIn, seatOrder, toDate, weekdayIndex, type Range,
} from '@/lib/analytics';
import { bikeKind } from '@/lib/bikeConfig';
import { allReadings, dailyDistance, useOdometer } from '@/lib/odometer';
import { formatDateLabel, formatLKR, formatTime12, isLiveBooking, netRevenue, routeLabel, todayISO } from '@/lib/trips';
import { tx, N_, txn, txr } from '@/lib/i18n';

type Tab = 'overview' | 'income' | 'expenses' | 'buses' | 'passengers' | 'fleet';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: N_('Overview') },
  { id: 'income', label: N_('Income') },
  { id: 'expenses', label: N_('Expenses') },
  { id: 'buses', label: N_('Buses & seats') },
  { id: 'passengers', label: N_('Passengers') },
  { id: 'fleet', label: N_('Fleet & fuel') },
];
const OTHER_INCOME: Record<string, string> = { charter: N_('Charter / hire'), parcel: N_('Parcels'), advertising: N_('Advertising'), other: N_('Other income') };
const PAID_BY: Record<string, string> = { cash: N_('Cash'), bank: N_('Bank'), card: N_('Card'), cheque: N_('Cheque'), other: N_('Other') };

export default function AnalyticsPage() {
  return (
    <AdminOnly>
      <Analytics />
    </AdminOnly>
  );
}

function Analytics() {
  const { data } = useStore();
  const erp = useErp({ admin: true });
  const odo = useOdometer();
  const [range, setRange] = useState<Range>({ ...presetDates('month'), busId: '', routeId: '' });
  // The open tab lives in the address (#expenses), so a reload or a shared link opens the same one.
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as Tab;
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash);
  }, []);
  const openTab = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, '', `#${t}`);
  };

  const fig = useMemo(() => {
    const expensesAll = erp.data?.expenses ?? [];
    const incomeAll = erp.data?.income ?? [];
    const sched = new Map(data.schedules.map((s) => [s.id, s]));
    const busName = (id?: string | null) => {
      const b = data.buses.find((x) => x.id === id);
      return b ? `${b.name} · ${b.regNo}` : tx('Not tied to a bus');
    };
    // Costs and other income belong to a bus (or nobody), never to a route: a route filter leaves them out.
    const expensesOf = (r: Range) => (r.routeId ? [] : expensesAll.filter((e) => inRange(e.spentOn, r) && (!r.busId || e.busId === r.busId)));
    const otherOf = (r: Range) => (r.routeId ? [] : incomeAll.filter((i) => inRange(i.receivedOn, r) && (!r.busId || i.busId === r.busId)));

    const period = (r: Range) => {
      const bks = bookingsIn(data, r);
      const live = bks.filter(isLiveBooking);
      const runs = runsIn(data, r);
      const cancelled = bks.filter((b) => b.status === 'cancelled');
      const noShow = bks.filter((b) => b.status === 'no-show');
      const exp = expensesOf(r);
      const other = otherOf(r);
      const tickets = bks.reduce((n, b) => n + netRevenue(b), 0);
      const otherTotal = other.reduce((n, i) => n + i.amount, 0);
      const costs = exp.reduce((n, e) => n + e.amount, 0);
      return {
        bks, live, runs, cancelled, noShow, exp, other, tickets, otherTotal, costs,
        income: tickets + otherTotal,
        profit: tickets + otherTotal - costs,
        seats: live.reduce((n, b) => n + b.seats.length, 0),
        fill: fillPct(runs),
        cancelRate: bks.length ? Math.round((cancelled.length / bks.length) * 100) : 0,
      };
    };
    const cur = period(range);
    // Changes compare the period so far with the same number of days before it.
    const cmp = period(toDate(range));
    const prev = period(previous(toDate(range)));

    // ---- over time
    const bk = buckets(range);
    const over = bk.map((x) => period({ ...range, from: x.from, to: x.to }));
    const routeLen = new Map(data.routes.map((r) => [r.id, routeKm(r)]));
    const kmOver = over.map((x) => x.runs.reduce((n, r) => n + (routeLen.get(r.routeId) ?? 0), 0));
    const fillOver = over.map((x) => x.fill);

    // ---- income
    const roleById = new Map((erp.data?.accounts ?? []).map((a) => [a.id, a.role as string]));
    const paid = cur.bks.filter(isPaidBooking);
    const bySource = [
      ...groupSum(paid, (b) => incomeSource(b, (id) => roleById.get(id)), (b) => b.total),
      ...groupSum(cur.other, (i) => tx(OTHER_INCOME[i.category]) ?? tx('Other income'), (i) => i.amount),
    ].sort((a, b) => b.value - a.value).map((x) => ({ label: x.label, value: x.value }));
    const byChannelMoney = groupSum(paid, (b) => tx(CHANNEL_LABEL[b.channel]) ?? b.channel, (b) => b.total).map((x) => ({ label: x.label, value: x.value }));
    const madeOf = [
      { label: tx('Seat fares'), value: paid.reduce((n, b) => n + Math.max(0, b.fare * b.seats.length - b.discount), 0) },
      { label: tx('Booking fees'), value: paid.reduce((n, b) => n + b.fee, 0) },
      { label: tx('Bike fees'), value: paid.reduce((n, b) => n + (b.bikeFee ?? 0), 0) },
    ];
    const byRoute = groupSum(paid, (b) => routeLabel(data.routes.find((r) => r.id === sched.get(b.scheduleId)?.routeId)), (b) => b.total).map((x) => ({ label: x.label, value: x.value }));
    const byBusIncome = groupSum(paid, (b) => busName(sched.get(b.scheduleId)?.busId), (b) => b.total).map((x) => ({ label: x.label, value: x.value }));
    const paidTotal = paid.reduce((n, b) => n + b.total, 0);
    const paidSeats = paid.reduce((n, b) => n + b.seats.length, 0);
    const byWeekday = WEEKDAY_SHORT.map((_, i) => paid.filter((b) => weekdayIndex(b.date) === i).reduce((n, b) => n + b.total, 0));

    // ---- expenses
    const byCat = groupSum(cur.exp, (e) => tx(CATEGORY_LABEL[e.category]), (e) => e.amount).map((x) => ({ label: x.label, value: x.value, hint: txn(x.count, '{n} entry', '{n} entries') }));
    const runningTotal = cur.exp.filter((e) => RUNNING_COSTS.includes(e.category)).reduce((n, e) => n + e.amount, 0);
    const byBusCost = groupSum(cur.exp, (e) => busName(e.busId), (e) => e.amount).map((x) => ({ label: x.label, value: x.value }));
    const byPaidBy = groupSum(cur.exp, (e) => tx(PAID_BY[e.paymentMethod]) ?? tx('Other'), (e) => e.amount).map((x) => ({ label: x.label, value: x.value }));
    const byVendor = groupSum(cur.exp.filter((e) => e.vendor?.trim()), (e) => e.vendor.trim(), (e) => e.amount).slice(0, 6).map((x) => ({ label: x.label, value: x.value, hint: txn(x.count, '{n} time', '{n} times') }));
    const biggest = [...cur.exp].sort((a, b) => b.amount - a.amount).slice(0, 8);
    // the three largest categories as lines over time, so a jump in one of them is visible
    const topCats = groupSum(cur.exp, (e) => e.category, (e) => e.amount).slice(0, 3).map((x) => x.label);
    const catOver = topCats.map((c) => over.map((x) => x.exp.filter((e) => e.category === c).reduce((n, e) => n + e.amount, 0)));

    // ---- buses & seats
    const seatsOver = bk.map((x) => cur.live.filter((b) => inRange(b.date, x)).reduce((n, b) => n + b.seats.length, 0));
    const emptyOver = bk.map((x, i) => Math.max(0, cur.runs.filter((r) => inRange(r.date, x)).reduce((n, r) => n + r.capacity, 0) - seatsOver[i]));
    const routes = data.routes.filter((r) => !range.routeId || r.id === range.routeId).filter((r) => cur.runs.some((x) => x.routeId === r.id));
    const cell = (routeId: string, wd: number) => cur.runs.filter((r) => r.routeId === routeId && weekdayIndex(r.date) === wd);
    const ranked = [...cur.runs].filter((r) => r.capacity > 0).sort((a, b) => b.sold / b.capacity - a.sold / a.capacity);
    const seatCount = new Map<string, number>();
    cur.live.forEach((b) => b.seats.forEach((s) => seatCount.set(s, (seatCount.get(s) ?? 0) + 1)));
    const topSeats = [...seatCount.entries()].sort((a, b) => b[1] - a[1] || seatOrder(a[0], b[0])).slice(0, 8).map(([label, value]) => ({ label: tx('Seat {label}', { label }), value }));

    // ---- passengers
    const lead = LEAD_BANDS.map((band) => ({ label: tx(band.label), value: cur.live.filter((b) => band.test(leadDays(b))).length })).filter((x) => x.value > 0);
    const byChannel = groupSum(cur.live, (b) => tx(CHANNEL_LABEL[b.channel]) ?? b.channel, (b) => b.seats.length).map((x) => ({ label: x.label, value: x.value, hint: txn(x.count, '{n} booking', '{n} bookings') }));
    const boardAt = groupSum(cur.live, (b) => b.from, (b) => b.seats.length).slice(0, 8).map((x) => ({ label: x.label, value: x.value }));
    const getOff = groupSum(cur.live, (b) => b.to, (b) => b.seats.length).slice(0, 8).map((x) => ({ label: x.label, value: x.value }));
    const gender = groupSum(cur.live.filter((b) => b.passenger.gender), (b) => (b.passenger.gender === 'Female' ? tx('Women') : tx('Men')), () => 1).map((x) => ({ label: x.label, value: x.value }));
    const phoneOf = (b: { contact: { phone: string }; passenger: { phone: string } }) => (b.contact.phone || b.passenger.phone || '').replace(/\D/g, '').replace(/^94/, '0');
    const firstTrip = new Map<string, string>();
    for (const b of data.bookings) {
      if (b.id.startsWith('avail-') || b.status === 'cancelled') continue;
      const ph = phoneOf(b);
      if (ph && (!firstTrip.has(ph) || b.date < firstTrip.get(ph)!)) firstTrip.set(ph, b.date);
    }
    const withPhone = cur.live.filter((b) => phoneOf(b));
    const returning = withPhone.filter((b) => firstTrip.get(phoneOf(b))! < b.date).length;
    const loyalty = [
      { label: tx('First trip with us'), value: withPhone.length - returning },
      { label: tx('Travelled before'), value: returning },
    ];
    const lostCancel = cur.cancelled.reduce((n, b) => n + (b.total - netRevenue(b)), 0);
    const unpaidNoShow = cur.noShow.filter((b) => b.paymentStatus !== 'paid');
    const bikeBookings = cur.live.filter((b) => b.bikes?.length);
    const bikes = groupSum(bikeBookings.flatMap((b) => b.bikes ?? []), (k) => bikeKind(k.kind).label, () => 1).map((x) => ({ label: x.label, value: x.value }));
    const promo = cur.live.filter((b) => b.discount > 0);

    // ---- fleet & fuel
    // Real distance comes from the odometer: the daily readings (Staff area → Odometer) plus the ones
    // entered with fuel or a service. Where a bus has no readings, the timetable estimate is used.
    const readings = allReadings(odo.logs, expensesAll);
    const withLogs = [...expensesAll, ...odo.logs.map((l) => ({ id: l.id, spentOn: l.date, category: 'odometer', amount: 0, busId: l.busId, odometerKm: l.km }))];
    const fleet = fleetFigures(data, withLogs, range, RUNNING_COSTS).map((f) => ({ ...f, name: busName(f.busId), km: f.kmLogged ?? f.kmPlanned }));
    const km = fleet.reduce((n, f) => n + f.km, 0);
    const kmEstimated = fleet.reduce((n, f) => n + f.kmPlanned, 0);
    const kmFromOdometer = fleet.some((f) => f.kmLogged != null);
    const perDay = data.buses.filter((b) => !range.busId || b.id === range.busId).map((b) => dailyDistance(readings, b.id));
    const kmLoggedOver = bk.map((x) => perDay.reduce((n, m) => n + [...m.entries()].filter(([d]) => inRange(d, x)).reduce((a, [, v]) => a + v, 0), 0));
    const litres = fleet.reduce((n, f) => n + f.litres, 0);
    const fuelCost = fleet.reduce((n, f) => n + f.fuelCost, 0);
    const pinsMissing = data.routes.some((r) => routeKm(r) === 0);

    return {
      cur, cmp, prev, bk, over, kmOver, fillOver,
      bySource, byChannelMoney, madeOf, byRoute, byBusIncome, paidTotal, paidSeats, paidCount: paid.length, byWeekday, discountGiven: paid.reduce((n, b) => n + b.discount, 0),
      byCat, runningTotal, byBusCost, byPaidBy, byVendor, biggest, topCats, catOver,
      seatsOver, emptyOver, routes, cell, ranked, topSeats,
      lead, byChannel, boardAt, getOff, gender, loyalty, lostCancel, unpaidNoShow, noShowSeats: cur.noShow.reduce((n, b) => n + b.seats.length, 0),
      bikes, bikeCount: bikeBookings.reduce((n, b) => n + (b.bikes?.length ?? 0), 0), bikeIncome: bikeBookings.reduce((n, b) => n + (b.bikeFee ?? 0), 0), promo, promoDiscount: promo.reduce((n, b) => n + b.discount, 0),
      fleet, km, kmEstimated, kmFromOdometer, kmLoggedOver, litres, fuelCost, pinsMissing, busName, runIncome: fleet.reduce((n, f) => n + f.income, 0),
    };
  }, [range, data, erp.data, odo.logs]);

  const num = (n: number) => n.toLocaleString('en-LK');
  const unit = fig.bk.length && fig.bk[0].from === fig.bk[0].to ? 'day' : daysIn(range) <= 120 ? 'week' : 'month';
  const unitWord = unit === 'day' ? tx('day') : unit === 'week' ? tx('week') : tx('month');
  const labels = fig.bk.map((x) => x.label);
  // Columns compare amounts; lines are kept for trends (how full the buses ran, kilometres driven).
  // Line charts stop at today: days still to come are shaded, not drawn as zero.
  const drawTo = fig.bk.filter((x) => x.from <= todayISO()).length;
  const titles = fig.bk.map((x) => x.title);
  const tripName = (r: { routeId: string; departure: string; date: string }) => `${formatDateLabel(r.date, false)} · ${formatTime12(r.departure)} ${routeLabel(data.routes.find((x) => x.id === r.routeId))}`;
  const perKm = (amount: number, km: number) => (km > 0 ? tx('LKR {toFixed}', { toFixed: (amount / km).toFixed(1) }) : '–');
  const routeNote = range.routeId ? tx(' Expenses aren\'t tied to a route, so they are left out while a route is selected.') : '';

  return (
    <>
      <PageHeader title={tx('Analytics')} description={tx('How the business is doing, section by section. Pick a period, a bus or a route, then a tab.')} />
      <RangeFilter value={range} onChange={setRange} />
      <Tabs tabs={TABS} value={tab} onChange={openTab} />

      {/* ============================================================ OVERVIEW */}
      {tab === 'overview' && (
        <div role="tabpanel">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <Stat label={tx('Income')} value={formatLKR(fig.cur.income)} delta={change(fig.cmp.income, fig.prev.income)} />
            <Stat label={tx('Expenses')} value={formatLKR(fig.cur.costs)} delta={change(fig.cmp.costs, fig.prev.costs)} goodWhenUp={false} />
            <Stat label={fig.cur.profit >= 0 ? tx('Profit') : tx('Loss')} value={formatLKR(fig.cur.profit)} tone={fig.cur.profit >= 0 ? 'good' : 'bad'} delta={change(fig.cmp.profit, fig.prev.profit)} />
            <Stat label={tx('Seats sold')} value={num(fig.cur.seats)} delta={change(fig.cmp.seats, fig.prev.seats)} />
            <Stat label={tx('Average fill')} value={`${fig.cur.fill}%`} delta={change(fig.cmp.fill, fig.prev.fill)} />
            <Stat label={tx('Distance driven')} value={`${num(fig.km)} km`} note={txn(fig.cur.runs.length, '{n} trip', '{n} trips')} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <Panel title={tx('Income, expenses and profit')} hint={tx('Each shaded column is one {unit}. Profit is income minus expenses: green above the line, red (a loss) below it.{routeNote}', { unit: unitWord, routeNote })}>
              <Bars
                label={tx('Income, expenses and profit over the chosen period')}
                labels={labels}
                titles={titles}
                format={formatLKR}
                series={[
                  { name: tx('Income'), color: CHART.income, values: fig.over.map((x) => x.income) },
                  { name: tx('Expenses'), color: CHART.expenses, values: fig.over.map((x) => x.costs) },
                  { name: tx('Profit'), color: CHART.profit, negativeColor: CHART.loss, negativeName: tx('Loss'), values: fig.over.map((x) => x.profit) },
                ]}
              />
            </Panel>
            <Panel title={tx('How full the buses ran')} hint={tx('Share of seats sold on the trips of each {unit}.', { unit: unitWord })}>
              {fig.cur.runs.length === 0 ? <Empty>{tx('No trips in this period.')}</Empty> : (
                <Lines drawTo={drawTo} label={tx('Share of seats sold over the chosen period')} labels={labels} titles={titles} format={(n) => `${n}%`} series={[{ name: tx('Seats sold'), color: CHART.income, values: fig.fillOver }]} />
              )}
            </Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Panel title={tx('Where the money came from')} hint={tx('Every kind of income.')}>
              <Pie stack label={tx('Income by where the money came from')} rows={fig.bySource} format={formatLKR} />
            </Panel>
            <Panel title={tx('Where the money went')} hint={tx('Expenses by category.')}>
              <Pie stack label={tx('Expenses by category')} rows={fig.byCat} format={formatLKR} />
            </Panel>
            <Panel title={tx('At a glance')} hint={tx('The headline facts for this period.')}>
              <ul className="space-y-2.5 text-[13px]">
                <li className="flex justify-between gap-3"><span>{tx('Best weekday for income')}</span><b className="text-[#050a44]">{fig.paidTotal ? `${tx(WEEKDAY_SHORT[fig.byWeekday.indexOf(Math.max(...fig.byWeekday))])} · ${formatLKR(Math.max(...fig.byWeekday))}` : '–'}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Average income per trip')}</span><b className="text-[#050a44] tabular-nums">{formatLKR(fig.cur.runs.length ? Math.round(fig.cur.income / fig.cur.runs.length) : 0)}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Average income per seat')}</span><b className="text-[#050a44] tabular-nums">{formatLKR(fig.paidSeats ? Math.round(fig.paidTotal / fig.paidSeats) : 0)}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Cost per km')}</span><b className="text-[#050a44] tabular-nums">{perKm(fig.cur.costs, fig.km)}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Fullest trip')}</span><b className="text-[#050a44] text-right">{fig.ranked[0] ? `${Math.round((fig.ranked[0].sold / fig.ranked[0].capacity) * 100)}% · ${formatDateLabel(fig.ranked[0].date, false)}` : '–'}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Emptiest trip')}</span><b className="text-[#050a44] text-right">{fig.ranked.length ? `${Math.round((fig.ranked[fig.ranked.length - 1].sold / fig.ranked[fig.ranked.length - 1].capacity) * 100)}% · ${formatDateLabel(fig.ranked[fig.ranked.length - 1].date, false)}` : '–'}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Cancelled bookings')}</span><b className="text-[#050a44]">{fig.cur.cancelled.length} ({fig.cur.cancelRate}%)</b></li>
                <li className="flex justify-between gap-3"><span>{tx('No-shows')}</span><b className="text-[#050a44]">{fig.cur.noShow.length}</b></li>
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {/* ============================================================== INCOME */}
      {tab === 'income' && (
        <div role="tabpanel">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label={tx('Money received')} value={formatLKR(fig.paidTotal + fig.cur.otherTotal)} note={txn(fig.paidCount, '{n} paid booking', '{n} paid bookings')} />
            <Stat label={tx('Average per seat')} value={formatLKR(fig.paidSeats ? Math.round(fig.paidTotal / fig.paidSeats) : 0)} note={tx('what one seat brings in')} />
            <Stat label={tx('Average per trip')} value={formatLKR(fig.cur.runs.length ? Math.round(fig.paidTotal / fig.cur.runs.length) : 0)} note={txn(fig.cur.runs.length, '{n} trip run so far', '{n} trips run so far')} />
            <Stat label={tx('Income per km')} value={perKm(fig.runIncome, fig.km)} note={tx('{km} km driven so far', { km: num(fig.km) })} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6 mb-6">
            <Panel title={tx('Income over time')} hint={tx('Ticket income (by travel date, after refunds) and other income, per {unit}.', { unit: unitWord })}>
              <Bars
                label={tx('Income over the chosen period')}
                labels={labels}
                titles={titles}
                format={formatLKR}
                series={[
                  { name: tx('Tickets'), color: CHART.income, values: fig.over.map((x) => x.tickets) },
                  { name: tx('Other income'), color: CHART.expenses, values: fig.over.map((x) => x.otherTotal) },
                ]}
              />
            </Panel>
            <Panel title={tx('Income by weekday')} hint={tx('Money received for trips leaving on each day of the week.')}>
              {fig.paidTotal ? (
                <Bars label={tx('Income by weekday')} height={170} labels={WEEKDAY_SHORT} titles={[tx('Mondays'), tx('Tuesdays'), tx('Wednesdays'), tx('Thursdays'), tx('Fridays'), tx('Saturdays'), tx('Sundays')]} format={formatLKR} series={[{ name: tx('Income'), color: CHART.income, values: fig.byWeekday }]} />
              ) : <Empty>{tx('No income in this period.')}</Empty>}
            </Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <Panel title={tx('Where the money came from')} hint={tx('Cash at the counter, cash the conductor collected on the bus, bank transfers, and other income such as charters and parcels.')}>
              <Pie label={tx('Income by where the money came from')} rows={fig.bySource} format={formatLKR} />
            </Panel>
            <Panel title={tx('What ticket income is made of')} hint={(fig.discountGiven ? tx('Seat fares, booking fees and bike fees. {amount} was given away in discounts.', { amount: formatLKR(fig.discountGiven) }) : tx('Seat fares, booking fees and bike fees.'))}>
              <Pie label={tx('Ticket income split into fares, booking fees and bike fees')} rows={fig.madeOf} format={formatLKR} />
            </Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Panel title={tx('By sales channel')} hint={tx('Online, counter or phone.')}><Pie stack label={tx('Income by sales channel')} rows={fig.byChannelMoney} format={formatLKR} /></Panel>
            <Panel title={tx('By direction')} hint={tx('Which way earns more.')}><Pie stack label={tx('Income by direction')} rows={fig.byRoute} format={formatLKR} /></Panel>
            <Panel title={tx('By bus')} hint={tx('Which bus earns more.')}><Pie stack label={tx('Income by bus')} rows={fig.byBusIncome} format={formatLKR} /></Panel>
          </div>
        </div>
      )}

      {/* ============================================================ EXPENSES */}
      {tab === 'expenses' && (
        <div role="tabpanel">
          {range.routeId && <p className="-mt-2 mb-5 text-[13px] font-semibold text-[#9a5b00]">{tx('Expenses aren\'t tied to a route. Choose “Both directions” to see them.')}</p>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label={tx('Total spent')} value={formatLKR(fig.cur.costs)} delta={change(fig.cmp.costs, fig.prev.costs)} goodWhenUp={false} note={txn(fig.cur.exp.length, '{n} entry', '{n} entries')} />
            <Stat label={tx('Running costs')} value={formatLKR(fig.runningTotal)} note={tx('fuel, tolls, parking, cleaning')} />
            <Stat label={tx('Other costs')} value={formatLKR(fig.cur.costs - fig.runningTotal)} note={tx('salaries, repairs, insurance…')} />
            <Stat label={tx('Cost per km')} value={perKm(fig.cur.costs, fig.km)} note={tx('{runningTotal} running only', { runningTotal: perKm(fig.runningTotal, fig.km) })} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.3fr] gap-6 mb-6">
            <Panel title={tx('Expense breakdown')} hint={tx('What each category cost, and its share of the total.')}>
              <Pie
                showZero
                label={tx('Expenses by category')}
                rows={(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((c) => ({ label: tx(CATEGORY_LABEL[c]), value: fig.byCat.find((x) => x.label === tx(CATEGORY_LABEL[c]))?.value ?? 0 })).sort((a, b) => b.value - a.value)}
                format={formatLKR}
              />
            </Panel>
            <Panel title={tx('Spending over time')} hint={tx('What the largest categories cost in each {unit}. Hover a column for the figures.', { unit: unitWord })}>
              {fig.cur.exp.length === 0 ? <Empty>{tx('No expenses in this period.')}</Empty> : (
                <Bars
                  label={tx('Expenses over the chosen period')}
                  labels={labels}
                  titles={titles}
                  format={formatLKR}
                  series={[
                    ...fig.topCats.map((c, i) => ({ name: tx(CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]) ?? c, color: [CHART.expenses, CHART.income, '#a855f7'][i], values: fig.catOver[i] })),
                  ]}
                />
              )}
            </Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            <Panel title={tx('By bus')} hint={tx('Which bus the money was spent on.')}><Pie stack label={tx('Expenses by bus')} rows={fig.byBusCost} format={formatLKR} /></Panel>
            <Panel title={tx('How it was paid')} hint={tx('Cash, bank, card or cheque.')}><Pie stack label={tx('Expenses by payment method')} rows={fig.byPaidBy} format={formatLKR} /></Panel>
            <Panel title={tx('Who you paid most')} hint={tx('Suppliers named on expense entries.')}>
              {fig.byVendor.length ? <BarList rows={fig.byVendor} format={formatLKR} /> : <Empty>{tx('No supplier names on this period\'s entries.')}</Empty>}
            </Panel>
          </div>
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[#edeef0]">
              <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Largest expenses')}</h2>
              <p className="text-[12px] text-[#6b6d78]">{tx('The biggest single entries in this period.')}</p>
            </div>
            {fig.biggest.length === 0 ? <p className="p-5 text-[14px] text-[#46464f]">{tx('No expenses in this period.')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] stack-table" ref={stackTable}>
                  <thead>
                    <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                      <th className="px-4 py-2.5">{tx('Date')}</th><th className="px-4 py-2.5">{tx('Category')}</th><th className="px-4 py-2.5">{tx('What')}</th><th className="px-4 py-2.5">{tx('Bus')}</th><th className="px-4 py-2.5 text-right">{tx('Amount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edeef0]">
                    {fig.biggest.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDateLabel(e.spentOn, false)}</td>
                        <td className="px-4 py-2.5 font-semibold text-[#050a44]">{tx(CATEGORY_LABEL[e.category])}</td>
                        <td className="px-4 py-2.5">{e.description || e.vendor || '—'}</td>
                        <td className="px-4 py-2.5">{e.busId ? fig.busName(e.busId) : '—'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#050a44]">{formatLKR(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ======================================================= BUSES & SEATS */}
      {tab === 'buses' && (
        <div role="tabpanel">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label={tx('Trips run')} value={num(fig.cur.runs.length)} delta={change(fig.cmp.runs.length, fig.prev.runs.length)} />
            <Stat label={tx('Seats sold')} value={num(fig.cur.seats)} delta={change(fig.cmp.seats, fig.prev.seats)} />
            <Stat label={tx('Average fill')} value={`${fig.cur.fill}%`} delta={change(fig.cmp.fill, fig.prev.fill)} />
            <Stat label={tx('Seats left empty')} value={num(fig.emptyOver.reduce((n, x) => n + x, 0))} note={tx('on trips already run')} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6 mb-6">
            <Panel title={tx('Seats sold and seats left empty')} hint={tx('By travel date. Empty seats are on trips that have already run or run today.')}>
              {fig.cur.runs.length === 0 && fig.cur.seats === 0 ? <Empty>{tx('No trips in this period.')}</Empty> : (
                <Bars label={tx('Seats sold and seats left empty over the chosen period')} labels={labels} titles={titles} format={(n) => tx('{n} seats', { n: num(n) })} series={[{ name: tx('Sold'), color: CHART.income, values: fig.seatsOver }, { name: tx('Left empty'), color: CHART.muted, values: fig.emptyOver }]} />
              )}
            </Panel>
            <Panel title={tx('How full, by weekday')} hint={tx('Average share of seats sold on each weekday, for each direction. Darker is fuller.')}>
              {fig.routes.length === 0 ? <Empty>{tx('No trips in this period.')}</Empty> : (
                <HeatGrid
                  label={tx('How full the bus is by weekday and direction')}
                  rows={fig.routes.map((r) => routeLabel(r))}
                  cols={WEEKDAY_SHORT}
                  value={(r, c) => { const runs = fig.cell(fig.routes[r].id, c); return runs.length ? fillPct(runs) : null; }}
                  note={(r, c) => tx('{length} trips', { length: fig.cell(fig.routes[r].id, c).length })}
                />
              )}
            </Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Panel title={tx('Fullest trips')} hint={tx('The bar is how full the bus was, out of 100%.')}>
              {fig.ranked.length === 0 ? <Empty>{tx('No trips in this period.')}</Empty> : <BarList rows={fig.ranked.slice(0, 6).map((r) => ({ label: tripName(r), value: Math.round((r.sold / r.capacity) * 100), hint: tx('{sold}/{capacity} seats', { sold: r.sold, capacity: r.capacity }) }))} format={(n) => tx('{n}% full', { n })} max={100} />}
            </Panel>
            <Panel title={tx('Emptiest trips')} hint={tx('Candidates for a promotion, or for not running.')}>
              {fig.ranked.length === 0 ? <Empty>{tx('No trips in this period.')}</Empty> : <BarList rows={[...fig.ranked].reverse().slice(0, 6).map((r) => ({ label: tripName(r), value: Math.round((r.sold / r.capacity) * 100), hint: tx('{v} seats empty', { v: r.capacity - r.sold }) }))} format={(n) => tx('{n}% full', { n })} max={100} />}
            </Panel>
            <Panel title={tx('Seats people choose most')} hint={tx('Useful when deciding which seats to reserve.')}>
              {fig.topSeats.length ? <BarList rows={fig.topSeats} format={(n) => txn(n, '{n} time', '{n} times', { n: num(n) })} /> : <Empty>{tx('No bookings in this period.')}</Empty>}
            </Panel>
          </div>
        </div>
      )}

      {/* ========================================================== PASSENGERS */}
      {tab === 'passengers' && (
        <div role="tabpanel">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat label={tx('Bookings')} value={num(fig.cur.live.length)} delta={change(fig.cmp.live.length, fig.prev.live.length)} />
            <Stat label={tx('Seats per booking')} value={fig.cur.live.length ? (fig.cur.seats / fig.cur.live.length).toFixed(1) : '–'} note={tx('how many travel together')} />
            <Stat label={tx('Cancelled')} value={`${fig.cur.cancelRate}%`} delta={change(fig.cmp.cancelRate, fig.prev.cancelRate)} goodWhenUp={false} note={txn(fig.cur.cancelled.length, '{n} booking', '{n} bookings')} />
            <Stat label={tx('No-shows')} value={num(fig.cur.noShow.length)} delta={change(fig.cmp.noShow.length, fig.prev.noShow.length)} goodWhenUp={false} note={txn(fig.noShowSeats, '{n} seat', '{n} seats')} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            <Panel title={tx('New and returning')} hint={tx('Matched by phone number.')}><Pie stack label={tx('Bookings by new and returning passengers')} rows={fig.loyalty} format={(n) => txn(n, '{n} booking', '{n} bookings', { n: num(n) })} total={tx("Bookings")} centerFormat={num} /></Panel>
            <Panel title={tx('Men and women')} hint={tx('Bookings by the passenger\'s gender.')}><Pie stack label={tx('Bookings by men and women')} rows={fig.gender} format={(n) => txn(n, '{n} booking', '{n} bookings', { n: num(n) })} total={tx("Bookings")} centerFormat={num} /></Panel>
            <Panel title={tx('How they book')} hint={tx('Seats by how the booking was made.')}><Pie stack label={tx('Seats by sales channel')} rows={fig.byChannel} format={(n) => tx('{n} seats', { n: num(n) })} total={tx("Seats")} centerFormat={num} /></Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            <Panel title={tx('How early people book')} hint={tx('The longest bar is the most common.')}>
              {fig.lead.length ? <BarList rows={fig.lead} format={(n) => txn(n, '{n} booking', '{n} bookings', { n: num(n) })} /> : <Empty>{tx('No bookings in this period.')}</Empty>}
            </Panel>
            <Panel title={tx('Where they get on')} hint={tx('Seats by boarding stop.')}>
              {fig.boardAt.length ? <BarList rows={fig.boardAt} format={(n) => tx('{n} seats', { n: num(n) })} /> : <Empty>{tx('No bookings in this period.')}</Empty>}
            </Panel>
            <Panel title={tx('Where they get off')} hint={tx('Seats by drop-off stop.')}>
              {fig.getOff.length ? <BarList rows={fig.getOff} format={(n) => tx('{n} seats', { n: num(n) })} /> : <Empty>{tx('No bookings in this period.')}</Empty>}
            </Panel>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Panel title={tx('Seats that were lost')} hint={tx('Cancellations and passengers who didn\'t turn up.')}>
              <ul className="space-y-2 text-[13px]">
                <li className="flex justify-between gap-3"><span>{tx('Cancelled bookings')}</span><b className="tabular-nums text-[#050a44]">{fig.cur.cancelled.length}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('Refunded to passengers')}</span><b className="tabular-nums text-[#050a44]">{formatLKR(fig.lostCancel)}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('No-show bookings')}</span><b className="tabular-nums text-[#050a44]">{fig.cur.noShow.length}</b></li>
                <li className="flex justify-between gap-3"><span>{tx('No-shows who never paid')}</span><b className="tabular-nums text-[#ba1a1a]">{fig.unpaidNoShow.length} · {formatLKR(fig.unpaidNoShow.reduce((n, b) => n + b.total, 0))}</b></li>
              </ul>
              <p className="text-[12px] text-[#6b6d78] mt-3">{tx('A no-show who never paid held a seat for nothing. If this grows, consider switching off “Pay on the bus” in Settings.')}</p>
            </Panel>
            <Panel title={tx('Bikes carried')} hint={tx('{bikeCount} in the period · {amount} in bike fees', { bikeCount: fig.bikeCount, amount: formatLKR(fig.bikeIncome) })}>
              {fig.bikes.length ? <BarList rows={fig.bikes} format={(n) => num(n)} /> : <Empty>{tx('No bikes in this period.')}</Empty>}
            </Panel>
            <Panel title={tx('Promo code')} hint={tx('How often it was used and what it gave away.')}>
              <p className="text-[13px]">{txr(fig.promo.length === 1 ? 'Used on <b>{n}</b> booking · <b>{amount}</b> discount given' : 'Used on <b>{n}</b> bookings · <b>{amount}</b> discount given', { n: fig.promo.length, amount: formatLKR(fig.promoDiscount), b: (c) => <b className="text-[#050a44] tabular-nums">{c}</b> })}</p>
            </Panel>
          </div>
        </div>
      )}

      {/* ======================================================== FLEET & FUEL */}
      {tab === 'fleet' && (
        <div role="tabpanel">
          {fig.pinsMissing && (
            <p className="-mt-2 mb-5 text-[13px] font-semibold text-[#9a5b00]">{tx('Some stops have no map pin, so the distance for those routes shows as 0. Add the pins in Routes & timetable → Edit route & map (search the place or click the map).')}</p>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <Stat label={tx('Distance driven')} value={`${num(fig.km)} km`} note={fig.kmFromOdometer ? tx('from odometer readings · timetable says {kmEstimated} km', { kmEstimated: num(fig.kmEstimated) }) : tx('estimate: trips run × route length')} />
            <Stat label={tx('Per day')} value={`${num(Math.round(fig.km / Math.max(1, daysIn(toDate(range)))))} km`} note={tx('average over the period so far')} />
            <Stat label={tx('Fuel bought')} value={`${num(Math.round(fig.litres))} L`} note={formatLKR(fig.fuelCost)} />
            <Stat label={tx('Fuel cost per km')} value={perKm(fig.fuelCost, fig.km)} />
            <Stat label={tx('Running cost per km')} value={perKm(fig.runningTotal, fig.km)} note={tx('fuel, tolls, parking, cleaning')} />
            <Stat label={tx('Income per km')} value={perKm(fig.runIncome, fig.km)} note={tx('tickets on trips already run')} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <Panel
              title={tx('Kilometres driven')}
              hint={
                fig.kmFromOdometer
                  ? tx('From the odometer readings logged each {v}, with the timetable estimate for comparison.', { v: unit === 'day' ? tx('day') : unit === 'week' ? tx('week') : tx('month') })
                  : tx('No odometer readings in this period, so this is an estimate: the trips of each {unit} × the route\'s length. Log readings under Odometer for the real distance.', { unit: unitWord })
              }
            >
              {fig.km === 0 && fig.kmEstimated === 0 ? <Empty>{tx('No distance to show for this period.')}</Empty> : (
                <Lines
                  drawTo={drawTo}
                  label={tx('Kilometres driven over the chosen period')}
                  labels={labels}
                  titles={titles}
                  format={(n) => tx('{n} km', { n: num(n) })}
                  series={fig.kmFromOdometer ? [{ name: tx('From the odometer'), color: CHART.income, values: fig.kmLoggedOver }, { name: tx('Timetable estimate'), color: CHART.muted, values: fig.kmOver }] : [{ name: tx('Timetable estimate'), color: CHART.income, values: fig.kmOver }]}
                />
              )}
            </Panel>
            <Panel title={tx('Fuel spending')} hint={tx('What was spent on fuel per {unit}.', { unit: unitWord })}>
              {fig.fuelCost === 0 ? <Empty>{tx('No fuel logged in this period. Add fuel under Expenses & fuel, with litres and the odometer reading.')}</Empty> : (
                <Bars label={tx('Fuel spending over the chosen period')} labels={labels} titles={titles} format={formatLKR} series={[{ name: tx('Fuel'), color: CHART.expenses, values: fig.over.map((x) => x.exp.filter((e) => e.category === 'fuel').reduce((n, e) => n + e.amount, 0)) }]} />
              )}
            </Panel>
          </div>
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-[#edeef0]">
              <h2 className="text-[16px] font-semibold text-[#050a44]">{tx('Each bus')}</h2>
              <p className="text-[12px] text-[#6b6d78]">{tx('Usage and mileage for the period. “By timetable” is an estimate from the trips run. “By odometer” is the real distance, from the daily readings (Staff area → Odometer) and the readings entered with fuel. Costs per km use the odometer distance when there is one. Mileage needs at least two fuel entries with litres and a reading.')}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] stack-table" ref={stackTable}>
                <thead>
                  <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                    <th className="px-4 py-2.5">{tx('Bus')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('Trips')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('By timetable')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('By odometer')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('Fuel')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('Mileage')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('Cost per km')}</th>
                    <th className="px-4 py-2.5 text-right">{tx('Income per km')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edeef0]">
                  {fig.fleet.map((f) => (
                    <tr key={f.busId}>
                      <td className="px-4 py-3 font-semibold text-[#050a44]">{f.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{num(f.trips)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{tx('{kmPlanned} km', { kmPlanned: num(f.kmPlanned) })}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {f.kmLogged != null ? <>{tx('{kmLogged} km', { kmLogged: num(f.kmLogged) })}<span className="block text-[11px] text-[#6b6d78]">{num(f.odoStart!)} → {num(f.odoEnd!)}</span></> : f.odoEnd ? <>{num(f.odoEnd)}<span className="block text-[11px] text-[#6b6d78]">{tx('one reading')}</span></> : <span className="text-[#6b6d78]">{tx('not logged')}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{f.litres ? <>{num(Math.round(f.litres))} L<span className="block text-[11px] text-[#6b6d78]">{formatLKR(f.fuelCost)}</span></> : <span className="text-[#6b6d78]">—</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#050a44]">{f.kmPerLitre ? tx('{kmPerLitre} km/L', { kmPerLitre: f.kmPerLitre.toFixed(1) }) : <span className="font-normal text-[#6b6d78]">{tx('needs 2 fill-ups')}</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{perKm(f.allCost, f.km)}<span className="block text-[11px] text-[#6b6d78]">{tx('{runningCost} running', { runningCost: perKm(f.runningCost, f.km) })}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums">{perKm(f.income, f.km)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
