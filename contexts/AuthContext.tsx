'use client';
// Sign-in state.
// - Supabase mode (keys set): real email + password accounts via Supabase
//   Auth; role comes from the profiles table ('staff' can open /admin).
// - Demo mode (no keys): a pretend user so the site can be clicked through.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, friendlyError } from '@/lib/supabase/client';

/** 'operator' = staff of the bus company (can open /admin). */
export type UserRole = 'passenger' | 'operator';

export type MockUser = {
  id: string;
  email: string;
  phone: string;
  role: UserRole;
  user_metadata: { full_name: string; avatar_url: string };
};
export type AppUser = MockUser;

export type LoginParams = { identifier?: string; email?: string; phone?: string; role?: UserRole; fullName?: string };
type Result = { ok: true; needsEmailConfirmation?: boolean } | { ok: false; reason: string };

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
      email: u.email ?? '',
      phone: prof?.phone ?? u.phone ?? '',
      role: prof?.role === 'staff' ? 'operator' : 'passenger',
      user_metadata: {
        full_name: prof?.full_name || (u.user_metadata?.full_name as string) || (u.email ?? 'Traveller').split('@')[0],
        avatar_url: '',
      },
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (mode === 'supabase') {
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
    const { identifier, email, phone, role = 'passenger' } = params;
    const fullName = params.fullName || (role === 'operator' ? 'Operations Desk' : DEMO_USER.user_metadata.full_name);
    const looksLikeEmail = (identifier ?? '').includes('@');
    setDemoUser({
      id: role === 'operator' ? 'mock-staff-1' : DEMO_USER.id,
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
      options: { data: { full_name: fullName, phone: phone ?? '' }, emailRedirectTo: `${window.location.origin}/my-bookings` },
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

  const logout = async () => {
    if (mode === 'supabase') await supabase().auth.signOut();
    else setDemoUser(null);
    setUserState(null);
  };

  return (
    <AuthContext.Provider value={{ mode, user, isLoggedIn: !!user, isLoading, login, signIn, signUp, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
