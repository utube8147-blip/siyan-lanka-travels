'use client';
// Choose a new password. Opened from the email link sent by "Forgot password?"
// on the staff sign-in page, and by the invite a super admin sends from
// Staff area → Accounts. Supabase puts a one-time token in the link (as
// ?code=, #access_token=… or ?token_hash=…, depending on the email template);
// this page turns it into a session and then sets the password.
// Add https://<your-site>/auth/reset to Supabase → Authentication → URL
// Configuration → Redirect URLs (README → Staff accounts).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { AuthShell, authButton, authInput } from '@/components/auth/AuthShell';
import { tx } from '@/lib/i18n';

type Stage = 'checking' | 'ready' | 'invalid' | 'done';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { updatePassword } = useAuth();
  const [stage, setStage] = useState<Stage>('checking');
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return setStage('ready');
    let alive = true;
    (async () => {
      const sb = supabase();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const linkError = url.searchParams.get('error_description') || hash.get('error_description');
      // getSession() waits until the client has read any token in the address.
      let { data } = await sb.auth.getSession();
      if (!data.session && !linkError) {
        const code = url.searchParams.get('code');
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type') as EmailOtpType | null;
        if (code) await sb.auth.exchangeCodeForSession(code).catch(() => undefined);
        else if (hash.get('access_token') && hash.get('refresh_token'))
          await sb.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! }).catch(() => undefined);
        else if (tokenHash && type) await sb.auth.verifyOtp({ token_hash: tokenHash, type }).catch(() => undefined);
        ({ data } = await sb.auth.getSession());
      }
      // Don't leave the one-time token in the address bar or the history.
      window.history.replaceState(null, '', url.pathname);
      if (!alive) return;
      if (data.session) setStage('ready');
      else {
        setProblem(linkError ? tx('This link has expired or was already used.') : tx('Open this page from the link in your email.'));
        setStage('invalid');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError(tx('Use at least 8 characters.'));
    if (password !== again) return setError(tx('The two passwords don\'t match.'));
    setBusy(true);
    const r = await updatePassword(password);
    setBusy(false);
    if (!r.ok) return setError(r.reason);
    setStage('done');
    // Staff go to their area; the staff sign-in page sends each role to the right place.
    setTimeout(() => router.replace('/staff/login'), 1500);
  };

  return (
    <AuthShell
      title={tx('Set a new password')}
      subtitle={tx('For staff accounts. Passengers sign in with their mobile number and don\'t need a password.')}
      footer={<Link href="/staff/login" className="font-bold text-[#050a44] hover:underline">{tx('Back to staff sign-in')}</Link>}
    >
      {stage === 'checking' && <p role="status" className="text-center text-[14px] text-[#46464f]">{tx('Checking your link…')}</p>}
      {stage === 'invalid' && (
        <div role="alert" className="rounded-xl bg-[#ffdad6] text-[#410002] px-4 py-3 text-[14px] font-medium">{tx('{problem} Ask for a new one from the staff sign-in page ("Forgot password?").', { problem })}</div>
      )}
      {stage === 'done' && <p role="status" className="rounded-xl bg-[#e8f6ea] text-[#0b4a1a] px-4 py-3 text-[14px] font-semibold">{tx('Password saved. Taking you to sign in…')}</p>}
      {stage === 'ready' && (
        <form className="space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">{tx('New password')}</span>
            <input className={`${authInput} mt-1.5`} type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <span className="block text-[12px] text-[#6b6d78] mt-1.5">{tx('At least 8 characters.')}</span>
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-[#050a44]">{tx('Type it again')}</span>
            <input className={`${authInput} mt-1.5`} type="password" autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required />
          </label>
          {error && <p role="alert" className="text-[13px] font-semibold text-[#ba1a1a]">{error}</p>}
          <button className={authButton} disabled={busy}>{busy ? tx('Saving…') : tx('Save password')}</button>
        </form>
      )}
    </AuthShell>
  );
}
