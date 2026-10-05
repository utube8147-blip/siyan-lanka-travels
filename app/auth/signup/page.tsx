'use client';
// Passenger sign-up: name + mobile number verified by SMS code (main), or
// email + password.

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AuthShell, authButton, authInput } from '@/components/auth/AuthShell';
import { PhoneCodeForm } from '@/components/auth/PhoneCodeForm';

function nextPath(fallback: string) {
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback;
}

export default function SignupPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // The phone form reads these through refs so it always sees the latest values.
  const nameRef = useRef(name);
  nameRef.current = name;
  const emailRef = useRef(email);
  emailRef.current = email;
  // Always to the account page, unless they were sent here from a page that
  // needs sign-in (checkout, a ticket or tracking link): then back to that.
  const done = () => router.push(nextPath('/dashboard'));

  const nameField = (
    <label className="block">
      <span className="text-[13px] font-semibold text-[#050a44]">Full name</span>
      <input className={`${authInput} mt-1.5`} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As on your ID" required />
    </label>
  );

  return (
    <AuthShell
      title="Create your account"
      subtitle="Book in seconds next time, keep your tickets on your phone, and get trip texts."
      footer={<>Already have an account? <Link href={`/auth/login${typeof window !== 'undefined' ? window.location.search : ''}`} className="font-bold text-[#050a44] hover:underline">Sign in</Link></>}
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
        <PhoneCodeForm
          mode="signup"
          onDone={done}
          onUseEmail={() => { setMethod('email'); setError(null); }}
          extra={{
            render: () => (
              <>
                {nameField}
                <label className="block">
                  <span className="text-[13px] font-semibold text-[#050a44]">Email <span className="font-normal text-[#6b6d78]">(optional, for receipts)</span></span>
                  <input className={`${authInput} mt-1.5`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </label>
              </>
            ),
            validate: () => (nameRef.current.trim().length < 2 ? 'Please enter your name.' : emailRef.current && !/^\S+@\S+\.\S+$/.test(emailRef.current) ? 'Check the email address, or leave it empty.' : null),
            fullName: () => nameRef.current.trim(),
            email: () => emailRef.current.trim(),
          }}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            if (name.trim().length < 2) return setError('Please enter your name.');
            if (password.length < 8) return setError('Use at least 8 characters for your password.');
            setBusy(true);
            const r = await signUp({ email, password, fullName: name.trim() });
            setBusy(false);
            if (!r.ok) return setError(r.reason);
            if (r.needsEmailConfirmation) return setInfo(`Almost done: open the link we sent to ${email}, then sign in.`);
            done();
          }}
        >
          {nameField}
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">Email</span>
            <input className={`${authInput} mt-1.5`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">Password</span>
            <input className={`${authInput} mt-1.5`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </label>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          {info && <p role="status" className="text-[13px] font-semibold text-[#006e1c]">{info}</p>}
          <button className={authButton} disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
      )}
      <p className="text-[12px] text-[#6b6d78] text-center mt-5">By continuing you agree to our <Link href="/legal" className="underline">terms and privacy policy</Link>.</p>
    </AuthShell>
  );
}
