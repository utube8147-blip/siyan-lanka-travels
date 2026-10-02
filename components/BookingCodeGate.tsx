'use client';
// A code on a mobile number for every online booking.
// However the passenger signed in (email or phone), each booking is confirmed
// with a 6-digit code texted to the mobile number they give for the booking.
// The code is ours, not the sign-in code: /api/booking-code sends it, the
// database checks it (migration 14) and refuses a booking without it. Each
// code confirms one booking, and the booking's contact number must be the
// verified one.
//
//   const code = useBookingCode();
//   await code.ask(phone);                                         // seat page: verify before checkout
//   const result = await code.run(() => createBooking(...), phone); // checkout: asks again only if that code has run out
//   ... {code.modal}

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { friendlyError, isSupabaseConfigured, supabase } from '@/lib/supabase/client';

/** Must match the message raised by require_booking_code() in the database. */
const CODE_REQUIRED = 'Confirm this booking with the code we send you.';
export const CODE_CANCELLED = "The booking wasn't confirmed because the code wasn't entered. You have not been charged.";
const RESEND_SECONDS = 60;

/** A Sri Lankan mobile: 0771234567, +94771234567, 94 77 123 4567… */
export const isLkMobile = (phone: string) => /^947\d{8}$/.test(phone.replace(/\D/g, '').replace(/^0094/, '94').replace(/^0/, '94'));

type Target = { phone: string; label: string; id: string | null; test?: boolean };
type Outcome = { ok: boolean; reason?: string };

/** Asks the server to text a code to this number. */
async function sendCode(phone: string): Promise<Outcome & { id?: string; label?: string; test?: boolean }> {
  const res = await fetch('/api/booking-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }).catch(() => null);
  const j = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) return { ok: false, reason: j.error ?? "We couldn't send the text just now. Check your connection and try again." };
  return { ok: true, id: j.id, label: j.sentTo, test: !!j.test };
}

async function checkCode(id: string, code: string): Promise<Outcome> {
  const { data, error } = await supabase().rpc('verify_booking_code', { p_id: id, p_code: code });
  if (error) return { ok: false, reason: friendlyError(error) };
  return data === true ? { ok: true } : { ok: false, reason: "That code isn't right. Check the text message and try again." };
}

export function useBookingCode() {
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const close = useCallback((ok: boolean) => {
    setOpen(false);
    setCode('');
    setError(null);
    settle.current?.(ok);
    settle.current = null;
  }, []);

  const send = useCallback(async (phone: string) => {
    setError(null);
    const r = await sendCode(phone);
    if (!r.ok) setError(r.reason ?? null);
    else setTarget({ phone, label: r.label ?? phone, id: r.id ?? null, test: r.test });
    setWait(RESEND_SECONDS);
  }, []);

  /** Opens the dialog, texts a code to this mobile number, resolves true once it has been verified. */
  const ask = useCallback(
    async (phone: string): Promise<boolean> => {
      if (!isSupabaseConfigured) return true; // demo mode has nobody to text
      setTarget({ phone, label: phone, id: null });
      setOpen(true);
      send(phone);
      return new Promise<boolean>((resolve) => (settle.current = resolve));
    },
    [send],
  );

  /** Runs a booking call; if the database asks for a code, gets one and tries again. */
  const run = useCallback(
    async <T extends Outcome>(fn: () => Promise<T>, phone: string): Promise<T> => {
      const first = await fn();
      if (first.ok || !isSupabaseConfigured || !first.reason?.startsWith(CODE_REQUIRED)) return first;
      if (!isLkMobile(phone)) return { ...first, reason: 'Go back and enter a mobile number to confirm this booking.' };
      const ok = await ask(phone);
      if (!ok) return { ...first, reason: CODE_CANCELLED };
      return fn();
    },
    [ask],
  );

  const verify = async () => {
    if (!target) return;
    const digits = code.replace(/\D/g, '');
    if (digits.length < 6) return setError('Enter the 6-digit code.');
    if (!target.id) return setError('The code hasn\'t been sent yet. Press "Send the code again".');
    setBusy(true);
    setError(null);
    const r = await checkCode(target.id, digits);
    setBusy(false);
    if (!r.ok) return setError(r.reason ?? null);
    close(true);
  };

  const modal =
    open && target ? (
      <div className="fixed inset-0 z-[120] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="booking-code-title">
        <div className="bg-white w-full sm:max-w-[420px] rounded-t-3xl sm:rounded-3xl p-6 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#006e1c]" />
              <h2 id="booking-code-title" className="text-[18px] font-bold text-[#050a44]">Confirm it&apos;s you</h2>
            </div>
            <button onClick={() => close(false)} aria-label="Cancel" className="w-9 h-9 -mt-1 -mr-1 rounded-full flex items-center justify-center text-[#46464f] hover:bg-[#f2f4f6]">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[14px] text-[#46464f] mt-2">
            {target.test ? 'Test mode: no text was sent. Enter the test code for ' : 'We texted a 6-digit code to '}
            <b className="text-[#050a44]">{target.label}</b>{target.test ? '.' : '. Enter it to confirm this booking.'}
          </p>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && verify()}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit code"
            placeholder="••••••"
            className="mt-4 w-full h-14 rounded-2xl bg-[#f2f4f6] text-center text-[24px] font-bold tracking-[0.4em] text-[#050a44] outline-none focus:ring-2 focus:ring-[#050a44]"
          />
          {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <button onClick={verify} disabled={busy || code.length < 6} className="mt-4 w-full h-12 rounded-2xl bg-[#050a44] text-white text-[15px] font-bold disabled:opacity-50">
            {busy ? 'Checking…' : 'Confirm booking'}
          </button>
          <div className="mt-3 flex items-center justify-between text-[13px]">
            <button onClick={() => send(target.phone)} disabled={wait > 0} className="font-bold text-[#050a44] underline disabled:no-underline disabled:text-[#6b6d78]">
              {wait > 0 ? `Send again in ${wait}s` : 'Send the code again'}
            </button>
            <button onClick={() => close(false)} className="font-semibold text-[#46464f]">Cancel</button>
          </div>
        </div>
      </div>
    ) : null;

  return { run, ask, modal };
}
