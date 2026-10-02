'use client';
// A one-time code for every online booking.
// Passengers can stay signed in for a long time; each booking is confirmed
// with a fresh 6-digit code sent to the account's phone (or its email, for
// accounts with no phone). The database enforces it (migration 6): the
// booking is refused with "Confirm this booking with the code…" until the
// session has been re-verified, and each code is good for one booking.
//
//   const code = useBookingCode();
//   await code.ask();                                          // seat page: verify before checkout
//   const result = await code.run(() => createBooking(...));   // checkout: asks again only if that code has run out
//   ... {code.modal}

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

/** Must match the message raised by require_booking_code() in the database. */
const CODE_REQUIRED = 'Confirm this booking with the code we send you.';
export const CODE_CANCELLED = "The booking wasn't confirmed because the code wasn't entered. You have not been charged.";
const RESEND_SECONDS = 60;

type Target = { kind: 'sms'; phone: string; label: string } | { kind: 'email'; email: string; label: string };
type Outcome = { ok: boolean; reason?: string };

const maskPhone = (p: string) => p.replace(/^\+94/, '0').replace(/^(\d{3})\d+(\d{3})$/, '$1 ••• •$2');
const maskEmail = (e: string) => e.replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2');

async function findTarget(): Promise<Target | null> {
  const { data } = await supabase().auth.getUser();
  const u = data.user;
  if (!u) return null;
  // Only the number / address verified on the account itself, never one typed into a form.
  if (u.phone) {
    const phone = u.phone.startsWith('+') ? u.phone : `+${u.phone}`;
    return { kind: 'sms', phone, label: maskPhone(phone) };
  }
  if (u.email) return { kind: 'email', email: u.email, label: maskEmail(u.email) };
  return null;
}

async function sendCode(t: Target): Promise<Outcome> {
  const { error } =
    t.kind === 'sms'
      ? await supabase().auth.signInWithOtp({ phone: t.phone, options: { shouldCreateUser: false, channel: 'sms' } })
      : await supabase().auth.signInWithOtp({ email: t.email, options: { shouldCreateUser: false } });
  if (!error) return { ok: true };
  if (/rate|too many|seconds|security purposes/i.test(error.message)) return { ok: false, reason: 'A code was sent less than a minute ago. Wait a moment, then press "Send the code again".' };
  console.warn('[booking code] could not send:', error.message);
  return { ok: false, reason: t.kind === 'sms' ? "We couldn't send the text just now. Try again in a minute." : "We couldn't send the email just now. Try again in a minute." };
}

async function checkCode(t: Target, code: string): Promise<Outcome> {
  const { error } = t.kind === 'sms' ? await supabase().auth.verifyOtp({ phone: t.phone, token: code, type: 'sms' }) : await supabase().auth.verifyOtp({ email: t.email, token: code, type: 'email' });
  if (!error) return { ok: true };
  return { ok: false, reason: /expired|invalid/i.test(error.message) ? 'That code is wrong or has expired.' : 'Could not check the code. Try again.' };
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

  const send = useCallback(async (t: Target) => {
    setError(null);
    const r = await sendCode(t);
    if (!r.ok) setError(r.reason ?? null);
    setWait(RESEND_SECONDS);
  }, []);

  /** Opens the dialog, sends the code, resolves true once it has been verified. */
  const ask = useCallback(async (): Promise<boolean> => {
    const t = await findTarget();
    if (!t) return false;
    setTarget(t);
    setOpen(true);
    send(t);
    return new Promise<boolean>((resolve) => (settle.current = resolve));
  }, [send]);

  /** Runs a booking call; if the database asks for a code, gets one and tries again. */
  const run = useCallback(
    async <T extends Outcome>(fn: () => Promise<T>): Promise<T> => {
      const first = await fn();
      if (first.ok || !isSupabaseConfigured || !first.reason?.startsWith(CODE_REQUIRED)) return first;
      const ok = await ask();
      if (!ok) return { ...first, reason: CODE_CANCELLED };
      return fn();
    },
    [ask],
  );

  const verify = async () => {
    if (!target) return;
    const digits = code.replace(/\D/g, '');
    if (digits.length < 6) return setError('Enter the 6-digit code.');
    setBusy(true);
    setError(null);
    const r = await checkCode(target, digits);
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
            We sent a 6-digit code to <b className="text-[#050a44]">{target.label}</b>. Enter it to place this booking.
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
            <button onClick={() => send(target)} disabled={wait > 0} className="font-bold text-[#050a44] underline disabled:no-underline disabled:text-[#6b6d78]">
              {wait > 0 ? `Send again in ${wait}s` : 'Send the code again'}
            </button>
            <button onClick={() => close(false)} className="font-semibold text-[#46464f]">Cancel</button>
          </div>
        </div>
      </div>
    ) : null;

  return { run, ask, modal };
}
