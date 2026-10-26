'use client';
// app/admin/layout.tsx — operator dashboard shell.
// Access is gated on the mock "operator" (staff) role. When real auth is added,
// enforce this on the server too (middleware + database row-level security);
// a client-side check alone only hides the UI.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Bus, Banknote, Ticket, BarChart3, Users, Settings as SettingsIcon, LogOut, ScanLine, Menu, X } from 'lucide-react';
import { motion } from 'motion/react';
import { isOfficeRole, useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStore, StoreLoading } from '@/lib/store';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/admin/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { usePayouts } from '@/lib/money';

import { tx, txn } from '@/lib/i18n';
// Seven places, one job each, each an icon and one word. Most pages are tabs
// inside these (see components/admin/Hub.tsx).
type NavItem = { href: string; label: string; icon: typeof House; adminOnly?: boolean; also?: string[] };
const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Daily work',
    items: [
      { href: '/admin', label: 'Today', icon: House },
      { href: '/admin/trips', label: 'Trips', icon: Ticket, also: ['/admin/requests'] },
      { href: '/admin/money', label: 'Money', icon: Banknote },
      { href: '/admin/buses', label: 'Buses', icon: Bus, also: ['/admin/routes/'] },
    ],
  },
  {
    title: 'Owner',
    items: [
      { href: '/admin/reports', label: 'Reports', icon: BarChart3, adminOnly: true },
      { href: '/admin/people', label: 'People', icon: Users, adminOnly: true },
      { href: '/admin/settings', label: 'Settings', icon: SettingsIcon, adminOnly: true },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, isLoading, mode } = useAuth();
  const { ready, data } = useStore();
  // Work waiting for the office: unpaid online holds for the counter or bank (incl. slips to check).
  const waiting = data.bookings.filter((b) => b.status === 'held' && b.channel === 'online' && (b.paymentMethod === 'bank' || b.paymentMethod === 'counter')).length;
  const { payouts } = usePayouts('all');
  const owed = payouts.filter((p) => p.status === 'pending').length;
  const counts: Record<string, number> = { '/admin/trips': waiting, '/admin/money': owed };
  const badge = (href: string) =>
    counts[href] > 0 ? (
      <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-[#feb700] text-[#14120a] text-[11px] font-bold inline-flex items-center justify-center" aria-label={txn(counts[href], '{n} waiting', '{n} waiting')}>{counts[href] > 99 ? '99+' : counts[href]}</span>
    ) : null;
  const isStaff = isOfficeRole(user?.role);
  // Slide-out menu on phones and tablets.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]); // a link was followed
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // the page behind doesn't scroll while the menu is open
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const router = useRouter();
  useEffect(() => {
    if (user?.role === 'conductor') router.replace('/conductor');
  }, [user?.role, router]);
  const isAdmin = user?.role === 'admin';
  const sections = SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter((i) => !i.adminOnly || isAdmin) })).filter((sec) => sec.items.length);
  const NAV = sections.flatMap((sec) => sec.items);
  const active = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    const item = NAV.find((i) => i.href === href);
    return pathname === href || !!pathname?.startsWith(`${href}/`) || !!item?.also?.some((a) => pathname?.startsWith(a));
  };

  if (isLoading) return <StoreLoading />;

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#f8f9fb]">
        <div className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm p-8 max-w-sm w-full text-center space-y-5">
          <div className="flex justify-center">
            <Wordmark badge />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-[#050a44]">{tx('Staff area')}</h1>
            <p className="text-[14px] text-[#46464f] mt-1">{tx('Staff only. Sign in with your staff account.')}</p>
          </div>
          {user && !isStaff && mode === 'supabase' ? (
            <p className="text-[13px] text-[#46464f] bg-[#f2f4f6] rounded-xl p-3">
              {tx("You're signed in as {email}, which doesn't have staff access.", { email: user.email })}
            </p>
          ) : (
            <Link href={`/staff/login?next=${encodeURIComponent(pathname || '/admin')}`} className="block">
              <Button className="w-full">{tx('Staff sign-in')}</Button>
            </Link>
          )}

        </div>
      </div>
    );
  }

  // The staff menu: one definition, shown as the fixed sidebar on large screens
  // and inside the slide-out drawer (hamburger) on phones and tablets.
  const sidebarBody = ({ closeButton = false }: { closeButton?: boolean } = {}) => (
    <>
      <div className="flex items-start justify-between gap-2 mb-8">
        <Link href="/admin" className="block min-w-0" onClick={() => setMenuOpen(false)}>
          <Wordmark />
          <span className="block text-[11px] font-semibold text-white/50 mt-2 truncate">{isAdmin ? tx('Super admin') : tx('Staff')} · {user.user_metadata.full_name}</span>
        </Link>
        {closeButton && (
          <button onClick={() => setMenuOpen(false)} aria-label={tx('Close menu')} className="shrink-0 w-10 h-10 -mr-2 -mt-1 rounded-xl flex items-center justify-center text-white/80 hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Scrolls with wheel / trackpad / touch, but the scrollbar is hidden
          (.no-scrollbar is defined in globals.css). */}
      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar space-y-5" aria-label={tx('Staff')}>
        {sections.map((sec) => (
          <div key={sec.title} className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">{sec.title}</p>
            {sec.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                aria-current={active(href) ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-semibold transition-colors ${
                  active(href) ? 'bg-white text-[#050a44]' : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {label}
                {badge(href)}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom block: Sign out on the left, theme toggle beside it on the right
          (same in the desktop sidebar and the hamburger drawer). */}
      <div className="space-y-1 border-t border-white/10 pt-4">
        <Link href="/conductor" className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
          <ScanLine className="w-4 h-4" /> {tx('Conductor app (phone)')}
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={logout} className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
            <LogOut className="w-4 h-4 shrink-0" /> {tx('Sign out')}
          </button>
          <ThemeToggle onDark />
        </div>
      </div>
    </>
  );

  return (
    // overflow-x-clip: nothing in the staff area can make the page scroll sideways.
    <div className="min-h-screen bg-[#f2f4f7] lg:grid lg:grid-cols-[248px_1fr] overflow-x-clip">
      <title>Staff area | Siyan Lanka Travels</title>
      <meta name="robots" content="noindex, nofollow" />

      {/* Large screens: fixed sidebar */}
      <aside className="keep-navy hidden lg:flex flex-col bg-[#111216] text-white sticky top-0 h-screen p-5">{sidebarBody()}</aside>

      {/* Phones and tablets: top bar with the hamburger */}
      <div className="keep-navy lg:hidden sticky top-0 z-40 bg-[#111216] text-white">
        <div className="flex items-center justify-between gap-2 px-2 h-14">
          <div className="flex items-center gap-1 min-w-0">
            <button onClick={() => setMenuOpen(true)} aria-label={tx('Open menu')} aria-expanded={menuOpen} className="relative w-11 h-11 rounded-xl flex items-center justify-center hover:bg-white/10">
              <Menu className="w-6 h-6" />
              {waiting > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#feb700]" aria-hidden />}
            </button>
            <Link href="/admin" aria-label={tx('Staff area home')}>
              <Wordmark size="sm" />
            </Link>
          </div>
          <ThemeToggle onDark />
        </div>
      </div>

      {/* The drawer. "fixed inset-0" (not 100vw) so it never widens the page. */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button aria-label={tx('Close menu')} onClick={() => setMenuOpen(false)} className="absolute inset-0 w-full h-full bg-black/60 cursor-default" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={tx('Staff menu')}
            className={`keep-navy absolute left-0 top-0 bottom-0 w-[280px] max-w-[85%] bg-[#111216] text-white flex flex-col p-5 shadow-2xl`}
          >
            {sidebarBody({ closeButton: true })}
          </aside>
        </div>
      )}

      <main className="min-w-0 px-4 md:px-8 pt-6 md:pt-8 pb-[calc(env(safe-area-inset-bottom)+110px)] lg:pb-8 max-w-[1280px] w-full">{ready ? children : <StoreLoading />}</main>

      {/* Phones and tablets: the four daily places in a bottom bar (the owner's are in the menu). */}
      <div className="keep-navy lg:hidden fixed inset-x-0 z-40 px-3 flex justify-center pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+10px)]">
        <nav aria-label="Daily work" className="pointer-events-auto w-full max-w-[480px] rounded-full bg-[#111216]/95 backdrop-blur border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.35)] p-1.5">
          <ul className="grid grid-cols-4 gap-1 h-[64px]">
            {SECTIONS[0].items.map(({ href, label, icon: Icon }) => {
              const on = active(href);
              return (
                <li key={href} className="relative">
                  <Link href={href} aria-current={on ? 'page' : undefined} className="relative h-full flex flex-col items-center justify-center gap-1 rounded-full">
                    {on && <motion.span layoutId="staff-tab-pill" className="absolute inset-0 rounded-full bg-white/[0.12]" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                    <span className="relative flex items-center justify-center">
                      <Icon className={`w-6 h-6 ${on ? 'text-[#feb700]' : 'text-white/60'}`} strokeWidth={on ? 2.3 : 1.8} />
                      {counts[href] > 0 && <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#feb700] text-[#14120a] text-[10px] font-extrabold flex items-center justify-center">{counts[href] > 99 ? '99+' : counts[href]}</span>}
                    </span>
                    <span className={`relative text-[12px] leading-none ${on ? 'font-bold text-white' : 'font-medium text-white/70'}`}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}