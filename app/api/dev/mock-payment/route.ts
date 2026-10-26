// Local testing only (NEXT_PUBLIC_MOCK_PAYMENTS=true, on your own computer):
// the mock payment gateway's answer for a held booking. "paid" marks it paid
// exactly as PayHere's server callback would (same database function, same
// amount check); "failed" leaves it held, so it can be paid again until the
// hold runs out. Refuses on Vercel and on any non-local address.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { serverMockPaymentsOn } from '@/lib/mockVerification';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!serverMockPaymentsOn(req.headers.get('host'))) return NextResponse.json({ error: 'Not available.' }, { status: 404 });
  const db = adminClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!db || !url || !key) return NextResponse.json({ error: 'The mock gateway needs NEXT_PUBLIC_SUPABASE_URL, the publishable key and SUPABASE_SECRET_KEY in .env.local.' }, { status: 503 });
  // The signed-in passenger, and only their own booking (row-level security).
  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const auth = req.headers.get('authorization');
  const { data: u } = auth ? await db.auth.getUser(auth.replace(/^Bearer\s+/i, '')) : await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const { ref, outcome, method } = (await req.json().catch(() => ({}))) as { ref?: string; outcome?: 'paid' | 'failed'; method?: string };
  const { data: b } = await db.from('bookings').select('id, ref, user_id, total, status, payment_status').eq('ref', ref ?? '').maybeSingle();
  if (!b || b.user_id !== u.user.id) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (outcome !== 'paid') return NextResponse.json({ ok: true, status: b.status });
  if (b.payment_status === 'paid') return NextResponse.json({ ok: true, status: b.status });
  const { data, error } = await db.rpc('mark_paid_by_gateway', { p_ref: b.ref, p_amount: b.total, p_gateway_ref: `MOCK-${Date.now()}`, p_method: method === 'wallet' ? 'wallet' : 'card' });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, status: (data as { status?: string })?.status ?? 'confirmed' });
}
