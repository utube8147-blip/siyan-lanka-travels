// lib/types.ts
// Domain model for a single bus operator. Designed so adding bus #2, #3...
// is just adding records: routes and schedules reference buses by id.

import type { SeatMap } from './seatLayout';

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
  /**
   * The seat grid (any arrangement and any seat numbers), set in Staff area →
   * Buses → Edit. Missing = the classic 2+2 rows from `rows` / `backRowSeats`.
   */
  seatMap?: SeatMap | null;
  /** Seats kept back by the owner. Not bookable online; staff can sell one only with the owner's code. */
  reservedSeats?: string[];
  amenities: string[];
  status: BusStatus;
  /** Bike spaces in the luggage compartment (0 = no bikes on this bus). */
  bikeSpaces: number;
  /** Photos of the bus (public URLs; data URLs in demo mode). The first is the cover. */
  photos?: string[];
}

/** A bike category id from Staff area → Settings → Bikes (e.g. "scooter"). */
export type BikeKind = string;

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
  /** Map pin for "where to wait" (optional). */
  lat?: number;
  lng?: number;
  /** e.g. "Clock tower roundabout, Kurunegala town" */
  landmark?: string;
  /** Photo of the exact spot (URL). */
  photo?: string;
  notes?: string;
  /**
   * "On request": the bus only goes here when at least `minSeats` seats are
   * booked to or from it by the cut-off (Settings, hours before departure).
   * Otherwise those passengers are moved to the nearest main stop and told.
   */
  optional?: boolean;
  minSeats?: number;
  /**
   * A point that only shapes the road (the bus goes this way) and isn't a stop:
   * passengers don't see it and can't book to or from it. The first and last
   * stops can't be hidden.
   */
  hidden?: boolean;
}

export interface Route {
  id: string;
  /** Name staff gave it, e.g. "Akkaraipattu to Colombo". Empty = "first stop → last stop". */
  name?: string;
  /** Stops in travel order. First = origin, last = final destination. */
  stops: RouteStop[];
  /**
   * One price for the whole route: every ticket costs the full-route fare
   * (the last stop's fareFromStart) whichever stops the passenger uses.
   * false = pay for the stretch you ride (difference between the two stops).
   * Missing counts as true.
   */
  flatFare?: boolean;
  active: boolean;
  /** Deleted, but kept because old tickets point to it. Hidden everywhere. */
  archived?: boolean;
  /** Route editor timing: bus time = car time × busFactor, plus stopMin at each stop. */
  busFactor?: number;
  stopMin?: number;
  /**
   * Other ways the bus can go, drawn by staff, for when some on-request stops
   * don't fill. Each has every main stop, plus the on-request stops it covers.
   * A trip uses the variant that covers exactly the on-request stops running.
   */
  variants?: RouteVariant[];
}

export interface RouteVariant {
  id: string;
  name: string;
  stops: RouteStop[];
  /**
   * Changed by staff in the route editor. Automatic variants (one for every
   * mix of on-request stops) are rebuilt from the route whenever it's saved;
   * edited ones are kept as they are.
   */
  edited?: boolean;
  /** Main stops staff took out of this variant on purpose (passengers booked there use the nearest point on the way). */
  removed?: string[];
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
  /**
   * Alternate-day running: when set (2 = every other day, 3 = every third…),
   * the bus runs every `everyDays` days counted from `startDate`, and `days`
   * is ignored. Lets one bus go out one night and come back the next, which
   * a 7-day week can't express.
   */
  everyDays?: number | null;
  /** "YYYY-MM-DD": the first date of the alternate-day pattern. */
  startDate?: string | null;
  active: boolean;
  /** Deleted, but kept because old tickets point to it. Hidden everywhere. */
  archived?: boolean;
}

export type BookingStatus = 'confirmed' | 'held' | 'boarded' | 'cancelled' | 'no-show';
/** 'bus' = reserved online, cash to the conductor on the bus. */
export type PaymentMethod = 'card' | 'wallet' | 'bank' | 'counter' | 'bus' | 'cash' | 'free';
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
  /**
   * The stop the passenger chose, when the bus doesn't go there on this trip
   * (an on-request stop that didn't fill, or one tonight's variant leaves out):
   * from/to then hold the stop they use instead.
   */
  bookedFrom?: string;
  bookedTo?: string;
  seats: string[];
  passenger: { name: string; gender: Gender; phone: string };
  /** Who sits in each seat ('' = not given); missing seats use passenger.gender. */
  seatGenders?: Record<string, Gender>;
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
  /** Card / wallet: the payment gateway's cut, included in total. */
  gatewayFee?: number;
  discount: number;
  total: number;
  status: BookingStatus;
  /** How it's paid; 'bank' / 'counter' bookings are held until paid. */
  paymentMethod?: PaymentMethod;
  paymentStatus?: 'paid' | 'unpaid' | 'refunded';
  /** Held bookings are released automatically after this (ISO). */
  holdExpiresAt?: string | null;
  rewardUsed?: boolean;
  createdAt: string; // ISO
  refund?: { amount: number; at: string };
  /** Staff member who recorded the payment (cash taken at the counter or on the bus). */
  paidBy?: string | null;
  /** The cash was taken by the conductor on the bus (the trip's cash), not in the office. */
  paidOnBus?: boolean;
  /** Push reminders for this trip (the bell in My trips). Missing = on. */
  notify?: boolean;
  /** Bank-transfer slip the passenger uploaded for a held booking. */
  slip?: { path: string; reference: string; uploadedAt: string } | null;
  /** Why staff sent the last slip back (cleared when a new one is uploaded). */
  slipRejectedReason?: string | null;
  /** Made from Staff area → Test passengers (to try the conductor app); deleted from there. */
  isTest?: boolean;
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
  /** Departure in the past or inside the booking cut-off, or not open for booking yet (see opensOn). */
  closed: boolean;
  /** Set when the trip is further ahead than passengers can book: the date booking opens. */
  opensOn?: string | null;
}

/** What a page passes to createBooking. Prices here are for display only:
 *  with Supabase the server recalculates everything. */
export type NewBooking = Omit<Booking, 'id' | 'ref' | 'createdAt' | 'status'> & Partial<Pick<Booking, 'status'>> & {
  promo?: string;
  /** Booked from the installed app (for the app-only promo). */
  inApp?: boolean;
  /** 'card' | 'wallet' (online, through the gateway), 'bank' (seat held until the slip is checked); staff: 'cash' / 'counter'. */
  payment?: PaymentMethod;
  useReward?: boolean;
  /** Office staff only: sell a ladies-only seat to a male passenger for this one sale. */
  overrideLadies?: boolean;
};

export type ActionResult = { ok: boolean; reason?: string };
export type BookingResult = { ok: true; booking: Booking } | { ok: false; reason: string };

export interface StoreData {
  version: number;
  buses: Bus[];
  routes: Route[];
  schedules: Schedule[];
  bookings: Booking[];
  /** How many days ahead passengers can book (0 = no limit). Staff: always 0. */
  bookingWindowDays?: number;
  /** On-request stops are decided this many hours before departure. */
  optionalCutoffHours?: number;
}
