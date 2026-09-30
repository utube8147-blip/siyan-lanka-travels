// Server-side check of the resale switch (layouts, sitemap). Cached 1 minute.
import { OPERATOR } from '@/config/operator';
import { HAS_DB } from './features';

export async function isResaleOn(): Promise<boolean> {
  if (!HAS_DB) return OPERATOR.features.resale;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  try {
    const res = await fetch(`${url}/rest/v1/app_settings?select=resale_enabled`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as { resale_enabled: boolean }[];
    return !!rows[0]?.resale_enabled;
  } catch {
    return false;
  }
}
