'use client';
// app/admin/layout.tsx — operator dashboard shell.
// Access is gated on the mock "operator" (staff) role. When real auth is added,
// enforce this on the server too (middleware + database row-level security);
// a client-side check alone only hides the UI.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarClock, Ticket, Bus, Route as RouteIcon, ExternalLink, LogOut, Wallet, Receipt, Wrench, Users, UserCog, Settings as SettingsIcon, Package, Banknote, ScanLine, HandCoins, Menu, X } from 'lucide-react';
import { isOfficeRole, useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useStore, StoreLoading } from '@/lib/store';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/admin/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean };
const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard },
      { href: '/admin/departures', label: 'Departures', icon: CalendarClock },
      { href: '/admin/bookings', label: 'Bookings', icon: Ticket },
      { href: '/admin/payouts', label: 'Refunds & payouts', icon: HandCoins },
      { href: '/admin/expenses', label: 'Expenses & fuel', icon: Receipt },
      { href: '/admin/requests', label: 'Parcels & hire', icon: Package },
      { href: '/admin/cash', label: 'Close the day', icon: Banknote },
      { href: '/admin/fleet', label: 'Buses', icon: Bus },
      { href: '/admin/routes', label: 'Routes & timetable', icon: RouteIcon },
    ],
  },
  {
    title: 'Business',
    items: [
      { href: '/admin/finance', label: 'Finance', icon: Wallet, adminOnly: true },
      { href: '/admin/fleet-health', label: 'Fleet health', icon: Wrench, adminOnly: true },
      { href: '/admin/crew', label: 'Crew', icon: Users, adminOnly: true },
      { href: '/admin/accounts', label: 'Accounts & roles', icon: UserCog, adminOnly: true },
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
  const badge = (href: string) =>
    href === '/admin/bookings' && waiting > 0 ? (
      <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-[#feb700] text-[#14120a] text-[11px] font-bold inline-flex items-center justify-center" aria-label={`${waiting} waiting for payment`}>{waiting}</span>
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
  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || !!pathname?.startsWith(`${href}/`));

  if (isLoading) return <StoreLoading />;

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#f8f9fb]">
        <div className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm p-8 max-w-sm w-full text-center space-y-5">
          <div className="flex justify-center">
            <Wordmark badge />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-[#050a44]">Staff area</h1>
            <p className="text-[14px] text-[#46464f] mt-1">Staff only. Sign in with your staff account.</p>
          </div>
          {user && !isStaff && mode === 'supabase' ? (
            <p className="text-[13px] text-[#46464f] bg-[#f2f4f6] rounded-xl p-3">
              You&apos;re signed in as {user.email}, which doesn&apos;t have staff access.
            </p>
          ) : (
            <Link href={`/staff/login?next=${encodeURIComponent(pathname || '/admin')}`} className="block">
              <Button className="w-full">Staff sign-in</Button>
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
          <span className="block text-[11px] font-semibold text-white/50 mt-2 truncate">{isAdmin ? 'Super admin' : 'Staff'} · {user.user_metadata.full_name}</span>
        </Link>
        {closeButton && (
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="shrink-0 w-10 h-10 -mr-2 -mt-1 rounded-xl flex items-center justify-center text-white/80 hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Scrolls with wheel / trackpad / touch, but the scrollbar is hidden
          (.no-scrollbar is defined in globals.css). */}
      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar space-y-5" aria-label="Staff">
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

      <div className="space-y-1 border-t border-white/10 pt-4">
        <Link href="/conductor" className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
          <ScanLine className="w-4 h-4" /> Conductor app (phone)
        </Link>
        <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
        <div className="flex items-center gap-2 px-1 pt-1 text-[13px] font-semibold text-white/80">
          <ThemeToggle onDark /> Theme
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
            <button onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} className="relative w-11 h-11 rounded-xl flex items-center justify-center hover:bg-white/10">
              <Menu className="w-6 h-6" />
              {waiting > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#feb700]" aria-hidden />}
            </button>
            <Link href="/admin" aria-label="Staff area home">
              <Wordmark size="sm" />
            </Link>
          </div>
          <ThemeToggle onDark />
        </div>
      </div>

      {/* The drawer. "fixed inset-0" (not 100vw) so it never widens the page. */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 w-full h-full bg-black/60 cursor-default" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Staff menu"
            className={`keep-navy absolute left-0 top-0 bottom-0 w-[280px] max-w-[85%] bg-[#111216] text-white flex flex-col p-5 shadow-2xl`}
          >
            {sidebarBody({ closeButton: true })}
          </aside>
        </div>
      )}

      <main className="min-w-0 px-4 md:px-8 py-6 md:py-8 max-w-[1280px] w-full">{ready ? children : <StoreLoading />}</main>
    </div>
  );
}