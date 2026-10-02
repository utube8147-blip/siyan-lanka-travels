'use client';
// Shown on My trips when the passenger comes back from the payment gateway
// (?paid=REF or ?unpaid=REF). The gateway confirms the payment to our server
// separately, a few seconds later, so we re-check a few times.

import { useEffect, useState } from 'react';
import { Check, Info } from 'lucide-react';
import { useStore } from '@/lib/store';

export function PaymentReturnNotice() {
  const { data, reload } = useStore();
  const [ret, setRet] = useState<{ kind: 'paid' | 'unpaid'; ref: string } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const paid = q.get('paid');
    const unpaid = q.get('unpaid');
    if (!paid && !unpaid) return;
    setRet(paid ? { kind: 'paid', ref: paid } : { kind: 'unpaid', ref: unpaid! });
    window.history.replaceState(null, '', window.location.pathname);
    if (!paid) return;
    const timers = [2000, 5000, 10000, 20000].map((ms) => setTimeout(reload, ms));
    return () => timers.forEach(clearTimeout);
  }, [reload]);

  if (!ret) return null;
  const resale = ret.ref.startsWith('RS-');
  const booking = data.bookings.find((b) => b.ref === ret.ref);
  const confirmed = booking ? booking.paymentStatus === 'paid' && booking.status !== 'cancelled' : false;
  if (ret.kind === 'unpaid')
    return (
      <p role="status" className="rounded-2xl bg-[#feb700]/15 border border-[#feb700]/40 text-[#46464f] text-[14px] px-5 py-4 flex gap-2">
        <Info className="w-5 h-5 text-[#7c5800] shrink-0" />
        The payment wasn&apos;t completed, so nothing was charged. {resale ? 'The ticket is back on sale.' : 'Your seat is still held until the time shown below; you can pay again from here.'}
      </p>
    );
  return (
    <p role="status" className="rounded-2xl bg-[#e8f6ea] border border-[#006e1c]/25 text-[#0b4a1a] text-[14px] font-medium px-5 py-4 flex gap-2">
      <Check className="w-5 h-5 text-[#006e1c] shrink-0" />
      {confirmed
        ? `Payment received. Booking ${ret.ref} is confirmed.`
        : resale
          ? 'Thank you. Your ticket appears below as soon as the payment is confirmed, usually within a minute.'
          : `Thank you. We're confirming your payment for ${ret.ref}; this usually takes under a minute.`}
    </p>
  );
}
