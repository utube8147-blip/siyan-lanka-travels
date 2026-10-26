// Local testing only (NEXT_PUBLIC_MOCK_VERIFICATION=true, on your own computer):
// signs a passenger in by phone without texting a code. The phone must be a
// Sri Lankan mobile and the code the test code. The account is a real one in
// your Supabase project (made on first use, found by its phone number after
// that); it gets a password only this server can work out, used just to start
// the session here. Refuses on Vercel and on any non-local address.
import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/server/admin';
import { MOCK_CODE, serverMockOn } from '@/lib/mockVerification';
import { toE164LK } from '@/lib/phone';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!serverMockOn(req.headers.get('host'))) return NextResponse.json({ error: 'Not available.' }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = adminClient();
  if (!url || !anon || !db || !secret) return NextResponse.json({ error: 'Test sign-in needs NEXT_PUBLIC_SUPABASE_URL, the publishable key and SUPABASE_SECRET_KEY in .env.local.' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { phone?: string; code?: string; fullName?: string; signUp?: boolean };
  const phone = toE164LK(body.phone ?? '');
  if (!phone) return NextResponse.json({ error: 'Enter a Sri Lankan mobile number, like 077 123 4567.' }, { status: 400 });
  if ((body.code ?? '').replace(/\D/g, '') !== MOCK_CODE) return NextResponse.json({ error: `Wrong code. (Test mode: the code is ${MOCK_CODE}.)` }, { status: 400 });

  const password = createHmac('sha256', secret).update(`mock-sign-in:${phone}`).digest('base64url');
  const digits = phone.replace(/\D/g, '');
  // Find the account by its number (profiles keep it as +94…; auth as 94…).
  const { data: prof } = await db.from('profiles').select('id').in('phone', [phone, digits]).limit(1).maybeSingle();
  let id = prof?.id as string | undefined;
  if (!id) {
    if (!body.signUp) return NextResponse.json({ error: 'No account with this number yet. Sign up first, it takes a minute.' }, { status: 404 });
    const { data, error } = await db.auth.admin.createUser({ phone: digits, phone_confirm: true, password, user_metadata: { full_name: body.fullName ?? '', phone } });
    if (error || !data.user) return NextResponse.json({ error: error?.message ?? 'Could not create the test account.' }, { status: 500 });
    id = data.user.id;
  } else {
    const { error } = await db.auth.admin.updateUserById(id, { password, phone_confirm: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error } = await sb.auth.signInWithPassword({ phone: digits, password });
  if (error || !s.session) return NextResponse.json({ error: `Test sign-in failed: ${error?.message ?? 'no session'}. Phone sign-in must be switched on in Supabase (Authentication → Sign In / Providers → Phone).` }, { status: 500 });
  console.info(`[mock sign-in] ${phone} signed in without a text (test mode).`);
  return NextResponse.json({ access_token: s.session.access_token, refresh_token: s.session.refresh_token });
}
