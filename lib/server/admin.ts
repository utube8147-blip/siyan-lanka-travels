// Server-only Supabase client with the SECRET key (bypasses row-level security).
// Only used in /api routes after checking who's calling. Never import this in
// a 'use client' file, and never prefix the key with NEXT_PUBLIC_.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
