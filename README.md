# Siyan Lanka Travels — online booking

Booking site and operator dashboard for Siyan Lanka Travels (Route 48,
Colombo ⇄ Akkaraipattu). Next.js 16 + Tailwind 4.

**This is a working demo.** Data is kept in the browser (localStorage), and
payments and phone codes are simulated. See "Going live" below.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start   # production build
```

- Booking site: `/`
- Operator dashboard: `/admin` (click "Continue as staff (demo)", or sign in
  on `/auth/login` with the **Staff** tab)
- Demo promo code: `SIYAN10`. Demo card: any 16 digits. Phone code: any 4 digits.

## Upgrading an existing folder

Unzip into a **new, empty folder**. If you copy these files over the old
multi-operator project instead, the old files stay behind, and the old
landing page (`app/page.tsx`) keeps showing up at `/`. If that happened,
delete these from the old folder and restart:

```
app/page.tsx   app/api/   public/Codes/   public/brands/   lib/supabase/
lib/seed-mock-data.ts   context/   hooks/   components/OperatorLayout.tsx
components/SuperAdminLayout.tsx   components/data.ts   types.ts
data/vivid-content.json   .next/
```

## Where to change things

| What | Where |
| --- | --- |
| Company name, email, **hotline**, address, booking fee, promo, refund policy | `config/operator.ts` |
| Bike kinds, bike fees, rules, photo size limit | `config/operator.ts` → `bikes` |
| Buses, seat layout, ladies seats, **bike spaces** | `/admin` → Buses |
| Stops, travel times, fares | `/admin` → Routes & timetable |
| Which bus leaves when, on which days | `/admin` → Routes & timetable → Add departure |
| Starting sample data (what "Reset demo data" restores) | `lib/seed.ts` |
| Logo | `public/logo.png` (transparent PNG; always shown on navy) |
| Photos | `public/brand/` |

The hotline is empty for now, so call/WhatsApp buttons are hidden. Add it in
`config/operator.ts` (`phone`, `phoneHref`, `whatsappHref`) and they appear.

## How it fits together

- `lib/types.ts` — data model: Bus → Route (ordered stops with time + fare from
  start) → Schedule (bus + route + time + weekdays) → Booking.
- `lib/trips.ts` — turns that into bookable trips: segment fares, overnight
  arrivals (+1 day), seats taken, bike spaces left, refund quotes, timetable
  clash checks.
- `lib/store.tsx` — the demo "database" (React context + localStorage). Pages
  only call `useStore()`, so swapping in a real backend means rewriting this
  one file.

### Bikes in the luggage compartment
Passengers switch on "Bringing a bike?" on the passenger-details page, pick
bicycle / scooter / motorbike, add make, colour and number plate, and upload a
photo (shrunk in the browser to ~50 KB). A bicycle uses 1 space and a
scooter/motorbike 2; each bus has its own number of spaces. Fees scale with
distance. Staff see a loading list with photos on each departure, ordered so
bikes coming off first are loaded last.

## Timetable assumptions (please check)
Stops, times and fares in `lib/seed.ts` are estimates:
Colombo 9:00 PM → Akkaraipattu ~5:50 AM, LKR 2,800 end to end, via Kurunegala,
Dambulla, Habarana, Polonnaruwa, Welikanda, Valaichchenai, Batticaloa and
Kalmunai. One bus runs out Mon/Wed/Fri and back Tue/Thu/Sat. Edit any of it
in `/admin`.

## Dark mode
Follows the phone/computer setting until the visitor taps the sun/moon
button in the header (then it's remembered). It works by swapping the app's
colour classes in `app/globals.css` (the "Dark mode" section at the end). If
you add a new colour class, add its dark version there. Anything inside an
element with the `keep-navy` class (header, footer, admin sidebar) is left as is.

## App (PWA)
- Installable on Android, iPhone and desktop. Manifest: `app/manifest.ts`;
  icons: `public/icons/`. An "Install the app" button appears in the footer
  when the browser allows it (on iPhone it explains Share → Add to Home Screen).
- `public/sw.js` keeps pages and files people have opened, so tickets still
  open with no signal; unopened pages show `public/offline.html`. It only
  runs in production builds (`npm run build && npm start`). After changing
  `sw.js`, bump `VERSION` in it so phones refresh.

## SEO
- **Set your domain**: copy `.env.example` to `.env` and set
  `NEXT_PUBLIC_SITE_URL`. Canonical links, sitemap and share previews use it.
- Titles, descriptions and share images for every page; private pages
  (my trips, payment, admin, sign-in) are marked no-index.
- `/sitemap.xml` and `/robots.txt` are generated automatically.
- Route pages for Google: `/bus` and `/bus/colombo-to-batticaloa` etc. (one per
  journey) with timetable, fare, stops and FAQs, plus structured data
  (company details, bus trips, FAQs, breadcrumbs). They're built from
  `lib/seed.ts`, so update the timetable there too until there's a database.
- Share image: `public/og.jpg` (1200×630).
- After going live: add the site to Google Search Console and submit
  `https://your-domain/sitemap.xml`; create a Google Business Profile for the
  Bastian Mawatha counter.

## Going live — still to do
1. **Backend + database** (e.g. Supabase/Postgres): move `lib/store.tsx` actions
   to server routes; enforce seat and bike-space checks in the database so two
   people can't book the same seat.
2. **Real auth** for passengers and staff; protect `/admin` on the server.
3. **Payments**: a Sri Lankan gateway (e.g. PayHere); create the booking from
   the gateway's server callback, not the browser.
4. **SMS** for phone verification and e-tickets (e.g. Dialog/Mobitel APIs).
5. **Bike photos** to file storage (not the database), with a size limit.
6. The QR code on tickets uses api.qrserver.com; generate it locally instead so
   booking details aren't sent to a third party.
