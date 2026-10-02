'use client';
// Bank-transfer bookings waiting for payment: bank details, the deadline, and
// "upload your slip". Once a slip is in, the seat is kept while staff check it.

import { useRef, useState } from 'react';
import { Check, Clock3, Landmark, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/lib/store';
import { usePublicSettings } from '@/lib/extras';
import { SLIP_ACCEPT, slipOnFile, submitSlip, useSlips } from '@/lib/money';
import { formatDateLabel, formatLKR } from '@/lib/trips';
import type { Booking } from '@/lib/types';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function PaymentSlipCard() {
  const { user } = useAuth();
  const { data, ready, reload } = useStore();
  const pub = usePublicSettings();
  const slipFor = useSlips();
  if (!ready || !user) return null;
  const waiting = data.bookings.filter((b) => b.userId === user.id && b.status === 'held' && b.paymentMethod === 'bank');
  if (waiting.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-[#c7c5d1] shadow-sm overflow-hidden" aria-label="Bank transfer payments">
      <div className="px-5 py-4 border-b border-[#edeef0] flex items-center gap-2">
        <Landmark className="w-4 h-4 text-[#7c5800]" />
        <h3 className="text-[15px] font-bold text-[#050a44]">Pay by bank transfer</h3>
      </div>
      <p className="px-5 pt-4 text-[13px] text-[#46464f]">
        Transfer to <b className="text-[#050a44]">{pub.bankDetails}</b>, put the booking reference in the remarks, then upload the slip: a photo, a screenshot or the bank&apos;s PDF receipt.
      </p>
      <ul className="divide-y divide-[#edeef0]">
        {waiting.map((b) => (
          <SlipRow key={b.id} booking={b} slip={slipFor(b)} onDone={reload} />
        ))}
      </ul>
    </section>
  );
}

function SlipRow({ booking, slip, onDone }: { booking: Booking; slip: ReturnType<ReturnType<typeof useSlips>>; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const r = await submitSlip(booking, file, reference.trim());
    setBusy(false);
    if (!r.ok) return setError(r.reason ?? "Couldn't upload the slip.");
    onDone();
  };
  const sent = slipOnFile(slip);
  return (
    <li className="px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-semibold text-[#050a44]">
          {booking.from} → {booking.to} · {formatDateLabel(booking.date, false)} · seat {booking.seats.join(', ')}
        </p>
        <p className="text-[14px] font-bold text-[#050a44] tabular-nums">{formatLKR(booking.total)}</p>
      </div>
      <p className="text-[12px] text-[#6b6d78]">
        Reference <b className="text-[#050a44]">{booking.ref}</b>
        {booking.holdExpiresAt && (
          <>
            {' '}· <Clock3 className="inline w-3.5 h-3.5 -mt-0.5" /> seat kept until <b className="text-[#050a44]">{when(booking.holdExpiresAt)}</b>
          </>
        )}
      </p>
      {sent ? (
        <div className="rounded-xl bg-[#e8f6ea] text-[#006e1c] text-[13px] font-semibold px-3 py-2.5 flex items-start gap-2">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Slip received {when(slip.uploadedAt)}. We&apos;ll confirm your seat once we&apos;ve checked it.{' '}
            <button className="underline font-bold" onClick={() => input.current?.click()} disabled={busy}>
              Replace slip
            </button>
          </span>
        </div>
      ) : (
        <>
          {slip && 'rejectedReason' in slip && slip.rejectedReason && (
            <p className="rounded-xl bg-[#ba1a1a]/10 text-[#ba1a1a] text-[13px] font-semibold px-3 py-2.5">We couldn&apos;t accept the last slip: {slip.rejectedReason}. Please upload it again.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Bank reference no. (optional)"
              aria-label="Bank reference number"
              className="flex-1 min-w-[180px] h-10 px-3 rounded-xl bg-[#f2f4f6] text-[14px] font-medium outline-none focus:ring-1 focus:ring-[#050a44]"
            />
            <button
              onClick={() => input.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-[#050a44] text-white text-[13px] font-bold disabled:opacity-50"
            >
              <Upload className="w-4 h-4" /> {busy ? 'Uploading…' : 'Upload slip'}
            </button>
          </div>
        </>
      )}
      <input ref={input} type="file" accept={SLIP_ACCEPT} className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
    </li>
  );
}
