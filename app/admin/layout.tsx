'use client';
// app/admin/layout.tsx — operator dashboard shell.
// Access is gated on the mock "operator" (staff) role. When real auth is added,
// enforce this on the server too (middleware + database row-level security);
// a client-side check alone only hides the UI.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarClock, Ticket, Bus, Route as RouteIcon, ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore, StoreLoading } from '@/lib/store';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/admin/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/departures', label: 'Departures', icon: CalendarClock },
  { href: '/admin/bookings', label: 'Bookings', icon: Ticket },
  { href: '/admin/fleet', label: 'Buses', icon: Bus },
  { href: '/admin/routes', label: 'Routes & timetable', icon: RouteIcon },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, login, logout, isLoading } = useAuth();
  const { ready } = useStore();
  const isStaff = user?.role === 'operator';
  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname?.startsWith(href));

  if (isLoading) return <StoreLoading />;

  if (!isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#f8f9fb]">
        <div className="bg-white rounded-2xl border border-[#e1e2e4] shadow-sm p-8 max-w-sm w-full text-center space-y-5">
          <div className="flex justify-center">
            <Wordmark badge />
          </div>
          <div>
            <h1 className="text-[20px] font-bold text-[#050a44]">Operator dashboard</h1>
            <p className="text-[14px] text-[#46464f] mt-1">Staff only. Sign in with a staff account to manage buses, departures and bookings.</p>
          </div>
          <Button className="w-full" onClick={() => login({ role: 'operator' })}>
            Continue as staff (demo)
          </Button>
          <Link href="/" className="block text-[13px] font-bold text-[#050a44] hover:underline">
            Back to the booking site
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f4f7] lg:grid lg:grid-cols-[248px_1fr]">
      <title>Operator dashboard | Siyan Lanka Travels</title>
      <meta name="robots" content="noindex, nofollow" />
      <aside className="keep-navy hidden lg:flex flex-col bg-[#111216] text-white sticky top-0 h-screen p-5">
        <Link href="/admin" className="mb-8 block">
          <Wordmark />
          <span className="block text-[11px] font-semibold text-[#bdc2ff] mt-2">Operator dashboard</span>
        </Link>
        <nav className="space-y-1 flex-1" aria-label="Operator">
          {NAV.map(({ href, label, icon: Icon }) => (
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
        </nav>
        <div className="space-y-1 border-t border-white/10 pt-4">
          <Link href="/" target="_blank" className="flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
            <ExternalLink className="w-4 h-4" /> Open booking site
          </Link>
          <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-white/80 hover:bg-white/10">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
          <div className="flex items-center gap-2 px-1 pt-1 text-[13px] font-semibold text-white/80">
            <ThemeToggle /> Theme
          </div>
        </div>
      </aside>

      {/* Mobile / tablet top bar */}
      <div className="keep-navy lg:hidden sticky top-0 z-40 bg-[#111216] text-white">
        <div className="flex items-center justify-between px-4 h-14">
          <Wordmark size="sm" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
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
