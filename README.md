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
- **Bank transfer slips:** in My trips the passenger uploads a photo of the
  slip (or a screenshot of the transfer) with the bank reference. That keeps
  the seat while it's checked: the hold is extended once, by the bank-transfer
  hold time, never past the booking cut-off. Staff see **Bank slips to check**
  in Bookings, open the slip, then **Mark paid** or send it back with a reason
  (the passenger is told and can upload again). Slips are private (bucket
  `payment-slips`): the passenger and office staff only.
- **Going live with PayHere:** set `PAYHERE_MERCHANT_ID`,
  `PAYHERE_MERCHANT_SECRET` (and `PAYHERE_SANDBOX=false` when approved), add
  your domain in PayHere, then Staff area → Settings → Payments → PayHere.
  The booking is confirmed only when PayHere calls `/api/payhere/notify` and
  the signature and amount check out.
- ⚠️ While Settings → Payments is on *Demo*, card bookings are confirmed
  without taking money. Don't open to the public like that.

## Ticket price: one price per route
Each route has its own price mode (Staff area → Routes & timetable → Edit
stops & fares; migration 12):
- **One price for the whole route** (the default): every seat costs the
  route's price, wherever the passenger gets on or off. Enter one figure.
- **Price by distance (per stop):** each stop has a fare from the first stop
  and the passenger pays the difference between their two stops.
Search results, the seat and payment pages, counter sales and the database
all use the route's mode. Bike fees follow the same rule: on a one-price
route a bike pays its full-route price.

## Timetable: weekdays or every other day
A departure (Staff area → Routes & timetable → Add / Edit departure) runs
either **on set weekdays** or **every other day** (every 2, 3 or 4 days from
a first date; migration 10). Use the second for one bus that goes out one
night and comes back the next: a 7-day week can't hold that pattern, because
it would need the same direction two nights running at the end of each week.
Set the outward departure to start on one date and the return departure to
start the day after. Search, the seat pages, staff Departures and the
database's own check all follow the rule, and the "bus is already on the road"
warning is checked on real dates for the next 12 weeks.

## Bike categories and prices
Staff area → Settings → **Bikes in the luggage compartment** (migration 11).
Each category has a name, an icon, the full-route price, how many spaces it
takes, whether a number plate is required, and whether it is offered to
passengers. **Add a category** makes a new one (for example a three-wheeler
or a bicycle). Switch a category off to stop offering it; it isn't deleted,
so bookings that already have it keep their label and their spaces. The
minimum fee and bikes-per-booking limit are on the same card. Passengers'
pages, staff screens and the database all read this one list; the categories
in `config/operator.ts` are only the starting values.

## Seat layout (any arrangement, any seat numbers)
Staff area → Buses → Edit → **Seat layout** (migration 13). Each bus has its
own grid of seats:
1. **Build the layout:** for each side separately, the number of rows and
   the seats per row (1–3); then the back bench seats, and how to number them:
   "1, 2, 3… right side first" (like the printed booking sheet), "1, 2, 3…
   left to right", or "1A, 1B…".
2. **Adjust any seat:** every position is a box. Type a seat number, or clear
   the box where there is no seat (a door, a gap, a side with one row fewer).
   Rows can be added, removed, and made wider or narrower (a bench with more
   seats across).
3. **Renumber the seats** numbers what is left, in order; any single number
   can still be typed by hand.

Example, the 51-seat bus on the printed sheet: left side 11 rows of 2, right
side 12 rows of 2, a 5-seat bench, "right side first"; press Build. Row 1 reads 4 3 | 1 2, row 12 has only 45 46, the bench reads
48 47 49 50 51.

**Sides that don't line up.** Some buses have more rows on one side over the
same length (the printed sheet: 12 on the right, 11 on the left), so the rows
are not level. Tick "One side has more rows than the other" in step 3: leave
the shorter side's boxes empty in any one row. The side with fewer rows keeps
the normal spacing; the side with more rows fits the same length with its
seats a little closer together. The editor shows a preview. Leave it unticked when the empty
boxes are a real gap, such as a door.

The passenger seat picker, the staff seat map, ladies-only and reserved
seats, the printed passenger list and the database's own seat check all use
the bus's grid. Buses that were never edited keep the classic 2+2 layout
(1A, 1B…). Tickets already sold keep the seat numbers they were sold with, so
change numbers on a bus before it has upcoming bookings, or check those
departures afterwards.

## Seat overrides
Set per bus in Staff area → Buses → Edit (migration 9).
- **Reserved seats (owner's approval):** list the seats, e.g. `1C, 1D`.
  Passengers see them as not available and can't book them. In Departures
  they are striped purple; staff can select one, and the Sell window then
  asks for the owner's agreement: **Send code to the owner** texts a 6-digit
  code to `OWNER_PHONE` (.env, server only) with who is asking, the seat, the
  trip and the passenger's name. The owner reads the code to the seller, who
  enters it and can then issue the ticket. A code lasts 10 minutes, allows 5
  tries, works once, only for those seats, that departure and that staff
  member; the approval then lasts 15 minutes. The database enforces all of
  it. Needs `OWNER_PHONE`, `SUPABASE_SECRET_KEY` and the Notify.lk keys.
- **Ladies-only override:** when a ladies-only seat is sold to a male
  passenger in Departures, office staff (not conductors) can tick
  **Override ladies-only for this sale**. Passengers booking online can never
  override it.

## Ways to pay
What a passenger can choose at checkout (migration 7):

| Way | What happens | Who records the payment |
| --- | --- | --- |
| **Bank transfer** | Seat held (bank hold time). Passenger uploads the slip at checkout or in My trips; office staff get a notification. | Office: Bookings → open it → view slip → **Mark paid** (or send the slip back). |
| **Pay at the counter** | Seat held (counter hold time); office staff get a notification. | Office: Bookings or the departure → **Take cash / Mark paid**. |
| **Pay on the bus** | Seat reserved until the trip is over; cash to the conductor. | Conductor app: scan → **Cash received · board**, or **Board now, collect later** and take the cash during the trip. |
| **Card / mobile wallet** | Shown locked, "Not available yet". | Opens with the payment gateway. |

- Whenever a payment is recorded the passenger gets a text and a
  notification: "Payment received, booking confirmed".
- The conductor's list shows **DUE** and the amount for anyone who hasn't
  paid, including passengers already on board. The printed passenger list
  marks them **COLLECT** and ends with a "Cash to collect" table with a tick
  box per passenger and the total.
- The Bookings item in the staff menu shows how many online holds are waiting
  for a counter or bank payment.
- Switches: Staff area → Settings → **Ways to pay online** (Pay on the bus,
  on by default; Card & wallet, locked by default). Both are enforced in the
  database. Keep Card & wallet locked while Payments is on Demo: unlocked,
  card bookings are confirmed with no money taken.
- Pay on the bus reserves a seat with no payment. Unused reservations are the
  risk; turn it off if no-shows become a problem. A reservation nobody paid
  for is released 12 hours after departure.

## A code on a mobile for every booking
Every online booking is confirmed with a 6-digit code texted to a mobile
number (migration 14), however the passenger signed in: an account that signed
in with an email address is asked for a mobile number too.
- On the seat page the passenger enters the mobile number for the booking and
  presses **Verify**; the code is texted to that number and must be entered
  before they can go on to payment. Changing the number means verifying again.
- The code is ours, not the Supabase sign-in code: `/api/booking-code` sends
  it through Notify.lk and the database checks it. So a sign-in a moment ago
  doesn't count, each code confirms one booking, and the booking's contact
  number must be the verified one. The database refuses an online booking
  without it. A code lasts 10 minutes to enter and then 20 minutes to book
  (`app_settings.booking_otp_minutes`); the payment page asks again if it has
  run out.
- Limits: one code a minute and six an hour, per account and per number.
- Staff and conductors selling at the counter are never asked.
- **Switch:** Staff area → Settings → **Code on every booking** (on by
  default). Turn it off if text messages are down, so people can still book.
- **Needs:** `SUPABASE_SECRET_KEY` and the Notify.lk keys on the server.
- **Testing without texts:** set `BOOKING_OTP_TEST_CODE=123456` in `.env`. No
  text is sent and that code works for every number. Never set it on the live
  site.

## Finance and Analytics (super admin)
Both pages share one filter bar: a period (last 7 days, this month, last
month, last 90 days, or custom dates), a bus and a route. Headline numbers
show the change against the same number of days before; a month that isn't
over is compared up to today.
- **Finance** (money): ticket income, other income, expenses and profit;
  income / expenses / profit over time (by day, week or month depending on
  the period); where the money went; how tickets were paid; what is still
  owed; refunds and payouts; cash that didn't match at close; profit per trip
  as a chart and a table; other income.
- **Analytics, income** (pie charts): where the money came from (counter
  cash, cash the conductor collected on the bus, cash paid at the counter for
  an online booking, bank transfer, card, and other income such as charters
  and parcels); what ticket income is made of (fares, booking fees, bike
  fees); income by sales channel, by direction and by bus; income by weekday;
  new and returning passengers; average income per seat and per trip.
- **Analytics** (buses and passengers): seats sold, average fill, bookings,
  cancellations and no-shows; seats sold vs left empty over time; how full by
  weekday and direction; fullest and emptiest trips; how early people book;
  where seats are sold (online, counter, phone); boarding and drop-off stops;
  seats lost to cancellations and unpaid no-shows; bikes carried; promo use.
Everything is worked out in the browser from bookings (by travel date),
expenses, payouts and cash counts already loaded for staff. Expenses and
other income belong to a bus, not a route, so they are left out while a route
is selected. No extra tables.

## Renewals: documents and licences
Staff area → **Fleet health** holds each bus's paperwork (insurance, revenue
licence, route permit, emission test, fitness certificate) with its expiry
date; **Crew** holds driving licence expiry dates.
- **Reminders** (migration 18) go out 30, 14, 7, 3 and 1 days before the
  expiry date, on the day, and every 3 days once it has expired, until the
  date is updated. Each goes to every super admin as a notification (and a
  push notification on devices where they turned notifications on), and the
  owner gets one text listing them (`OWNER_PHONE` in `.env`).
- They are sent by the every-minute cron on `/api/messages/dispatch`, so they
  need that cron, `SUPABASE_SECRET_KEY` and, for the text, the Notify.lk keys.
- The Overview and Fleet health pages show what is due as before.
- **Paying for a renewal:** the add / renew form has "What did it cost?".
  Enter the amount and it is added to Expenses (Insurance, Licence or Permit)
  for that bus, so it counts in Finance.

## Salaries (settlement)
Staff area → **Crew** → "Salaries for <month>" (super admin; migration 19).
Each person has a monthly salary and, optionally, a pay per trip (edit the
crew member). For the chosen month:
- **Earned** = monthly salary + pay per trip × the trips their bus has run in
  the month so far + bonuses − deductions.
- **Balance** = earned − advances given − salary already paid.
- Buttons per person: **Advance**, **Bonus**, **Deduction**, **Pay balance**,
  and **History** (every record, each removable). **Pay all balances** pays
  everyone with something owed.
- Advances and salary payments are added to Expenses under Salary (and so to
  Finance). Removing one removes its expense. Bonuses and deductions only
  change what is owed.
- A cash shortage from Close the day is not deducted automatically: add it as
  a deduction if the person should bear it.

## Closing the day (cash)
Staff area → **Close the day** (conductors reach it from the conductor app).
Each person closes their own cash (migration 15):
- **Cash you should have** is worked out by the database for the signed-in
  person: every cash payment they recorded that day (counter and phone sales,
  cash taken for held or pay-on-the-bus bookings), less cash refunds they paid
  out. Both lists are shown.
- They enter what they counted. The page shows should-have, counted and the
  difference: **Balanced**, **Short by…** or **Over by…**.
- A day that is short or over can't be closed without a note saying what
  happened (enforced in the database too), and the super admins get a
  notification with the figures and the note.
- The super admin sees everyone's closed days, with the differences marked.
- **Conductors close a trip, not a date** (migration 16): "Close this trip" on
  the conductor screen closes the cash for the departure selected at the top
  of that screen, i.e. the cash they took for bookings on that departure. A
  night bus spans two dates, so "today" is the wrong unit for it.
- **Office staff close a day:** today by default; the Day box picks any
  earlier day. A day that hasn't happened can't be closed.
- **Unfinished counts** (migration 17): if someone took cash on an earlier
  day (office) or an earlier trip (conductor) and never closed it, the page
  opens with an alert listing each one with its amount; choosing one opens
  that count so it can be finished late.
- **Super admin overview:** under the count, "All buses and trips" for the
  chosen day lists every departure with seats sold, cash, bank / online and
  not-yet-paid totals, who took the cash and whether they closed it (balanced,
  short or over, with their note), followed by the office cash for that day.
- **Unfinished counts** (migration 17): if someone took cash on an earlier day
  or trip and never closed it, a yellow alert at the top of the page lists
  each one with its amount; picking one opens it to be finished.
- **All buses and trips** (super admin): for the chosen day, every departure
  with seats sold, cash / bank and online / not paid yet, and each person who
  took cash for it, marked closed (balanced, short or over, with their note)
  or not closed yet. Office staff who took cash that day are listed below.
- One close per person per day, and one per person per trip. Payments
  recorded before migration 15 by marking a held booking paid have no "taken
  by" on them and aren't counted.

## Refunds & payouts
Whenever money becomes owed to a passenger, the database adds a row to
`payouts`: a paid booking cancelled with a refund, a paid booking made cheaper
(a seat dropped), a gateway payment that arrived after the hold expired, or a
resold seat (the seller's sale money).
- **Passenger:** My trips and the account page show each refund / payout and
  its status, and ask for the bank account to send it to (remembered for next
  time).
- **Office staff:** Staff area → **Refunds & payouts** lists what is owed
  with the account details (copy button, CSV export). Send the money, then
  **Mark paid** with the method and reference; the passenger gets a
  notification and a text. "Not owed" removes one with a reason, kept on
  record. Conductors can't see this page or the bank details.
- Nothing is sent automatically. When the payment gateway is added, a card
  refund can be issued there and recorded here as "Refunded on the card".
- The first time the migration runs it adds payouts for bookings cancelled
  with a refund in the last 30 days. If you already refunded those by hand,
  mark them paid or "Not owed".

## Wallet, points and free trips (parked)
Hidden for now: the travel-credit wallet, points / tiers, and "every Nth trip
free". Switches are in `lib/features.ts` (`WALLET_ENABLED`,
`REWARDS_ENABLED`). The free-trip reward is also off in the database
(`app_settings.rewards_enabled`), so it can't be claimed by calling the API
directly. The wallet and points screens were sample data only and still need
building before they are switched on.

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
The database keeps the latest position plus a short history
(`bus_location_history`: a point each time the bus has moved about 50 m, last
20 kept per departure), so the trail on the Track page is there as soon as it
opens and survives a reload. The route map on the search page uses the same
live position: it shows the bus only while a position shared in the last 20
minutes exists; otherwise it shows the stops (from their map pins in Routes &
timetable), the timetable and the road distance.

### Send the bus location to one passenger
In the conductor app, tap a passenger → **Send bus location**. They get a
message with a map link to where the bus is now and their live-tracking link
(and a notification in the app). It goes by WhatsApp when the WhatsApp Cloud
API is set up and switched on in Settings → Messages and the number is on
WhatsApp; otherwise, or if WhatsApp can't deliver, the same message goes as a
text. Location sharing must be on, and one passenger can be sent it once
every 2 minutes. It is sent by the every-minute cron, so allow up to a minute.
**Send from my WhatsApp** opens the conductor's own WhatsApp with the message
ready, which works without the WhatsApp API.

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
Runs on the database (`resale_listings`, `list_for_resale`, `buy_resale`,
`reserve_resale`): a passenger lists a booking for no more than they paid; a
buyer pays the price + booking fee; in one transaction the seller's booking
closes and the buyer gets a new booking for the same seats.
- **The switch:** Staff area → Settings → **Seat resale** (super admin). Off
  by default. While it's off customers see no links, the marketplace says
  resale isn't available, and the database refuses to list, reserve or buy.
  Turning it off leaves seats with their owners; existing listings come back
  if it's turned on again. Screens read the switch on every visit, so a change
  applies straight away. (Demo mode: the same switch, saved in the browser.)
- **Buyer's payment:** with Settings → Payments on *Demo* the hand-over
  happens at once and no money is taken (testing only). With *PayHere* the
  ticket is reserved for 15 minutes, the buyer pays on PayHere, and the seat
  changes hands only when `/api/payhere/notify` confirms the amount. If the
  payment arrives after the ticket has gone, a full refund is added to
  Refunds & payouts.
- **Seller's money:** each sale adds a "Resale payout" to Refunds & payouts;
  the seller adds a bank account in My trips and staff pay it.

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
- **Reminders when the app is closed** are sent by the server as push
  notifications. Set up once:
  1. `npx web-push generate-vapid-keys`
  2. Put the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the private key
     in `VAPID_PRIVATE_KEY` (server only). Optional `VAPID_SUBJECT`
     (`mailto:you@example.com`).
  3. Keep the every-minute cron on `/api/messages/dispatch` running (see
     Messages); it also needs `SUPABASE_SECRET_KEY`.
  When a passenger turns reminders on, their browser is saved to their
  account (`push_subscriptions`). Three hours before their own boarding time
  they get "Your bus leaves at …". The same channel delivers waitlist offers,
  "refund paid", "seat sold" and "slip sent back". Signing out unlinks that
  browser. On iPhone this needs the app on the Home Screen (iOS 16.4+).
  Without the VAPID keys nothing is pushed and the in-page reminder still
  works.

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
   Supabase → SQL Editor → **Run**. It sets up everything (all five
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
- Resale is on the database and follows the switch in Settings (see Seat resale).
- Route pages (`/bus/...`) and the sitemap read the timetable from the
  database, refreshed hourly; new routes get pages automatically.
- Card payment is simulated until Settings → Payments is switched to PayHere
  and its keys are set (see Payments).

Changing prices or rules later: the database copy lives in the
`app_settings` table (booking fee, promo, refund policy, bike fees). Keep it in
step with `config/operator.ts`, which the pages use for display.

## Going live — still to do
1. **Card payments:** PayHere keys + Settings → Payments → PayHere. Until then
   online card bookings are confirmed without taking money. The card forms on
   the payment page, the "settle the difference" step in My trips and the
   resale checkout are placeholders that the gateway replaces.
2. **Charging for changes:** a change that costs more (extra seat, dearer day)
   updates the total but doesn't collect the difference yet; do this with the
   gateway. Changes that cost less already create a refund.
3. `SUPABASE_SECRET_KEY`, `CRON_SECRET` and the every-minute cron (messages,
   push, releasing expired holds).
4. Push keys (see Notifications) and SMS provider keys (see Messages).
5. Hotline in `config/operator.ts`; legal text and Tamil / Sinhala wording
   reviewed.
6. Run `supabase/setup.sql` again after each update (safe to re-run).
