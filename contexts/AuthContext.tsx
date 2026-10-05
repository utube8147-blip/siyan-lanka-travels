'use client';
// Sign-in state.
// - Supabase mode (keys set): real email + password accounts via Supabase
//   Auth; role comes from the profiles table ('staff' can open /admin).
// - Demo mode (no keys): a pretend user so the site can be clicked through.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { forgetPushSubscription } from '@/lib/pwa';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, friendlyError } from '@/lib/supabase/client';
import { toE164LK } from '@/lib/phone';

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
type Result = { ok: true; needsEmailConfirmation?: boolean } | { ok: false; reason: string; code?: 'sms_unavailable' };

type AuthContextValue = {
  mode: 'supabase' | 'demo';
  user: AppUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  /** Demo mode only: pretend sign-in. */
  login: (params?: LoginParams) => void;
  signIn: (email: string, password: string) => Promise<Result>;
  signUp: (p: { email: string; password: string; fullName: string; phone?: string }) => Promise<Result>;
  resetPassword: (email: string) => Promise<Result>;
  /** Text a 6-digit code to a Sri Lankan mobile. createUser=false for sign-in only. */
  sendPhoneCode: (phone: string, opts?: { createUser?: boolean; fullName?: string }) => Promise<Result>;
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
    const { data: prof } = await supabase().from('profiles').select('full_name, phone, role').eq('id', u.id).maybeSingle();
    setUserState({
      id: u.id,
      // Phone sign-ups: the address given at sign-up counts even before it's confirmed.
      email: u.email || u.new_email || '',
      phone: prof?.phone ?? u.phone ?? '',
      role: prof?.role === 'admin' ? 'admin' : prof?.role === 'staff' ? 'operator' : prof?.role === 'conductor' ? 'conductor' : 'passenger',
      user_metadata: {
        full_name: prof?.full_name || (u.user_metadata?.full_name as string) || (u.email ?? 'Traveller').split('@')[0],
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
    const fullName = params.fullName || (role === 'admin' ? 'Owner (super admin)' : role === 'operator' ? 'Operations Desk' : role === 'conductor' ? 'Suresh (conductor)' : DEMO_USER.user_metadata.full_name);
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
    if (error) return { ok: false, reason: error.message === 'Invalid login credentials' ? 'Wrong email or password.' : friendlyError(error) };
    return { ok: true };
  };

  const signUp = async ({ email, password, fullName, phone }: { email: string; password: string; fullName: string; phone?: string }): Promise<Result> => {
    if (mode === 'demo') {
      login({ email, phone, fullName });
      return { ok: true };
    }
    const { data, error } = await supabase().auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName, phone: phone ?? '' }, emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) return { ok: false, reason: friendlyError(error) };
    // With "Confirm email" on (Supabase default) there's no session until they click the link.
    return { ok: true, needsEmailConfirmation: !data.session };
  };

  const resetPassword = async (email: string): Promise<Result> => {
    if (mode === 'demo') return { ok: true };
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/login` });
    return error ? { ok: false, reason: friendlyError(error) } : { ok: true };
  };

  const sendPhoneCode = async (phone: string, opts: { createUser?: boolean; fullName?: string } = {}): Promise<Result> => {
    const e164 = toE164LK(phone);
    if (!e164) return { ok: false, reason: 'Enter a Sri Lankan mobile number, like 077 123 4567.' };
    if (mode === 'demo') return { ok: true };
    const { error } = await supabase().auth.signInWithOtp({
      phone: e164,
      options: { shouldCreateUser: opts.createUser ?? false, channel: 'sms', data: opts.fullName ? { full_name: opts.fullName, phone: e164 } : undefined },
    });
    if (!error) return { ok: true };
    if (/signups not allowed|user not found/i.test(error.message)) return { ok: false, reason: 'No account with this number yet. Sign up first, it takes a minute.' };
    if (/unsupported phone provider|phone.*(disabled|not enabled)|sms|provider|twilio|vonage|messagebird/i.test(error.message)) {
      // Supabase couldn't send the text: Phone provider off or SMS provider not set up (README → Phone sign-in).
      console.warn('[phone sign-in] Supabase could not send the SMS:', error.message, '→ Supabase → Authentication → Sign In / Providers → Phone: turn on, provider MessageBird, add the access key + originator (README → Phone sign-in).');
      return { ok: false, reason: "We can't send text codes right now. Please use email instead, or try again later.", code: 'sms_unavailable' };
    }
    if (/rate|too many|seconds/i.test(error.message)) return { ok: false, reason: 'Please wait a minute before asking for another code.' };
    return { ok: false, reason: friendlyError(error) };
  };

  const verifyPhoneCode = async (phone: string, code: string, opts: { fullName?: string; email?: string } = {}): Promise<Result> => {
    const e164 = toE164LK(phone);
    if (!e164) return { ok: false, reason: 'Check the mobile number.' };
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) return { ok: false, reason: 'Enter the 6-digit code from the text message.' };
    if (mode === 'demo') {
      if (token !== '123456') return { ok: false, reason: 'Wrong code. (Demo mode: the code is 123456.)' };
      login({ phone: e164, identifier: e164, fullName: opts.fullName, email: opts.email });
      return { ok: true };
    }
    const { data, error } = await supabase().auth.verifyOtp({ phone: e164, token, type: 'sms' });
    if (error) return { ok: false, reason: /expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Ask for a new one.' : friendlyError(error) };
    // Keep the profile in step (name from sign-up, number from the verified phone).
    const uid = data.user?.id;
    if (uid) {
      const patch: Record<string, string> = { phone: e164 };
      if (opts.fullName) patch.full_name = opts.fullName;
      await supabase().from('profiles').update(patch).eq('id', uid);
      if (opts.email) await supabase().auth.updateUser({ email: opts.email }).catch(() => undefined);
      await applySession(data.session);
    }
    return { ok: true };
  };

  const logout = async () => {
    if (mode === 'supabase') {
      await forgetPushSubscription(); // this browser stops getting this account's reminders
      await supabase().auth.signOut();
    } else setDemoUser(null);
    setUserState(null);
  };

  return (
    <AuthContext.Provider value={{ mode, user, isLoggedIn: !!user, isLoading, login, signIn, signUp, resetPassword, sendPhoneCode, verifyPhoneCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
