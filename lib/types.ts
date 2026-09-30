// lib/types.ts
// Domain model for a single bus operator. Designed so adding bus #2, #3...
// is just adding records: routes and schedules reference buses by id.

export type BusType = 'AC' | 'Non-AC';
export type BusStatus = 'active' | 'maintenance' | 'retired';

export interface Bus {
  id: string;
  /** Friendly name shown to passengers, e.g. "Coach 1". */
  name: string;
  /** Registration number, e.g. "NB-4521". */
  regNo: string;
  type: BusType;
  /** Rows of 2+2 seating (A B | C D). */
  rows: number;
  /** Seats across the back bench (0 for none, usually 5). */
  backRowSeats: number;
  /** Seat ids set aside for female passengers, e.g. ["1A","1B"]. */
  ladiesSeats: string[];
  amenities: string[];
  status: BusStatus;
  /** Bike spaces in the luggage compartment (0 = no bikes on this bus). */
  bikeSpaces: number;
}

export type BikeKind = 'bicycle' | 'scooter' | 'motorbike';

export interface BikeItem {
  id: string;
  kind: BikeKind;
  /** e.g. "Honda Dio, red" */
  description: string;
  /** Number plate; required for scooters and motorbikes. */
  regNo: string;
  /** Photo as a compressed data URL (demo). In production: a storage URL. */
  photo: string;
  fee: number;
}

export interface RouteStop {
  /** Place name as passengers search for it, e.g. "Kegalle". */
  name: string;
  /** Minutes after the route's first departure that the bus reaches this stop. */
  offsetMin: number;
  /** Fare from the first stop to this one (LKR). Segment fare = difference. */
  fareFromStart: number;
}

export interface Route {
  id: string;
  /** Stops in travel order. First = origin, last = final destination. */
  stops: RouteStop[];
  active: boolean;
}

/** 0 = Sunday ... 6 = Saturday */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Schedule {
  id: string;
  routeId: string;
  busId: string;
  /** "HH:MM" 24h, departure from the route's first stop. */
  departure: string;
  days: Weekday[];
  active: boolean;
}

export type BookingStatus = 'confirmed' | 'boarded' | 'cancelled' | 'no-show';
export type Gender = 'Male' | 'Female' | '';
export type BookingChannel = 'online' | 'counter' | 'phone';

export interface Booking {
  id: string;
  ref: string;
  scheduleId: string;
  /** Travel date "YYYY-MM-DD" (date the bus leaves its first stop). */
  date: string;
  from: string;
  to: string;
  seats: string[];
  passenger: { name: string; gender: Gender; phone: string };
  contact: { email: string; phone: string };
  /** Set when a signed-in passenger booked it (links it to My Bookings). */
  userId?: string;
  channel: BookingChannel;
  fare: number; // per seat
  /** Bikes travelling in the luggage compartment on this booking. */
  bikes?: BikeItem[];
  /** Sum of bike fees (included in total). */
  bikeFee?: number;
  fee: number;
  discount: number;
  total: number;
  status: BookingStatus;
  createdAt: string; // ISO
  refund?: { amount: number; at: string };
}

/** A bookable departure on a specific date, for a from→to segment. */
export interface Trip {
  scheduleId: string;
  routeId: string;
  bus: Bus;
  /** Date the bus leaves its FIRST stop (what bookings are stored against). */
  date: string;
  /** Date the passenger actually gets on (later than `date` after midnight). */
  boardingDate: string;
  /** Days after boardingDate that the bus reaches the drop-off (0 or 1). */
  arrivalDayOffset: number;
  from: string;
  to: string;
  /** "HH:MM" at the passenger's boarding stop / drop-off stop. */
  departure: string;
  arrival: string;
  durationMin: number;
  /** Stops strictly between from and to. */
  via: string[];
  fare: number;
  capacity: number;
  seatsBooked: number;
  seatsLeft: number;
  bikeSpaces: number;
  bikeSpacesLeft: number;
  /** Share of the full-route fare this trip covers (scales bike fees). */
  routeShare: number;
  /** Departure in the past or inside the booking cut-off. */
  closed: boolean;
}

export interface StoreData {
  version: number;
  buses: Bus[];
  routes: Route[];
  schedules: Schedule[];
  bookings: Booking[];
}
