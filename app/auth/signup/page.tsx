'use client';
// Passenger sign-up: name + mobile number, confirmed with a texted code. The
// mobile number is the login. Email is optional: we only use it to send the
// e-ticket (it's saved on the profile and can be changed in the account page).

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell, authInput } from '@/components/auth/AuthShell';
import { PhoneCodeForm } from '@/components/auth/PhoneCodeForm';
import { nextFromLocation } from '@/lib/safeNext';
import { tx, txr } from '@/lib/i18n';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // The phone form reads these through refs so it always sees the latest values.
  const nameRef = useRef(name);
  nameRef.current = name;
  const emailRef = useRef(email);
  emailRef.current = email;
  // Always to the account page, unless they were sent here from a page that
  // needs sign-in (checkout, a ticket or tracking link): then back to that.
  const done = () => router.push(nextFromLocation('/dashboard'));
  const search = typeof window !== 'undefined' ? window.location.search : '';

  return (
    <AuthShell
      title={tx('Create your account')}
      subtitle={tx('Book in seconds next time, keep your tickets on your phone, and get trip texts.')}
      footer={<>{tx('Already have an account?')}{' '}<Link href={`/auth/login${search}`} className="font-bold text-[#050a44] hover:underline">{tx('Sign in')}</Link></>}
    >
      <PhoneCodeForm
        mode="signup"
        onDone={done}
        extra={{
          render: () => (
            <>
              <label className="block">
                <span className="text-[13px] font-semibold text-[#050a44]">{tx('Full name')}</span>
                <input className={`${authInput} mt-1.5`} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tx('As on your ID')} required />
              </label>
              <label className="block">
                <span className="text-[13px] font-semibold text-[#050a44]">{tx('Email')}{' '}<span className="font-normal text-[#6b6d78]">{tx('(optional)')}</span>
                </span>
                <input className={`${authInput} mt-1.5`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-describedby="email-hint" />
                <span id="email-hint" className="block text-[12px] text-[#6b6d78] mt-1.5">{tx('Only to email you your e-tickets. You sign in with your mobile number.')}</span>
              </label>
            </>
          ),
          validate: () => (nameRef.current.trim().length < 2 ? tx('Please enter your name.') : emailRef.current && !/^\S+@\S+\.\S+$/.test(emailRef.current) ? tx('Check the email address, or leave it empty.') : null),
          fullName: () => nameRef.current.trim(),
          email: () => emailRef.current.trim(),
        }}
      />
      <p className="text-[12px] text-[#6b6d78] text-center mt-5">{txr('By continuing you agree to our <a>terms and privacy policy</a>.', { a: (c) => <Link href="/legal" className="underline">{c}</Link> })}</p>
    </AuthShell>
  );
}
