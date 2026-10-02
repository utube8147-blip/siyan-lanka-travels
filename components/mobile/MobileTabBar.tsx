'use client';
// Phone bottom tab bar (Home · Book · Trips · Profile), styled like the current
// Uber app: a floating rounded capsule inset from the screen edges, with the
// active tab shown as a filled pill holding the icon and label.
// Hidden during checkout/sign-in so the flow stays focused. Renders its own
// spacer so page content never hides behind it. Slides away while scrolling
// down and returns as soon as you scroll up, like the desktop header.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Search, Ticket, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { isFocused } from './routes';
import { useT } from '@/lib/i18n';
import { useHideOnScroll } from '@/lib/useHideOnScroll';

const TABS = [
  { href: '/', label: 'Home', Icon: House, fill: true, match: (p: string) => p === '/' || p.startsWith('/bus') },
  { href: '/search', label: 'Book', Icon: Search, fill: false, match: (p: string) => p.startsWith('/search') },
  { href: '/my-bookings', label: 'Trips', Icon: Ticket, fill: false, match: (p: string) => p.startsWith('/my-bookings') || p.startsWith('/refund') },
  { href: '/profile', label: 'Profile', Icon: UserRound, fill: true, match: (p: string) => ['/profile', '/dashboard', '/marketplace', '/legal', '/services'].some((b) => p.startsWith(b)) },
];

export function MobileTabBar() {
  const { t } = useT();
  const pathname = usePathname() || '/';
  // Must run before the early return below so hooks stay in the same order.
  const hidden = useHideOnScroll();
  if (isFocused(pathname)) return null;
  return (
    <>
      <div className="md:hidden h-[calc(88px+env(safe-area-inset-bottom))]" aria-hidden />
      {/* Wrapper handles position + slide; the capsule inside is centred and capped in width. */}
      <div
        className={`md:hidden fixed inset-x-0 z-40 px-3 flex justify-center pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+10px)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
          hidden ? 'translate-y-[calc(100%+40px)]' : 'translate-y-0'
        }`}
      >
        <nav
          aria-label="Main"
          className="pointer-events-auto w-full max-w-[480px] rounded-full bg-white border border-[#e1e2e4] shadow-[0_8px_30px_rgba(0,0,0,0.14)] p-1.5 select-none"
        >
          <ul className="grid grid-cols-4 gap-1 h-[62px]">
            {TABS.map(({ href, label, Icon, fill, match }) => {
              const active = match(pathname);
              return (
                <li key={href} className="relative">
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className="relative h-full flex flex-col items-center justify-center gap-1"
                  >
                    {active && (
                      <motion.span
                        layoutId="tab-pill"
                        className="absolute inset-0 rounded-full bg-[#edeef0]"
                        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                      />
                    )}
                    <motion.span whileTap={{ scale: 0.88 }} className="relative flex items-center justify-center">
                      <Icon
                        className={`w-6 h-6 transition-colors ${active ? 'text-[#050a44]' : 'text-[#6b6d78]'}`}
                        strokeWidth={active ? 2.3 : 1.8}
                        fill={active && fill ? 'currentColor' : 'none'}
                      />
                    </motion.span>
                    <span className={`relative text-[11px] leading-none transition-colors ${active ? 'font-bold text-[#050a44]' : 'font-medium text-[#6b6d78]'}`}>
                      {t(label)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}