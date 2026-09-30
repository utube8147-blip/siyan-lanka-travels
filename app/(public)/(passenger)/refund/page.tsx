// /app/(public)/(passenger)/refund/page.tsx
'use client';
import React, { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OPERATOR } from '@/config/operator';
import { formatLKR } from '@/lib/trips';

type RefundReason = 'cancelled' | 'rescheduled' | 'seats-changed';

const REASON_COPY: Record<RefundReason, { title: string; description: (ctx: { route: string }) => string }> = {
  cancelled: {
    title: 'Booking Cancelled',
    description: ({ route }) => `Your trip on ${route} was cancelled and a refund has been initiated.`,
  },
  rescheduled: {
    title: 'Reschedule Refund',
    description: ({ route }) => `Moving your ${route} trip to a cheaper departure freed up some fare — it's on its way back to you.`,
  },
  'seats-changed': {
    title: 'Seat Change Refund',
    description: ({ route }) => `Dropping a seat on your ${route} trip freed up some fare — it's on its way back to you.`,
  },
};

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
  const operator = searchParams.get('operator') || '';
  const amount = parseFloat(searchParams.get('amount') || '0');
  const reason = (searchParams.get('reason') as RefundReason) || 'cancelled';
  const refundId = searchParams.get('refundId') || '';
  const newDate = searchParams.get('newDate') || '';
  const newSeats = searchParams.get('newSeats') || '';

  const route = from && to ? `${from} → ${to}` : 'your trip';
  const copy = REASON_COPY[reason] ?? REASON_COPY.cancelled;

  const eta = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' });
  }, []);

  if (!bookingRef) {
    return (
      <main className="max-w-[600px] mx-auto px-4 py-[64px] text-center">
        <p className="text-[16px] font-semibold text-[#46464f]">We couldn't find that refund.</p>
        <button
          onClick={() => router.push('/my-bookings')}
          className="mt-[16px] px-6 py-3 bg-black text-white rounded-xl font-bold text-sm"
        >
          Back to My Bookings
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-[1000px] mx-auto px-4 md:px-[64px] py-[40px]">
      {/* Banner */}
      <div className="flex flex-col items-center justify-center text-center mb-[32px]">
        <div className="w-16 h-16 bg-[#e8f6ea] rounded-full flex items-center justify-center mb-[12px]">
          <span className="material-symbols-outlined text-[#006e1c] text-[32px]">currency_exchange</span>
        </div>
        <h1 className="text-[24px] font-bold mb-[4px]">{copy.title}</h1>
        <p className="text-[14px] text-[#46464f] max-w-md">{copy.description({ route })}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[24px] items-stretch">
        {/* Main refund summary */}
        <div className="lg:col-span-7 flex flex-col gap-[24px]">
          <div className="bg-white rounded-xl shadow-sm border border-[#c7c5d1] overflow-hidden">
            <div className="px-[24px] py-[16px] bg-[#f2f4f6] flex justify-between items-center border-b border-[#c7c5d1]">
              <div>
                <h3 className="text-[16px] font-semibold">{operator || OPERATOR.name}</h3>
                <p className="text-[11px] text-[#46464f]">Booking Ref: {bookingRef}</p>
              </div>
              <span className="bg-[#006e1c]/10 text-[#006e1c] px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide">
                Refund Initiated
              </span>
            </div>

            <div className="p-[24px] space-y-[16px]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#46464f]">Route</span>
                <span className="text-[14px] font-bold">{route}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#46464f]">Original Travel Date</span>
                <span className="text-[14px] font-bold">{date || '—'}</span>
              </div>
              {reason === 'rescheduled' && newDate && (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-[#46464f]">Moved To</span>
                  <span className="text-[14px] font-bold">{newDate}</span>
                </div>
              )}
              {reason === 'seats-changed' && newSeats && (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-[#46464f]">New Seat{newSeats.includes(',') ? 's' : ''}</span>
                  <span className="text-[14px] font-bold">{newSeats}</span>
                </div>
              )}

              <div className="h-px bg-[#e1e2e4]" />

              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#46464f]">Refund Reference</span>
                <span className="text-[13px] font-bold font-mono">{refundId || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#46464f]">Refund Method</span>
                <span className="text-[13px] font-bold">Original payment method</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-[#46464f]">Expected By</span>
                <span className="text-[13px] font-bold">{eta}</span>
              </div>
            </div>

            <div className="px-[24px] py-[20px] border-t border-[#c7c5d1] bg-[#f2f4f6] flex items-center justify-between">
              <span className="text-[14px] font-semibold">Refund Amount</span>
              <span className="text-[22px] font-extrabold text-[#006e1c]">{formatLKR(amount)}</span>
            </div>
          </div>

          {/* Status tracker */}
          <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm">
            <h4 className="text-[14px] font-semibold mb-[16px] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">timeline</span>
              Refund Status
            </h4>
            <div className="space-y-0">
              {[
                { label: 'Refund initiated', done: true },
                { label: 'Processing with payment provider', done: false, active: true },
                { label: 'Funds returned to your account', done: false },
              ].map((step, i, arr) => (
                <div key={step.label} className="flex gap-[12px]">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        step.done
                          ? 'bg-[#006e1c] text-white'
                          : step.active
                          ? 'bg-[#feb700]/20 text-[#7c5800] border-2 border-[#feb700]'
                          : 'bg-[#e1e2e4] text-[#9a9ba5]'
                      }`}
                    >
                      {step.done ? (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      )}
                    </div>
                    {i < arr.length - 1 && (
                      <div className={`w-px flex-1 my-1 ${step.done ? 'bg-[#006e1c]' : 'bg-[#e1e2e4]'}`} style={{ minHeight: 24 }} />
                    )}
                  </div>
                  <div className="pb-[20px]">
                    <p className={`text-[13px] font-bold ${step.done || step.active ? 'text-[#050a44]' : 'text-[#9a9ba5]'}`}>
                      {step.label}
                    </p>
                    {step.active && <p className="text-[11px] text-[#46464f] mt-0.5">Usually takes 5–7 business days</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-5 flex flex-col gap-[24px]">
          <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm">
            <h4 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">info</span>
              What happens next
            </h4>
            <ul className="space-y-[8px] text-[13px] text-[#46464f]">
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                We've notified your bank or wallet provider — no further action is needed from you.
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                A confirmation email with this reference will arrive shortly.
              </li>
              <li className="flex gap-2">
                <span className="font-bold">•</span>
                Card refunds can take a few days to appear on your statement even after we send them.
              </li>
            </ul>
          </div>

          <div className="bg-white p-[20px] rounded-xl border border-[#c7c5d1] shadow-sm">
            <h4 className="text-[14px] font-semibold mb-[12px] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">support_agent</span>
              Support &amp; Help
            </h4>
            <p className="text-[13px] text-[#46464f] mb-[12px]">
              Refund hasn't shown up after {eta}? Reach out and we'll look into it.
            </p>
            <div className="flex flex-col gap-[6px]">
              {OPERATOR.contact.phone ? (
                <a className="flex items-center gap-2 text-[13px] font-bold hover:underline" href={OPERATOR.contact.phoneHref}>
                  <span className="material-symbols-outlined text-[16px]">call</span>
                  {OPERATOR.contact.phone}
                </a>
              ) : null}
              <a className="flex items-center gap-2 text-[13px] font-bold hover:underline" href={`mailto:${OPERATOR.contact.email}`}>
                <span className="material-symbols-outlined text-[16px]">mail</span>
                {OPERATOR.contact.email}
              </a>
            </div>
          </div>

          <div className="bg-[#f2f4f6] rounded-xl p-[20px] border border-[#c7c5d1] flex-1 flex flex-col justify-center">
            <button
              onClick={() => router.push('/my-bookings')}
              className="w-full py-3 px-4 rounded-xl font-bold text-[13px] bg-black text-white hover:opacity-90 active:scale-95 transition-all"
            >
              Back to My Bookings
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}