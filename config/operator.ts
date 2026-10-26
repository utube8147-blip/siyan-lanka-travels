import { N_ } from '@/lib/i18n-core';
// config/operator.ts
// ---------------------------------------------------------------------------
// The ONE place to rebrand the platform for your bus company.
// Everything customer-facing (nav, footer, tickets, emails-to-be, admin)
// reads from here, so changing the name/phone/colors below updates the whole
// site. Buses, routes and schedules are NOT here: they are data, managed from
// the operator dashboard at /admin (see lib/seed.ts for the starting data).
// ---------------------------------------------------------------------------

// Hotline shown to passengers, from .env so it can change without editing code:
//   NEXT_PUBLIC_HOTLINE=0771234567        (call button, "tel:" links, messages)
//   NEXT_PUBLIC_WHATSAPP=0771234567       (optional; defaults to the hotline)
// Leave NEXT_PUBLIC_HOTLINE empty and the site hides the call / WhatsApp buttons.
const HOTLINE = (process.env.NEXT_PUBLIC_HOTLINE ?? '').trim();
const WHATSAPP = (process.env.NEXT_PUBLIC_WHATSAPP ?? '').trim() || HOTLINE;
/** 0771234567 / +94 77 123 4567 / 94771234567 → 94771234567 */
const lkDigits = (n: string) => n.replace(/\D/g, '').replace(/^0/, '94');
/** 94771234567 → 077 123 4567 (how the number is written for passengers) */
const lkDisplay = (n: string) => {
  const d = lkDigits(n).replace(/^94/, '0');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : n;
};

export const OPERATOR = {
  /** Full company name, shown in the footer, tickets and page titles. */
  name: 'Siyan Lanka Travels',
  /** Wordmark shown in the top nav (second line is the smaller "TRAVELS"). */
  shortName: 'SIYAN LANKA',
  wordmarkSub: 'TRAVELS',
  /** Two letters used on ticket badges when there's no logo. */
  initials: 'SL',
  tagline: N_('Luxury AC night coach between Colombo and the East: Polonnaruwa, Batticaloa, Kalmunai and Akkaraipattu.'),

  contact: {
    // From NEXT_PUBLIC_HOTLINE / NEXT_PUBLIC_WHATSAPP in .env (see above).
    phone: HOTLINE ? lkDisplay(HOTLINE) : '',
    phoneHref: HOTLINE ? `tel:+${lkDigits(HOTLINE)}` : '',
    whatsappHref: WHATSAPP ? `https://wa.me/${lkDigits(WHATSAPP)}` : '',
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
  /** Platform fee per online booking (LKR); the live value is in Staff area → Settings. */
  bookingFee: 120,
  /** Card / wallet: the payment gateway's cut (percent), added to what goes through it. */
  gatewayFeePercent: 3,
  /** Demo promo code; percent off the fare (not the fee). */
  promo: { code: 'SIYAN10', percentOff: 10 },

  /** How many seats one person can book in a single booking. */
  maxSeatsPerBooking: 6,
  /** Minutes a selected seat is held on the seat page before it's released. */
  seatHoldMinutes: 10,
  /** Online booking closes this many minutes before departure. */
  bookingCutoffMinutes: 30,
  /** Passengers can book this many days ahead (0 = no limit). The live value is
   *  Staff area → Settings; this is the fallback and the demo-mode value. */
  bookingWindowDays: 7,

  /**
   * Cancellation policy used for refunds (hours before the bus leaves the
   * passenger's stop → % of the fare back). 4 hours or more before: 90% (a 10%
   * service charge covers admin and payment processing); less than 4 hours, or
   * not turning up: nothing (the seat counts as taken). The live value is
   * Staff area → Settings; this is the fallback and the demo-mode value.
   */
  refundPolicy: [
    { hoursBefore: 4, percent: 90 },
    { hoursBefore: 0, percent: 0 },
  ],

  /**
   * Bikes in the luggage compartment under the bus. Each bus has a number of
   * "spaces" (set per bus in /admin → Buses); each kind of bike uses some.
   * Fees are for the full route and scale down for shorter trips.
   */
  bikes: {
    kinds: {
      scooter: { label: N_('Scooter / e-bike'), icon: 'moped', spaces: 2, fullRouteFee: 1200 },
      motorbike: { label: N_('Motorbike'), icon: 'two_wheeler', spaces: 2, fullRouteFee: 1500 },
    },
    minFee: 300,
    maxPerBooking: 2,
    maxPhotoMB: 10,
    rules: [
      N_('Motorbike and scooter fuel tanks no more than a quarter full.'),
      N_('Take off helmets, bags and anything loose; they travel with you.'),
      N_('Be at the boarding point 30 minutes early so the crew can load it.'),
      N_('The crew will check the bike matches your photo before loading.'),
    ],
  },

  features: {
    /** Demo mode only: passenger resale on/off. With Supabase, use Staff area → Settings. */
    resale: false,
  },
} as const;

export type OperatorConfig = typeof OPERATOR;
