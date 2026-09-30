import type { Metadata } from 'next';
import Link from 'next/link';
import { isResaleOn } from '@/lib/resale-server';

export const metadata: Metadata = {
  title: 'Resale tickets',
  description: "Can't travel? Buy or sell Siyan Lanka Travels seats from other passengers.",
  alternates: { canonical: '/marketplace' },
  robots: { index: false }, // turn on once resale is live
};

// Until resale is switched on (Staff area → Settings), customers get a clear
// "coming soon" screen. The database also refuses resale while it's off.
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (await isResaleOn()) return children;
  return (
    <main className="max-w-[560px] mx-auto px-4 py-16 text-center">
      <h1 className="text-[26px] font-semibold text-[#050a44]">Seat resale is coming soon</h1>
      <p className="text-[15px] text-[#46464f] mt-3">
        Can&apos;t make your trip? You can cancel from My trips and get a refund under our cancellation policy.
      </p>
      <div className="flex justify-center gap-3 mt-6">
        <Link href="/my-bookings" className="px-5 py-3 rounded-xl bg-[#050a44] text-white text-[14px] font-semibold">
          My trips
        </Link>
        <Link href="/legal#refunds" className="px-5 py-3 rounded-xl bg-white border border-[#c7c5d1] text-[#050a44] text-[14px] font-semibold">
          Refund policy
        </Link>
      </div>
    </main>
  );
}
