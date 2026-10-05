// lib/bookingView.ts
// Converts a stored Booking into the display shape used by the ticket cards on
// /my-bookings and /dashboard (formatted dates/times, bus label, status).

import { bikeKind } from './bikeConfig';
import { OPERATOR } from '@/config/operator';
import type { Booking, StoreData } from './types';
import { departureDate, formatDateLabel, formatTime12, getTrip } from './trips';

export type ViewStatus = 'confirmed' | 'pending' | 'completed' | 'cancelled';

export interface BookingView {
  id: string;
  bookingRef: string;
  operator: string;
  travelClass: string;
  from: string;
  to: string;
  date: string;
  isoDate: string;
  departureTime: string;
  arrivalTime: string;
  busNumber: string;
  totalPrice: number;
  status: ViewStatus;
  seats: string[];
  seatPrice: number;
  reschedulable: boolean;
  seatsChangeable: boolean;
  scheduleId: string;
  /** e.g. "Motorbike (EP BGK-1234)" per bike in the luggage compartment. */
  bikes: string[];
  /** Sort key: departure timestamp. */
  sortKey: number;
}

export function toBookingView(b: Booking, data: StoreData, now = new Date()): BookingView {
  const trip = getTrip(data, b.scheduleId, b.date, b.from, b.to, now);
  const leaves = trip ? departureDate(trip.boardingDate, trip.departure) : departureDate(b.date, '00:00');
  const inPast = leaves.getTime() < now.getTime();
  let status: ViewStatus;
  if (b.status === 'cancelled') status = 'cancelled';
  else if (b.status === 'boarded' || b.status === 'no-show' || inPast) status = 'completed';
  else status = 'confirmed';
  // A ticket bought before the booking window was shortened can still be changed or cancelled.
  const changeable = status === 'confirmed' && !!trip && (!trip.closed || !!trip.opensOn);
  return {
    id: b.id,
    bookingRef: b.ref,
    operator: OPERATOR.name,
    travelClass: trip ? `${trip.bus.type} Coach` : 'Coach',
    from: b.from,
    to: b.to,
    date: formatDateLabel(trip ? trip.boardingDate : b.date),
    isoDate: b.date,
    departureTime: trip ? formatTime12(trip.departure) : '',
    arrivalTime: trip ? `${formatTime12(trip.arrival)}${trip.arrivalDayOffset ? ' +1' : ''}` : '',
    busNumber: trip ? `${trip.bus.name} · ${trip.bus.regNo}` : '',
    totalPrice: b.total,
    status,
    seats: b.seats,
    seatPrice: b.fare,
    reschedulable: changeable,
    seatsChangeable: changeable,
    scheduleId: b.scheduleId,
    bikes: (b.bikes ?? []).map((x) => `${bikeKind(x.kind).label}${x.regNo ? ` (${x.regNo})` : ''}`),
    sortKey: leaves.getTime(),
  };
}
