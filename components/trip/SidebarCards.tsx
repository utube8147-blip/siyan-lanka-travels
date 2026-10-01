'use client';
// My trips sidebar: rewards progress, waitlist, past trips ("Book again").

import Link from 'next/link';
import { Gift, Hourglass, RotateCcw, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { addDays, formatDateLabel, todayISO } from '@/lib/trips';
import { useLoyalty, useWaitlist } from '@/lib/extras';
import AnimatedNumber from '@/components/motion/AnimatedNumber';
import { useT } from '@/lib/i18n';

export function LoyaltyCard() {
  const { user } = useAuth();
  const l = useLoyalty(user?.id);
  if (!user || !l || !l.every) return null;
  const pct = ((l.every - l.nextIn) / l.every) * 100;
  return (
    <div className="bg-white rounded-2xl p-[20px] shadow-sm border border-[#c7c5d1] space-y-3 relative overflow-hidden">
      <div className="absolute left-0 top-0 w-1.5 h-full bg-gradient-to-b from-[#feb700] to-[#ffe08a]" />
      <h4 className="font-bold text-[#050a44] text-[14px] flex items-center gap-2"><Gift className="w-4 h-4 text-[#7c5800]" /> Every {l.every}th trip free</h4>
      {l.available > 0 ? (
        <p className="text-[13px] text-[#46464f]">
          You have <b className="text-[#006e1c]">{l.available} free trip{l.available > 1 ? 's' : ''}</b>. Tick &ldquo;Use my free trip&rdquo; when you pay.
        </p>
      ) : (
        <p className="text-[13px] text-[#46464f]">
          <b className="text-[#050a44]"><AnimatedNumber value={l.nextIn} /> more trip{l.nextIn > 1 ? 's' : ''}</b> until your next free one.
        </p>
      )}
      <div className="w-full bg-[#f2f4f6] h-2 rounded-full overflow-hidden" aria-hidden>
        <div className="bg-[#feb700] h-full rounded-full transition-all" style={{ width: `${l.available > 0 ? 100 : pct}%` }} />
      </div>
      <p className="text-[11px] text-[#6b6d78]">{l.trips} completed trip{l.trips === 1 ? '' : 's'} so far.</p>
    </div>
  );
}

export function WaitlistCard() {
  const { t } = useT();
  const { user } = useAuth();
  const { entries, leave } = useWaitlist(user?.id);
  if (!user || entries.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl p-[20px] shadow-sm border border-[#c7c5d1] space-y-3">
      <h4 className="font-bold text-[#050a44] text-[14px] flex items-center gap-2"><Hourglass className="w-4 h-4" /> {t('Waitlist')}</h4>
      <ul className="space-y-3">
        {entries.map((w) => (
          <li key={w.id} className="text-[13px]">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-[#050a44]">{w.from} → {w.to}</p>
                <p className="text-[#6b6d78]">{formatDateLabel(w.date, false)} · {w.seats} seat{w.seats > 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => leave(w.id)} aria-label="Leave waitlist" className="p-1 rounded hover:bg-[#f2f4f6]"><X className="w-4 h-4 text-[#6b6d78]" /></button>
            </div>
            {w.status === 'offered' ? (
              <Link
                href={`/seats/${w.scheduleId}?${new URLSearchParams({ date: w.date, from: w.from, to: w.to }).toString()}`}
                onClick={() => leave(w.id, 'booked')}
                className="mt-2 inline-flex px-3 py-1.5 rounded-lg bg-[#006e1c] text-white text-[12px] font-bold"
              >
                {t('A seat is free: book now')}
              </Link>
            ) : (
              <p className="mt-1 text-[12px] text-[#7c5800]">Waiting. We&apos;ll text you if a seat frees up.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PastTripsCard() {
  const { t } = useT();
  const { user } = useAuth();
  const { data } = useStore();
  if (!user) return null;
  const seen = new Set<string>();
  const past = data.bookings
    .filter((b) => b.userId === user.id && b.date < todayISO() && b.status !== 'cancelled')
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((b) => (seen.has(`${b.from}>${b.to}`) ? false : (seen.add(`${b.from}>${b.to}`), true)))
    .slice(0, 3);
  if (!past.length) return null;
  return (
    <div className="bg-white rounded-2xl p-[20px] shadow-sm border border-[#c7c5d1] space-y-3">
      <h4 className="font-bold text-[#050a44] text-[14px] flex items-center gap-2"><RotateCcw className="w-4 h-4" /> {t('Travel again')}</h4>
      <ul className="space-y-2">
        {past.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 text-[13px]">
            <span>
              <span className="block font-semibold text-[#050a44]">{b.from} → {b.to}</span>
              <span className="block text-[#6b6d78]">last {formatDateLabel(b.date, false)}</span>
            </span>
            <span className="flex gap-1.5 shrink-0">
              <Link href={`/search?${new URLSearchParams({ from: b.from, to: b.to, date: addDays(todayISO(), 1) }).toString()}`} className="px-2.5 py-1.5 rounded-lg bg-[#050a44] text-white text-[12px] font-bold">{t('Book again')}</Link>
              <Link href={`/search?${new URLSearchParams({ from: b.to, to: b.from, date: addDays(todayISO(), 1) }).toString()}`} className="px-2.5 py-1.5 rounded-lg bg-[#f2f4f6] text-[#050a44] text-[12px] font-bold" aria-label={`Return: ${b.to} to ${b.from}`}>{t('Return')}</Link>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
