// lib/features.ts — what's switched on. Safe to import anywhere (server or client).
import { OPERATOR } from '@/config/operator';

/** True when Supabase keys are set: real database + accounts. */
export const HAS_DB = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

/** Resale default for demo mode. With Supabase the switch is in Staff area → Settings
 *  (see lib/resale.ts / lib/resale-server.ts). */
export const RESALE_DEMO_DEFAULT = OPERATOR.features.resale;

/**
 * Sign-in cookies: kept for 400 days (the longest browsers allow) and renewed
 * on every visit, so people stay signed in on that device until they sign out
 * or clear their browser data. Secure (HTTPS-only) in production.
 */
export const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
