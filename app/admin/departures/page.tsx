'use client';
// app/admin/departures/page.tsx — pick a date and departure, see the seat map
// and passenger manifest, sell seats at the counter or by phone, and mark
// passengers as boarded / no-show on the night.

import React, { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { useStore } from '@/lib/store';
import type { Booking, BookingChannel, Gender } from '@/lib/types';
import {
  addDays,
  formatDateLabel,
  formatLKR,
  formatTime12,
  getTrip,
  listRuns,
  routeLabel,
  seatIds,
  takenSeats,
  todayISO,
  type Run,
} from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, useToast } from '@/components/admin/ui';
import { BikeLoadingList } from '@/components/admin/BikeList';
import { TripTools } from '@/components/admin/TripTools';
import { downloadManifestPdf } from '@/lib/manifestPdf';
import { FileDown } from 'lucide-react';

export default function DeparturesPage() {
  return (
    <Suspense fallback={null}>
      <Departures />
    </Suspense>
  );
}

function Departures() {
  const router = useRouter();
  const params = useSearchParams();
  const { data } = useStore();
  const date = params.get('date') || todayISO();
  const runs = useMemo(() => listRuns(data, date, 1), [data, date]);
  const runId = params.get('run') || runs[0]?.schedule.id || '';
  const run = runs.find((r) => r.schedule.id === runId) ?? runs[0];

  const go = (d: string, r?: string) => router.replace(`/admin/departures?date=${d}${r ? `&run=${r}` : ''}`, { scroll: false });

  return (
    <>
      <PageHeader title="Departures" description="Seat map and passenger list for each trip. Sell seats at the counter and check people in on the night." />

      <Card className="p-3 mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className={`${inputClass} !w-auto`} aria-label="Date" />
        <Button variant="ghost" size="sm" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => go(todayISO())}>
          Today
        </Button>
        <div className="flex gap-2 flex-wrap ml-auto">
          {runs.map((r) => (
            <button
              key={r.schedule.id}
              onClick={() => go(date, r.schedule.id)}
              aria-pressed={r.schedule.id === run?.schedule.id}
              className={`px-3 py-2 rounded-xl text-[13px] font-bold border transition-colors ${
                r.schedule.id === run?.schedule.id ? 'bg-[#050a44] text-white border-[#050a44]' : 'bg-white text-[#050a44] border-[#c7c5d1] hover:bg-[#f2f4f6]'
              }`}
            >
              {formatTime12(r.schedule.departure)} · {r.route.stops[0].name} → {r.route.stops[r.route.stops.length - 1].name}
            </button>
          ))}
        </div>
      </Card>

      {!run ? (
        <Card className="p-10 text-center">
          <p className="text-[16px] font-bold text-[#050a44]">No departures on {formatDateLabel(date)}</p>
          <p className="text-[14px] text-[#46464f] mt-1">The bus isn&apos;t timetabled that day. Try the next day, or add a departure in Routes &amp; timetable.</p>
        </Card>
      ) : (
        <Manifest key={`${run.schedule.id}-${date}`} run={run} />
      )}
    </>
  );
}

function Manifest({ run }: { run: Run }) {
  const { data, createBooking, updateBooking, confirmPayment } = useStore();
  const { toast, Toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [selling, setSelling] = useState(false);
  const [viewing, setViewing] = useState<Booking | null>(null);

  const bookings = data.bookings.filter((b) => b.scheduleId === run.schedule.id && b.date === run.date);
  const live = bookings.filter((b) => b.status === 'confirmed' || b.status === 'boarded' || b.status === 'held');
  const taken = takenSeats(data.bookings, run.schedule.id, run.date);
  const seatOwner = new Map<string, Booking>();
  live.forEach((b) => b.seats.forEach((s) => seatOwner.set(s, b)));
  const stopOrder = (name: string) => run.route.stops.findIndex((s) => s.name === name);
  const manifest = [...bookings].sort((a, b) => stopOrder(a.from) - stopOrder(b.from) || a.seats[0].localeCompare(b.seats[0], undefined, { numeric: true }));
  const boarded = live.filter((b) => b.status === 'boarded').reduce((n, b) => n + b.seats.length, 0);
  const departed = run.departsAt.getTime() < Date.now();

  const toggle = (seat: string) => {
    if (taken.has(seat)) {
      setViewing(seatOwner.get(seat) ?? null);
      return;
    }
    setSelected((p) => (p.includes(seat) ? p.filter((s) => s !== seat) : [...p, seat]));
  };

  const setStatus = async (b: Booking, status: Booking['status']) => {
    const res = await updateBooking(b.id, { status, ...(status === 'cancelled' ? { refund: { amount: b.total - b.fee, at: new Date().toISOString() } } : {}) });
    toast(res.ok ? `${b.passenger.name}: ${status.replace('-', ' ')}` : res.reason ?? 'Could not update', res.ok ? 'ok' : 'error');
    setViewing(null);
  };

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[360px_1fr] xl:grid-cols-[320px_1fr] gap-6">
      <Card className="p-5 self-start print:hidden">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[16px] font-bold text-[#050a44]">{routeLabel(run.route)}</p>
            <p className="text-[13px] text-[#46464f]">
              {formatDateLabel(run.date)} · {formatTime12(run.schedule.departure)}
            </p>
            <p className="text-[12px] text-[#686873]">
              {run.bus.name} · {run.bus.regNo}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[20px] font-extrabold text-[#050a44] tabular-nums">
              {run.sold}/{run.capacity}
            </p>
            <p className="text-[11px] text-[#46464f]">seats sold</p>
          </div>
        </div>

        <SeatGrid run={run} taken={taken} owner={seatOwner} selected={selected} onToggle={toggle} />

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-[11px] font-medium text-[#46464f]">
          <Legend className="border border-[#c7c5d1] bg-white" label="Free" />
          <Legend className="bg-[#feb700]" label="Selected" />
          <Legend className="bg-[#050a44]" label="Sold" />
          <Legend className="bg-[#006e1c]" label="Boarded" />
          <Legend className="border border-pink-300 bg-pink-50" label="Ladies" />
        </div>

        <Button variant="gold" className="w-full mt-5" disabled={selected.length === 0 || departed} onClick={() => setSelling(true)}>
          {departed ? 'This bus has left' : selected.length ? `Sell ${selected.length} seat${selected.length > 1 ? 's' : ''}` : 'Tap free seats to sell'}
        </Button>
      </Card>

      <div className="min-w-0 space-y-6">
      <TripTools run={run} bookings={bookings} />
      <Card className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#edeef0]">
          <div>
            <h2 className="text-[16px] font-bold text-[#050a44]">Passenger list</h2>
            <p className="text-[12px] text-[#46464f]">
              {boarded} of {run.sold} seats boarded · {formatLKR(run.revenue)} collected
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => downloadManifestPdf(data, run.schedule.id, run.date)} className="print:hidden">
            <FileDown className="w-4 h-4" /> Download PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
            <Printer className="w-4 h-4" /> Print list
          </Button>
        </div>
        <div className="hidden print:block px-5 pt-4">
          <p className="font-bold">
            {OPERATOR.name} · {routeLabel(run.route)} · {formatDateLabel(run.date)} {formatTime12(run.schedule.departure)} · {run.bus.regNo}
          </p>
        </div>
        {manifest.length === 0 ? (
          <p className="p-6 text-[14px] text-[#46464f]">No bookings yet for this departure.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">Seats</th>
                  <th className="px-4 py-2.5">Passenger</th>
                  <th className="px-4 py-2.5">Gets on → off</th>
                  <th className="px-4 py-2.5">Paid</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 print:hidden">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {manifest.map((b) => (
                  <tr key={b.id} className={b.status === 'cancelled' ? 'opacity-50' : ''}>
                    <td className="px-4 py-3 font-bold text-[#050a44] whitespace-nowrap">
                      {b.seats.join(', ')}
                      {b.bikes?.length ? (
                        <span className="material-symbols-outlined text-[16px] text-[#7c5800] align-middle ml-1" title={`${b.bikes.length} bike(s) in the compartment`}>
                          two_wheeler
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 min-w-[170px]">
                      <p className="font-bold text-[#050a44] whitespace-nowrap">{b.passenger.name}</p>
                      <p className="text-[12px] text-[#46464f] whitespace-nowrap">{b.passenger.phone}</p>
                      <p className="text-[11px] text-[#6b6d78] whitespace-nowrap">{b.ref}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {b.from} → {b.to}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-bold tabular-nums">{formatLKR(b.total)}</p>
                      <Badge value={b.channel} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={b.status} />
                    </td>
                    <td className="px-4 py-3 print:hidden">
                      {b.status === 'confirmed' && (
                        <div className="flex gap-1.5 justify-end">
                          <Button size="sm" onClick={() => setStatus(b, 'boarded')}>
                            Boarded
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setViewing(b)}>
                            More
                          </Button>
                        </div>
                      )}
                      {b.status === 'held' && (
                        <div className="flex gap-1.5 justify-end">
                          <Button size="sm" variant="gold" onClick={async () => {
                            const r = await confirmPayment(b.id, 'cash');
                            toast(r.ok ? `${b.passenger.name}: paid in cash` : r.reason ?? 'Could not take payment', r.ok ? 'ok' : 'error');
                          }}>
                            Take cash
                          </Button>
                        </div>
                      )}
                      {(b.status === 'boarded' || b.status === 'no-show') && (
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setStatus(b, 'confirmed')}>
                            Undo
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {run.bus.bikeSpaces > 0 && <BikeLoadingList bookings={bookings} stopOrder={stopOrder} spaces={run.bus.bikeSpaces} />}
      </div>

      {selling && (
        <SellSeatsModal
          run={run}
          seats={selected}
          onClose={() => setSelling(false)}
          onSell={async (input) => {
            const res = await createBooking(input);
            if (!res.ok) {
              toast(res.reason, 'error');
              return;
            }
            toast(`Sold ${input.seats.join(', ')} to ${input.passenger.name} · ${res.booking.ref}`);
            setSelected([]);
            setSelling(false);
          }}
        />
      )}

      {viewing && (
        <Modal
          title={`${viewing.passenger.name} · ${viewing.ref}`}
          onClose={() => setViewing(null)}
          footer={
            viewing.status === 'confirmed' ? (
              <>
                <Button variant="danger" onClick={() => setStatus(viewing, 'cancelled')}>
                  Cancel booking
                </Button>
                <Button variant="secondary" onClick={() => setStatus(viewing, 'no-show')}>
                  No-show
                </Button>
                <Button onClick={() => setStatus(viewing, 'boarded')}>Boarded</Button>
              </>
            ) : undefined
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-[14px]">
            <Info label="Seats" value={viewing.seats.join(', ')} />
            <Info label="Status" value={<Badge value={viewing.status} />} />
            <Info label="Gets on" value={viewing.from} />
            <Info label="Gets off" value={viewing.to} />
            <Info label="Phone" value={viewing.passenger.phone || '—'} />
            <Info label="Email" value={viewing.contact.email || '—'} />
            <Info label="Paid" value={formatLKR(viewing.total)} />
            <Info label="Booked" value={`${new Date(viewing.createdAt).toLocaleString('en-GB')} (${viewing.channel})`} />
          </dl>
          {viewing.status === 'confirmed' && (
            <p className="text-[12px] text-[#46464f]">Cancelling here refunds the fare in full (the booking fee is kept) and frees the seats.</p>
          )}
        </Modal>
      )}
      <Toast />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-3.5 h-3.5 rounded ${className}`} aria-hidden />
      {label}
    </span>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-bold text-[#686873]">{label}</dt>
      <dd className="font-semibold text-[#050a44] break-words">{value}</dd>
    </div>
  );
}

function SeatGrid({
  run,
  taken,
  owner,
  selected,
  onToggle,
}: {
  run: Run;
  taken: Map<string, Gender>;
  owner: Map<string, Booking>;
  selected: string[];
  onToggle: (seat: string) => void;
}) {
  const ids = seatIds(run.bus);
  const rows: string[][] = [];
  for (let r = 1; r <= run.bus.rows; r++) rows.push(ids.filter((id) => id.match(/^\d+/)?.[0] === String(r)));
  const back = ids.filter((id) => id.match(/^\d+/)?.[0] === String(run.bus.rows + 1));

  const seat = (id: string) => {
    const o = owner.get(id);
    const isSel = selected.includes(id);
    const cls = o
      ? o.status === 'boarded'
        ? 'bg-[#006e1c] text-white'
        : 'bg-[#050a44] text-white'
      : isSel
        ? 'bg-[#feb700] text-[#050a44] border-[#feb700]'
        : run.bus.ladiesSeats.includes(id)
          ? 'bg-pink-50 border border-pink-300 text-pink-700'
          : 'bg-white border border-[#c7c5d1] text-[#46464f] hover:border-[#050a44]';
    return (
      <button
        key={id}
        type="button"
        onClick={() => onToggle(id)}
        title={o ? `${id}: ${o.passenger.name} (${o.from} → ${o.to})` : `${id}: free`}
        aria-label={o ? `Seat ${id}, sold to ${o.passenger.name}` : `Seat ${id}, free${isSel ? ', selected' : ''}`}
        aria-pressed={isSel}
        className={`h-9 rounded-lg text-[11px] font-bold transition-colors ${cls} ${taken.has(id) ? 'cursor-pointer' : ''}`}
      >
        {id}
      </button>
    );
  };

  return (
    <div className="rounded-2xl bg-[#f2f4f6] p-3">
      <p className="text-[10px] font-bold text-[#686873] text-right mb-2 pr-1">Front · driver</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_14px_1fr_1fr] gap-1.5">
            {seat(r[0])}
            {seat(r[1])}
            <span />
            {seat(r[2])}
            {seat(r[3])}
          </div>
        ))}
        {back.length > 0 && (
          <div className="grid gap-1.5 pt-1" style={{ gridTemplateColumns: `repeat(${back.length}, 1fr)` }}>
            {back.map(seat)}
          </div>
        )}
      </div>
    </div>
  );
}

function SellSeatsModal({
  run,
  seats,
  onClose,
  onSell,
}: {
  run: Run;
  seats: string[];
  onClose: () => void;
  onSell: (input: Parameters<ReturnType<typeof useStore>['createBooking']>[0]) => void;
}) {
  const { data } = useStore();
  const stops = run.route.stops.map((s) => s.name);
  const [from, setFrom] = useState(stops[0]);
  const [to, setTo] = useState(stops[stops.length - 1]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [channel, setChannel] = useState<BookingChannel>('counter');
  const trip = getTrip(data, run.schedule.id, run.date, from, to);
  const validSegment = stops.indexOf(from) < stops.indexOf(to);
  const fare = validSegment && trip ? trip.fare : 0;
  const ladiesClash = gender === 'Male' && seats.some((s) => run.bus.ladiesSeats.includes(s));
  const valid = validSegment && name.trim().length > 1 && phone.trim().length >= 9 && gender !== '' && !ladiesClash;

  return (
    <Modal
      title={`Sell seat${seats.length > 1 ? 's' : ''} ${seats.join(', ')}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="gold"
            disabled={!valid}
            onClick={() =>
              onSell({
                scheduleId: run.schedule.id,
                date: run.date,
                from,
                to,
                seats,
                passenger: { name: name.trim(), gender, phone: phone.trim() },
                contact: { email: '', phone: phone.trim() },
                channel,
                fare,
                fee: 0,
                discount: 0,
                total: fare * seats.length,
              })
            }
          >
            Take {formatLKR(fare * seats.length)} and issue ticket
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gets on at">
          <select className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)}>
            {stops.slice(0, -1).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Gets off at">
          <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>
            {stops.slice(1).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {!validSegment && <p className="text-[12px] font-semibold text-[#ba1a1a]">The drop-off must come after the boarding stop on this route.</p>}
      <Field label="Passenger name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mobile number">
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07X XXX XXXX" inputMode="tel" />
        </Field>
        <Field label="Gender" hint="Needed for ladies-only seats">
          <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
            <option value="">Select</option>
            <option>Female</option>
            <option>Male</option>
          </select>
        </Field>
      </div>
      {ladiesClash && <p className="text-[12px] font-semibold text-[#ba1a1a]">Seats {run.bus.ladiesSeats.join(', ')} are for female passengers.</p>}
      <Field label="Sold via">
        <div className="flex gap-2">
          {(['counter', 'phone'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              aria-pressed={channel === c}
              className={`flex-1 h-10 rounded-lg text-[13px] font-bold border capitalize ${channel === c ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}
            >
              {c === 'counter' ? 'Counter / cash' : 'Phone booking'}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-[13px] text-[#46464f]">
        {seats.length} × {formatLKR(fare)} = <span className="font-bold text-[#050a44]">{formatLKR(fare * seats.length)}</span>. No online booking fee on counter sales.
      </p>
    </Modal>
  );
}
