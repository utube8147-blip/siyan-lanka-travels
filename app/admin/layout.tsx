'use client';
// app/admin/layout.tsx — operator dashboard shell.
// Access is gated on the mock "operator" (staff) role. When real auth is added,
// enforce this on the server too (middleware + database row-level security);
// a client-side check alone only hides the UI.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarClock, Ticket, Bus, Route as RouteIcon, ExternalLink, LogOut, Wallet, Receipt, Wrench, Users, UserCog, Settings as SettingsIcon } from 'lucide-react';
import { isStaffRole, useAuth } from '@/contexts/AuthContext';
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
      { href: '/admin/expenses', label: 'Expenses & fuel', icon: Receipt },
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
  const { ready } = useStore();
  const isStaff = isStaffRole(user?.role);
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

  return (
    <div className="min-h-screen bg-[#f2f4f7] lg:grid lg:grid-cols-[248px_1fr]">
      <title>Staff area | Siyan Lanka Travels</title>
      <meta name="robots" content="noindex, nofollow" />
      <aside className="keep-navy hidden lg:flex flex-col bg-[#111216] text-white sticky top-0 h-screen p-5">
        <Link href="/admin" className="mb-8 block">
          <Wordmark />
          <span className="block text-[11px] font-semibold text-white/50 mt-2">{isAdmin ? 'Super admin' : 'Staff'} · {user.user_metadata.full_name}</span>
        </Link>
        <nav className="flex-1 overflow-y-auto space-y-5" aria-label="Staff">
          {sections.map((sec) => (
            <div key={sec.title} className="space-y-1">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">{sec.title}</p>
          {sec.items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-semibold transition-colors ${
                active(href) ? 'bg-white text-[#050a44]' : 'text-white/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              {label}
            </Link>
          ))}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/10 pt-4">
          <Link href="/" target="_blank" className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
            <ExternalLink className="w-4 h-4" /> View customer site
          </Link>
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
          <div className="flex items-center gap-2 px-1 pt-1 text-[13px] font-semibold text-white/80">
            <ThemeToggle onDark /> Theme
          </div>
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      <div className="keep-navy lg:hidden sticky top-0 z-40 bg-[#111216] text-white">
        <div className="flex items-center justify-between px-4 h-14">
          <Wordmark size="sm" />
          <div className="flex items-center gap-1">
            <ThemeToggle onDark />
            <button onClick={logout} className="text-[12px] font-semibold text-white/80 px-2">
              Sign out
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto no-scrollbar px-3 pb-2" aria-label="Operator">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold ${active(href) ? 'bg-white text-[#050a44]' : 'text-white/80 bg-white/10'}`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <main className="min-w-0 px-4 md:px-8 py-6 md:py-8 max-w-[1280px] w-full">{ready ? children : <StoreLoading />}</main>
    </div>
  );
}
