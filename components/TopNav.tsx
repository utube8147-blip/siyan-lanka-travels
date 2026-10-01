'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  LogOut,
  Ticket,
  User as UserIcon,
  LayoutDashboard,
  Store,
  Search,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { OPERATOR } from '@/config/operator';
import { useResaleEnabled } from '@/lib/resale';
import { Wordmark } from './Wordmark';
import { ThemeToggle } from './ThemeToggle';
import { InstallAppButton } from './InstallAppButton';
import { LanguageSwitcher, useT } from '@/lib/i18n';

// Desktop/tablet header (md and up). Phones use components/mobile/* instead:
// a slim top bar and a bottom tab bar, like a native app.
// Header links = where you go to travel. Account things live only in the
// avatar menu, so nothing appears twice.
const BASE_LINKS = [
  { href: '/search', label: 'Book', icon: Search },
  { href: '/my-bookings', label: 'My trips', icon: Ticket },
];
const RESALE_LINK = { href: '/marketplace', label: 'Resale', icon: Store };

export function TopNav() {
  const { t } = useT();
  const pathname = usePathname();
  const { user, isLoggedIn, logout } = useAuth();
  const resaleOn = useResaleEnabled();
  const NAV_LINKS = resaleOn ? [...BASE_LINKS, RESALE_LINK] : BASE_LINKS;
  const [menuOpen, setMenuOpen] = useState(false);

  // Hide the header while scrolling down (more room to read), bring it back
  // the moment the user scrolls up, and always show it near the top.
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        if (y < 80) setHidden(false);
        else if (delta > 6) setHidden(true);
        else if (delta < -6) setHidden(false);
        lastY.current = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Show it again whenever the page changes.
  useEffect(() => setHidden(false), [pathname]);
  const headerHidden = hidden && !menuOpen;

  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <>
      {/* Top bar — desktop nav lives here, mobile just shows logo + avatar/bell */}
      <nav className={`hidden md:flex sticky top-0 z-40 bg-white/90 backdrop-blur-md h-20 w-full px-4 md:px-[64px] justify-between items-center border-b border-[#edeef0] transition-transform duration-300 ease-out motion-reduce:transition-none ${headerHidden ? '-translate-y-full' : 'translate-y-0'}`}
        onFocusCapture={() => setHidden(false)}
      >
        <Link href="/" aria-label={`${OPERATOR.name} home`}>
          <Wordmark />
        </Link>

        <div className="hidden md:flex items-center gap-8 h-full">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={`relative h-full flex items-center text-[15px] tracking-[0.01em] transition-colors duration-200 after:absolute after:left-0 after:right-0 after:bottom-0 after:h-[3px] after:rounded-t-full after:transition-colors ${
                isActive(link.href)
                  ? 'text-[#050a44] font-bold after:bg-[#feb700]'
                  : 'text-[#46464f] font-medium hover:text-[#050a44] after:bg-transparent'
              }`}
            >
              {t(link.label)}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <LanguageSwitcher className="hidden lg:inline-flex" />
          <InstallAppButton variant="icon" />
          <ThemeToggle />

          {isLoggedIn && user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-[#f2f4f6] transition-colors"
              >
                <div className="cursor-pointer w-10 h-10 rounded-full bg-[#feb700] text-[#050a44] flex items-center justify-center text-[13px] font-bold shadow-sm" aria-label={user.user_metadata.full_name}>
                  {user.user_metadata.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown className="w-4 h-4 text-[#46464f] hidden md:block" />
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-[#edeef0] rounded-2xl shadow-lg py-2 z-20">
                    <div className="px-4 py-3 border-b border-[#edeef0]">
                      <p className="text-sm font-bold text-[#050a44] truncate">{user.user_metadata.full_name}</p>
                      <p className="text-xs text-[#46464f] truncate">{user.email}</p>
                    </div>
                    <Link
                      href="/dashboard"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#050a44] hover:bg-[#f2f4f6] transition-all"
                    >
                      <UserIcon className="w-4 h-4" />
                      {t('Account')}
                    </Link>
                    <Link
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#050a44] hover:bg-[#f2f4f6] transition-all"
                    >
                      <Settings className="w-4 h-4" />
                      {t('Settings')}
                    </Link>
                    <InstallAppButton variant="menu" onDone={() => setMenuOpen(false)} />
                    {/* Mock auth reset — signs the mock user out in place, no
                        real login page needed. Swap for a real sign-out call
                        (and keep the redirect) once auth is wired for real. */}
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('Sign out')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link
              href={`/auth/login?next=${encodeURIComponent(pathname || '/')}`}
              className="px-5 py-2.5 bg-[#feb700] text-[#050a44] rounded-xl text-[14px] font-bold hover:brightness-105 transition-all"
            >
              {t('Sign in')}
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}