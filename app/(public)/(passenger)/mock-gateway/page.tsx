'use client';
// Test payment gateway (only with NEXT_PUBLIC_MOCK_PAYMENTS=true on your own
// computer). Stands in for PayHere: choose whether the payment goes through.
// "Succeeds" marks the booking paid the same way PayHere's callback does.

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { mockPaymentsOn } from '@/lib/mockVerification';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { formatLKR } from '@/lib/trips';
import { tx, useT } from '@/lib/i18n';

export default function MockGatewayPage() {
  return (
    <React.Suspense fallback={null}>
      <MockGateway />
    </React.Suspense>
  );
}

function MockGateway() {
  useT();
  const router = useRouter();
  const q = useSearchParams();
  const ref = q.get('ref') ?? '';
  const amount = Number(q.get('amount') ?? 0);
  const [method, setMethod] = useState<'card' | 'wallet'>('card');
  const [busy, setBusy] = useState<'paid' | 'failed' | null>(null);
  const [error, setError] = useState('');

  if (!mockPaymentsOn()) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-[22px] font-bold text-[#050a44]">{tx('Not available')}</h1>
        <p className="text-[14px] text-[#46464f] mt-2">{tx('The test payment gateway only works on your own computer with NEXT_PUBLIC_MOCK_PAYMENTS=true.')}</p>
      </main>
    );
  }

  const answer = async (outcome: 'paid' | 'failed') => {
    setBusy(outcome);
    setError('');
    try {
      const token = isSupabaseConfigured ? (await supabase().auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch('/api/dev/mock-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ref, outcome, method }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? tx('The test gateway could not answer.'));
      router.replace(outcome === 'paid' ? `/my-bookings?paid=${encodeURIComponent(ref)}` : `/my-bookings?unpaid=${encodeURIComponent(ref)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#e1e2e4] shadow-lg overflow-hidden">
        <div className="bg-[#7c3aed] text-white px-6 py-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] opacity-80">{tx('Test mode · no money moves')}</p>
          <h1 className="text-[20px] font-bold mt-0.5">{tx('Test payment gateway')}</h1>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[12px] text-[#46464f]">{tx('Booking')}</p>
              <p className="text-[16px] font-bold text-[#050a44]">{ref}</p>
            </div>
            <p className="text-[26px] font-extrabold text-[#050a44]">{formatLKR(amount)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tx('Pay with')}>
            {(['card', 'wallet'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`h-11 rounded-xl border text-[14px] font-bold ${method === m ? 'border-[#050a44] bg-[#050a44]/5 text-[#050a44]' : 'border-[#e1e2e4] text-[#46464f]'}`}>
                {m === 'card' ? tx('Card') : tx('Mobile wallet')}
              </button>
            ))}
          </div>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <div className="space-y-2">
            <button onClick={() => answer('paid')} disabled={!!busy} className="w-full h-12 rounded-xl bg-[#16a34a] text-white text-[15px] font-bold disabled:opacity-60">
              {busy === 'paid' ? tx('Processing…') : tx('Payment succeeds')}
            </button>
            <button onClick={() => answer('failed')} disabled={!!busy} className="w-full h-12 rounded-xl bg-white border border-[#ba1a1a]/40 text-[#ba1a1a] text-[15px] font-bold disabled:opacity-60">
              {tx('Payment fails')}
            </button>
          </div>
          <p className="text-[12px] text-[#46464f]">{tx('Succeeds: the booking is marked paid exactly as the real gateway would. Fails: the seat stays held, so you can try again from My trips until the hold runs out.')}</p>
        </div>
      </div>
    </main>
  );
}
