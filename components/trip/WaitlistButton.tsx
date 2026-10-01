'use client';
// "Join waitlist" for a full departure. We text and notify you if a seat frees up.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useWaitlist } from '@/lib/extras';
import { useT } from '@/lib/i18n';

export function WaitlistButton({ scheduleId, date, from, to }: { scheduleId: string; date: string; from: string; to: string }) {
  const { t } = useT();
  const { user, mode } = useAuth();
  const router = useRouter();
  const { entries, join } = useWaitlist(user?.id);
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState(1);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const already = entries.some((w) => w.scheduleId === scheduleId && w.date === date);

  if (already) return <span className="bg-[#feb700]/15 text-[#7c5800] rounded-xl px-4 py-2.5 text-[13px] font-bold whitespace-nowrap">{t('On waitlist')}</span>;
  return (
    <>
      <button
        onClick={() => {
          if (!user && mode === 'supabase') return router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          setOpen(true);
        }}
        className="bg-white border border-[#050a44] text-[#050a44] rounded-xl px-4 py-2.5 text-[13px] font-bold whitespace-nowrap hover:bg-[#f2f4f6]"
      >
        {t('Full · join waitlist')}
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Join the waitlist">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-6 space-y-4 shadow-2xl">
            <h2 className="text-[18px] font-semibold text-[#050a44]">Join the waitlist</h2>
            <p className="text-[14px] text-[#46464f]">This bus is full. If seats free up, we&apos;ll text you straight away. First come, first served, so book quickly when you hear from us.</p>
            <label className="block">
              <span className="text-[12px] font-bold text-[#46464f]">Seats you need</span>
              <select value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="mt-1 w-full px-3 py-2.5 bg-[#f2f4f6] rounded-lg text-[14px]">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-bold text-[#46464f]">Mobile number for the text</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="07X XXX XXXX" className="mt-1 w-full px-3 py-2.5 bg-[#f2f4f6] rounded-lg text-[14px]" />
            </label>
            {msg && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{msg}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 h-10 rounded-xl border border-[#c7c5d1] text-[13px] font-bold text-[#050a44]">Cancel</button>
              <button
                disabled={phone.replace(/\D/g, '').length < 9}
                onClick={async () => {
                  const r = await join({ scheduleId, date, from, to, seats, phone });
                  if (!r.ok) return setMsg(r.reason ?? 'Could not join');
                  setOpen(false);
                }}
                className="px-4 h-10 rounded-xl bg-[#050a44] text-white text-[13px] font-bold disabled:opacity-40"
              >
                Join waitlist
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
