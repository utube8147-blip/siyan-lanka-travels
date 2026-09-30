// config/operator.ts
// ---------------------------------------------------------------------------
// The ONE place to rebrand the platform for your bus company.
// Everything customer-facing (nav, footer, tickets, emails-to-be, admin)
// reads from here, so changing the name/phone/colors below updates the whole
// site. Buses, routes and schedules are NOT here: they are data, managed from
// the operator dashboard at /admin (see lib/seed.ts for the starting data).
// ---------------------------------------------------------------------------

export const OPERATOR = {
  /** Full company name, shown in the footer, tickets and page titles. */
  name: 'Siyan Lanka Travels',
  /** Wordmark shown in the top nav (second line is the smaller "TRAVELS"). */
  shortName: 'SIYAN LANKA',
  wordmarkSub: 'TRAVELS',
  /** Two letters used on ticket badges when there's no logo. */
  initials: 'SL',
  tagline: 'Luxury AC night coach between Colombo and the East: Polonnaruwa, Batticaloa, Kalmunai and Akkaraipattu.',

  contact: {
    // TODO: add your hotline. Leave empty and the site hides call/WhatsApp buttons.
    phone: '',
    phoneHref: '',
    whatsappHref: '',
    email: 'siyanlanka3332@gmail.com',
    address: 'Bastian Mawatha, Pettah, Colombo 11',
  },

  /**
   * Public web address, used for SEO (canonical links, sitemap, share
   * previews). TODO: set NEXT_PUBLIC_SITE_URL to your real domain when live.
   */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.siyanlanka.lk').replace(/\/$/, ''),
  /** Words people search for; used in page descriptions/keywords. */
  seoKeywords: [
    'Siyan Lanka Travels',
    'Colombo to Batticaloa bus',
    'Colombo to Kalmunai bus',
    'Colombo to Akkaraipattu bus',
    'Colombo to Polonnaruwa bus',
    'route 48 bus',
    'night bus Sri Lanka',
    'AC luxury bus booking',
    'online bus ticket Sri Lanka',
    'Eastern Province bus',
  ],

  /** Booking-reference prefix, e.g. VVD-7K2Q1P */
  refPrefix: 'SLT',

  currency: 'LKR',
  /** Flat convenience fee added once per booking (LKR). */
  bookingFee: 50,
  /** Demo promo code; percent off the fare (not the fee). */
  promo: { code: 'SIYAN10', percentOff: 10 },

  /** How many seats one person can book in a single booking. */
  maxSeatsPerBooking: 6,
  /** Minutes a selected seat is held on the seat page before it's released. */
  seatHoldMinutes: 10,
  /** Online booking closes this many minutes before departure. */
  bookingCutoffMinutes: 30,

  /** Cancellation policy used for refunds (hours before departure → % back). */
  refundPolicy: [
    { hoursBefore: 24, percent: 90 },
    { hoursBefore: 6, percent: 50 },
    { hoursBefore: 0, percent: 0 },
  ],

  /**
   * Bikes in the luggage compartment under the bus. Each bus has a number of
   * "spaces" (set per bus in /admin → Buses); each kind of bike uses some.
   * Fees are for the full route and scale down for shorter trips.
   */
  bikes: {
    kinds: {
      bicycle: { label: 'Bicycle', icon: 'pedal_bike', spaces: 1, fullRouteFee: 600 },
      scooter: { label: 'Scooter / e-bike', icon: 'moped', spaces: 2, fullRouteFee: 1200 },
      motorbike: { label: 'Motorbike', icon: 'two_wheeler', spaces: 2, fullRouteFee: 1500 },
    },
    minFee: 300,
    maxPerBooking: 2,
    maxPhotoMB: 10,
    rules: [
      'Motorbike and scooter fuel tanks no more than a quarter full.',
      'Take off helmets, bags and anything loose; they travel with you.',
      'Be at the boarding point 30 minutes early so the crew can load it.',
      'The crew will check the bike matches your photo before loading.',
    ],
  },

  features: {
    /** Passenger-to-passenger ticket resale. Hide it from the nav with false. */
    resale: true,
  },
} as const;

export type OperatorConfig = typeof OPERATOR;
