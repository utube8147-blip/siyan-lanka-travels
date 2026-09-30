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
  Building2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { OPERATOR } from '@/config/operator';
import { Wordmark } from './Wordmark';
import { ThemeToggle } from './ThemeToggle';

// Header links = where you go to travel. Account things live only in the
// avatar menu, so nothing appears twice. The phone tab bar has no avatar
// menu room, so it also carries Account.
const NAV_LINKS = [
  { href: '/search', label: 'Book', icon: Search },
  { href: '/my-bookings', label: 'My trips', icon: Ticket },
  ...(OPERATOR.features.resale ? [{ href: '/marketplace', label: 'Resale', icon: Store }] : []),
];
const MOBILE_LINKS = [...NAV_LINKS, { href: '/dashboard', label: 'Account', icon: LayoutDashboard }];

export function TopNav() {
  const pathname = usePathname();
  const { user, isLoggedIn, login, logout } = useAuth();
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
      <nav className={`sticky top-0 z-40 bg-[#050a44]/95 backdrop-blur-md h-20 w-full px-4 md:px-[64px] flex justify-between items-center border-b border-[#feb700]/20 shadow-[0_4px_20px_-8px_rgba(5,10,68,0.5)] transition-transform duration-300 ease-out motion-reduce:transition-none ${headerHidden ? '-translate-y-full' : 'translate-y-0'}`}
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
                  ? 'text-white font-bold after:bg-[#feb700]'
                  : 'text-white/70 font-medium hover:text-white after:bg-transparent'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <ThemeToggle />

          {isLoggedIn && user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <div className="cursor-pointer w-10 h-10 rounded-full bg-[#feb700] text-[#050a44] flex items-center justify-center text-[13px] font-bold shadow-sm" aria-label={user.user_metadata.full_name}>
                  {user.user_metadata.full_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown className="w-4 h-4 text-white/70 hidden md:block" />
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
                      Account
                    </Link>
                    <Link
                      href="/admin"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#050a44] hover:bg-[#f2f4f6] transition-all border-t border-[#edeef0]"
                    >
                      <Building2 className="w-4 h-4" />
                      Operator dashboard
                    </Link>
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
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            // Mock auth reset — instantly restores the mock user instead of
            // sending you to a real /auth/login page (which doesn't do
            // anything yet). Swap for <Link href="/auth/login"> once a real
            // login flow exists.
            <button
              onClick={() => login()}
              className="px-5 py-2.5 bg-[#feb700] text-[#050a44] rounded-xl text-[14px] font-bold hover:brightness-105 transition-all"
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-[#edeef0] shadow-[0_-4px_24px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-around px-2 pt-2 pb-2">
          {MOBILE_LINKS.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex flex-col items-center justify-center gap-1 flex-1 py-1"
              >
                <div
                  className={`flex items-center justify-center w-11 h-8 rounded-full transition-all duration-200 ${
                    active ? 'bg-[#050a44]' : 'bg-transparent'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 transition-colors ${
                      active ? 'text-white' : 'text-[#46464f]'
                    }`}
                    strokeWidth={active ? 2.4 : 2}
                  />
                </div>
                <span
                  className={`text-[10px] leading-none tracking-[0.01em] transition-colors ${
                    active ? 'text-[#050a44] font-bold' : 'text-[#46464f] font-medium'
                  }`}
                >
                  {link.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}