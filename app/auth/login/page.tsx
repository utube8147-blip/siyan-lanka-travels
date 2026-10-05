'use client';
// Passenger sign-in: mobile number + SMS code (main), or email + password.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell, authButton, authInput } from '@/components/auth/AuthShell';
import { PhoneCodeForm } from '@/components/auth/PhoneCodeForm';

/** Where to go after signing in: ?next=/some/path (same-site paths only). */
function nextPath(fallback: string) {
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn, resetPassword } = useAuth();
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Always to the account page, unless they were sent here from a page that
  // needs sign-in (checkout, a ticket or tracking link): then back to that.
  const done = () => router.push(nextPath('/dashboard'));

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your tickets and manage your trips."
      footer={<>New here? <Link href={`/auth/signup${typeof window !== 'undefined' ? window.location.search : ''}`} className="font-bold text-[#050a44] hover:underline">Create an account</Link></>}
    >
      <div role="tablist" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#f2f4f6] border border-[#e1e2e4] mb-6">
        {(['phone', 'email'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setError(null); }}
            className={`h-10 rounded-lg text-[14px] font-semibold transition-colors ${method === m ? 'bg-white text-[#050a44] shadow-sm' : 'text-[#46464f]'}`}>
            {m === 'phone' ? 'Mobile number' : 'Email'}
          </button>
        ))}
      </div>

      {method === 'phone' ? (
        <PhoneCodeForm mode="signin" onDone={done} />
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
            <span className="text-[13px] font-semibold text-[#050a44]">Email</span>
            <input className={`${authInput} mt-1.5`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
          </label>
          <label className="block">
            <span className="flex justify-between text-[13px] font-semibold text-[#050a44]">
              Password
              <button type="button" className="font-semibold underline" onClick={async () => {
                setError(null);
                if (!email.includes('@')) return setError('Type your email first, then tap "Forgot?".');
                const r = await resetPassword(email);
                r.ok ? setInfo(`We've emailed a reset link to ${email}.`) : setError(r.reason);
              }}>Forgot?</button>
            </span>
            <input className={`${authInput} mt-1.5`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          {info && <p role="status" className="text-[13px] font-semibold text-[#006e1c]">{info}</p>}
          <button className={authButton} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      )}
    </AuthShell>
  );
}
