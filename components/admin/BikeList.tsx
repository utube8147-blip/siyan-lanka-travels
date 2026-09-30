'use client';
// components/admin/BikeList.tsx — bikes in the luggage compartment, with
// photos the crew can check at loading. Click a photo to see it large.

import { useState } from 'react';
import { OPERATOR } from '@/config/operator';
import type { BikeItem, Booking } from '@/lib/types';
import { formatLKR } from '@/lib/trips';
import { Modal } from './ui';

export function BikeThumb({ bike, size = 56, onOpen }: { bike: BikeItem; size?: number; onOpen?: () => void }) {
  const meta = OPERATOR.bikes.kinds[bike.kind];
  return bike.photo ? (
    <button type="button" onClick={onOpen} className="shrink-0 rounded-lg overflow-hidden border border-[#e1e2e4] hover:ring-2 hover:ring-[#feb700]" style={{ width: size, height: size }} aria-label="View bike photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bike.photo} alt={bike.description} className="w-full h-full object-cover" />
    </button>
  ) : (
    <span className="shrink-0 rounded-lg bg-[#f2f4f6] text-[#46464f] flex flex-col items-center justify-center" style={{ width: size, height: size }} title="Booked at the counter, no photo">
      <span className="material-symbols-outlined text-[22px]">{meta.icon}</span>
    </span>
  );
}

export function BikeLoadingList({ bookings, stopOrder, spaces }: { bookings: Booking[]; stopOrder: (stop: string) => number; spaces: number }) {
  const [open, setOpen] = useState<{ bike: BikeItem; booking: Booking } | null>(null);
  // Bikes going furthest are loaded first (deepest in the compartment),
  // so the ones coming off earliest are nearest the door.
  const rows = bookings
    .filter((b) => b.status === 'confirmed' || b.status === 'boarded')
    .flatMap((b) => (b.bikes ?? []).map((bike) => ({ bike, booking: b })))
    .sort((a, b) => stopOrder(b.booking.to) - stopOrder(a.booking.to));
  const used = rows.reduce((n, r) => n + OPERATOR.bikes.kinds[r.bike.kind].spaces, 0);

  return (
    <div className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#edeef0]">
        <div>
          <h2 className="text-[16px] font-bold text-[#050a44] flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-[#7c5800]">two_wheeler</span>
            Luggage compartment
          </h2>
          <p className="text-[12px] text-[#46464f]">Load in this order: first in comes off last.</p>
        </div>
        <div className="flex gap-1" aria-label={`${used} of ${spaces} bike spaces used`}>
          {Array.from({ length: spaces }).map((_, i) => (
            <span key={i} className={`w-5 h-2.5 rounded-full ${i < used ? 'bg-[#feb700]' : 'bg-[#edeef0]'}`} />
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="p-5 text-[14px] text-[#46464f]">No bikes booked on this departure.</p>
      ) : (
        <ol className="divide-y divide-[#edeef0]">
          {rows.map(({ bike, booking }, i) => (
            <li key={bike.id} className="flex items-center gap-4 px-5 py-3">
              <span className="w-6 text-[13px] font-extrabold text-[#6b6d78] tabular-nums">{i + 1}</span>
              <BikeThumb bike={bike} onOpen={() => setOpen({ bike, booking })} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold text-[#050a44] truncate">
                  {OPERATOR.bikes.kinds[bike.kind].label} · {bike.description}
                </p>
                <p className="text-[12px] text-[#46464f] truncate">
                  {bike.regNo ? `${bike.regNo} · ` : ''}
                  {booking.passenger.name}, seat {booking.seats.join(', ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] font-bold text-[#686873]">Unload at</p>
                <p className="text-[13px] font-bold text-[#050a44]">{booking.to}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <Modal title={`${OPERATOR.bikes.kinds[open.bike.kind].label} · ${open.booking.ref}`} onClose={() => setOpen(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.bike.photo} alt={open.bike.description} className="w-full rounded-xl border border-[#e1e2e4]" />
          <dl className="grid grid-cols-2 gap-3 text-[14px]">
            {[
              ['Bike', open.bike.description],
              ['Number plate', open.bike.regNo || '—'],
              ['Passenger', `${open.booking.passenger.name} (${open.booking.passenger.phone})`],
              ['Seat', open.booking.seats.join(', ')],
              ['Gets on / off', `${open.booking.from} → ${open.booking.to}`],
              ['Paid for bike', formatLKR(open.bike.fee)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-bold text-[#686873]">{k}</dt>
                <dd className="font-semibold text-[#050a44] break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </div>
  );
}
