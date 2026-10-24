'use client';
// Passenger sign-in: mobile number + a 6-digit code by text message.
// Staff sign in with email + password at /staff/login. Accounts made with an
// email address before phone sign-in was the rule can still get in through
// the small "email" link at the bottom.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell, authButton, authInput } from '@/components/auth/AuthShell';
import { PhoneCodeForm } from '@/components/auth/PhoneCodeForm';
import { nextFromLocation } from '@/lib/safeNext';
import { tx } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [withEmail, setWithEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Always to the account page, unless they were sent here from a page that
  // needs sign-in (checkout, a ticket or tracking link): then back to that.
  const done = () => router.push(nextFromLocation('/dashboard'));
  const search = typeof window !== 'undefined' ? window.location.search : '';

  return (
    <AuthShell
      title={tx('Welcome back')}
      subtitle={tx('Sign in with your mobile number to see your tickets and manage your trips.')}
      footer={<>{tx('New here?')}{' '}<Link href={`/auth/signup${search}`} className="font-bold text-[#050a44] hover:underline">{tx('Create an account')}</Link></>}
    >
      {!withEmail ? (
        <>
          <PhoneCodeForm mode="signin" onDone={done} onUseEmail={() => setWithEmail(true)} />
          <p className="text-[12px] text-[#6b6d78] text-center mt-6">{tx('Made your account with an email address?')}{' '}
            <button type="button" className="font-semibold text-[#050a44] underline" onClick={() => { setWithEmail(true); setError(null); }}>{tx('Sign in with email')}</button>
          </p>
        </>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            const r = await signIn(email, password);
            setBusy(false);
            if (!r.ok) return setError(r.reason);
            done();
          }}
        >
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">{tx('Email')}</span>
            <input className={`${authInput} mt-1.5`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">{tx('Password')}</span>
            <input className={`${authInput} mt-1.5`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <button className={authButton} disabled={busy}>{busy ? tx('Signing in…') : tx('Sign in')}</button>
          <p className="text-[12px] text-[#6b6d78]">{tx('Forgot the password? Sign in with your mobile number instead, or call us and we\'ll help.')}</p>
          <button type="button" className="w-full h-12 rounded-xl border border-[#c7c5d1] text-[#050a44] text-[15px] font-semibold" onClick={() => { setWithEmail(false); setError(null); }}>{tx('Use my mobile number')}</button>
        </form>
      )}
    </AuthShell>
  );
}
