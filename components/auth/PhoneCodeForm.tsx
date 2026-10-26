'use client';
// Mobile number → 6-digit SMS code: how passengers sign in and sign up.
// Supabase asks /api/auth/sms-hook to text the code (Notify.lk; README →
// Phone sign-in).

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { formatLK, toE164LK } from '@/lib/phone';
import { authButton, authInput } from './AuthShell';
import { tx, txr } from '@/lib/i18n';
import { MOCK_CODE, mockVerificationOn } from '@/lib/mockVerification';

export function PhoneCodeForm({
  mode,
  onDone,
  extra,
  onUseEmail,
}: {
  mode: 'signin' | 'signup';
  onDone: () => void;
  /** Switch to the email form (offered when texts can't be sent). */
  onUseEmail?: () => void;
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
  const [smsDown, setSmsDown] = useState(false);
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
    if (!toE164LK(phone)) return setError(tx('Enter a Sri Lankan mobile number, like 077 123 4567.'));
    setBusy(true);
    const r = await sendPhoneCode(phone, { createUser: mode === 'signup', fullName: extra?.fullName(), email: extra?.email() || undefined });
    setBusy(false);
    if (!r.ok) {
      setSmsDown('code' in r && r.code === 'sms_unavailable');
      return setError(r.reason);
    }
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
            <span className="text-[13px] font-semibold text-[#050a44]">{tx('Mobile number')}</span>
            <div className="mt-1.5 flex gap-2">
              <span className="h-12 px-3 shrink-0 whitespace-nowrap rounded-xl bg-[#f2f4f6] border border-[#c7c5d1] flex items-center gap-1 text-[15px] font-semibold text-[#050a44]" aria-hidden>
                🇱🇰 +94
              </span>
              <input
                className={authInput}
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
            <span id="phone-hint" className="block text-[12px] text-[#6b6d78] mt-1.5">{mode === 'signup' ? tx("We'll text you a 6-digit code. Your number becomes your login.") : tx("We'll text you a 6-digit code.")}
            </span>
          </label>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          {smsDown && onUseEmail && (
            <button type="button" onClick={onUseEmail} className="w-full h-12 rounded-xl border border-[#050a44] text-[#050a44] text-[15px] font-semibold">
              {mode === 'signup' ? tx('Sign up with email instead') : tx('Sign in with email instead')}
            </button>
          )}
          <button className={authButton} disabled={busy}>{busy ? tx('Sending code…') : tx('Send code')}</button>
        </>
      ) : (
        <>
          <p className="text-[14px] text-[#46464f]">{txr('Enter the code we sent to <b>{phone}</b>', { phone: formatLK(toE164LK(phone)!), b: (c) => <b className="text-[#050a44]">{c}</b> })}{' '}
            <button type="button" onClick={() => { setStep('number'); setCode(''); setError(null); }} className="font-semibold text-[#050a44] underline">{tx('Change')}</button>
          </p>
          <input
            ref={codeRef}
            className={`${authInput} text-center text-[24px] tracking-[0.5em] font-semibold`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="••••••"
            aria-label={tx('6-digit code')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {authMode === 'demo' && <p className="text-[12px] text-[#7c5800] font-semibold">{tx('Demo mode: no text is sent. Use 123456.')}</p>}
          {authMode !== 'demo' && mockVerificationOn() && <p className="text-[12px] text-[#7c5800] font-semibold">{tx('Test mode: no text is sent. Use {code}.', { code: MOCK_CODE })}</p>}
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <button className={authButton} disabled={busy || code.length !== 6}>
            {busy ? tx('Checking…') : mode === 'signup' ? tx('Verify & create account') : tx('Verify & sign in')}
          </button>
          <button type="button" disabled={wait > 0 || busy} onClick={send} className="w-full text-[13px] font-semibold text-[#050a44] disabled:text-[#6b6d78]">
            {wait > 0 ? tx('Resend code in {wait}s', { wait }) : tx('Resend code')}
          </button>
        </>
      )}
    </form>
  );
}
