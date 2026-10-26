'use client';
// Sign-in state.
// - Passengers sign in with their mobile number and a texted code. An email
//   address is optional and only used to send them their e-ticket; it is kept
//   on the profile (profiles.email), not as a second way to sign in.
// - Staff (office, conductors, super admins) sign in with email + password.
//   The owner adds them from Staff area → Accounts (an invite email lets them
//   set a password) and they can reset it from the staff sign-in page.
// - Demo mode (no keys): a pretend user so the site can be clicked through.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { clearPageCache, forgetPushSubscription } from '@/lib/pwa';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, friendlyError } from '@/lib/supabase/client';
import { toE164LK } from '@/lib/phone';
import { tx } from '@/lib/i18n';
import { MOCK_CODE, mockVerificationOn } from '@/lib/mockVerification';

/**
 * 'operator' = staff (operations: departures, bookings, fleet, timetable).
 * 'admin'    = super admin (everything staff can do + finance, expenses,
 *              crew, accounts, settings).
 */
export type UserRole = 'passenger' | 'conductor' | 'operator' | 'admin';
/** Anyone working for the company (incl. conductors). */
export const isStaffRole = (r?: UserRole | null) => r === 'operator' || r === 'admin' || r === 'conductor';
/** Office staff (staff area); conductors only get the conductor page. */
export const isOfficeRole = (r?: UserRole | null) => r === 'operator' || r === 'admin';

export type MockUser = {
  id: string;
  email: string;
  phone: string;
  role: UserRole;
  user_metadata: { full_name: string; avatar_url: string };
};
export type AppUser = MockUser;

export type LoginParams = { identifier?: string; email?: string; phone?: string; role?: UserRole; fullName?: string };
type Result = { ok: true } | { ok: false; reason: string; code?: 'sms_unavailable' };

type AuthContextValue = {
  mode: 'supabase' | 'demo';
  user: AppUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  /** Demo mode only: pretend sign-in. */
  login: (params?: LoginParams) => void;
  signIn: (email: string, password: string) => Promise<Result>;
  /** Staff: email a link that opens /auth/reset to choose a new password. */
  resetPassword: (email: string) => Promise<Result>;
  /** Signed in from a reset or invite link: set the new password. */
  updatePassword: (password: string) => Promise<Result>;
  /** Passenger: change their name and the (optional) email for e-tickets. */
  saveProfile: (p: { fullName: string; email: string }) => Promise<Result>;
  /** Text a 6-digit code to a Sri Lankan mobile. createUser=false for sign-in only. */
  sendPhoneCode: (phone: string, opts?: { createUser?: boolean; fullName?: string; email?: string }) => Promise<Result>;
  /** Check the code; signs the person in (and finishes sign-up). */
  verifyPhoneCode: (phone: string, code: string, opts?: { fullName?: string; email?: string }) => Promise<Result>;
  logout: () => Promise<void>;
};

const DEMO_USER: AppUser = {
  id: 'mock-user-1',
  email: 'alex.ham@example.com',
  phone: '+94771234567',
  role: 'passenger',
  user_metadata: { full_name: 'Alex Ham', avatar_url: '' },
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const DEMO_KEY = 'mock-auth-user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = isSupabaseConfigured ? 'supabase' : 'demo';
  const [user, setUserState] = useState<AppUser | null>(mode === 'demo' ? DEMO_USER : null);
  const [isLoading, setIsLoading] = useState(true);

  // ---- Supabase session -----------------------------------------------------
  const applySession = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setUserState(null);
      setIsLoading(false);
      return;
    }
    const u = session.user;
    // profiles.email (migration 35) holds the e-ticket address; older databases don't have it yet.
    const first = await supabase().from('profiles').select('full_name, phone, role, email').eq('id', u.id).maybeSingle();
    const prof = first.error ? (await supabase().from('profiles').select('full_name, phone, role').eq('id', u.id).maybeSingle()).data : first.data;
    const p = prof as { full_name?: string | null; phone?: string | null; role?: string | null; email?: string | null } | null;
    setUserState({
      id: u.id,
      email: p?.email || u.email || '',
      phone: p?.phone || u.phone || '',
      role: p?.role === 'admin' ? 'admin' : p?.role === 'staff' ? 'operator' : p?.role === 'conductor' ? 'conductor' : 'passenger',
      user_metadata: {
        full_name: p?.full_name || (u.user_metadata?.full_name as string) || (u.email ?? '').split('@')[0] || '',
        avatar_url: '',
      },
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (mode === 'supabase') {
      try {
        window.sessionStorage.removeItem(DEMO_KEY); // clear any old demo session
      } catch {
        /* ignore */
      }
      const sb = supabase();
      sb.auth.getSession().then(({ data }) => applySession(data.session));
      // Don't await Supabase calls inside this callback (can deadlock); defer.
      const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => applySession(session), 0);
      });
      return () => sub.subscription.unsubscribe();
    }
    // Demo: remember the pretend session for this tab.
    try {
      const raw = window.sessionStorage.getItem(DEMO_KEY);
      if (raw !== null) setUserState(raw === 'null' ? null : JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setIsLoading(false);
  }, [mode, applySession]);

  const setDemoUser = (u: AppUser | null) => {
    setUserState(u);
    try {
      window.sessionStorage.setItem(DEMO_KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
  };

  const login = (params: LoginParams = {}) => {
    if (mode === 'supabase') return; // real accounts only
    const { identifier, email, phone, role = 'passenger' } = params;
    const fullName = params.fullName || (role === 'admin' ? tx('Owner (super admin)') : role === 'operator' ? tx('Operations Desk') : role === 'conductor' ? tx('Suresh (conductor)') : DEMO_USER.user_metadata.full_name);
    const looksLikeEmail = (identifier ?? '').includes('@');
    setDemoUser({
      id: role === 'admin' ? 'mock-admin-1' : role === 'operator' ? 'mock-staff-1' : role === 'conductor' ? 'mock-conductor-1' : DEMO_USER.id,
      email: email || (looksLikeEmail ? identifier! : DEMO_USER.email),
      phone: phone || (!looksLikeEmail && identifier ? identifier : DEMO_USER.phone),
      role,
      user_metadata: { full_name: fullName, avatar_url: '' },
    });
  };

  const signIn = async (email: string, password: string): Promise<Result> => {
    if (mode === 'demo') {
      login({ email, identifier: email });
      return { ok: true };
    }
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, reason: error.message === 'Invalid login credentials' ? tx('Wrong email or password.') : friendlyError(error) };
    return { ok: true };
  };

  const resetPassword = async (email: string): Promise<Result> => {
    if (mode === 'demo') return { ok: true };
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset` });
    return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
  };

  const updatePassword = async (password: string): Promise<Result> => {
    if (password.length < 8) return { ok: false, reason: tx('Use at least 8 characters.') };
    if (mode === 'demo') return { ok: true };
    const { error } = await supabase().auth.updateUser({ password });
    return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
  };

  const saveProfile = async ({ fullName, email }: { fullName: string; email: string }): Promise<Result> => {
    const name = fullName.trim();
    const mail = email.trim().toLowerCase();
    if (name.length < 2) return { ok: false, reason: tx('Please enter your name.') };
    if (mail && !EMAIL_RE.test(mail)) return { ok: false, reason: tx('Check the email address, or leave it empty.') };
    if (mode === 'demo') {
      if (user) setDemoUser({ ...user, email: mail, user_metadata: { ...user.user_metadata, full_name: name } });
      return { ok: true };
    }
    if (!user) return { ok: false, reason: tx('Please sign in.') };
    const { error } = await supabase().from('profiles').update({ full_name: name, email: mail }).eq('id', user.id);
    if (error) return { ok: false, reason: friendlyError(error) };
    setUserState({ ...user, email: mail, user_metadata: { ...user.user_metadata, full_name: name } });
    return { ok: true };
  };

  const sendPhoneCode = async (phone: string, opts: { createUser?: boolean; fullName?: string; email?: string } = {}): Promise<Result> => {
    const e164 = toE164LK(phone);
    if (!e164) return { ok: false, reason: tx('Enter a Sri Lankan mobile number, like 077 123 4567.') };
    if (mode === 'demo') return { ok: true };
    if (mockVerificationOn()) return { ok: true }; // local testing: no text; the test code signs in
    const { error } = await supabase().auth.signInWithOtp({
      phone: e164,
      options: { shouldCreateUser: opts.createUser ?? false, channel: 'sms', data: opts.fullName ? { full_name: opts.fullName, phone: e164, ...(opts.email ? { email: opts.email.trim().toLowerCase() } : {}) } : undefined },
    });
    if (!error) return { ok: true };
    if (/signups not allowed|user not found/i.test(error.message)) return { ok: false, reason: tx('No account with this number yet. Sign up first, it takes a minute.') };
    if (/unsupported phone provider|phone.*(disabled|not enabled)|sms|provider|twilio|vonage|messagebird/i.test(error.message)) {
      // Supabase couldn't send the text: Phone provider off or SMS provider not set up (README → Phone sign-in).
      console.warn('[phone sign-in] Supabase could not send the SMS:', error.message, '→ Supabase → Authentication → Sign In / Providers → Phone must be on, and Authentication → Hooks → Send SMS must point to /api/auth/sms-hook (README → Phone sign-in).');
      return { ok: false, reason: tx('We can\'t send text codes right now. Please use email instead, or try again later.'), code: 'sms_unavailable' };
    }
    if (/rate|too many|seconds/i.test(error.message)) return { ok: false, reason: tx('Please wait a minute before asking for another code.') };
    return { ok: false, reason: friendlyError(error) };
  };

  const verifyPhoneCode = async (phone: string, code: string, opts: { fullName?: string; email?: string } = {}): Promise<Result> => {
    const e164 = toE164LK(phone);
    if (!e164) return { ok: false, reason: tx('Check the mobile number.') };
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) return { ok: false, reason: tx('Enter the 6-digit code from the text message.') };
    if (mode === 'demo') {
      if (token !== '123456') return { ok: false, reason: tx('Wrong code. (Demo mode: the code is 123456.)') };
      login({ phone: e164, identifier: e164, fullName: opts.fullName, email: opts.email });
      return { ok: true };
    }
    let data: { user: { id: string } | null; session: Session | null };
    if (mockVerificationOn()) {
      // Local testing: the server signs this number in without a text.
      const res = await fetch('/api/dev/mock-sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: e164, code: token, fullName: opts.fullName, signUp: !!opts.fullName }) }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) return { ok: false, reason: j.error ?? tx('Wrong code. (Test mode: the code is {code}.)', { code: MOCK_CODE }) };
      const set = await supabase().auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
      if (set.error) return { ok: false, reason: friendlyError(set.error) };
      data = { user: set.data.user, session: set.data.session };
    } else {
      const v = await supabase().auth.verifyOtp({ phone: e164, token, type: 'sms' });
      if (v.error) return { ok: false, reason: /expired|invalid/i.test(v.error.message) ? tx('That code is wrong or has expired. Ask for a new one.') : friendlyError(v.error) };
      data = v.data;
    }
    // Keep the profile in step (name from sign-up, number from the verified
    // phone, and the optional e-ticket email — kept on the profile, so it
    // never becomes a second way to sign in).
    const uid = data.user?.id;
    if (uid) {
      const patch: Record<string, string> = { phone: e164 };
      if (opts.fullName) patch.full_name = opts.fullName;
      const mail = (opts.email ?? '').trim().toLowerCase();
      if (mail && EMAIL_RE.test(mail)) patch.email = mail;
      const { error: upErr } = await supabase().from('profiles').update(patch).eq('id', uid);
      if (upErr && patch.email) {
        delete patch.email; // database without migration 35: save the rest
        await supabase().from('profiles').update(patch).eq('id', uid);
      }
      await applySession(data.session);
    }
    return { ok: true };
  };

  const logout = async () => {
    if (mode === 'supabase') {
      await forgetPushSubscription(); // this browser stops getting this account's reminders
      await supabase().auth.signOut();
      await clearPageCache(); // pages this account opened shouldn't show offline for the next person
    } else {
      setDemoUser(null);
      await clearPageCache();
    }
    setUserState(null);
  };

  return (
    <AuthContext.Provider value={{ mode, user, isLoggedIn: !!user, isLoading, login, signIn, resetPassword, updatePassword, saveProfile, sendPhoneCode, verifyPhoneCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
