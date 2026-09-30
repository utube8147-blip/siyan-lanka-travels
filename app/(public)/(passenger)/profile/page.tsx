'use client';
// Profile & settings — the app's "More" screen. Holds everything a website
// would put in its footer or menu: account, settings, help, legal.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  FileText,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Route as RouteIcon,
  ShieldCheck,
  Store,
  Ticket,
  Undo2,
  Wallet,
} from 'lucide-react';
import { OPERATOR } from '@/config/operator';
import { useResaleEnabled } from '@/lib/resale';
import { useAuth } from '@/contexts/AuthContext';
import { ThemeSegmented } from '@/components/ThemeToggle';
import { NotificationOptIn } from '@/components/NotificationOptIn';
import { InstallAppButton } from '@/components/InstallAppButton';

type RowProps = { href: string; icon: React.ComponentType<{ className?: string }>; label: string; hint?: string; external?: boolean };

function Row({ href, icon: Icon, label, hint, external }: RowProps) {
  const inner = (
    <>
      <span className="w-9 h-9 rounded-xl bg-[#f2f4f6] flex items-center justify-center shrink-0">
        <Icon className="w-[18px] h-[18px] text-[#050a44]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-[#050a44] truncate">{label}</span>
        {hint && <span className="block text-[12px] text-[#6b6d78] truncate">{hint}</span>}
      </span>
      <ChevronRight className="w-5 h-5 text-[#6b6d78] shrink-0" />
    </>
  );
  const cls = 'flex items-center gap-3 px-4 py-3 active:bg-[#f2f4f6] hover:bg-[#f8f9fb] transition-colors';
  return external ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-4 pb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6b6d78]" style={{ fontFamily: 'var(--font-sans)', letterSpacing: '0.08em' }}>
        {title}
      </h2>
      <div className="bg-white rounded-2xl border border-[#edeef0] divide-y divide-[#edeef0] overflow-hidden">{children}</div>
    </section>
  );
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const resaleOn = useResaleEnabled();
  const router = useRouter();
  const name = user?.user_metadata.full_name ?? 'Guest';
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <main className="max-w-[640px] mx-auto px-4 py-5 md:py-10 space-y-6">
      <h1 className="hidden md:block text-[28px] font-semibold text-[#050a44]">Profile & settings</h1>

      {/* Account card */}
      <div className="bg-white rounded-2xl border border-[#edeef0] p-4 flex items-center gap-4">
        <span className="w-14 h-14 rounded-full bg-[#feb700] text-[#14120a] flex items-center justify-center text-[18px] font-semibold shrink-0">
          {user ? initials : '?'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold text-[#050a44] truncate">{user ? name : 'Not signed in'}</p>
          <p className="text-[13px] text-[#6b6d78] truncate">{user ? user.email : 'Sign in to see your tickets on any device'}</p>
        </div>
        {user ? (
          <Link href="/dashboard" className="shrink-0 px-3 py-2 rounded-lg bg-[#f2f4f6] text-[13px] font-semibold text-[#050a44]">
            Account
          </Link>
        ) : (
          <Link href="/auth/login" className="shrink-0 px-4 py-2 rounded-lg bg-[#050a44] text-white text-[13px] font-semibold">
            Sign in
          </Link>
        )}
      </div>

      <Group title="Travel">
        <Row href="/my-bookings" icon={Ticket} label="My trips" hint="Tickets, seat changes, cancellations" />
        <Row href="/dashboard" icon={Wallet} label="Wallet & rewards" hint="Credits, points, booking history" />
        {resaleOn && <Row href="/marketplace" icon={Store} label="Resale tickets" hint="Buy or sell a seat" />}
        <Row href="/bus" icon={RouteIcon} label="Routes & timetables" hint="Stops, times and fares" />
      </Group>

      <section className="space-y-3">
        <h2 className="px-4 text-[12px] font-semibold uppercase text-[#6b6d78]" style={{ fontFamily: 'var(--font-sans)', letterSpacing: '0.08em' }}>
          App
        </h2>
        <div className="bg-white rounded-2xl border border-[#edeef0] p-4 space-y-3">
          <p className="text-[15px] font-medium text-[#050a44]">Appearance</p>
          <ThemeSegmented />
        </div>
        <NotificationOptIn />
        <div className="empty:hidden">
          <InstallAppButton className="w-full justify-center" />
        </div>
      </section>

      <Group title="Help">
        <Row href={`mailto:${OPERATOR.contact.email}`} icon={Mail} label="Email us" hint={OPERATOR.contact.email} external />
        {OPERATOR.contact.phone ? <Row href={OPERATOR.contact.phoneHref} icon={Phone} label="Call us" hint={OPERATOR.contact.phone} external /> : null}
        <Row href="/bus" icon={MapPin} label="Where the bus leaves from" hint={OPERATOR.contact.address} />
      </Group>

      <Group title="Legal">
        <Row href="/legal#terms" icon={FileText} label="Terms of travel" />
        <Row href="/legal#privacy" icon={ShieldCheck} label="Privacy policy" />
        <Row href="/legal#refunds" icon={Undo2} label="Cancellation & refund policy" />
      </Group>

      {user && (
        <button
          onClick={() => {
            logout();
            router.push('/');
          }}
          className="w-full flex items-center justify-center gap-2 h-12 rounded-2xl bg-white border border-[#edeef0] text-[15px] font-semibold text-[#ba1a1a]"
        >
          <LogOut className="w-[18px] h-[18px]" /> Sign out
        </button>
      )}

      <p className="text-center text-[12px] text-[#6b6d78] pb-2">
        © {new Date().getFullYear()} {OPERATOR.name}
        <br />
        {OPERATOR.contact.address}
      </p>
    </main>
  );
}
