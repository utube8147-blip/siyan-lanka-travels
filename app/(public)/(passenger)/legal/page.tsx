// app/(public)/(passenger)/legal/page.tsx — terms of service, refunds and privacy.
// The wording describes how this booking system actually behaves (payment
// options, seat rules, codes, refunds). It is not legal advice: have it read
// by someone qualified before relying on it, and adjust the parts marked
// "operator policy" below (luggage, children, liability) to your own rules.
// The refund table is generated from OPERATOR.refundPolicy.
//
// Layout: single column on phones/tablets; on laptops (lg+) the page is wider,
// the Terms of service flow in two columns, and Refunds + Privacy sit side by side.

import type { Metadata } from 'next';
import { OPERATOR } from '@/config/operator';
import { LegalContent } from './LegalContent';
import { tx } from '@/lib/i18n-core';

export const metadata: Metadata = {
  title: tx('Terms of service, refunds & privacy'),
  description: `How booking, payment, seats, cancellations, refunds and your personal data work with ${OPERATOR.name}.`,
  alternates: { canonical: '/legal' },
};

export default function LegalPage() {
  return <LegalContent />;
}
