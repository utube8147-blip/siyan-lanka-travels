'use client';
// Browser Supabase client. Set these in .env.local (see README → Database):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (or the older NEXT_PUBLIC_SUPABASE_ANON_KEY)
// Never put the secret / service_role key in a NEXT_PUBLIC_ variable.
// Without them the app runs in demo mode on local sample data.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_COOKIE_MAX_AGE, HAS_DB } from '../features';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const isSupabaseConfigured = HAS_DB;

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured');
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    // Session lives in cookies (readable by the server, so /admin etc. can be
    // checked before the page loads). The tokens inside are signed by Supabase,
    // so they can't be forged; the refresh token rotates on each renewal.
    cookieOptions: {
      maxAge: AUTH_COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
      path: '/',
    },
  });
  return client;
}

/** Turn a database error like "SEAT_TAKEN: One of those seats…" into the readable part. */
export function friendlyError(err: { message?: string } | null | undefined, fallback = 'Something went wrong. Please try again.') {
  const m = err?.message ?? '';
  const i = m.indexOf(': ');
  if (/^[A-Z_]+: /.test(m)) return m.slice(i + 2);
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(m)) return "Can't reach the booking system right now. Check your internet connection.";
  if (/relation .* does not exist|could not find the (table|function)/i.test(m)) return 'The database is not set up yet. Run the SQL in supabase/migrations (see README → Database).';
  if (/violates foreign key/.test(m)) return 'This is still used elsewhere (bookings or departures). Remove those first.';
  if (/duplicate key/.test(m)) return 'That already exists.';
  if (/row-level security|permission denied/.test(m)) return "You don't have permission to do that.";
  return m || fallback;
}
