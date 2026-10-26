'use client';
// app/admin/departures/page.tsx — pick a date and departure, see the seat map
// and passenger manifest, sell seats at the counter or by phone, and mark
// passengers as boarded / no-show on the night.

import React, { Suspense, useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { useStore } from '@/lib/store';
import type { Booking, BookingChannel, Gender } from '@/lib/types';
import { addDays, formatDateLabel, formatLKR, formatTime12, getTrip, listRuns, routeLabel, seatIds, takenSeats, todayISO, type Run, seatsBesideLoneWoman, dateLocale } from '@/lib/trips';
import { Badge, Button, Card, Field, Modal, PageHeader, inputClass, stackTable, useToast } from '@/components/admin/ui';
import { BikeLoadingList } from '@/components/admin/BikeList';
import { TripTools } from '@/components/admin/TripTools';
import { downloadManifestPdf } from '@/lib/manifestPdf';
import { lastReading, useOdometer } from '@/lib/odometer';
import { slipOnFile, slipUrl, useSlips } from '@/lib/money';
import { usePublicSettings } from '@/lib/extras';
import { holdSeats, releaseSeatHolds, useSeatHolds } from '@/lib/seatHolds';
import { busSeatMap, layoutSegments } from '@/lib/seatLayout';
import { friendlyError, isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { isOfficeRole, useAuth } from '@/contexts/AuthContext';
import { FileDown } from 'lucide-react';
import { tx, txn } from '@/lib/i18n';
import { MOCK_CODE } from '@/lib/mockVerification';

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
      <PageHeader title={tx('Departures')} description={tx('Seat map and passenger list for each trip. Sell seats at the counter and check people in on the night.')} />

      <Card className="p-3 mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" aria-label={tx('Previous day')} onClick={() => go(addDays(date, -1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)} className={`${inputClass} !w-auto`} aria-label={tx('Date')} />
        <Button variant="ghost" size="sm" aria-label={tx('Next day')} onClick={() => go(addDays(date, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => go(todayISO())}>{tx('Today')}</Button>
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
          <p className="text-[16px] font-bold text-[#050a44]">{tx('No departures on {date}', { date: formatDateLabel(date) })}</p>
          <p className="text-[14px] text-[#46464f] mt-1">{tx('The bus isn\'t timetabled that day. Try the next day, or add a departure in Routes & timetable.')}</p>
        </Card>
      ) : (
        <Manifest key={`${run.schedule.id}-${date}`} run={run} />
      )}
    </>
  );
}

function Manifest({ run }: { run: Run }) {
  const { data, createBooking, updateBooking, confirmPayment } = useStore();
  // For the printed trip sheet: the bus's last odometer reading goes in as the start.
  const odometer = useOdometer();
  const { toast, Toast } = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [selling, setSelling] = useState(false);
  const [viewing, setViewing] = useState<Booking | null>(null);
  const slipFor = useSlips();
  const payLabel: Record<string, string> = { bank: tx('bank transfer'), counter: tx('pay at counter'), bus: tx('pay on the bus') };

  const bookings = data.bookings.filter((b) => b.scheduleId === run.schedule.id && b.date === run.date);
  const live = bookings.filter((b) => b.status === 'confirmed' || b.status === 'boarded' || b.status === 'held');
  const taken = takenSeats(data.bookings, run.schedule.id, run.date);
  // Seats a passenger is checking out with online right now (a 10-minute hold). Shown on the map;
  // office staff can still sell them, which takes the seat from that passenger.
  const { holds, reload: reloadHolds } = useSeatHolds(run.schedule.id, run.date);
  // Seats other people are holding (a passenger at checkout, or another staff member mid-sale).
  const heldUntil = new Map(holds.filter((h) => !h.mine).map((h) => [h.seat, h.expiresAt]));
  // Seats picked here for a counter sale are held too, so passengers see them turn
  // unavailable straight away and can't book them while the sale is being made.
  const selectedKey = selected.join(',');
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await holdSeats(run.schedule.id, run.date, selectedKey ? selectedKey.split(',') : []);
      if (!r.ok) {
        toast(r.reason ?? tx('One of those seats is no longer free.'), 'error');
        setSelected([]);
      }
      reloadHolds();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, run.schedule.id, run.date]);
  useEffect(() => () => void releaseSeatHolds(), []); // leaving the page lets the seats go
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
    toast(res.ok ? tx('{name}: {status}', { name: b.passenger.name, status: status === 'boarded' ? tx('on board') : status === 'no-show' ? tx('no-show') : status === 'cancelled' ? tx('cancelled') : status === 'held' ? tx('held') : tx('confirmed') }) : res.reason ?? tx('Could not update'), res.ok ? 'ok' : 'error');
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
            <p className="text-[11px] text-[#46464f]">{tx('seats sold')}</p>
          </div>
        </div>

        <SeatGrid run={run} taken={taken} owner={seatOwner} selected={selected} onToggle={toggle} heldUntil={heldUntil} />
        {heldUntil.size > 0 && (
          <p className="mt-2 text-[12px] font-semibold text-[#9a5b00]">{txn(heldUntil.size, "{n} seat is being booked online right now ({seats}). It comes free again if the passenger doesn't finish in time.", "{n} seats are being booked online right now ({seats}). They come free again if the passenger doesn't finish in time.", { seats: [...heldUntil.keys()].join(', ') })}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-[11px] font-medium text-[#46464f]">
          <Legend className="border border-[#c7c5d1] bg-white" label={tx('Free')} />
          <Legend className="bg-[#050a44]" label={tx('Selected')} />
          <Legend className="bg-[#dc2626]" label={tx('Booked, paid')} />
          <Legend className="bg-[#f97316]" label={tx('Booked, not paid yet')} />
          <Legend className="border-2 border-dashed border-[#f59e0b] bg-[#fef3c7]" label={tx('Being booked online (held)')} />
          <Legend className="bg-[#006e1c]" label={tx('Boarded')} />
          <Legend className="border border-rose-400 bg-rose-50" label={tx('Ladies')} />
          <Legend className="border border-dashed border-[#6d28d9] bg-[#ede9fe]" label={tx('Reserved')} />
        </div>

        <Button variant="gold" className="w-full mt-5" disabled={selected.length === 0 || departed} onClick={() => setSelling(true)}>
          {departed ? tx('This bus has left') : selected.length ? txn(selected.length, 'Sell {n} seat', 'Sell {n} seats') : tx('Tap free seats to sell')}
        </Button>
      </Card>

      <div className="min-w-0 space-y-6">
      <TripTools run={run} bookings={bookings} />
      <Card className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#edeef0]">
          <div>
            <h2 className="text-[16px] font-bold text-[#050a44]">{tx('Passenger list')}</h2>
            <p className="text-[12px] text-[#46464f]">{tx('{boarded} of {sold} seats boarded · {amount} collected', { boarded, sold: run.sold, amount: formatLKR(run.revenue) })}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => downloadManifestPdf(data, run.schedule.id, run.date, { lastOdometer: lastReading(odometer.logs, run.bus.id) })} className="print:hidden">
            <FileDown className="w-4 h-4" />{' '}{tx('Download PDF')}</Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
            <Printer className="w-4 h-4" />{' '}{tx('Print list')}</Button>
        </div>
        <div className="hidden print:block px-5 pt-4">
          <p className="font-bold">
            {OPERATOR.name} · {routeLabel(run.route)} · {formatDateLabel(run.date)} {formatTime12(run.schedule.departure)} · {run.bus.regNo}
          </p>
        </div>
        {manifest.length === 0 ? (
          <p className="p-6 text-[14px] text-[#46464f]">{tx('No bookings yet for this departure.')}</p>
        ) : (
          <div className="overflow-x-auto">
            {/* A normal table on wide screens. On phones each row becomes a block that wraps onto a few
                lines (class "stack-table" in globals.css), so nothing scrolls sideways. */}
            <table className="w-full text-[13px] stack-table" ref={stackTable}>
              <thead>
                <tr className="text-left text-[11px] font-bold text-[#46464f] bg-[#f8f9fb]">
                  <th className="px-4 py-2.5">{tx('Seats')}</th>
                  <th className="px-4 py-2.5">{tx('Passenger')}</th>
                  <th className="px-4 py-2.5">{tx('Gets on → off')}</th>
                  <th className="px-4 py-2.5">{tx('Paid')}</th>
                  <th className="px-4 py-2.5">{tx('Status')}</th>
                  <th className="px-4 py-2.5 print:hidden">
                    <span className="sr-only">{tx('Actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {manifest.map((b) => (
                  <tr key={b.id} className={b.status === 'cancelled' ? 'opacity-50' : ''}>
                    <td className="px-4 py-3 font-bold text-[#050a44] whitespace-nowrap">
                      {b.seats.join(', ')}
                      {b.bikes?.length ? (
                        <span className="material-symbols-outlined text-[16px] text-[#7c5800] align-middle ml-1" title={txn(b.bikes.length, '{n} bike in the compartment', '{n} bikes in the compartment')}>
                          two_wheeler
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 min-w-[170px]">
                      <p className="font-bold text-[#050a44]">{b.passenger.name}</p>
                      <p className="text-[12px] text-[#46464f] whitespace-nowrap">{b.passenger.phone}</p>
                      <p className="text-[11px] text-[#6b6d78] whitespace-nowrap">{b.ref}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {b.from} → {b.to}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {/* Green = paid in full, red = not paid yet, grey = cancelled. */}
                      <p className={`font-bold tabular-nums ${b.status === 'cancelled' ? 'text-[#6b6d78]' : b.paymentStatus === 'unpaid' ? 'text-[#ba1a1a]' : 'text-[#006e1c]'}`}>{formatLKR(b.total)}</p>
                      <Badge value={b.channel} />
                      {b.paymentStatus === 'unpaid' && (b.status === 'held' || b.status === 'boarded') && (
                        <p className="text-[11px] font-bold text-[#ba1a1a] mt-1">{tx('Not paid · {method}', { method: payLabel[b.paymentMethod ?? ''] ?? b.paymentMethod ?? '' })}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={b.status} />
                      {b.status === 'held' && slipOnFile(slipFor(b)) && <div className="mt-1"><Badge value="new" label={tx('Slip to check')} /></div>}
                    </td>
                    <td className="px-4 py-3 print:hidden">
                      <div className="flex flex-wrap gap-1.5 md:justify-end">
                      {b.status === 'confirmed' && (
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" onClick={() => setStatus(b, 'boarded')}>{tx('Boarded')}</Button>
                          <Button size="sm" variant="secondary" onClick={() => setViewing(b)}>{tx('More')}</Button>
                        </div>
                      )}
                      {b.paymentStatus === 'unpaid' && (b.status === 'held' || b.status === 'boarded') && (
                        <div className="flex flex-wrap gap-1.5">
                          {b.status === 'held' && slipOnFile(slipFor(b)) && (
                            <Button size="sm" variant="secondary" onClick={async () => {
                              const u = await slipUrl(b);
                              if (u) window.open(u, '_blank', 'noopener');
                              else toast(tx('Couldn\'t open the slip'), 'error');
                            }}>{tx('View slip')}</Button>
                          )}
                          {/* Bank transfers are recorded as bank payments (after checking the slip); everything else as cash. */}
                          <Button size="sm" variant="gold" onClick={async () => {
                            const bank = b.paymentMethod === 'bank';
                            const r = await confirmPayment(b.id, bank ? 'bank' : 'cash', bank ? b.slip?.reference || undefined : undefined);
                            toast(r.ok ? (bank ? tx('{name}: bank transfer recorded', { name: b.passenger.name }) : tx('{name}: paid in cash', { name: b.passenger.name })) : r.reason ?? tx('Could not take payment'), r.ok ? 'ok' : 'error');
                          }}>
                            {b.paymentMethod === 'bank' ? tx('Mark paid') : tx('Take cash')}
                          </Button>
                        </div>
                      )}
                      {(b.status === 'boarded' || b.status === 'no-show') && (
                        <div className="flex">
                          <Button size="sm" variant="ghost" onClick={() => setStatus(b, b.paymentStatus === 'unpaid' ? 'held' : 'confirmed')}>{tx('Undo')}</Button>
                        </div>
                      )}
                      </div>
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
            toast(tx('Sold {seats} to {name} · {ref}', { seats: input.seats.join(', '), name: input.passenger.name, ref: res.booking.ref }));
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
                <Button variant="danger" onClick={() => setStatus(viewing, 'cancelled')}>{tx('Cancel booking')}</Button>
                <Button variant="secondary" onClick={() => setStatus(viewing, 'no-show')}>{tx('No-show')}</Button>
                <Button onClick={() => setStatus(viewing, 'boarded')}>{tx('Boarded')}</Button>
              </>
            ) : undefined
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-[14px]">
            <Info label={tx('Seats')} value={viewing.seats.join(', ')} />
            <Info label={tx('Status')} value={<Badge value={viewing.status} />} />
            <Info label={tx('Gets on')} value={viewing.from} />
            <Info label={tx('Gets off')} value={viewing.to} />
            <Info label={tx('Phone')} value={viewing.passenger.phone || '—'} />
            <Info label={tx('Email')} value={viewing.contact.email || '—'} />
            <Info label={tx('Paid')} value={formatLKR(viewing.total)} />
            <Info label={tx('Booked')} value={`${new Date(viewing.createdAt).toLocaleString(dateLocale())} (${viewing.channel})`} />
          </dl>
          {viewing.status === 'confirmed' && (
            <p className="text-[12px] text-[#46464f]">{tx('Cancelling here refunds the fare in full (the booking fee is kept) and frees the seats.')}</p>
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
  heldUntil,
}: {
  run: Run;
  taken: Map<string, Gender>;
  owner: Map<string, Booking>;
  selected: string[];
  onToggle: (seat: string) => void;
  /** Seats held by a passenger at checkout → when the hold runs out. */
  heldUntil?: Map<string, string>;
}) {
  // Drawn from the bus's own layout (Staff area → Buses → Edit): gaps stay gaps, a bench can be wider than a row.
  const seatMap = busSeatMap(run.bus);

  const seat = (id: string) => {
    const o = owner.get(id);
    const isSel = selected.includes(id);
    // Seat colours: red = booked and paid, orange = booked but not fully paid,
    // green = on board (orange ring = on board, still to pay), rose = ladies
    // only, purple stripes = reserved, plain = free.
    const due = !!o && o.paymentStatus === 'unpaid';
    const held = !o ? heldUntil?.get(id) : undefined;
    const heldTime = held ? new Date(held).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const cls = o
      ? o.status === 'boarded'
        ? `bg-[#006e1c] text-white ${due ? 'ring-2 ring-[#f97316] ring-offset-1' : ''}`
        : due
          ? 'bg-[#f97316] text-white'
          : 'bg-[#dc2626] text-white'
      : isSel
        ? 'bg-[#050a44] text-white border-[#050a44]'
        : held
          ? 'bg-[#fef3c7] border-2 border-dashed border-[#f59e0b] text-[#7c5800]'
        : (run.bus.reservedSeats ?? []).includes(id)
          ? 'bg-[repeating-linear-gradient(135deg,#ede9fe_0,#ede9fe_4px,#fff_4px,#fff_8px)] border border-dashed border-[#6d28d9] text-[#4c1d95]'
        : run.bus.ladiesSeats.includes(id)
          ? 'bg-rose-50 border border-rose-400 text-rose-700'
          : 'bg-white border border-[#c7c5d1] text-[#46464f] hover:border-[#050a44]';
    return (
      <button
        key={id}
        type="button"
        onClick={() => onToggle(id)}
        title={o ? [`${id}: ${o.passenger.name} (${o.from} → ${o.to})`, due ? tx('NOT PAID, {amount} to collect', { amount: formatLKR(o.total) }) : tx('paid {amount}', { amount: formatLKR(o.total) }), o.status === 'boarded' ? tx('on board') : ''].filter(Boolean).join(' · ') : held ? tx('{id}: being booked online right now, held until {heldTime}. Free again after that if the passenger doesn\'t finish.', { id, heldTime }) : (run.bus.reservedSeats ?? []).includes(id) ? tx('{id}: reserved. Needs the owner\'s code to sell', { id }) : run.bus.ladiesSeats.includes(id) ? tx('{id}: free, ladies only', { id }) : tx('{id}: free', { id })}
        aria-label={o ? tx('Seat {id}, sold to {name}', { id, name: o.passenger.name }) : held ? (isSel ? tx('Seat {id}, being booked online, held until {heldTime}, selected', { id, heldTime }) : tx('Seat {id}, being booked online, held until {heldTime}', { id, heldTime })) : (isSel ? tx('Seat {id}, free, selected', { id }) : tx('Seat {id}, free', { id }))}
        aria-pressed={isSel}
        className={`h-9 rounded-lg text-[11px] font-bold transition-colors ${cls} ${taken.has(id) ? 'cursor-pointer' : ''}`}
      >
        {id}
      </button>
    );
  };

  return (
    <div className="rounded-2xl bg-[#f2f4f6] p-3">
      <p className="text-[10px] font-bold text-[#686873] text-right mb-2 pr-1">{tx('Front · driver')}</p>
      <div className="space-y-2">
        {layoutSegments(seatMap).map((seg, i) =>
          seg.kind === 'row' ? (
            <div key={i} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${seg.cells.length}, minmax(0, 1fr))` }}>
              {seg.cells.map((cell, c) => (cell ? seat(cell) : <span key={`gap-${c}`} aria-hidden />))}
            </div>
          ) : (
            // Sides with different numbers of rows: each side is spread over the same length of bus.
            <div key={i} className="flex items-stretch">
              {([seg.left, seg.right] as const).map((side, k) => (
                <React.Fragment key={k}>
                  {k === 1 && <span aria-hidden style={{ flex: '1 0 0' }} />}
                  {/* Fewer rows: normal spacing, sets the length. More rows: same length, a little closer together. */}
                  <div className="flex flex-col justify-between min-w-0" style={{ flex: `${k === 0 ? seatMap.left : seatMap.right} 0 0`, rowGap: side.length > Math.min(seg.left.length, seg.right.length) ? 2 : 8 }}>
                    {side.map((cells, r) => (
                      <div key={r} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
                        {cells.map((cell, c) => (cell ? seat(cell) : <span key={`gap-${c}`} aria-hidden />))}
                      </div>
                    ))}
                  </div>
                </React.Fragment>
              ))}
            </div>
          ),
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
  // Seats beside a woman travelling alone are kept for women; office staff can override at the counter.
  const { data: storeData } = useStore();
  const pubSettings = usePublicSettings();
  const besideWoman = pubSettings.ladiesAdjacent ? seatsBesideLoneWoman(storeData.bookings, run.bus, run.schedule.id, run.date) : new Set<string>();
  const besideClash = gender !== '' && gender !== 'Female' ? seats.filter((s) => besideWoman.has(s)) : [];
  // Seats in this sale that a passenger is checking out with online right now.
  const { holds: liveHolds } = useSeatHolds(run.schedule.id, run.date);
  const heldPicked = seats.filter((s) => liveHolds.some((h) => h.seat === s && !h.mine)); // not this seller's own lock
  // Office staff may override the ladies-only rule for this one sale.
  const { user } = useAuth();
  const canOverride = isOfficeRole(user?.role);
  const [overrideLadies, setOverrideLadies] = useState(false);

  // Reserved seats: the owner gets a code by text and reads it to the seller.
  const reservedPicked = seats.filter((s) => (run.bus.reservedSeats ?? []).includes(s));
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [ownerCode, setOwnerCode] = useState('');
  const [approved, setApproved] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalMsg, setApprovalMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const askOwner = async () => {
    if (!isSupabaseConfigured) {
      setApproved(true); // demo mode has no owner to text
      return setApprovalMsg({ text: tx('Demo mode: approval skipped.') });
    }
    setApprovalBusy(true);
    setApprovalMsg(null);
    const res = await fetch('/api/owner-approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: run.schedule.id, date: run.date, seats: reservedPicked, note: name.trim() }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setApprovalBusy(false);
    if (!res || !res.ok) return setApprovalMsg({ text: j.error ?? tx('Couldn\'t send the code. Check the connection and try again.'), bad: true });
    setApprovalId(j.id);
    setOwnerCode('');
    setApprovalMsg({ text: j.test ? `Test mode: nothing was texted. The code is ${MOCK_CODE}.` : tx('Code sent to the owner ({sentTo}). Ask them for it; it works for 10 minutes.', { sentTo: j.sentTo }) });
  };
  const checkOwnerCode = async () => {
    if (!approvalId) return;
    setApprovalBusy(true);
    const { data: ok, error } = await supabase().rpc('verify_seat_approval', { p_id: approvalId, p_code: ownerCode });
    setApprovalBusy(false);
    if (error) return setApprovalMsg({ text: friendlyError(error), bad: true });
    if (!ok) return setApprovalMsg({ text: tx('That code isn\'t right. Check it with the owner (5 tries).'), bad: true });
    setApproved(true);
    setApprovalMsg({ text: tx('Owner approved. Issue the ticket within 15 minutes.') });
  };

  const valid =
    validSegment && name.trim().length > 1 && phone.trim().length >= 9 && gender !== '' && ((!ladiesClash && besideClash.length === 0) || (canOverride && overrideLadies)) && (reservedPicked.length === 0 || approved);

  return (
    <Modal
      title={txn(seats.length, 'Sell seat {seats}', 'Sell seats {seats}', { seats: seats.join(', ') })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tx('Cancel')}</Button>
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
                overrideLadies: ladiesClash && canOverride && overrideLadies,
              })
            }
          >{tx('Take {amount} and issue ticket', { amount: formatLKR(fare * seats.length) })}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('Gets on at')}>
          <select className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)}>
            {stops.slice(0, -1).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label={tx('Gets off at')}>
          <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>
            {stops.slice(1).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {!validSegment && <p className="text-[12px] font-semibold text-[#ba1a1a]">{tx('The drop-off must come after the boarding stop on this route.')}</p>}
      <Field label={tx('Passenger name')}>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={tx('Full name')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={tx('Mobile number')}>
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx('07X XXX XXXX')} inputMode="tel" />
        </Field>
        <Field label={tx('Gender')} hint={tx('Needed for ladies-only seats')}>
          <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
            <option value="">{tx('Select')}</option>
            <option>{tx('Female')}</option>
            <option>{tx('Male')}</option>
          </select>
        </Field>
      </div>
      {(ladiesClash || besideClash.length > 0) && (
        <div className="rounded-xl bg-pink-50 border border-pink-200 p-3 space-y-2">
          {ladiesClash && <p className="text-[12px] font-semibold text-[#9d174d]">{tx('Seats {ladiesSeats} are for female passengers.', { ladiesSeats: run.bus.ladiesSeats.join(', ') })}</p>}
          {besideClash.length > 0 && (
            <p className="text-[12px] font-semibold text-[#9d174d]">{tx('Seat {besideClash} is beside a woman travelling alone, so it is kept for women. Offer another seat if you can; override only if the two are travelling together or she agrees.', { besideClash: besideClash.join(', ') })}</p>
          )}
          {canOverride ? (
            <label className="flex items-start gap-2 text-[13px] font-semibold text-[#050a44]">
              <input type="checkbox" className="mt-0.5 w-4 h-4" checked={overrideLadies} onChange={(e) => setOverrideLadies(e.target.checked)} />{tx('Override the ladies seating rule for this sale')}</label>
          ) : (
            <p className="text-[12px] text-[#46464f]">{tx('Only office staff can override this.')}</p>
          )}
        </div>
      )}
      {heldPicked.length > 0 && (
        <div className="rounded-xl bg-[#fef3c7] border border-[#f59e0b]/50 p-3">
          <p className="text-[13px] font-bold text-[#7c5800]">{tx('Seat {heldPicked} is being booked online right now', { heldPicked: heldPicked.join(', ') })}</p>
          <p className="text-[12px] text-[#46464f]">
            {canOverride
              ? tx('A passenger chose it and is at checkout. Selling it here takes it from them: they will be told the seat is gone. Offer another seat if you can.')
              : tx('A passenger chose it and is at checkout. Only office staff can sell over a hold; pick another seat or wait a few minutes.')}
          </p>
        </div>
      )}
      {reservedPicked.length > 0 && (
        <div className="rounded-xl bg-[#f5f3ff] border border-[#ddd6fe] p-3 space-y-2">
          <p className="text-[13px] font-bold text-[#4c1d95]">{txn(reservedPicked.length, 'Seat {seats} is reserved: the owner must agree', 'Seats {seats} are reserved: the owner must agree', { seats: reservedPicked.join(', ') })}</p>
          {approved ? (
            <p className="text-[13px] font-semibold text-[#006e1c]">{tx('✓ Owner approved')}</p>
          ) : (
            <>
              <p className="text-[12px] text-[#46464f]">{tx('We text a code to the owner. If they agree, they give it to you.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={approvalBusy} onClick={askOwner}>
                  {approvalId ? tx('Send a new code') : tx('Send code to the owner')}
                </Button>
                {approvalId && (
                  <>
                    <input
                      className={`${inputClass} w-[130px] tracking-widest text-center`}
                      value={ownerCode}
                      onChange={(e) => setOwnerCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      placeholder={tx('6-digit code')}
                      aria-label={tx('Owner\'s code')}
                    />
                    <Button size="sm" disabled={approvalBusy || ownerCode.length < 6} onClick={checkOwnerCode}>{tx('Check code')}</Button>
                  </>
                )}
              </div>
            </>
          )}
          {approvalMsg && <p className={`text-[12px] font-semibold ${approvalMsg.bad ? 'text-[#ba1a1a]' : 'text-[#46464f]'}`}>{approvalMsg.text}</p>}
        </div>
      )}
      <Field label={tx('Sold via')}>
        <div className="flex gap-2">
          {(['counter', 'phone'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              aria-pressed={channel === c}
              className={`flex-1 h-10 rounded-lg text-[13px] font-bold border capitalize ${channel === c ? 'bg-[#050a44] text-white border-[#050a44]' : 'border-[#c7c5d1] text-[#46464f]'}`}
            >
              {c === 'counter' ? tx('Counter / cash') : tx('Phone booking')}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-[13px] text-[#46464f]">
        {seats.length} × {formatLKR(fare)} = <span className="font-bold text-[#050a44]">{formatLKR(fare * seats.length)}</span>{tx('. No online booking fee on counter sales.')}</p>
    </Modal>
  );
}
