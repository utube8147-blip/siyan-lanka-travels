'use client';
// Shows the marketplace only while Staff area → Settings → Seat resale is on.
// The database refuses resale while it's off; this keeps the screens in step.

import Link from 'next/link';
import { useResaleState } from '@/lib/resale';
import { tx } from '@/lib/i18n';

export function ResaleGate({ children }: { children: React.ReactNode }) {
  const on = useResaleState();
  if (on === null) return <div className="max-w-[1100px] mx-auto px-4 py-10"><div className="skeleton h-64 rounded-2xl" /></div>;
  if (on) return <>{children}</>;
  return (
    <main className="max-w-[560px] mx-auto px-4 py-16 text-center">
      <h1 className="text-[26px] font-semibold text-[#050a44]">{tx('Seat resale isn\'t available right now')}</h1>
      <p className="text-[15px] text-[#46464f] mt-3">{tx('Can\'t make your trip? You can cancel from My trips and get a refund under our cancellation policy.')}</p>
      <div className="flex justify-center gap-3 mt-6">
        <Link href="/my-bookings" className="px-5 py-3 rounded-xl bg-[#050a44] text-white text-[14px] font-semibold">{tx('My trips')}</Link>
        <Link href="/legal#refunds" className="px-5 py-3 rounded-xl bg-white border border-[#c7c5d1] text-[#050a44] text-[14px] font-semibold">{tx('Refund policy')}</Link>
      </div>
    </main>
  );
}
