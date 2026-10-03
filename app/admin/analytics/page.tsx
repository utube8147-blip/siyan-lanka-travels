'use client';
// Analytics — how full the buses run and how people book, for a chosen
// period, bus and route. Money (income, expenses, profit) is on Finance.
// Everything is worked out from bookings by TRAVEL date.

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { AdminOnly, BarList } from '@/components/admin/AdminOnly';
import { PageHeader } from '@/components/admin/ui';
import { Bars, CHART, Empty, HeatGrid, Panel, Pie, RangeFilter, Stat } from '@/components/admin/charts';
import { useErp } from '@/lib/erp';
import { CHANNEL_LABEL, LEAD_BANDS, WEEKDAY_SHORT, incomeSource, isPaidBooking, seatOrder, bookingsIn, buckets, change, fillPct, groupSum, inRange, leadDays, presetDates, previous, runsIn, toDate, weekdayIndex, type Range } from '@/lib/analytics';
import { bikeKind } from '@/lib/bikeConfig';
import { formatDateLabel, formatLKR, formatTime12, isLiveBooking, netRevenue, routeLabel } from '@/lib/trips';

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
  const [range, setRange] = useState<Range>({ ...presetDates('month'), busId: '', routeId: '' });

  const fig = useMemo(() => {
    const period = (r: Range) => {
      const bks = bookingsIn(data, r);
      const live = bks.filter(isLiveBooking);
      const runs = runsIn(data, r);
      const cancelled = bks.filter((b) => b.status === 'cancelled');
      const noShow = bks.filter((b) => b.status === 'no-show');
      return {
        bks, live, runs, cancelled, noShow,
        seats: live.reduce((n, b) => n + b.seats.length, 0),
        fill: fillPct(runs),
        cancelRate: bks.length ? Math.round((cancelled.length / bks.length) * 100) : 0,
      };
    };
    const cur = period(range);
    // Changes compare the period so far with the same number of days before it.
    const cmp = period(toDate(range));
    const prev = period(previous(toDate(range)));

    // seats sold over time
    const bk = buckets(range);
    const seatsOver = bk.map((x) => cur.live.filter((b) => inRange(b.date, x)).reduce((n, b) => n + b.seats.length, 0));
    const emptyOver = bk.map((x, i) => Math.max(0, cur.runs.filter((r) => inRange(r.date, x)).reduce((n, r) => n + r.capacity, 0) - seatsOver[i]));

    // how full, by weekday and direction
    const routes = data.routes.filter((r) => !range.routeId || r.id === range.routeId).filter((r) => cur.runs.some((x) => x.routeId === r.id));
    const cell = (routeId: string, wd: number) => cur.runs.filter((r) => r.routeId === routeId && weekdayIndex(r.date) === wd);

    // each trip, fullest and emptiest
    const ranked = [...cur.runs].filter((r) => r.capacity > 0).sort((a, b) => b.sold / b.capacity - a.sold / a.capacity);

    // booking habits
    const lead = LEAD_BANDS.map((band) => ({ label: band.label, value: cur.live.filter((b) => band.test(leadDays(b))).length })).filter((x) => x.value > 0);
    const byChannel = groupSum(cur.live, (b) => CHANNEL_LABEL[b.channel] ?? b.channel, (b) => b.seats.length).map((x) => ({ label: x.label, value: x.value, hint: `${x.count} booking${x.count === 1 ? '' : 's'}` }));
    const boardAt = groupSum(cur.live, (b) => b.from, (b) => b.seats.length).slice(0, 8).map((x) => ({ label: x.label, value: x.value }));
    const getOff = groupSum(cur.live, (b) => b.to, (b) => b.seats.length).slice(0, 8).map((x) => ({ label: x.label, value: x.value }));
    const gender = groupSum(cur.live.filter((b) => b.passenger.gender), (b) => (b.passenger.gender === 'Female' ? 'Women' : 'Men'), () => 1).map((x) => ({ label: x.label, value: x.value }));

    // lost seats
    const lostCancel = cur.cancelled.reduce((n, b) => n + (b.total - netRevenue(b)), 0); // refunded back
    const lostNoShowUnpaid = cur.noShow.filter((b) => b.paymentStatus !== 'paid').reduce((n, b) => n + b.total, 0);
    const noShowSeats = cur.noShow.reduce((n, b) => n + b.seats.length, 0);
    const busPay = cur.bks.filter((b) => b.paymentMethod === 'bus' || (b.status === 'no-show' && b.paymentStatus !== 'paid'));
    const busPayNoShow = cur.noShow.filter((b) => b.paymentStatus !== 'paid').length;

    // ---- income: where it came from and what it is made of (money actually received, by travel date)
    const roleById = new Map((erp.data?.accounts ?? []).map((a) => [a.id, a.role as string]));
    const paid = cur.bks.filter(isPaidBooking);
    const sched = new Map(data.schedules.map((s) => [s.id, s]));
    const otherIncome = range.routeId ? [] : (erp.data?.income ?? []).filter((i) => inRange(i.receivedOn, range) && (!range.busId || i.busId === range.busId));
    const OTHER: Record<string, string> = { charter: 'Charter / hire', parcel: 'Parcels', advertising: 'Advertising', other: 'Other income' };
    const bySource = [
      ...groupSum(paid, (b) => incomeSource(b, (id) => roleById.get(id)), (b) => b.total),
      ...groupSum(otherIncome, (i) => OTHER[i.category] ?? 'Other income', (i) => i.amount),
    ].sort((a, b) => b.value - a.value).map((x) => ({ label: x.label, value: x.value }));
    const byChannelMoney = groupSum(paid, (b) => CHANNEL_LABEL[b.channel] ?? b.channel, (b) => b.total).map((x) => ({ label: x.label, value: x.value }));
    const madeOf = [
      { label: 'Seat fares', value: paid.reduce((n, b) => n + Math.max(0, b.fare * b.seats.length - b.discount), 0) },
      { label: 'Booking fees', value: paid.reduce((n, b) => n + b.fee, 0) },
      { label: 'Bike fees', value: paid.reduce((n, b) => n + (b.bikeFee ?? 0), 0) },
    ];
    const byRoute = groupSum(paid, (b) => routeLabel(data.routes.find((r) => r.id === sched.get(b.scheduleId)?.routeId)), (b) => b.total).map((x) => ({ label: x.label, value: x.value }));
    const byBus = groupSum(paid, (b) => { const bus = data.buses.find((x) => x.id === sched.get(b.scheduleId)?.busId); return bus ? `${bus.name} · ${bus.regNo}` : 'Unknown bus'; }, (b) => b.total).map((x) => ({ label: x.label, value: x.value }));
    const paidTotal = paid.reduce((n, b) => n + b.total, 0);
    const paidSeats = paid.reduce((n, b) => n + b.seats.length, 0);
    const byWeekday = WEEKDAY_SHORT.map((d, i) => paid.filter((b) => weekdayIndex(b.date) === i).reduce((n, b) => n + b.total, 0));

    // new and returning passengers: has this phone number travelled with us before this booking?
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
      { label: 'First trip with us', value: withPhone.length - returning },
      { label: 'Travelled before', value: returning },
    ];

    // which seats sell
    const seatCount = new Map<string, number>();
    cur.live.forEach((b) => b.seats.forEach((s) => seatCount.set(s, (seatCount.get(s) ?? 0) + 1)));
    const topSeats = [...seatCount.entries()].sort((a, b) => b[1] - a[1] || seatOrder(a[0], b[0])).slice(0, 8).map(([label, value]) => ({ label: `Seat ${label}`, value }));

    // extras
    const bikeBookings = cur.live.filter((b) => b.bikes?.length);
    const bikes = groupSum(bikeBookings.flatMap((b) => b.bikes ?? []), (k) => bikeKind(k.kind).label, () => 1).map((x) => ({ label: x.label, value: x.value }));
    const bikeIncome = bikeBookings.reduce((n, b) => n + (b.bikeFee ?? 0), 0);
    const promo = cur.live.filter((b) => b.discount > 0);

    return { bySource, byChannelMoney, madeOf, byRoute, byBus, paidTotal, paidSeats, paidCount: paid.length, byWeekday, loyalty, topSeats, discountGiven: paid.reduce((n, b) => n + b.discount, 0), cur, cmp, prev, bk, seatsOver, emptyOver, routes, cell, ranked, lead, byChannel, boardAt, getOff, gender, lostCancel, lostNoShowUnpaid, noShowSeats, busPay, busPayNoShow, bikes, bikeIncome, bikeCount: bikeBookings.reduce((n, b) => n + (b.bikes?.length ?? 0), 0), promo, promoDiscount: promo.reduce((n, b) => n + b.discount, 0) };
  }, [range, data, erp.data]);

  const num = (n: number) => n.toLocaleString('en-LK');
  const tripName = (r: { routeId: string; departure: string; date: string }) => `${formatDateLabel(r.date, false)} · ${formatTime12(r.departure)} ${routeLabel(data.routes.find((x) => x.id === r.routeId))}`;

  return (
    <>
      <PageHeader title="Analytics" description="How full the buses run, when and how people book, and where seats are lost. Money is on the Finance page." />
      <RangeFilter value={range} onChange={setRange} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Stat label="Seats sold" value={num(fig.cur.seats)} delta={change(fig.cmp.seats, fig.prev.seats)} />
        <Stat label="Average fill" value={`${fig.cur.fill}%`} delta={change(fig.cmp.fill, fig.prev.fill)} note={`${fig.cur.runs.length} trip${fig.cur.runs.length === 1 ? '' : 's'} run`} />
        <Stat label="Bookings" value={num(fig.cur.live.length)} delta={change(fig.cmp.live.length, fig.prev.live.length)} />
        <Stat label="Cancelled" value={`${fig.cur.cancelRate}%`} delta={change(fig.cmp.cancelRate, fig.prev.cancelRate)} goodWhenUp={false} note={`${fig.cur.cancelled.length} booking${fig.cur.cancelled.length === 1 ? '' : 's'}`} />
        <Stat label="No-shows" value={num(fig.cur.noShow.length)} delta={change(fig.cmp.noShow.length, fig.prev.noShow.length)} goodWhenUp={false} note={`${fig.noShowSeats} seat${fig.noShowSeats === 1 ? '' : 's'}`} />
      </div>

      {/* ------------------------------------------------------------ income */}
      <h2 className="text-[18px] font-semibold text-[#050a44] mb-3">Income</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Money received" value={formatLKR(fig.paidTotal)} note={`${fig.paidCount} paid booking${fig.paidCount === 1 ? '' : 's'}`} />
        <Stat label="Average per seat" value={formatLKR(fig.paidSeats ? Math.round(fig.paidTotal / fig.paidSeats) : 0)} note="what one seat brings in" />
        <Stat label="Average per trip" value={formatLKR(fig.cur.runs.length ? Math.round(fig.paidTotal / fig.cur.runs.length) : 0)} note={`${fig.cur.runs.length} trip${fig.cur.runs.length === 1 ? '' : 's'} run so far`} />
        <Stat label="Best weekday" value={fig.paidTotal ? WEEKDAY_SHORT[fig.byWeekday.indexOf(Math.max(...fig.byWeekday))] : '–'} note={fig.paidTotal ? formatLKR(Math.max(...fig.byWeekday)) : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="Where the money came from" hint="Every kind of income: cash at the counter, cash the conductor collected on the bus, bank transfers, and other income such as charters and parcels.">
          <Pie label="Income by where the money came from" rows={fig.bySource} format={formatLKR} />
        </Panel>
        <Panel title="What ticket income is made of" hint={`Seat fares, booking fees and bike fees.${fig.discountGiven ? ` ${formatLKR(fig.discountGiven)} was given away in discounts.` : ''}`}>
          <Pie label="Ticket income split into fares, booking fees and bike fees" rows={fig.madeOf} format={formatLKR} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        <Panel title="Income by sales channel" hint="Online, counter or phone.">
          <Pie stack label="Income by sales channel" rows={fig.byChannelMoney} format={formatLKR} />
        </Panel>
        <Panel title="Income by direction" hint="Which way earns more.">
          <Pie stack label="Income by direction" rows={fig.byRoute} format={formatLKR} />
        </Panel>
        <Panel title="Income by bus" hint="Which bus earns more.">
          <Pie stack label="Income by bus" rows={fig.byBus} format={formatLKR} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6 mb-8">
        <Panel title="Income by weekday" hint="Money received for trips leaving on each day of the week.">
          {fig.paidTotal ? (
            <Bars label="Income by weekday" height={160} labels={WEEKDAY_SHORT} titles={['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']} format={formatLKR} series={[{ name: 'Income', color: CHART.income, values: fig.byWeekday }]} />
          ) : (
            <Empty>No income in this period.</Empty>
          )}
        </Panel>
        <Panel title="New and returning passengers" hint="Bookings by people who have travelled with you before (matched by phone number) and by first-timers.">
          <Pie label="Bookings by new and returning passengers" rows={fig.loyalty} format={(n) => `${num(n)} booking${n === 1 ? '' : 's'}`} total="Bookings" centerFormat={num} />
        </Panel>
      </div>

      {/* ------------------------------------------------- buses and bookings */}
      <h2 className="text-[18px] font-semibold text-[#050a44] mb-3">Buses and bookings</h2>
      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-6 mb-6">
        <Panel title="Seats sold and seats left empty" hint="By travel date. Empty seats are on trips that have already run or run today.">
          {fig.cur.runs.length === 0 && fig.cur.seats === 0 ? (
            <Empty>No trips in this period.</Empty>
          ) : (
            <Bars
              label="Seats sold and seats left empty over the chosen period"
              labels={fig.bk.map((x) => x.label)}
              titles={fig.bk.map((x) => x.title)}
              format={(n) => `${num(n)} seats`}
              series={[
                { name: 'Sold', color: CHART.income, values: fig.seatsOver },
                { name: 'Left empty', color: CHART.muted, values: fig.emptyOver },
              ]}
            />
          )}
        </Panel>
        <Panel title="How full, by weekday" hint="Average share of seats sold on each weekday, for each direction. Darker is fuller.">
          {fig.routes.length === 0 ? (
            <Empty>No trips in this period.</Empty>
          ) : (
            <HeatGrid
              label="How full the bus is by weekday and direction"
              rows={fig.routes.map((r) => routeLabel(r))}
              cols={WEEKDAY_SHORT}
              value={(r, c) => {
                const runs = fig.cell(fig.routes[r].id, c);
                return runs.length ? fillPct(runs) : null;
              }}
              note={(r, c) => `${fig.cell(fig.routes[r].id, c).length} trips`}
            />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="Fullest trips" hint="The departures that sold the largest share of their seats. The bar is how full the bus was, out of 100%.">
          {fig.ranked.length === 0 ? <Empty>No trips in this period.</Empty> : (
            <BarList rows={fig.ranked.slice(0, 6).map((r) => ({ label: tripName(r), value: Math.round((r.sold / r.capacity) * 100), hint: `${r.sold}/${r.capacity} seats` }))} format={(n) => `${n}% full`} max={100} />
          )}
        </Panel>
        <Panel title="Emptiest trips" hint="The departures with the most unsold seats: candidates for a promotion, or for not running. The bar is how full the bus was, out of 100%.">
          {fig.ranked.length === 0 ? <Empty>No trips in this period.</Empty> : (
            <BarList rows={[...fig.ranked].reverse().slice(0, 6).map((r) => ({ label: tripName(r), value: Math.round((r.sold / r.capacity) * 100), hint: `${r.capacity - r.sold} seats empty` }))} format={(n) => `${n}% full`} max={100} />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="How early people book" hint="Bookings by how many days before departure they were made. The longest bar is the most common.">
          {fig.lead.length ? <BarList rows={fig.lead} format={(n) => `${num(n)} booking${n === 1 ? '' : 's'}`} /> : <Empty>No bookings in this period.</Empty>}
        </Panel>
        <Panel title="Where seats are sold" hint="Seats by how the booking was made. The longest bar sold the most.">
          {fig.byChannel.length ? <BarList rows={fig.byChannel} format={(n) => `${num(n)} seats`} /> : <Empty>No bookings in this period.</Empty>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="Where passengers get on" hint="Seats by boarding stop. The longest bar is the busiest stop.">
          {fig.boardAt.length ? <BarList rows={fig.boardAt} format={(n) => `${num(n)} seats`} /> : <Empty>No bookings in this period.</Empty>}
        </Panel>
        <Panel title="Where passengers get off" hint="Seats by drop-off stop. The longest bar is the busiest stop.">
          {fig.getOff.length ? <BarList rows={fig.getOff} format={(n) => `${num(n)} seats`} /> : <Empty>No bookings in this period.</Empty>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title="Seats people choose most" hint="The seats that were booked most often. Useful when deciding which seats to reserve or price.">
          {fig.topSeats.length ? <BarList rows={fig.topSeats} format={(n) => `${num(n)} time${n === 1 ? '' : 's'}`} /> : <Empty>No bookings in this period.</Empty>}
        </Panel>
        <Panel title="Passengers" hint="Bookings by men and women.">
          <Pie label="Bookings by men and women" rows={fig.gender} format={(n) => `${num(n)} booking${n === 1 ? '' : 's'}`} total="Bookings" centerFormat={num} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="Seats that were lost" hint="Cancellations and passengers who didn't turn up.">
          <ul className="space-y-2 text-[13px]">
            <li className="flex justify-between gap-3"><span>Cancelled bookings</span><b className="tabular-nums text-[#050a44]">{fig.cur.cancelled.length}</b></li>
            <li className="flex justify-between gap-3"><span>Refunded to passengers</span><b className="tabular-nums text-[#050a44]">{formatLKR(fig.lostCancel)}</b></li>
            <li className="flex justify-between gap-3"><span>No-show bookings</span><b className="tabular-nums text-[#050a44]">{fig.cur.noShow.length}</b></li>
            <li className="flex justify-between gap-3"><span>No-shows who never paid</span><b className="tabular-nums text-[#ba1a1a]">{fig.busPayNoShow} · {formatLKR(fig.lostNoShowUnpaid)}</b></li>
          </ul>
          <p className="text-[12px] text-[#6b6d78] mt-3">A no-show who never paid held a seat for nothing. If this number grows, consider switching off &ldquo;Pay on the bus&rdquo; in Settings.</p>
        </Panel>
        <Panel title="Bikes carried" hint={`${fig.bikeCount} in the period · ${formatLKR(fig.bikeIncome)} in bike fees`}>
          {fig.bikes.length ? <BarList rows={fig.bikes} format={(n) => num(n)} /> : <Empty>No bikes in this period.</Empty>}
        </Panel>
        <Panel title="Promo code" hint="How often it was used and what it gave away.">
          <p className="text-[13px]">
            Promo code used on <b className="text-[#050a44]">{fig.promo.length}</b> booking{fig.promo.length === 1 ? '' : 's'} · <b className="text-[#050a44] tabular-nums">{formatLKR(fig.promoDiscount)}</b> discount given
          </p>
        </Panel>
      </div>
    </>
  );
}
