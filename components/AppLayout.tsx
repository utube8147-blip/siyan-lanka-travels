// components/AppLayout.tsx
import Link from 'next/link';
import { ReactNode } from 'react';
import { TopNav } from './TopNav';
import { OPERATOR } from '@/config/operator';
import { Wordmark } from './Wordmark';
import { InstallAppButton } from './InstallAppButton';
import { InstallBanner } from './InstallBanner';
import { TripReminders } from './TripReminders';
import { OfflineIndicator } from './OfflineIndicator';
import { MobileTopBar } from './mobile/MobileTopBar';
import { MobileTabBar } from './mobile/MobileTabBar';
import { Fab } from './mobile/Fab';
import { PullToRefresh } from './mobile/PullToRefresh';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Desktop/tablet: website header + footer. Phones: app bars. */}
      <TopNav />
      <MobileTopBar />
      <OfflineIndicator />
      <PullToRefresh>
        <div className="flex-1">{children}</div>
      </PullToRefresh>
      <div className="hidden md:block">
        <SiteFooter />
      </div>
      <MobileTabBar />
      <Fab />
      <InstallBanner />
      <TripReminders />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="keep-navy bg-[#0d0e11] border-t-2 border-[#feb700]/40 w-full pt-12 pb-12">
      <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between gap-10">
        <div className="space-y-3 max-w-sm">
          <Wordmark />
          <p className="text-[14px] leading-[1.6] text-white/70">{OPERATOR.tagline}</p>
          <InstallAppButton className="pt-2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-10 text-[14px] leading-[1.6] min-w-0">
          <div className="space-y-2">
            <h4 className="font-bold text-[#feb700]">Popular routes</h4>
            <ul className="space-y-2 text-white/70">
              {[
                ['colombo-to-batticaloa', 'Colombo to Batticaloa'],
                ['colombo-to-kalmunai', 'Colombo to Kalmunai'],
                ['colombo-to-akkaraipattu', 'Colombo to Akkaraipattu'],
                ['colombo-to-polonnaruwa', 'Colombo to Polonnaruwa'],
              ].map(([slug, label]) => (
                <li key={slug}><Link className="hover:text-white" href={`/bus/${slug}`}>{label}</Link></li>
              ))}
              <li><Link className="hover:text-white font-semibold" href="/bus">All routes</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-[#feb700]">Travel</h4>
            <ul className="space-y-2 text-white/70">
              <li><Link className="hover:text-white" href="/search">Book a seat</Link></li>
              <li><Link className="hover:text-white" href="/my-bookings">Manage my trip</Link></li>
              <li><Link className="hover:text-white" href="/#timetable">Next departures</Link></li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-[#feb700]">Contact</h4>
            <ul className="space-y-2 text-white/70">
              {OPERATOR.contact.phone ? (
                <li><a className="hover:text-white" href={OPERATOR.contact.phoneHref}>{OPERATOR.contact.phone}</a></li>
              ) : null}
              <li><a className="hover:text-white" href={`mailto:${OPERATOR.contact.email}`}>{OPERATOR.contact.email}</a></li>
              <li>{OPERATOR.contact.address}</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="px-4 md:px-[64px] max-w-[1440px] mx-auto mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row justify-between gap-3 text-[12px] font-semibold text-white/50">
        <p>© {new Date().getFullYear()} {OPERATOR.name}. All rights reserved.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link className="hover:text-white" href="/legal#terms">Terms of travel</Link>
          <Link className="hover:text-white" href="/legal#privacy">Privacy</Link>
          <Link className="hover:text-white" href="/legal#refunds">Refund policy</Link>
        </div>
      </div>
    </footer>
  );
}
