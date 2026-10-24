'use client';
// The terms, refunds and privacy text (translated). The page and its
// metadata are in page.tsx.
import Link from 'next/link';
import { OPERATOR } from '@/config/operator';
import { dateLocale } from '@/lib/trips';
import { N_, tx, txr } from '@/lib/i18n';

import { fmtDate } from '@/lib/dates';
// When these terms last changed (shown in the reader's language).
const UPDATED_ON = new Date(2026, 9, 3);

function Section({
  id,
  title,
  columns = false,
  children,
}: {
  id: string;
  title: string;
  columns?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 bg-white rounded-2xl border border-[#edeef0] p-5 md:p-7 lg:p-8 text-[15px] leading-[1.7] text-[#46464f]">
      <h2 className="text-[22px] font-semibold text-[#050a44] mb-4">{title}</h2>
      {columns ? (
        // Two newspaper-style columns on laptops; each Part stays in one piece.
        <div className="space-y-6 lg:space-y-0 lg:columns-2 lg:gap-12 lg:[&>*]:mb-6">{children}</div>
      ) : (
        <div className="space-y-4">{children}</div>
      )}
    </section>
  );
}
function Part({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 space-y-2 break-inside-avoid">
      <h3 className="text-[16px] font-semibold text-[#050a44]">{title}</h3>
      {children}
    </div>
  );
}
const List = ({ children }: { children: React.ReactNode }) => <ul className="list-disc pl-5 space-y-1.5">{children}</ul>;

export function LegalContent() {
  const tiers = OPERATOR.refundPolicy;
  const contact = OPERATOR.contact;
  return (
    <main className="max-w-[760px] lg:max-w-[1440px] mx-auto px-4 lg:px-8 py-6 md:py-10 space-y-5">
      <h1 className="hidden md:block text-[30px] font-semibold text-[#050a44]">{tx('Terms & policies')}</h1>
      <p className="text-[13px] text-[#6b6d78]">{tx('Last updated {UPDATED}. These terms apply to every booking made with {name}, on this website, at our counter or by phone.', { UPDATED: fmtDate(UPDATED_ON, { day: 'numeric', month: 'long', year: 'numeric' }), name: OPERATOR.name })}</p>
      <nav aria-label={tx('On this page')} className="flex flex-wrap gap-2">
        {[
          ['#terms', N_('Terms of service')],
          ['#payment', N_('Paying')],
          ['#seats', N_('Seats')],
          ['#boarding', N_('Boarding')],
          ['#refunds', N_('Cancellations & refunds')],
          ['#privacy', N_('Privacy')],
        ].map(([h, l]) => (
          <a key={h} href={h} className="px-3 py-1.5 rounded-full bg-[#f2f4f6] text-[13px] font-semibold text-[#050a44]">
            {tx(l)}
          </a>
        ))}
      </nav>

      <Section id="terms" title={tx('Terms of service')} columns>
        <Part title={tx('1. Your booking')}>
          <List>
            <li>{tx('By booking you agree to these terms. If you book for someone else, you agree on their behalf and must tell them about these terms.')}</li>
            <li>{txr('A booking is for the seat, date, departure and stops shown on the ticket. It is confirmed once we have recorded your payment; until then the seat is only held or reserved for you, as explained under <a>Paying</a>.', { a: (c) => <a className="underline font-semibold text-[#050a44]" href="#payment">{c}</a> })}</li>
            <li>{tx('To book online you need an account and a mobile number. Before you can pay, we text a 6-digit code to the mobile number you give for the booking; entering it confirms the number is yours. One code confirms one booking.')}</li>
            <li>{tx('Give the passenger\'s real name, gender and a working phone number. We use the phone number to reach you about the trip, and the gender for the seating rules below. A booking made with false details may be cancelled.')}</li>
            <li>{tx('You can book up to {maxSeatsPerBooking} seats in one booking.', { maxSeatsPerBooking: OPERATOR.maxSeatsPerBooking })}</li>
            <li>{tx('Your ticket and its QR code are in My trips. Show the QR code, or give your name and booking reference, when you board.')}</li>
          </List>
        </Part>

        <Part title={tx('2. Fares and fees')}>
          <List>
            <li>{tx('The fare for each seat is shown before you pay. Where a route has one price, the fare is the same wherever you get on or off along that route.')}</li>
            <li>{tx('An online booking fee, shown at checkout, is added once per booking made on this website. It is not refunded if you cancel.')}</li>
            <li>{tx('A promo code, where one is offered, reduces the fare only and can\'t be exchanged for cash.')}</li>
            <li>{tx('Bikes carried in the luggage compartment are charged separately; see section 6.')}</li>
          </List>
        </Part>

        <Part id="payment" title={tx('3. Paying')}>
          <p>{tx('The ways to pay are shown at checkout. Not every option is available at all times.')}</p>
          <List>
            <li><b className="text-[#050a44]">{tx('Bank transfer.')}</b>{' '}{tx('Your seat is held for the time shown at checkout. Transfer the full amount to the account shown, quote your booking reference, and upload the slip (a photo, a screenshot or the bank\'s PDF). The booking is confirmed when our staff have checked the payment. If the slip can\'t be matched to a payment we will tell you and you can upload it again; if no payment arrives in time, the seat is released.')}</li>
            <li><b className="text-[#050a44]">{tx('Pay at the counter.')}</b>{' '}{tx('Your seat is held for the time shown at checkout. Pay in cash at {address} with your booking reference. If it isn\'t paid in time, the seat is released.', { address: contact.address })}</li>
            <li><b className="text-[#050a44]">{tx('Pay on the bus.')}</b>{' '}{tx('Your seat is reserved and you pay the conductor in cash when you board or during the journey. Please bring the exact amount. If your plans change, cancel in My trips so someone else can use the seat. We may withdraw this option from passengers who reserve seats and don\'t travel.')}</li>
            <li><b className="text-[#050a44]">{tx('Card or mobile wallet.')}</b>{' '}{tx('When offered, payment is taken by our payment provider. We don\'t see or store your card details.')}</li>
          </List>
          <p>{tx('When a payment is recorded we send a confirmation by text and in the app. Keep it until you have travelled.')}</p>
        </Part>

        <Part id="seats" title={tx('4. Seats')}>
          <List>
            <li>{tx('You choose your seat when you book. We try to keep every passenger in the seat they chose, but the crew may move passengers when safety or the running of the bus requires it, for example if a different bus has to be used.')}</li>
            <li><b className="text-[#050a44]">{tx('Ladies-only seats.')}</b>{' '}{tx('Seats marked for ladies can be booked for female passengers only.')}</li>
            <li>
              <b className="text-[#050a44]">{tx('The seat beside a woman travelling alone.')}</b>{' '}{tx('When a woman has booked a single seat, the seat right beside hers is kept for women. If a man tries to book it online, the booking is refused and he is asked to choose another seat. This doesn\'t apply when the same account books the next seat (for example for a relative), or when two or more seats are booked together. Our office staff can make an exception at the counter, for example when the two passengers are travelling together.')}</li>
            <li>{tx('Some seats are kept back by the operator and can\'t be booked online.')}</li>
            <li>{tx('You can change your seat in My trips while seats are free and before booking closes. The same seating rules apply to the new seat.')}</li>
          </List>
        </Part>

        <Part id="boarding" title={tx('5. Boarding and travelling')}>
          <List>
            <li>{tx('Be at your boarding point 20 minutes before the departure time for your stop. The bus can\'t wait for late passengers, and a missed bus is treated as a no-show (see Cancellations & refunds).')}</li>
            <li>{tx('Carry a photo ID. The crew may ask for it, especially if you can\'t show your ticket.')}</li>
            <li>{tx('Times at stops along the route are estimates. Traffic, weather, road conditions and breakdowns can delay the bus. When we know of a delay or a change we tell booked passengers by text or in the app, and where the conductor is sharing the bus\'s location you can follow it under My trips.')}</li>
            <li>{tx('For everyone\'s safety the crew may refuse travel to anyone who is abusive, intoxicated, or who endangers or seriously disturbs other passengers. No refund is due in that case.')}</li>
            <li>{tx('Smoking and alcohol are not allowed on the bus.')}</li>
            <li>{tx('Keep your luggage within what one person can reasonably carry, and keep valuables with you. Dangerous, illegal or strongly smelling goods can\'t be carried. Luggage travels at your own risk.')}</li>
          </List>
        </Part>

        <Part id="bikes" title={tx('6. Bikes in the luggage compartment')}>
          <List>
            <li>{tx('A bike is carried only when it was added to the booking in advance and space was confirmed. Space is limited on each departure.')}</li>
            <li>{tx('The fee for each kind of bike is shown when you add it. Give the make, colour and number plate, and a photo, so the crew can check it at loading.')}</li>
            <li>{tx('Fuel tanks must be no more than a quarter full. Remove loose items and accessories. The crew may refuse a bike that doesn\'t match the booking or can\'t be loaded safely.')}</li>
            <li>{tx('Bring the bike to the boarding point early enough to be loaded before departure.')}</li>
          </List>
        </Part>

        <Part title={tx('7. If we change or cancel a departure')}>
          <List>
            <li>{tx('If we cancel a departure you can move to another departure with free seats at no extra charge, or have a full refund including the booking fee.')}</li>
            <li>{tx('If the bus is replaced by another vehicle, we will seat you as close as possible to the seat you chose.')}</li>
            <li>{tx('Beyond the refund of what you paid, we are not responsible for costs that follow from a delay or a cancellation, such as missed connections or accommodation, except where the law says otherwise.')}</li>
          </List>
        </Part>

        <Part title={tx('8. General')}>
          <List>
            <li>{tx('We may update these terms. The version in force when you made your booking applies to that booking.')}</li>
            <li>{tx('These terms are governed by the laws of Sri Lanka.')}</li>
            <li>{contact.phone
              ? txr('Questions or complaints: call {phone} or email <a>{email}</a>, or visit us at {address}. Please quote your booking reference.', { phone: contact.phone, email: contact.email, address: contact.address, a: (c) => <a className="underline font-semibold text-[#050a44]" href={`mailto:${contact.email}`}>{c}</a> })
              : txr('Questions or complaints: email <a>{email}</a>, or visit us at {address}. Please quote your booking reference.', { email: contact.email, address: contact.address, a: (c) => <a className="underline font-semibold text-[#050a44]" href={`mailto:${contact.email}`}>{c}</a> })}</li>
          </List>
        </Part>
      </Section>

      {/* Refunds and Privacy side by side on laptops */}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Section id="refunds" title={tx('Cancellations & refunds')}>
          <p>{tx('Cancel from My trips. The refund depends on how long before your departure you cancel:')}</p>
          <div className="overflow-hidden rounded-xl border border-[#edeef0]">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-[#f8f9fb] text-left text-[#050a44]">
                  <th className="px-4 py-2.5 font-semibold">{tx('When you cancel')}</th>
                  <th className="px-4 py-2.5 font-semibold">{tx('Refund of the fare')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edeef0]">
                {tiers.map((t, i) => (
                  <tr key={t.hoursBefore}>
                    <td className="px-4 py-2.5">
                      {t.hoursBefore > 0
                        ? i > 0
                          ? tx('{h}+ hours before (less than {prev})', { h: t.hoursBefore, prev: tiers[i - 1].hoursBefore })
                          : tx('{h}+ hours before', { h: t.hoursBefore })
                        : tx('Less than {h} hours before', { h: tiers[i - 1]?.hoursBefore ?? 0 })}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-[#050a44]">{t.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <List>
            <li>{tx('The exact amount you will get back is shown in My trips before you confirm the cancellation.')}</li>
            <li>{tx('The online booking fee is not refunded. A booking that was never paid has nothing to refund; cancelling it simply frees the seat.')}</li>
            <li>{tx('If you don\'t travel and haven\'t cancelled (a no-show), no refund is due.')}</li>
            <li>{tx('Refunds are paid to the bank account you give us in My trips, or in cash at our counter. We aim to pay within 7 working days of the cancellation; you are told when it has been paid.')}</li>
            <li>{tx('To travel with fewer seats, cancel the booking and book again; the refund follows the table above. Our office can also change the number of seats at the counter.')}</li>
            <li>{tx('If we cancel a departure, you get a full refund including the booking fee.')}</li>
          </List>
        </Section>

        <Section id="privacy" title={tx('Privacy policy')}>
          <Part title={tx('What we collect')}>
            <List>
              <li>{tx('Your name, mobile number, email address (if you give one) and the gender you select for the passenger.')}</li>
              <li>{tx('Your bookings: the trip, seats, what you paid and how.')}</li>
              <li>{tx('For bank transfers, the payment slip you upload. For refunds, the bank account you ask us to pay.')}</li>
              <li>{tx('For bikes, the description, number plate and photo you provide.')}</li>
              <li>{tx('If you turn on notifications, a token that lets us send them to your device.')}</li>
            </List>
          </Part>
          <Part title={tx('How we use it')}>
            <List>
              <li>{tx('To make and manage your booking, check payments, pay refunds and let you board.')}</li>
              <li>{tx('To contact you about your trip by text, WhatsApp or notification: confirmations, reminders, delays and changes.')}</li>
              <li>{tx('To apply the seating rules. Other passengers choosing seats can see only whether a seat is booked by a man or a woman, and whether that passenger is travelling alone; never your name or contact details.')}</li>
              <li>{tx('To keep the accounts and records a transport business is required to keep.')}</li>
            </List>
          </Part>
          <Part title={tx('Who sees it')}>
            <List>
              <li>{tx('Our office staff, and the conductor of your bus for the passengers on that trip.')}</li>
              <li>{tx('Service providers who run parts of the system for us: hosting and database, text and WhatsApp delivery, and, when card payments are offered, the payment provider. Card details go to the payment provider directly and are not stored by us.')}</li>
              <li>{tx('We don\'t sell your data or use it for other companies\' advertising.')}</li>
            </List>
          </Part>
          <Part title={tx('Your choices')}>
            <p>{txr('To see, correct or delete your data, email <a>{email}</a>. We may need to keep booking and payment records for as long as the law requires. You can turn notifications off at any time in your device or browser settings.', { email: contact.email, a: (c) => <a className="text-[#050a44] font-semibold underline" href={`mailto:${contact.email}`}>{c}</a> })}</p>
          </Part>
        </Section>
      </div>

      <p className="text-[12px] text-[#6b6d78] text-center">
        {OPERATOR.name} · {contact.address} · <Link href="/search" className="underline">{tx('Book a seat')}</Link>
      </p>
    </main>
  );
}