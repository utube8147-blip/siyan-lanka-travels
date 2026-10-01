'use client';
// Mobile number → 6-digit SMS code (sent through Notify.lk). Used for both
// signing in and signing up.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { formatLK, toE164LK } from '@/lib/phone';
import { authButton, authInput } from './AuthShell';

export function PhoneCodeForm({
  mode,
  onDone,
  extra,
}: {
  mode: 'signin' | 'signup';
  onDone: () => void;
  /** Sign-up fields (name, email) rendered above the number. Return null when valid, or an error. */
  extra?: { render: () => React.ReactNode; validate: () => string | null; fullName: () => string; email: () => string };
}) {
  const { sendPhoneCode, verifyPhoneCode, mode: authMode } = useAuth();
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  // Android Chrome can read the code straight from the SMS.
  useEffect(() => {
    if (step !== 'code' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as unknown as { get: (o: object) => Promise<{ code?: string } | null> })
      .get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((c) => c?.code && setCode(c.code))
      .catch(() => {});
    return () => ac.abort();
  }, [step]);

  const send = async () => {
    setError(null);
    const problem = extra?.validate();
    if (problem) return setError(problem);
    if (!toE164LK(phone)) return setError('Enter a Sri Lankan mobile number, like 077 123 4567.');
    setBusy(true);
    const r = await sendPhoneCode(phone, { createUser: mode === 'signup', fullName: extra?.fullName() });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setStep('code');
    setWait(30);
    setTimeout(() => codeRef.current?.focus(), 50);
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    const r = await verifyPhoneCode(phone, code, { fullName: extra?.fullName(), email: extra?.email() || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    onDone();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        step === 'number' ? send() : verify();
      }}
    >
      {step === 'number' ? (
        <>
          {extra?.render()}
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">Mobile number</span>
            <div className="mt-1.5 flex gap-2">
              <span
                className="h-12 px-3 shrink-0 rounded-xl bg-[#f2f4f6] border border-[#c7c5d1] flex items-center gap-1.5 text-[15px] font-semibold text-[#050a44] whitespace-nowrap"
                aria-hidden
              >
                <span className="text-[11px] font-bold text-[#6b6d78]">LK</span>
                +94
              </span>
              <input
                className={`${authInput} min-w-0 flex-1`}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="77 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                aria-describedby="phone-hint"
              />
            </div>
            <span id="phone-hint" className="block text-[12px] text-[#6b6d78] mt-1.5">
              We&apos;ll text you a 6-digit code.{mode === 'signup' ? ' Your number becomes your login.' : ''}
            </span>
          </label>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <button className={authButton} disabled={busy}>{busy ? 'Sending code…' : 'Send code'}</button>
        </>
      ) : (
        <>
          <p className="text-[14px] text-[#46464f]">
            Enter the code we sent to <b className="text-[#050a44]">{formatLK(toE164LK(phone)!)}</b>{' '}
            <button type="button" onClick={() => { setStep('number'); setCode(''); setError(null); }} className="font-semibold text-[#050a44] underline">Change</button>
          </p>
          <input
            ref={codeRef}
            className={`${authInput} text-center text-[24px] tracking-[0.5em] font-semibold`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            aria-label="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {authMode === 'demo' && <p className="text-[12px] text-[#7c5800] font-semibold">Demo mode: no text is sent. Use 123456.</p>}
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <button className={authButton} disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : mode === 'signup' ? 'Verify & create account' : 'Verify & sign in'}
          </button>
          <button type="button" disabled={wait > 0 || busy} onClick={send} className="w-full text-[13px] font-semibold text-[#050a44] disabled:text-[#6b6d78]">
            {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </button>
        </>
      )}
    </form>
  );
}
