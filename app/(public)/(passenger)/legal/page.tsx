// app/(public)/(passenger)/legal/page.tsx — terms of service, refunds and privacy.
// The wording describes how this booking system actually behaves (payment
// options, seat rules, codes, refunds). It is not legal advice: have it read
// by someone qualified before relying on it, and adjust the parts marked
// "operator policy" below (luggage, children, liability) to your own rules.
// The refund table is generated from OPERATOR.refundPolicy.

import type { Metadata } from 'next';
import Link from 'next/link';
import { OPERATOR } from '@/config/operator';

export const metadata: Metadata = {
  title: 'Terms of service, refunds & privacy',
  description: `How booking, payment, seats, cancellations, refunds and your personal data work with ${OPERATOR.name}.`,
  alternates: { canonical: '/legal' },
};

const UPDATED = '3 October 2026';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 bg-white rounded-2xl border border-[#edeef0] p-5 md:p-7 space-y-4 text-[15px] leading-[1.7] text-[#46464f]">
      <h2 className="text-[22px] font-semibold text-[#050a44]">{title}</h2>
      {children}
    </section>
  );
}
function Part({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 space-y-2">
      <h3 className="text-[16px] font-semibold text-[#050a44]">{title}</h3>
      {children}
    </div>
  );
}
const List = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 space-y-1.5">{children}</ul>;

export default function LegalPage() {
  const tiers = OPERATOR.refundPolicy;
  const contact = OPERATOR.contact;
  return (
    <main className="max-w-[760px] mx-auto px-4 py-6 md:py-10 space-y-5">
      <h1 className="hidden md:block text-[30px] font-semibold text-[#050a44]">Terms & policies</h1>
      <p className="text-[13px] text-[#6b6d78]">Last updated {UPDATED}. These terms apply to every booking made with {OPERATOR.name}, on this website, at our counter or by phone.</p>
      <nav aria-label="On this page" className="flex flex-wrap gap-2">
        {[
          ['#terms', 'Terms of service'],
          ['#payment', 'Paying'],
          ['#seats', 'Seats'],
          ['#boarding', 'Boarding'],
          ['#refunds', 'Cancellations & refunds'],
          ['#privacy', 'Privacy'],
        ].map(([h, l]) => (
          <a key={h} href={h} className="px-3 py-1.5 rounded-full bg-[#f2f4f6] text-[13px] font-semibold text-[#050a44]">
            {l}
          </a>
        ))}
      </nav>

      <Section id="terms" title="Terms of service">
        <Part title="1. Your booking">
          <List>
            <li>By booking you agree to these terms. If you book for someone else, you agree on their behalf and must tell them about these terms.</li>
            <li>A booking is for the seat, date, departure and stops shown on the ticket. It is confirmed once we have recorded your payment; until then the seat is only held or reserved for you, as explained under <a className="underline font-semibold text-[#050a44]" href="#payment">Paying</a>.</li>
            <li>To book online you need an account and a mobile number. Before you can pay, we text a 6-digit code to the mobile number you give for the booking; entering it confirms the number is yours. One code confirms one booking.</li>
            <li>Give the passenger&apos;s real name, gender and a working phone number. We use the phone number to reach you about the trip, and the gender for the seating rules below. A booking made with false details may be cancelled.</li>
            <li>You can book up to {OPERATOR.maxSeatsPerBooking} seats in one booking.</li>
            <li>Your ticket and its QR code are in My trips. Show the QR code, or give your name and booking reference, when you board.</li>
          </List>
        </Part>

        <Part title="2. Fares and fees">
          <List>
            <li>The fare for each seat is shown before you pay. Where a route has one price, the fare is the same wherever you get on or off along that route.</li>
            <li>An online booking fee, shown at checkout, is added once per booking made on this website. It is not refunded if you cancel.</li>
            <li>A promo code, where one is offered, reduces the fare only and can&apos;t be exchanged for cash.</li>
            <li>Bikes carried in the luggage compartment are charged separately; see section 6.</li>
          </List>
        </Part>

        <Part id="payment" title="3. Paying">
          <p>The ways to pay are shown at checkout. Not every option is available at all times.</p>
          <List>
            <li><b className="text-[#050a44]">Bank transfer.</b> Your seat is held for the time shown at checkout. Transfer the full amount to the account shown, quote your booking reference, and upload the slip (a photo, a screenshot or the bank&apos;s PDF). The booking is confirmed when our staff have checked the payment. If the slip can&apos;t be matched to a payment we will tell you and you can upload it again; if no payment arrives in time, the seat is released.</li>
            <li><b className="text-[#050a44]">Pay at the counter.</b> Your seat is held for the time shown at checkout. Pay in cash at {contact.address} with your booking reference. If it isn&apos;t paid in time, the seat is released.</li>
            <li><b className="text-[#050a44]">Pay on the bus.</b> Your seat is reserved and you pay the conductor in cash when you board or during the journey. Please bring the exact amount. If your plans change, cancel in My trips so someone else can use the seat. We may withdraw this option from passengers who reserve seats and don&apos;t travel.</li>
            <li><b className="text-[#050a44]">Card or mobile wallet.</b> When offered, payment is taken by our payment provider. We don&apos;t see or store your card details.</li>
          </List>
          <p>When a payment is recorded we send a confirmation by text and in the app. Keep it until you have travelled.</p>
        </Part>

        <Part id="seats" title="4. Seats">
          <List>
            <li>You choose your seat when you book. We try to keep every passenger in the seat they chose, but the crew may move passengers when safety or the running of the bus requires it, for example if a different bus has to be used.</li>
            <li><b className="text-[#050a44]">Ladies-only seats.</b> Seats marked for ladies can be booked for female passengers only.</li>
            <li>
              <b className="text-[#050a44]">The seat beside a woman travelling alone.</b> When a woman has booked a single seat, the seat right beside hers is kept for women. If a man tries to book it online, the booking is refused and he is asked to choose another seat. This doesn&apos;t apply when the same account books the next seat (for example for a relative), or when two or more seats are booked together. Our office staff can make an exception at the counter, for example when the two passengers are travelling together.
            </li>
            <li>Some seats are kept back by the operator and can&apos;t be booked online.</li>
            <li>You can change your seat in My trips while seats are free and before booking closes. The same seating rules apply to the new seat.</li>
          </List>
        </Part>

        <Part id="boarding" title="5. Boarding and travelling">
          <List>
            <li>Be at your boarding point 20 minutes before the departure time for your stop. The bus can&apos;t wait for late passengers, and a missed bus is treated as a no-show (see Cancellations & refunds).</li>
            <li>Carry a photo ID. The crew may ask for it, especially if you can&apos;t show your ticket.</li>
            <li>Times at stops along the route are estimates. Traffic, weather, road conditions and breakdowns can delay the bus. When we know of a delay or a change we tell booked passengers by text or in the app, and where the conductor is sharing the bus&apos;s location you can follow it under My trips.</li>
            <li>For everyone&apos;s safety the crew may refuse travel to anyone who is abusive, intoxicated, or who endangers or seriously disturbs other passengers. No refund is due in that case.</li>
            <li>Smoking and alcohol are not allowed on the bus.</li>
            <li>Keep your luggage within what one person can reasonably carry, and keep valuables with you. Dangerous, illegal or strongly smelling goods can&apos;t be carried. Luggage travels at your own risk.</li>
          </List>
        </Part>

        <Part id="bikes" title="6. Bikes in the luggage compartment">
          <List>
            <li>A bike is carried only when it was added to the booking in advance and space was confirmed. Space is limited on each departure.</li>
            <li>The fee for each kind of bike is shown when you add it. Give the make, colour and number plate, and a photo, so the crew can check it at loading.</li>
            <li>Fuel tanks must be no more than a quarter full. Remove loose items and accessories. The crew may refuse a bike that doesn&apos;t match the booking or can&apos;t be loaded safely.</li>
            <li>Bring the bike to the boarding point early enough to be loaded before departure.</li>
          </List>
        </Part>

        <Part title="7. If we change or cancel a departure">
          <List>
            <li>If we cancel a departure you can move to another departure with free seats at no extra charge, or have a full refund including the booking fee.</li>
            <li>If the bus is replaced by another vehicle, we will seat you as close as possible to the seat you chose.</li>
            <li>Beyond the refund of what you paid, we are not responsible for costs that follow from a delay or a cancellation, such as missed connections or accommodation, except where the law says otherwise.</li>
          </List>
        </Part>

        <Part title="8. General">
          <List>
            <li>We may update these terms. The version in force when you made your booking applies to that booking.</li>
            <li>These terms are governed by the laws of Sri Lanka.</li>
            <li>Questions or complaints: {contact.phone ? <>call {contact.phone} or </> : null}email <a className="underline font-semibold text-[#050a44]" href={`mailto:${contact.email}`}>{contact.email}</a>, or visit us at {contact.address}. Please quote your booking reference.</li>
          </List>
        </Part>
      </Section>

      <Section id="refunds" title="Cancellations & refunds">
        <p>Cancel from My trips. The refund depends on how long before your departure you cancel:</p>
        <div className="overflow-hidden rounded-xl border border-[#edeef0]">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="bg-[#f8f9fb] text-left text-[#050a44]">
                <th className="px-4 py-2.5 font-semibold">When you cancel</th>
                <th className="px-4 py-2.5 font-semibold">Refund of the fare</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edeef0]">
              {tiers.map((t, i) => (
                <tr key={t.hoursBefore}>
                  <td className="px-4 py-2.5">
                    {t.hoursBefore > 0
                      ? `${t.hoursBefore}+ hours before${i > 0 ? ` (less than ${tiers[i - 1].hoursBefore})` : ''}`
                      : `Less than ${tiers[i - 1]?.hoursBefore ?? 0} hours before`}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-[#050a44]">{t.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <List>
          <li>The exact amount you will get back is shown in My trips before you confirm the cancellation.</li>
          <li>The online booking fee is not refunded. A booking that was never paid has nothing to refund; cancelling it simply frees the seat.</li>
          <li>If you don&apos;t travel and haven&apos;t cancelled (a no-show), no refund is due.</li>
          <li>Refunds are paid to the bank account you give us in My trips, or in cash at our counter. We aim to pay within 7 working days of the cancellation; you are told when it has been paid.</li>
          <li>If you change a paid booking to fewer seats, the difference is refunded in the same way.</li>
          <li>If we cancel a departure, you get a full refund including the booking fee.</li>
        </List>
      </Section>

      <Section id="privacy" title="Privacy policy">
        <Part title="What we collect">
          <List>
            <li>Your name, mobile number, email address (if you give one) and the gender you select for the passenger.</li>
            <li>Your bookings: the trip, seats, what you paid and how.</li>
            <li>For bank transfers, the payment slip you upload. For refunds, the bank account you ask us to pay.</li>
            <li>For bikes, the description, number plate and photo you provide.</li>
            <li>If you turn on notifications, a token that lets us send them to your device.</li>
          </List>
        </Part>
        <Part title="How we use it">
          <List>
            <li>To make and manage your booking, check payments, pay refunds and let you board.</li>
            <li>To contact you about your trip by text, WhatsApp or notification: confirmations, reminders, delays and changes.</li>
            <li>To apply the seating rules. Other passengers choosing seats can see only whether a seat is booked by a man or a woman, and whether that passenger is travelling alone; never your name or contact details.</li>
            <li>To keep the accounts and records a transport business is required to keep.</li>
          </List>
        </Part>
        <Part title="Who sees it">
          <List>
            <li>Our office staff, and the conductor of your bus for the passengers on that trip.</li>
            <li>Service providers who run parts of the system for us: hosting and database, text and WhatsApp delivery, and, when card payments are offered, the payment provider. Card details go to the payment provider directly and are not stored by us.</li>
            <li>We don&apos;t sell your data or use it for other companies&apos; advertising.</li>
          </List>
        </Part>
        <Part title="Your choices">
          <p>
            To see, correct or delete your data, email <a className="text-[#050a44] font-semibold underline" href={`mailto:${contact.email}`}>{contact.email}</a>. We may need to keep booking and payment records for as long as the law requires. You can turn notifications off at any time in your device or browser settings.
          </p>
        </Part>
      </Section>

      <p className="text-[12px] text-[#6b6d78] text-center">
        {OPERATOR.name} · {contact.address} · <Link href="/search" className="underline">Book a seat</Link>
      </p>
    </main>
  );
}
