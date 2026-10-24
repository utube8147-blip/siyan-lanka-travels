'use client';
// app/admin/page.tsx — Today: what needs doing (big cards, a number each,
// one tap to the place it is done), today's buses, and (owner) the money.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { addDays, formatDateLabel, formatLKR, formatTime12, listRuns, netRevenue, routeLabel, todayISO } from '@/lib/trips';
import { Badge, Button, Card, Modal, PageHeader, useToast } from '@/components/admin/ui';
import { useAuth } from '@/contexts/AuthContext';
import { DOCUMENT_LABEL, daysUntil, latestOdometer, nextService, useErp } from '@/lib/erp';
import { AlertTriangle, Banknote, CheckCircle2, FileCheck2, HandCoins, Plus, Store, TriangleAlert, Wrench } from 'lucide-react';
import { slipOnFile, usePayouts, useSlips } from '@/lib/money';
import { useCashUnclosed } from '@/lib/extras';
import { isLive, useRoadReports } from '@/lib/conductor';
import { tx, txn } from '@/lib/i18n';

export default function AdminOverview() {
  const { data, resetDemo, mode } = useStore();
  const { toast, Toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const erp = useErp({ admin: isAdmin });
  const alerts = useMemo(() => {
    if (!isAdmin || !erp.data) return [];
    const out: { text: string; href: string; bad: boolean }[] = [];
    for (const d of erp.data.documents) {
      const n = daysUntil(d.expiresOn);
      const bus = data.buses.find((b) => b.id === d.busId)?.regNo ?? '';
      if (n < 0) out.push({ text: `${tx(DOCUMENT_LABEL[d.kind])} for ${bus} expired ${-n} days ago`, href: '/admin/buses?tab=health', bad: true });
      else if (n <= 30) out.push({ text: `${tx(DOCUMENT_LABEL[d.kind])} for ${bus} expires in ${n} days`, href: '/admin/buses?tab=health', bad: n <= 7 });
    }
    for (const b of data.buses) {
      const svc = nextService(erp.data.expenses, b.id);
      const odo = latestOdometer(erp.data.expenses, b.id);
      if (svc?.nextDueKm && odo && svc.nextDueKm - odo < 1500)
        out.push({ text: svc.nextDueKm - odo <= 0 ? `${b.regNo} service is overdue` : `${b.regNo} service due in ${(svc.nextDueKm - odo).toLocaleString()} km`, href: '/admin/buses?tab=health', bad: svc.nextDueKm - odo <= 0 });
    }
    for (const c of erp.data.crew) {
      if (c.role !== 'driver' || !c.licenseExpires || !c.active) continue;
      const n = daysUntil(c.licenseExpires);
      if (n <= 30) out.push({ text: n < 0 ? `${c.fullName}'s driving licence has expired` : `${c.fullName}'s driving licence expires in ${n} days`, href: '/admin/people?tab=crew', bad: n < 0 });
    }
    return out.sort((a, b) => Number(b.bad) - Number(a.bad));
  }, [isAdmin, erp.data, data.buses]);
  const slipFor = useSlips();
  const { payouts } = usePayouts('all');
  const unclosed = useCashUnclosed('today');
  const { reports } = useRoadReports();
  const todo = [
    { n: data.bookings.filter((b) => b.status === 'held' && slipOnFile(slipFor(b))).length, label: 'Bank slips to check', href: '/admin/trips?tab=bookings', Icon: FileCheck2, tone: 'bg-[#dbeafe] text-[#1e40af]' },
    { n: data.bookings.filter((b) => b.status === 'held' && b.channel === 'online' && b.paymentMethod === 'counter').length, label: 'Coming to pay at the counter', href: '/admin/trips?tab=bookings', Icon: Store, tone: 'bg-[#fef3c7] text-[#92400e]' },
    { n: payouts.filter((p) => p.status === 'pending').length, label: 'Money to pay back', href: '/admin/money?tab=payback', Icon: HandCoins, tone: 'bg-[#ede9fe] text-[#5b21b6]' },
    { n: unclosed.length, label: 'Cash not counted yet', href: '/admin/money?tab=cash', Icon: Banknote, tone: 'bg-[#dcfce7] text-[#166534]' },
    { n: reports.filter((r) => isLive(r)).length, label: 'Road reports now', href: '/admin/trips?tab=road', Icon: TriangleAlert, tone: 'bg-[#fee2e2] text-[#991b1b]' },
    ...(isAdmin ? [{ n: alerts.length, label: 'Bus papers & service', href: '/admin/buses?tab=health', Icon: Wrench, tone: 'bg-[#ffedd5] text-[#9a3412]' }] : []),
  ].filter((t) => t.n > 0);
  const [confirmReset, setConfirmReset] = useState(false);
  const today = todayISO();
  const now = new Date();

  const upcoming = useMemo(() => listRuns(data, today, 14).filter((r) => r.departsAt.getTime() > now.getTime() - 3 * 3600_000), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const past30 = useMemo(() => listRuns(data, addDays(today, -30), 30), [data, today]);

  const monthPrefix = today.slice(0, 7);
  const monthBookings = data.bookings.filter((b) => b.date.startsWith(monthPrefix));
  const monthRevenue = monthBookings.reduce((n, b) => n + netRevenue(b), 0);
  const bookedToday = data.bookings.filter((b) => b.createdAt.slice(0, 10) === today && b.status !== 'cancelled');
  const seats30 = past30.reduce((n, r) => n + r.sold, 0);
  const cap30 = past30.reduce((n, r) => n + r.capacity, 0);
  const occupancy = cap30 ? Math.round((seats30 / cap30) * 100) : 0;
  const recent = [...data.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  const scheduleRoute = (scheduleId: string) => {
    const s = data.schedules.find((x) => x.id === scheduleId);
    return routeLabel(data.routes.find((r) => r.id === s?.routeId));
  };

  const stats = [
    { label: tx('Revenue this month'), value: formatLKR(monthRevenue), note: txn(monthBookings.filter((b) => b.status !== 'cancelled').length, '{n} booking travelling this month', '{n} bookings travelling this month') },
    { label: tx('Booked today'), value: String(bookedToday.reduce((n, b) => n + b.seats.length, 0)), note: txn(bookedToday.length, 'seats across {n} booking', 'seats across {n} bookings') },
    { label: tx('Seat occupancy'), value: `${occupancy}%`, note: `last 30 days, ${past30.length} departures` },
    { label: tx('Active buses'), value: String(data.buses.filter((b) => b.status === 'active').length), note: txn(data.schedules.filter((s) => s.active).length, '{n} departure in the timetable', '{n} departures in the timetable') },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-extrabold tracking-tight text-[#050a44]">Today</h1>
          <p className="text-[15px] text-[#46464f]">{formatDateLabel(today)}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/trips?tab=seats">
            <Button variant="gold" className="!h-14 !px-6 !text-[17px] !rounded-2xl"><Plus className="w-5 h-5" />Sell a seat</Button>
          </Link>
          {mode === 'demo' && <Button variant="secondary" className="!h-14" onClick={() => setConfirmReset(true)}>Reset demo</Button>}
        </div>
      </div>

      {/* To do: one big card per job, the number first. */}
      {todo.length === 0 ? (
        <Card className="p-5 mb-6 flex items-center gap-4">
          <span className="w-12 h-12 rounded-xl bg-[#f2f4f6] text-[#006e1c] flex items-center justify-center shrink-0"><CheckCircle2 className="w-6 h-6" /></span>
          <p className="text-[20px] font-extrabold text-[#050a44]">All done. Nothing waiting.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-6">
          {todo.map((t) => (
            <Link key={t.label} href={t.href} className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm p-4 md:p-5 flex items-center gap-3 md:gap-4 hover:border-[#050a44] active:scale-[0.98] transition">
              <span className="w-12 h-12 rounded-xl bg-[#f2f4f6] text-[#050a44] flex items-center justify-center shrink-0"><t.Icon className="w-6 h-6" /></span>
              <span className="min-w-0">
                <span className="block text-[28px] leading-none font-extrabold text-[#050a44] tabular-nums">{t.n}</span>
                <span className="block text-[14px] md:text-[15px] font-bold text-[#46464f] mt-1 leading-tight">{t.label}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {alerts.length > 0 && (
        <Card className="p-4 mb-6 border-[#feb700]/50">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#050a44] mb-2">
            <AlertTriangle className="w-4 h-4 text-[#7c5800]" /> Needs attention</p>
          <ul className="space-y-1.5">
            {alerts.map((a) => (
              <li key={a.text}>
                <Link href={a.href} className={`text-[13px] font-medium hover:underline ${a.bad ? 'text-[#ba1a1a]' : 'text-[#7c5800]'}`}>
                  {a.text}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isAdmin && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <p className="text-[12px] font-bold text-[#46464f]">{s.label}</p>
            <p className="text-[26px] font-extrabold text-[#050a44] tabular-nums mt-1">{s.value}</p>
            <p className="text-[12px] text-[#686873] mt-1">{s.note}</p>
          </Card>
        ))}
      </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#edeef0]">
            <h2 className="text-[16px] font-bold text-[#050a44]">Buses coming up</h2>
            <Link href="/admin/trips?tab=seats" className="text-[13px] font-bold text-[#050a44] hover:underline">All trips</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="p-5 text-[14px] text-[#46464f]">{tx('No departures in the next two weeks. Add one in')}{' '}<Link className="font-bold underline" href="/admin/buses?tab=routes">{tx('Routes & timetable')}</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-[#edeef0]">
              {upcoming.slice(0, 6).map((r) => {
                const pct = Math.round((r.sold / r.capacity) * 100);
                return (
                  <li key={`${r.schedule.id}-${r.date}`}>
                    <Link
                      href={`/admin/trips?tab=seats&date=${r.date}&run=${r.schedule.id}`}
                      className="grid grid-cols-[1fr_auto] sm:grid-cols-[130px_1fr_160px] gap-x-4 gap-y-2 items-center px-5 py-4 hover:bg-[#f8f9fb]"
                    >
                      <span>
                        <span className="block text-[12px] font-semibold text-[#46464f]">{formatDateLabel(r.date, false)}</span>
                        <span className="block text-[18px] font-extrabold text-[#050a44] tabular-nums">{formatTime12(r.schedule.departure)}</span>
                      </span>
                      <span className="hidden sm:block min-w-0">
                        <span className="block text-[14px] font-bold text-[#050a44] truncate">{routeLabel(r.route)}</span>
                        <span className="block text-[12px] text-[#46464f]">
                          {r.bus.name} · {r.bus.regNo}
                        </span>
                      </span>
                      <span className="text-right sm:text-left">
                        <span className="block text-[13px] font-bold text-[#050a44] tabular-nums">
                          {r.sold}/{r.capacity} sold
                        </span>
                        <span className="block h-1.5 mt-1.5 rounded-full bg-[#edeef0] overflow-hidden" aria-hidden>
                          <span className={`block h-full rounded-full ${pct >= 90 ? 'bg-[#ba1a1a]' : 'bg-[#feb700]'}`} style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

      </div>

      {confirmReset && (
        <Modal
          title={tx('Reset demo data?')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>{tx('Keep my changes')}</Button>
              <Button
                variant="danger"
                onClick={() => {
                  resetDemo();
                  setConfirmReset(false);
                  toast(tx('Demo data reset.'));
                }}
              >{tx('Reset')}</Button>
            </>
          }
        >
          <p className="text-[14px] text-[#46464f]">{tx('This puts buses, routes, the timetable and bookings back to the starting sample data in this browser. Anything you added will be lost.')}</p>
        </Modal>
      )}
      <Toast />
    </>
  );
}
