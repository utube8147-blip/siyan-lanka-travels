// Sends queued SMS / WhatsApp messages (booking confirmed, seat held, trip
// updates, waitlist offers…) and push notifications (trip reminders 3 hours
// before boarding, refund paid, seat sold…). Call every minute from a cron with
//   Authorization: Bearer <CRON_SECRET>
// (Vercel Cron, or Supabase pg_cron + pg_net — see README → Messages).
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/server/admin';
import { sendSms, sendWhatsApp } from '@/lib/server/messaging';
import { pushPendingNotifications } from '@/lib/server/push';

export const dynamic = 'force-dynamic';

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = adminClient();
  if (!db) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY not set' }, { status: 500 });

  await db.rpc('release_expired_holds');
  // Push first: it's quick, and a slow SMS provider shouldn't delay reminders.
  const push = await pushPendingNotifications(db).catch((e) => ({ error: String(e).slice(0, 200) }));
  const { data: batch, error } = await db.from('message_queue').select('*').eq('status', 'pending').order('created_at').limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const m of batch ?? []) {
    const r = m.channel === 'whatsapp' ? await sendWhatsApp(m.to_phone, m.body) : await sendSms(m.to_phone, m.body);
    const retry = r.status === 'failed' && m.attempts < 2;
    await db
      .from('message_queue')
      .update({ status: retry ? 'pending' : r.status, attempts: m.attempts + 1, error: r.error ?? null, sent_at: r.status === 'sent' ? new Date().toISOString() : null })
      .eq('id', m.id);
    results[r.status] += 1;
  }
  return NextResponse.json({ processed: batch?.length ?? 0, ...results, push });
}

export const GET = handle;
export const POST = handle;
