'use client';
// app/admin/page.tsx — at-a-glance numbers and the next departures.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { addDays, formatDateLabel, formatLKR, formatTime12, listRuns, netRevenue, routeLabel, todayISO } from '@/lib/trips';
import { Badge, Button, Card, Modal, PageHeader, useToast } from '@/components/admin/ui';
import { useAuth } from '@/contexts/AuthContext';
import { DOCUMENT_LABEL, daysUntil, latestOdometer, nextService, useErp } from '@/lib/erp';
import { AlertTriangle } from 'lucide-react';

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
      if (n < 0) out.push({ text: `${DOCUMENT_LABEL[d.kind]} for ${bus} expired ${-n} days ago`, href: '/admin/fleet-health', bad: true });
      else if (n <= 30) out.push({ text: `${DOCUMENT_LABEL[d.kind]} for ${bus} expires in ${n} days`, href: '/admin/fleet-health', bad: n <= 7 });
    }
    for (const b of data.buses) {
      const svc = nextService(erp.data.expenses, b.id);
      const odo = latestOdometer(erp.data.expenses, b.id);
      if (svc?.nextDueKm && odo && svc.nextDueKm - odo < 1500)
        out.push({ text: svc.nextDueKm - odo <= 0 ? `${b.regNo} service is overdue` : `${b.regNo} service due in ${(svc.nextDueKm - odo).toLocaleString()} km`, href: '/admin/fleet-health', bad: svc.nextDueKm - odo <= 0 });
    }
    for (const c of erp.data.crew) {
      if (c.role !== 'driver' || !c.licenseExpires || !c.active) continue;
      const n = daysUntil(c.licenseExpires);
      if (n <= 30) out.push({ text: n < 0 ? `${c.fullName}'s driving licence has expired` : `${c.fullName}'s driving licence expires in ${n} days`, href: '/admin/crew', bad: n < 0 });
    }
    return out.sort((a, b) => Number(b.bad) - Number(a.bad));
  }, [isAdmin, erp.data, data.buses]);
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
    { label: 'Revenue this month', value: formatLKR(monthRevenue), note: `${monthBookings.filter((b) => b.status !== 'cancelled').length} bookings travelling this month` },
    { label: 'Booked today', value: String(bookedToday.reduce((n, b) => n + b.seats.length, 0)), note: `seats across ${bookedToday.length} bookings` },
    { label: 'Seat occupancy', value: `${occupancy}%`, note: `last 30 days, ${past30.length} departures` },
    { label: 'Active buses', value: String(data.buses.filter((b) => b.status === 'active').length), note: `${data.schedules.filter((s) => s.active).length} departures in the timetable` },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description={formatDateLabel(today)}
        actions={
          <>
            <Link href="/admin/departures">
              <Button variant="gold">Sell a seat</Button>
            </Link>
            {mode === 'demo' && (
              <Button variant="secondary" onClick={() => setConfirmReset(true)}>
                Reset demo data
              </Button>
            )}
          </>
        }
      />

      {alerts.length > 0 && (
        <Card className="p-4 mb-6 border-[#feb700]/50">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-[#050a44] mb-2">
            <AlertTriangle className="w-4 h-4 text-[#7c5800]" /> Needs attention
          </p>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <p className="text-[12px] font-bold text-[#46464f]">{s.label}</p>
            <p className="text-[26px] font-extrabold text-[#050a44] tabular-nums mt-1">{s.value}</p>
            <p className="text-[12px] text-[#686873] mt-1">{s.note}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-6">
        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#edeef0]">
            <h2 className="text-[16px] font-bold text-[#050a44]">Next departures</h2>
            <Link href="/admin/departures" className="text-[13px] font-bold text-[#050a44] hover:underline">
              All departures
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="p-5 text-[14px] text-[#46464f]">
              No departures in the next two weeks. Add one in <Link className="font-bold underline" href="/admin/routes">Routes &amp; timetable</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-[#edeef0]">
              {upcoming.slice(0, 6).map((r) => {
                const pct = Math.round((r.sold / r.capacity) * 100);
                return (
                  <li key={`${r.schedule.id}-${r.date}`}>
                    <Link
                      href={`/admin/departures?date=${r.date}&run=${r.schedule.id}`}
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

        <Card>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#edeef0]">
            <h2 className="text-[16px] font-bold text-[#050a44]">Latest bookings</h2>
            <Link href="/admin/bookings" className="text-[13px] font-bold text-[#050a44] hover:underline">
              All bookings
            </Link>
          </div>
          <ul className="divide-y divide-[#edeef0]">
            {recent.map((b) => (
              <li key={b.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-[#050a44] truncate">{b.passenger.name}</p>
                  <p className="text-[12px] text-[#46464f] truncate">
                    {b.from} → {b.to} · {formatDateLabel(b.date, false)} · {b.seats.join(', ')}
                  </p>
                  <p className="text-[11px] text-[#686873] truncate">{scheduleRoute(b.scheduleId)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[13px] font-bold text-[#050a44] tabular-nums">{formatLKR(b.total)}</p>
                  <Badge value={b.status} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {confirmReset && (
        <Modal
          title="Reset demo data?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>
                Keep my changes
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  resetDemo();
                  setConfirmReset(false);
                  toast('Demo data reset.');
                }}
              >
                Reset
              </Button>
            </>
          }
        >
          <p className="text-[14px] text-[#46464f]">
            This puts buses, routes, the timetable and bookings back to the starting sample data in this browser. Anything you added will be lost.
          </p>
        </Modal>
      )}
      <Toast />
    </>
  );
}
