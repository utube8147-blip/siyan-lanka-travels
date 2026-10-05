// Push notifications without waiting for the every-minute cron.
//  - POST {}            sends every in-app notification that hasn't been pushed
//                       yet (a conductor's update, a booking confirmed…). The
//                       app calls this right after it creates one.
//  - POST {test: true}  pushes a test message to the signed-in person's own
//                       devices and reports exactly what happened, so "why am
//                       I not getting notifications?" has an answer.
// Timed reminders (1 day, 3 hours, 1 hour before) still need the cron on
// /api/messages/dispatch: nothing else is awake to send them at that moment.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { pushPendingNotifications, pushToUser } from '@/lib/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = adminClient();
  if (!url || !key) return NextResponse.json({ problem: 'no_database' }, { status: 503 });
  if (!db) return NextResponse.json({ problem: 'no_secret_key' }, { status: 503 });

  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ problem: 'signed_out' }, { status: 401 });

  const { test } = (await req.json().catch(() => ({}))) as { test?: boolean };
  if (test) {
    const r = await pushToUser(db, u.user.id, { title: 'Test from the server', body: 'Push notifications reach this device. Trip reminders will arrive the same way.', url: '/my-bookings', tag: 'server-test' });
    return NextResponse.json(r);
  }
  const r = await pushPendingNotifications(db).catch((e) => ({ error: String(e).slice(0, 200) }));
  return NextResponse.json(r);
}
