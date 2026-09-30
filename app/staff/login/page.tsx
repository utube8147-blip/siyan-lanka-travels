'use client';
// Staff / super admin sign-in — separate from the passenger sign-in.
// Only accounts whose profile role is 'staff' or 'admin' get in.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { isStaffRole, useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { Wordmark } from '@/components/Wordmark';

function nextPath() {
  const n = new URLSearchParams(window.location.search).get('next');
  return n && n.startsWith('/admin') ? n : '/admin';
}

export default function StaffLoginPage() {
  const router = useRouter();
  const { mode, login, signIn, logout, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await signIn(email, password);
    if (!r.ok) {
      setBusy(false);
      return setError(r.reason);
    }
    // Check the role before letting them in.
    const { data } = await supabase().auth.getUser();
    const { data: prof } = await supabase().from('profiles').select('role').eq('id', data.user?.id ?? '').maybeSingle();
    if (prof?.role !== 'staff' && prof?.role !== 'admin') {
      await logout();
      setBusy(false);
      return setError("This account doesn't have staff access. Ask the owner to give you access.");
    }
    router.replace(nextPath());
  };

  const field =
    'w-full px-4 py-3 rounded-xl bg-white/5 border border-white/15 text-white placeholder:text-white/40 outline-none focus:border-[#feb700] focus:bg-white/10';

  return (
    <main className="keep-navy min-h-screen bg-[#0d0e11] text-white flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <Wordmark />
        </div>
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-6 space-y-5">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-[#feb700] text-[#14120a] flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold">Staff sign-in</h1>
              <p className="text-[13px] text-white/60">Operations and management</p>
            </div>
          </div>

          {user && isStaffRole(user.role) ? (
            <button onClick={() => router.replace(nextPath())} className="w-full h-12 rounded-xl bg-[#feb700] text-[#14120a] font-semibold">
              Continue as {user.user_metadata.full_name}
            </button>
          ) : mode === 'demo' ? (
            <div className="space-y-2">
              <button
                onClick={() => {
                  login({ role: 'operator' });
                  router.replace(nextPath());
                }}
                className="w-full h-12 rounded-xl bg-white/10 border border-white/15 font-semibold hover:bg-white/15"
              >
                Continue as staff (demo)
              </button>
              <button
                onClick={() => {
                  login({ role: 'admin' });
                  router.replace(nextPath());
                }}
                className="w-full h-12 rounded-xl bg-[#feb700] text-[#14120a] font-semibold"
              >
                Continue as super admin (demo)
              </button>
              <p className="text-[12px] text-white/50 pt-1">Demo mode: connect Supabase for real staff accounts.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="text-[12px] font-semibold text-white/70">Work email</span>
                <input className={`${field} mt-1`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="block">
                <span className="text-[12px] font-semibold text-white/70">Password</span>
                <input className={`${field} mt-1`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              {error && (
                <p role="alert" className="text-[13px] font-semibold text-[#ff8a80]">
                  {error}
                </p>
              )}
              <button disabled={busy} className="w-full h-12 rounded-xl bg-[#feb700] text-[#14120a] font-semibold disabled:opacity-60">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-[12px] text-white/40 mt-6">Authorised staff only. Access is logged.</p>
      </div>
    </main>
  );
}
