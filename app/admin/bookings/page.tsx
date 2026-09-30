'use client';
// app/admin/bookings/page.tsx — find any booking by reference, name or phone.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useStore } from '@/lib/store';
import type { Booking } from '@/lib/types';
import { formatDateLabel, formatLKR, formatTime12, todayISO } from '@/lib/trips';
import { Badge, Button, Card, Modal, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { BikeThumb } from '@/components/admin/BikeList';
import { OPERATOR } from '@/config/operator';

type When = 'upcoming' | 'past' | 'all';
const PAGE = 40;

export default function BookingsPage() {
  const { data, updateBooking } = useStore();
  const { toast, Toast } = useToast();
  const [q, setQ] = useState('');
  const [when, setWhen] = useState<When>('upcoming');
  const [status, setStatus] = useState<'all' | Booking['status']>('all');
  const [channel, setChannel] = useState<'all' | Booking['channel']>('all');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Booking | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const today = todayISO();

  const schedule = (id: string) => data.schedules.find((s) => s.id === id);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.bookings
      .filter((b) => (when === 'upcoming' ? b.date >= today : when === 'past' ? b.date < today : true))
      .filter((b) => status === 'all' || b.status === status)
      .filter((b) => channel === 'all' || b.channel === channel)
      .filter(
        (b) =>
          !needle ||
          b.ref.toLowerCase().includes(needle) ||
          b.passenger.name.toLowerCase().includes(needle) ||
          b.passenger.phone.replace(/\s/g, '').includes(needle.replace(/\s/g, '')),
      )
      .sort((a, b) => (when === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) || a.seats[0].localeCompare(b.seats[0], undefined, { numeric: true }));
  }, [data.bookings, q, when, status, channel, today]);

  const exportCsv = () => {
    const header = ['Ref', 'Travel date', 'Departure', 'From', 'To', 'Seats', 'Passenger', 'Phone', 'Email', 'Channel', 'Status', 'Total (LKR)', 'Refund (LKR)', 'Booked at'];
    const lines = rows.map((b) => [
      b.ref,
      b.date,
      schedule(b.scheduleId)?.departure ?? '',
      b.from,
      b.to,
      b.seats.join(' '),
      b.passenger.name,
      b.passenger.phone,
      b.contact.email,
      b.channel,
      b.status,
      String(b.total),
      String(b.refund?.amount ?? ''),
      b.createdAt,
    ]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookings-${when}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cancel = async (b: Booking) => {
    const res = await updateBooking(b.id, { status: 'cancelled', refund: { amount: b.total - b.fee, at: new Date().toISOString() } });
    toast(res.ok ? `${b.ref} cancelled, ${formatLKR(b.total - b.fee)} to refund` : res.reason ?? 'Could not cancel', res.ok ? 'ok' : 'error');
    setConfirmCancel(false);
    setOpen(null);
  };

  const pill = (active: boolean) =>
    `px-3 h-9 rounded-lg text-[13px] font-bold border ${active ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1] hover:bg-[#f2f4f6]'}`;

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Search by booking reference, passenger name or phone number."
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      <Card className="p-4 mb-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6d78]" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="SLT-7K2Q1P, Fathima, 077…"
            aria-label="Search bookings"
            className={`${inputClass} pl-9`}
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {(['upcoming', 'past', 'all'] as const).map((w) => (
            <button key={w} className={pill(when === w)} aria-pressed={when === w} onClick={() => setWhen(w)}>
              {w === 'upcoming' ? 'Upcoming' : w === 'past' ? 'Past' : 'All dates'}
            </button>
          ))}
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${inputClass} !w-auto !py-2`}>
            <option value="all">Any status</option>
            <option value="confirmed">Confirmed</option>
            <option value="boarded">Boarded</option>
            <option value="no-show">No-show</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className={`${inputClass} !w-auto !py-2`}>
            <option value="all">Any channel</option>
            <option value="online">Online</option>
            <option value="counter">Counter</option>
            <option value="phone">Phone</option>
          </select>
          <span className="ml-auto text-[13px] font-semibold text-[#46464f]">{rows.length} bookings</span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-[14px] text-[#46464f]">No bookings match. Clear the search or pick &ldquo;All dates&rdquo;.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Reference</th>
                  <th className="px-4 py-2.5">Travel</th>
                  <th className="px-4 py-2.5">Passenger</th>
                  <th className="px-4 py-2.5">Seats</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {rows.slice(0, limit).map((b) => (
                  <tr key={b.id} onClick={() => setOpen(b)} className="cursor-pointer hover:bg-[#f8f9fb]">
                    <td className="px-4 py-3">
                      <button className="font-bold text-[#050a44] hover:underline" onClick={() => setOpen(b)}>
                        {b.ref}
                      </button>
                      <div className="mt-0.5">
                        <Badge value={b.channel} />
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-semibold text-[#050a44]">
                        {formatDateLabel(b.date, false)} · {formatTime12(schedule(b.scheduleId)?.departure ?? '00:00')}
                      </p>
                      <p className="text-[12px] text-[#46464f]">
                        {b.from} → {b.to}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#050a44]">{b.passenger.name}</p>
                      <p className="text-[12px] text-[#46464f]">{b.passenger.phone}</p>
                    </td>
                    <td className="px-4 py-3 font-bold whitespace-nowrap">{b.seats.join(', ')}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums whitespace-nowrap">{formatLKR(b.total)}</td>
                    <td className="px-4 py-3">
                      <Badge value={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && (
          <div className="p-4 border-t border-[#edeef0] text-center">
            <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({rows.length - limit} left)
            </Button>
          </div>
        )}
      </Card>

      {open && (
        <Modal
          title={`${open.ref} · ${open.passenger.name}`}
          onClose={() => {
            setOpen(null);
            setConfirmCancel(false);
          }}
          footer={
            <>
              <Link href={`/admin/departures?date=${open.date}&run=${open.scheduleId}`}>
                <Button variant="secondary">Open departure</Button>
              </Link>
              {open.status === 'confirmed' &&
                (confirmCancel ? (
                  <Button variant="danger" onClick={() => cancel(open)}>
                    Yes, cancel and refund {formatLKR(open.total - open.fee)}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                    Cancel booking
                  </Button>
                ))}
            </>
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-[14px]">
            {[
              ['Travel date', formatDateLabel(open.date)],
              ['Departure', formatTime12(schedule(open.scheduleId)?.departure ?? '00:00')],
              ['From', open.from],
              ['To', open.to],
              ['Seats', open.seats.join(', ')],
              ['Gender', open.passenger.gender || '—'],
              ['Phone', open.passenger.phone || '—'],
              ['Email', open.contact.email || '—'],
              ['Fare', `${formatLKR(open.fare)} × ${open.seats.length}`],
              ['Fee / discount', `${formatLKR(open.fee)} / ${formatLKR(open.discount)}`],
              ['Total', formatLKR(open.total)],
              ['Refunded', open.refund ? formatLKR(open.refund.amount) : '—'],
              ['Booked', new Date(open.createdAt).toLocaleString('en-GB')],
              ['Channel', open.channel],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-bold text-[#686873]">{k}</dt>
                <dd className="font-semibold text-[#050a44] break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {open.bikes?.length ? (
            <div className="rounded-xl bg-[#f8f9fb] border border-[#edeef0] p-3 space-y-2">
              <p className="text-[11px] font-bold text-[#686873]">Luggage compartment</p>
              {open.bikes.map((bike) => (
                <div key={bike.id} className="flex items-center gap-3">
                  <BikeThumb bike={bike} size={64} />
                  <div className="text-[13px]">
                    <p className="font-bold text-[#050a44]">
                      {OPERATOR.bikes.kinds[bike.kind].label} · {bike.description}
                    </p>
                    <p className="text-[#46464f]">
                      {bike.regNo || 'No plate'} · {formatLKR(bike.fee)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div>
            <Badge value={open.status} />
          </div>
        </Modal>
      )}
      <Toast />
    </>
  );
}
