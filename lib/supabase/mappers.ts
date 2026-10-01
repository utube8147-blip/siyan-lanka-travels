// Database rows ⇄ the app's types (lib/types.ts).
import type { BikeItem, Booking, Bus, Route, Schedule, Weekday } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const busFromRow = (r: any): Bus => ({
  id: r.id,
  name: r.name,
  regNo: r.reg_no,
  type: r.type,
  rows: r.rows,
  backRowSeats: r.back_row_seats,
  ladiesSeats: r.ladies_seats ?? [],
  amenities: r.amenities ?? [],
  status: r.status,
  bikeSpaces: r.bike_spaces ?? 0,
});
export const busToRow = (b: Bus) => ({
  id: b.id,
  name: b.name,
  reg_no: b.regNo,
  type: b.type,
  rows: b.rows,
  back_row_seats: b.backRowSeats,
  ladies_seats: b.ladiesSeats,
  amenities: b.amenities,
  status: b.status,
  bike_spaces: b.bikeSpaces ?? 0,
});

export const routeFromRow = (r: any): Route => ({ id: r.id, stops: r.stops, active: r.active });
export const routeToRow = (r: Route) => ({ id: r.id, stops: r.stops, active: r.active });

export const scheduleFromRow = (r: any): Schedule => ({
  id: r.id,
  routeId: r.route_id,
  busId: r.bus_id,
  departure: r.departure,
  days: (r.days ?? []) as Weekday[],
  active: r.active,
});
export const scheduleToRow = (s: Schedule) => ({
  id: s.id,
  route_id: s.routeId,
  bus_id: s.busId,
  departure: s.departure,
  days: s.days,
  active: s.active,
});

export const bikeFromRow = (r: any, photoUrl?: string): BikeItem => ({
  id: r.id,
  kind: r.kind,
  description: r.description,
  regNo: r.reg_no ?? '',
  photo: photoUrl ?? '',
  fee: r.fee,
});

export const bookingFromRow = (r: any, photoUrls: Record<string, string> = {}): Booking => ({
  id: r.id,
  ref: r.ref,
  scheduleId: r.schedule_id,
  date: r.travel_date,
  from: r.from_stop,
  to: r.to_stop,
  seats: r.seats ?? [],
  passenger: { name: r.passenger_name, gender: r.passenger_gender ?? '', phone: r.passenger_phone ?? '' },
  contact: { email: r.contact_email ?? '', phone: r.contact_phone ?? '' },
  userId: r.user_id ?? undefined,
  channel: r.channel,
  fare: r.fare,
  fee: r.fee,
  discount: r.discount,
  bikeFee: r.bike_fee || undefined,
  bikes: (r.booking_bikes ?? []).map((b: any) => bikeFromRow(b, b.photo_path ? photoUrls[b.photo_path] : undefined)),
  total: r.total,
  status: r.status,
  paymentMethod: r.payment_method,
  paymentStatus: r.payment_status,
  holdExpiresAt: r.hold_expires_at,
  rewardUsed: r.reward_used,
  createdAt: r.created_at,
  refund: r.refund_amount != null ? { amount: r.refund_amount, at: r.refunded_at } : undefined,
});
