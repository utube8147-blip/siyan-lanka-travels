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
 * Parked for a later release. While false the screens, the "free trip"
 * checkbox and the settings field are hidden; nothing is deleted.
 * - WALLET_ENABLED: travel-credit wallet (balance, top-up, history).
 * - REWARDS_ENABLED: points / tiers and "every Nth trip free". To bring the
 *   free-trip reward back, set this to true AND run
 *   `update app_settings set rewards_enabled = true;` in the database.
 */
export const WALLET_ENABLED = false;
export const REWARDS_ENABLED = false;

/**
 * Sign-in cookies: kept for 400 days (the longest browsers allow) and renewed
 * on every visit, so people stay signed in on that device until they sign out
 * or clear their browser data. Secure (HTTPS-only) in production.
 */
export const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
