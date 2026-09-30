# Siyan Lanka Travels — online booking

Booking site and operator dashboard for Siyan Lanka Travels (Route 48,
Colombo ⇄ Akkaraipattu). Next.js 16 + Tailwind 4.

**Two modes.** With Supabase keys set it uses a real database and accounts (see "Database"). Without them it runs as a demo with data in the browser (localStorage), and
payments and phone codes are simulated in both modes. See "Going live" below.

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

## Phone (app) layout vs desktop (website) layout
Same pages, two layouts, switched at the `md` breakpoint (768px):
- **Desktop/tablet:** website header (`components/TopNav.tsx`) and footer.
- **Phones:** app layout in `components/mobile/`:
  - `MobileTopBar` — slim bar: logo on Home, back arrow + screen title
    elsewhere; hides while scrolling down; clears the notch.
  - `MobileTabBar` — Home · Book · Trips · Profile, above the gesture bar.
    Hidden in focused flows (seat picking, payment, sign-in).
  - `Fab` — floating "Book a seat" on screens where booking isn't already
    the main action.
  - `PullToRefresh` — only in the installed app (browsers have their own).
  - Screen titles, back targets and which screens hide the tab bar or show
    the button: `components/mobile/routes.ts`.
- The website footer's content lives in **Profile** (`/profile`): account,
  theme, reminders, install, help, legal links, staff login. Legal text is at
  `/legal` (placeholder wording; have it reviewed before going live).
- Loading skeletons (`PageSkeleton` in `lib/store.tsx`, `loading.tsx`) and an
  offline notice (`components/OfflineIndicator.tsx`) replace spinners and
  blank pages.

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

### Installing the app
Where people see it: the download icon in the header, "Install the app" in
the account menu and footer, and a small banner that appears a few seconds
after arriving (hidden for 14 days if they tap ×). These only show when the
browser can actually install the site. Chrome/Edge/Samsung Internet show
their own install prompt. On iPhone, the button explains Share → Add to Home
Screen. Chrome also shows its own install icon in the address bar.
The service worker is registered in `npm run dev` too (with caching off), so
you can test installing locally.

## Notifications
- Passengers turn on **Trip reminders** from My trips or the booking
  confirmation screen. Chrome only allows asking after a tap, so there's no
  automatic pop-up.
- They get a "Booking confirmed" notification after paying, and a reminder
  3 hours before departure while the site/app is open
  (`components/TripReminders.tsx`).
- If notifications are blocked, the card explains how to re-allow them in
  Chrome's site settings. On iPhone, notifications only work after adding the
  app to the Home Screen (iOS 16.4+).
- **Reminders when the app is closed** need a server: generate VAPID keys
  (`npx web-push generate-vapid-keys`), put the public key in
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, save each browser's subscription (see
  `subscribeToPush` in `lib/pwa.ts`) in your database, and send reminders
  from a scheduled job with the `web-push` package. `public/sw.js` already
  shows them and opens My trips when tapped.

## Typography
Headings use Bricolage Grotesque; everything else uses Plus Jakarta Sans. Both
are self-hosted (no Google Fonts). Weights are set centrally in
`app/globals.css` (`--font-weight-*` in `@theme`), a step lighter than
Tailwind's defaults.

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

## Database (Supabase)
Without Supabase keys the app runs in **demo mode** (sample data in the
browser). To connect a real database:

1. **Create a project** at supabase.com (region: Mumbai / `ap-south-1` is
   closest to Sri Lanka).
2. **Run the SQL** (Dashboard → SQL Editor → New query), in this order:
   - `supabase/migrations/20261001000000_init.sql` — tables, security rules,
     booking functions, bike-photo storage
   - `supabase/seed.sql` — ND-2323, Route 48 both ways, the timetable
   (or with the Supabase CLI: `supabase link` then `supabase db push`, then
   run `seed.sql`).
3. **Keys:** Dashboard → Project Settings → API. Copy `.env.example` to
   `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and the **publishable**
   key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the older "anon" key also
   works as `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Never put the secret /
   service_role key in a `NEXT_PUBLIC_` variable. Restart `npm run dev`.
4. **Auth settings:** Authentication → URL Configuration: set Site URL to
   your domain (and add `http://localhost:3000` for testing). "Confirm email"
   is on by default: new passengers click a link before they can sign in.
5. **Make yourself staff:** sign up on the site, then in the SQL Editor run
   `update public.profiles set role = 'staff' where id = (select id from auth.users where email = 'you@example.com');`
   Sign out and back in; `/admin` now opens.

What the database guarantees (tested, see `supabase/tests/`):
- Prices, fees, promo and bike charges are calculated **in the database**
  (`create_booking`); whatever the browser sends is ignored.
- A seat can't be sold twice (unique index on live seats per departure),
  bikes can't overfill the compartment, ladies seats need a female passenger,
  closed/past departures can't be booked.
- Passengers only see their own bookings; the public seat map shows which
  seats are taken, never who. Only staff can edit buses, routes, timetable and
  sell counter tickets. Passengers can't change their own role.
- Bike photos are private (bucket `bike-photos`); each passenger uploads into
  their own folder; staff can see all.
- Seats update live on everyone's screen (Supabase Realtime).

Changing prices or rules later: the database copy lives in the
`app_settings` table (booking fee, promo, refund policy, bike fees). Keep it in
step with `config/operator.ts`, which the pages use for display.

## Going live — still to do
1. ~~Database~~ and ~~real sign-in~~: done with Supabase (see Database).
2. Optional: phone-number sign-in with SMS codes (Supabase supports it with
   an SMS provider such as Twilio, or a local gateway like Dialog/Notify.lk).
3. **Payments**: a Sri Lankan gateway (e.g. PayHere); create the booking from
   the gateway's server callback, not the browser.
4. **SMS** for phone verification and e-tickets (e.g. Dialog/Mobitel APIs).
5. ~~Bike photos to file storage~~: done (Supabase Storage, private bucket).
6. The QR code on tickets uses api.qrserver.com; generate it locally instead so
   booking details aren't sent to a third party.
