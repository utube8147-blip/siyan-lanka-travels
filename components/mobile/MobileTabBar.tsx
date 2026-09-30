'use client';
// Phone bottom tab bar (Home · Book · Trips · Profile), in thumb reach and
// clear of the gesture bar. Hidden during checkout/sign-in so the flow stays
// focused. Renders its own spacer so page content never hides behind it.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Search, Ticket, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { isFocused } from './routes';

const TABS = [
  { href: '/', label: 'Home', Icon: House, match: (p: string) => p === '/' || p.startsWith('/bus') },
  { href: '/search', label: 'Book', Icon: Search, match: (p: string) => p.startsWith('/search') },
  { href: '/my-bookings', label: 'Trips', Icon: Ticket, match: (p: string) => p.startsWith('/my-bookings') || p.startsWith('/refund') },
  { href: '/profile', label: 'Profile', Icon: UserRound, match: (p: string) => ['/profile', '/dashboard', '/marketplace', '/legal'].some((b) => p.startsWith(b)) },
];

export function MobileTabBar() {
  const pathname = usePathname() || '/';
  if (isFocused(pathname)) return null;
  return (
    <>
      <div className="md:hidden h-[calc(64px+env(safe-area-inset-bottom))]" aria-hidden />
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur-md border-t border-[#edeef0] pb-[env(safe-area-inset-bottom)] select-none"
      >
        <ul className="grid grid-cols-4 h-16">
          {TABS.map(({ href, label, Icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className="h-full flex flex-col items-center justify-center gap-1"
                >
                  <span className="relative w-14 h-8 rounded-full flex items-center justify-center">
                    {active && (
                      <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-[#feb700]" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />
                    )}
                    <motion.span className="relative" animate={{ scale: active ? 1.06 : 1 }} whileTap={{ scale: 0.86 }}>
                      <Icon className={`w-[22px] h-[22px] ${active ? 'text-[#14120a]' : 'text-[#46464f]'}`} strokeWidth={active ? 2.3 : 1.9} />
                    </motion.span>
                  </span>
                  <span className={`text-[11px] ${active ? 'font-semibold text-[#050a44]' : 'font-medium text-[#46464f]'}`}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
