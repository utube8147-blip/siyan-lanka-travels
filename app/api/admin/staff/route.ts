// Super admins add a staff member (office staff, conductor or super admin).
// Staff sign in with email + password, so this emails them an invite: the
// link opens /auth/reset where they choose their password. If the address
// already has an account, it just gets the role (and branch).
// The caller must be a super admin; the database checks that too.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { OPERATOR } from '@/config/operator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['conductor', 'staff', 'admin'] as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = adminClient();
  if (!url || !key) return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  if (!db) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY is not set on the server, so invites cannot be sent.' }, { status: 503 });

  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (isAdmin !== true) return NextResponse.json({ error: 'Super admins only.' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { email?: string; fullName?: string; role?: string; branchId?: string | null };
  const email = (body.email ?? '').trim().toLowerCase();
  const fullName = (body.fullName ?? '').trim().slice(0, 120);
  const role = ROLES.find((r) => r === body.role);
  if (!EMAIL_RE.test(email) || email.length > 200) return NextResponse.json({ error: 'Check the email address.' }, { status: 400 });
  if (fullName.length < 2) return NextResponse.json({ error: 'Please enter their name.' }, { status: 400 });
  if (!role) return NextResponse.json({ error: 'Choose a role.' }, { status: 400 });

  const site = (process.env.NEXT_PUBLIC_SITE_URL || OPERATOR.siteUrl || req.nextUrl.origin).replace(/\/$/, '');
  let userId: string | null = null;
  let invited = false;
  const inv = await db.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo: `${site}/auth/reset` });
  if (inv.data?.user) {
    userId = inv.data.user.id;
    invited = true;
  } else {
    // Already has an account (e.g. signed up as a passenger with this email): find it.
    const { data: prof } = await db.from('profiles').select('id').eq('email', email).maybeSingle();
    userId = prof?.id ?? null;
    if (!userId) return NextResponse.json({ error: `Couldn't send the invite: ${inv.error?.message ?? 'unknown error'}` }, { status: 400 });
  }

  // Wait for the sign-up trigger to make the profile, then give the role and branch.
  for (let i = 0; i < 5; i++) {
    const { data: p } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (p) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const { error: e1 } = await db.from('profiles').update({ role, full_name: fullName, email }).eq('id', userId);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (body.branchId) await db.from('profiles').update({ branch_id: body.branchId }).eq('id', userId);

  return NextResponse.json({ ok: true, invited, userId });
}
