// app/(public)/(passenger)/legal/page.tsx — terms, privacy and refunds.
// ⚠️ Placeholder wording: have it reviewed before going live. The refund
// table is real: it's generated from OPERATOR.refundPolicy.

import type { Metadata } from 'next';
import { OPERATOR } from '@/config/operator';
import { formatLKR } from '@/lib/trips';

export const metadata: Metadata = {
  title: 'Terms of travel, privacy & refund policy',
  description: `How booking, cancellations, refunds and your personal data work with ${OPERATOR.name}.`,
  alternates: { canonical: '/legal' },
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 bg-white rounded-2xl border border-[#edeef0] p-5 md:p-7 space-y-3 text-[15px] leading-[1.7] text-[#46464f]">
      <h2 className="text-[22px] font-semibold text-[#050a44]">{title}</h2>
      {children}
    </section>
  );
}

export default function LegalPage() {
  const tiers = OPERATOR.refundPolicy;
  return (
    <main className="max-w-[760px] mx-auto px-4 py-6 md:py-10 space-y-5">
      <h1 className="hidden md:block text-[30px] font-semibold text-[#050a44]">Terms & policies</h1>
      <nav aria-label="On this page" className="flex flex-wrap gap-2">
        {[
          ['#terms', 'Terms of travel'],
          ['#refunds', 'Refunds'],
          ['#privacy', 'Privacy'],
        ].map(([h, l]) => (
          <a key={h} href={h} className="px-3 py-1.5 rounded-full bg-[#f2f4f6] text-[13px] font-semibold text-[#050a44]">
            {l}
          </a>
        ))}
      </nav>

      <Section id="terms" title="Terms of travel">
        <p>Your ticket is for the seat, date and departure shown on it. Please be at your boarding point 20 minutes before departure; the bus can&apos;t wait for late passengers.</p>
        <p>Carry the e-ticket on your phone or a printout, and a photo ID. Seats marked for ladies are for female passengers only.</p>
        <p>Bikes travel in the luggage compartment only when booked in advance. Motorbike and scooter fuel tanks must be no more than a quarter full.</p>
        <p>An online booking fee of {formatLKR(OPERATOR.bookingFee)} applies per booking and isn&apos;t refundable.</p>
      </Section>

      <Section id="refunds" title="Cancellation & refund policy">
        <p>Cancel from My trips. The refund depends on how long before departure you cancel:</p>
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
        <p>Refunds go back to the original payment method, usually within 5–7 working days. If we cancel a departure, you get a full refund including the booking fee.</p>
      </Section>

      <Section id="privacy" title="Privacy policy">
        <p>We collect your name, phone number, email and the gender you select (for ladies-only seats), plus photos of bikes you book space for. We use them only to run your booking, contact you about your trip and check bikes at loading.</p>
        <p>We don&apos;t sell your data. Payment details are handled by our payment provider, not stored by us.</p>
        <p>
          To see or delete your data, email <a className="text-[#050a44] font-semibold underline" href={`mailto:${OPERATOR.contact.email}`}>{OPERATOR.contact.email}</a>.
        </p>
      </Section>

      <p className="text-[12px] text-[#6b6d78] text-center">
        {OPERATOR.name} · {OPERATOR.contact.address}
      </p>
    </main>
  );
}
