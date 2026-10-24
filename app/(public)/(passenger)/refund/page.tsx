// /app/(public)/(passenger)/refund/page.tsx
// Shown after a passenger cancels a booking. Refunds are sent by bank
// transfer by the office (Staff area → Payouts), so this page says how much is
// owed and asks for the bank account if we don't have one yet (PayoutsCard).
'use client';
import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OPERATOR } from '@/config/operator';
import { formatLKR } from '@/lib/trips';
import { PayoutsCard } from '@/components/trip/PayoutsCard';
import { tx } from '@/lib/i18n';

export default function RefundPage() {
  return (
    <React.Suspense fallback={null}>
      <RefundPageInner />
    </React.Suspense>
  );
}

function RefundPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const bookingRef = searchParams.get('ref') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const date = searchParams.get('date') || '';
  const amount = Math.max(0, parseFloat(searchParams.get('amount') || '0') || 0);
  const route = from && to ? `${from} → ${to}` : '';

  if (!bookingRef) {
    return (
      <main className="max-w-[600px] mx-auto px-4 py-[64px] text-center">
        <p className="text-[16px] font-semibold text-[#46464f]">{tx('We couldn\'t find that refund.')}</p>
        <button onClick={() => router.push('/my-bookings')} className="mt-[16px] px-6 py-3 bg-black text-white rounded-xl font-bold text-sm">{tx('Back to My trips')}</button>
      </main>
    );
  }

  return (
    <main className="max-w-[1000px] mx-auto px-4 md:px-[64px] py-[40px]">
      <div className="flex flex-col items-center justify-center text-center mb-[32px]">
        <div className="w-16 h-16 bg-[#e8f6ea] rounded-full flex items-center justify-center mb-[12px]">
          <span className="material-symbols-outlined text-[#006e1c] text-[32px]">{amount > 0 ? 'currency_exchange' : 'event_busy'}</span>
        </div>
        <h1 className="text-[24px] font-bold mb-[4px] text-[#050a44]">{tx('Booking cancelled')}</h1>
        <p className="text-[14px] text-[#46464f] max-w-md">
          {amount > 0
            ? tx('We will send your refund by bank transfer. Add the bank account it should go to, if you haven’t already.')
            : tx('There is nothing to refund for this booking: it wasn’t paid yet, or it was cancelled too close to departure.')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px] items-start">
        <div className="lg:col-span-7 flex flex-col gap-[24px]">
          <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden">
            <div className="px-[24px] py-[16px] bg-[#f2f4f6] flex justify-between items-center gap-3 border-b border-[#c7c5d1]">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-[#050a44]">{OPERATOR.name}</h2>
                <p className="text-[12px] text-[#46464f]">{tx('Booking number: {bookingRef}', { bookingRef })}</p>
              </div>
              <span className="shrink-0 bg-[#ba1a1a]/10 text-[#ba1a1a] px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide">{tx('Cancelled')}</span>
            </div>
            <div className="p-[24px] space-y-[16px]">
              {route && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-[#46464f]">{tx('Route')}</span>
                  <span className="text-[14px] font-bold text-[#050a44] text-right">{route}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-[#46464f]">{tx('Travel date')}</span>
                <span className="text-[14px] font-bold text-[#050a44] text-right">{date || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-[#46464f]">{tx('How it is paid')}</span>
                <span className="text-[13px] font-bold text-[#050a44] text-right">{tx('Bank transfer')}</span>
              </div>
            </div>
            <div className="px-[24px] py-[20px] border-t border-[#c7c5d1] bg-[#f2f4f6] flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[#050a44]">{tx('Refund')}</span>
              <span className={`text-[22px] font-extrabold ${amount > 0 ? 'text-[#006e1c]' : 'text-[#46464f]'}`}>{formatLKR(amount)}</span>
            </div>
          </div>
          {amount > 0 && <PayoutsCard />}
        </div>

        <div className="lg:col-span-5 flex flex-col gap-[24px]">
          <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm">
            <h3 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2 text-[#050a44]">
              <span className="material-symbols-outlined text-[18px]">info</span>{tx('What happens next')}</h3>
            <ul className="space-y-[8px] text-[13px] text-[#46464f]">
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>{tx('Our office sends the money to your bank account and marks it paid. You\'ll get a text and a notification when it\'s sent.')}</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                <span>{tx('You can see the refund and change the bank account any time in My trips.')}</span>
              </li>
            </ul>
          </div>

          <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm">
            <h3 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2 text-[#050a44]">
              <span className="material-symbols-outlined text-[18px]">support_agent</span>{tx('Need help?')}</h3>
            <div className="flex flex-col gap-[6px]">
              {OPERATOR.contact.phone ? (
                <a className="flex items-center gap-2 text-[13px] font-bold text-[#050a44] hover:underline" href={OPERATOR.contact.phoneHref}>
                  <span className="material-symbols-outlined text-[16px]">call</span>
                  {OPERATOR.contact.phone}
                </a>
              ) : null}
              <a className="flex items-center gap-2 text-[13px] font-bold text-[#050a44] hover:underline break-all" href={`mailto:${OPERATOR.contact.email}`}>
                <span className="material-symbols-outlined text-[16px]">mail</span>
                {OPERATOR.contact.email}
              </a>
            </div>
          </div>

          <button onClick={() => router.push('/my-bookings')} className="w-full py-3 px-4 rounded-xl font-bold text-[13px] bg-black text-white hover:opacity-90 active:scale-95 transition-all">{tx('Back to My trips')}</button>
        </div>
      </div>
    </main>
  );
}
