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

## Phone sign-in (MessageBird, through Supabase)
Passengers sign up and sign in with their mobile number and a 6-digit text
code (email + password is still offered). **Supabase sends the codes itself
via MessageBird**; there's no MessageBird code or key in this app, and it
works on `localhost` too.

1. **MessageBird** (now part of *Bird*): create an account, add credit, and
   copy a **live API access key** (Developers → API access). Choose an
   originator (sender name, max 11 letters/digits, e.g. `SiyanLanka`).
   Sri Lankan networks may require the sender name to be registered first;
   until then use a number as the originator. Note: Supabase uses the
   classic MessageBird SMS API. If a new Bird account doesn't offer a classic
   live access key, Twilio Verify or Vonage work the same way in step 2.
2. Supabase → Authentication → **Sign In / Providers → Phone**: turn on,
   SMS provider **MessageBird**, paste the access key and originator, save.
   The text template ("Your code is {{ .Code }}") and code expiry are here too.
3. Authentication → **Rate Limits**: check the SMS-per-hour limit.
4. Testing without paying for texts: in the same Phone settings add **test
   phone numbers** with a fixed code (e.g. `94771234567=123456`).

If MessageBird isn't set up (Supabase answers "Unsupported phone provider"),
passengers see "We can't send text codes right now" with a one-tap "use
email instead", and the browser console says what to fix.
Demo mode (no Supabase): no text is sent; the code is **123456**.

**All other texts use Notify.lk** (booking confirmed, seat held, cancelled,
trip updates, waitlist offers): sent by `/api/messages/dispatch`; see Messages.

## Payments
- Passengers choose **Card / Mobile wallet** (PayHere: Visa, Mastercard,
  Amex, eZ Cash, mCash, Genie), **Bank transfer** or **Pay at counter**.
  Bank / counter bookings hold the seat (24 h / 2 h by default, never past
  the booking cut-off); unpaid holds are released automatically.
- Staff take payment for holds from the departure list ("Take cash") or a
  booking ("Mark paid").
- **Going live with PayHere:** set `PAYHERE_MERCHANT_ID`,
  `PAYHERE_MERCHANT_SECRET` (and `PAYHERE_SANDBOX=false` when approved), add
  your domain in PayHere, then Staff area → Settings → Payments → PayHere.
  The booking is confirmed only when PayHere calls `/api/payhere/notify` and
  the signature and amount check out.
- ⚠️ While Settings → Payments is on *Demo*, card bookings are confirmed
  without taking money. Don't open to the public like that.

## Messages (SMS / WhatsApp)
The database queues a message when a booking is confirmed, a seat is held,
a booking is cancelled, a waitlisted seat frees up, or the crew posts a trip
update. `/api/messages/dispatch` sends them (Notify.lk SMS; WhatsApp Cloud
API if configured) and logs the result (Settings → Recent messages).
Run it every minute with `Authorization: Bearer $CRON_SECRET`, e.g. with
Supabase pg_cron + pg_net:
```sql
select cron.schedule('send-messages', '* * * * *', $$
  select net.http_post(url := 'https://your-domain/api/messages/dispatch',
                       headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'))
$$);
```
WhatsApp: business-started messages need an approved template; create one
named `siyan_update` with the body `{{1}}`.

## Live tracking ("Track my bus")
No GPS tracker is needed: the bus location comes from the **conductor's
phone GPS** through the conductor page (`/conductor` → *Share location*,
or Staff area → Departures). It sends on movement plus a heartbeat every
30 s while stopped, keeps the screen on, resumes by itself after the screen
locks / the app is switched / the page is reopened, and catches up after
lost signal. The conductor sees "Live · sent 8 s ago · ±12 m" or a warning.
Tips for the crew: keep the conductor page open on a phone mount, plugged
into the bus charger, and add it to the home screen. (Browsers pause GPS when
the page isn't on screen; for sharing with the screen off you'd need a small
native app wrapper later, e.g. Capacitor with a background-location plugin.)
The conductor taps **Share location** and keeps the phone in the bus; passengers open **Track** on
their ticket to see the bus on a map, its recent positions, the arrival
estimate at their stop and crew updates.
Right now the database keeps the latest position only; the page builds the
trail from live updates while it's open. To keep the **last 5 positions**
in the database later, run this and change `loadRecentPositions()` in
`lib/tracking.ts` to read `bus_location_history` (the map already handles
a list):
```sql
create table public.bus_location_history (
  id bigint generated always as identity primary key,
  schedule_id text not null, travel_date date not null,
  lat double precision not null, lng double precision not null,
  speed_kmh numeric, heading numeric, recorded_at timestamptz not null default now()
);
create index on public.bus_location_history (schedule_id, travel_date, recorded_at desc);
alter table public.bus_location_history enable row level security;
create policy "read history" on public.bus_location_history for select using (true);
create function public.keep_location_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into bus_location_history (schedule_id, travel_date, lat, lng, speed_kmh, heading)
  values (new.schedule_id, new.travel_date, new.lat, new.lng, new.speed_kmh, new.heading);
  delete from bus_location_history where schedule_id = new.schedule_id and travel_date = new.travel_date
    and id not in (select id from bus_location_history where schedule_id = new.schedule_id and travel_date = new.travel_date order by recorded_at desc limit 5);
  return new;
end $$;
create trigger bus_locations_history after insert or update on public.bus_locations for each row execute function public.keep_location_history();
```

## Languages
English, Tamil and Sinhala (switcher in the header and Profile). Strings live
in `lib/i18n.tsx`; anything untranslated shows in English. **Have a native
speaker review the Tamil and Sinhala before launch.**

## Conductor page & passenger list
- **`/conductor`**, a phone-first page for the bus. Sign in at `/staff/login`
  with a **Conductor** account (set in Accounts & roles); conductors land
  here and can't open the rest of the staff area. Office staff and super
  admins can use it too ("Conductor app" in the staff sidebar).
  - Today's departure is picked automatically (last night's overnight bus
    counts while it's still on the road).
  - **Scan tickets**: full-screen camera scanner. Works on Android (built-in
    detector) and iPhone (jsQR). Green ✓ boards the passenger; unpaid holds
    show "collect LKR …" with *Cash received · board*; wrong-bus and
    cancelled tickets show red. You can also type a ref or a seat number.
  - Tap a name to board, mark a no-show, undo, call, or take cash.
  - Share location, update passengers, download the passenger list, close
    the day (`/conductor/cash`).
- **Passenger list PDF** (Departures → *Download PDF*, or the conductor
  page): A4 tick list grouped by boarding stop in route order, with seat,
  name, phone, destination, what to collect, bikes to load, and lines for
  boarded count, cash and signatures. Passengers already on board come
  pre-ticked.
- Passenger tickets (My trips → View Ticket and the confirmation screen)
  carry a real QR code with the booking reference, made on the phone.

## Staff area & roles
- **Entrance:** `https://your-domain/staff/login`. It isn't linked anywhere on
  the customer site (share it with staff yourself) and is hidden from Google.
  Anyone who opens `/admin` without staff access is sent to this page, never
  to the passenger sign-in.
- **Roles** (set in Accounts & roles):
  - *Passenger*: books and manages their own trips.
  - *Conductor*: the conductor page only (boarding, cash, trip updates,
    location, fuel/tolls, closing the day).
  - *Staff*: Operations: departures & manifests, bookings, buses, routes &
    timetable, and logging running costs (fuel, tolls, parking, cleaning).
  - *Super admin*: everything, plus Business: Finance (P&L by month / bus /
    departure, other income), Expenses (all categories), Fleet health (service
    due, fuel efficiency, insurance / licence / permit expiry), Crew (licences,
    payroll, one-tap salary run), Accounts & roles, Settings (booking fee,
    promo, refund tiers, bike fees, resale switch).
- The server (`proxy.ts`) and the database rules both enforce this: staff can't
  open Business pages or read salaries, passengers can't read any of it.

## Seat resale
Runs on the database (`resale_listings`, `list_for_resale`, `buy_resale`):
a passenger lists a booking for no more than they paid; a buyer pays the
price + booking fee; in one transaction the seller's booking closes (they're
paid the price) and the buyer gets a new booking for the same seats.
**It's off.** Customers see "coming soon" and no links. To launch: Staff area
→ Settings → Seat resale → On → Save. (Demo mode: `features.resale` in
`config/operator.ts`.) Payouts to sellers still need a payment gateway.

## Animation
Built with Motion (`motion/react`); see `components/motion/` (BlurText and
AnimatedNumber are adapted from React Bits, credit in that folder's README).
Screens ease in on navigation (`app/(public)/(passenger)/template.tsx`), the
phone tab highlight slides between tabs, the seat picker is a bottom sheet
you can drag down to close, lists cascade in (`useStaggerIn`), numbers count
(seats left, totals), and bookings end with an animated check. Everything
respects the device's "Reduce motion" setting.

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
2. **Run the SQL**: open `supabase/setup.sql`, paste the whole file into
   Supabase → SQL Editor → **Run**. It sets up everything (all four
   migrations + starting data) and is **safe to run again**: existing
   tables, functions, rules and data are skipped or updated, so it also
   repairs a project where only some migrations ran. (The separate files in
   `supabase/migrations/` are the same SQL split up, for the Supabase CLI.)
3. **Keys:** Dashboard → Project Settings → API. Copy `.env.example` to
   `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and the **publishable**
   key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the older "anon" key also
   works as `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Never put the secret /
   service_role key in a `NEXT_PUBLIC_` variable. Restart `npm run dev`.
4. **Auth settings:** Authentication → URL Configuration: set Site URL to
   your domain (and add `http://localhost:3000` for testing). "Confirm email"
   is on by default: new passengers click a link before they can sign in.
5. **Make yourself super admin:** sign up on the site, then in the SQL Editor run
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');`
   Then sign in at `/staff/login`. From then on, give other people access in
   Staff area → Accounts & roles (no more SQL needed).

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

Sign-in & pages (with Supabase):
- The Sign in button goes to the real sign-in page and returns you to where
  you were. There is no pretend user in this mode.
- Staying signed in: the session is kept in cookies for 400 days (the most
  browsers allow) and renewed on every visit, so people stay signed in on
  that device until they sign out or clear their browser data. The tokens are
  signed by Supabase (can't be forged) and cookies are HTTPS-only in
  production. Settings: `lib/features.ts` (`AUTH_COOKIE_MAX_AGE`).
- `proxy.ts` checks the session on the server: My trips, Account, Payment
  and Refund need a signed-in passenger; `/admin` needs a staff account.
- Signed-in passengers skip the phone-code step (their account is the
  verification). The account page shows real figures from their bookings;
  editing name/phone saves to `profiles`.
- Resale is on the database but switched off (see Seat resale).
- Route pages (`/bus/...`) and the sitemap read the timetable from the
  database, refreshed hourly; new routes get pages automatically.
- Payment is still simulated in both modes until a gateway is added.

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
