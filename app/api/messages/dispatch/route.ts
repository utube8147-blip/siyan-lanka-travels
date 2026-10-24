// Sends queued SMS / WhatsApp messages (booking confirmed with the ticket and
// tracking links, seat held, trip updates, waitlist offers…), the ticket by
// email, and push notifications (trip reminders 1 day, 3 hours and 1 hour
// before boarding and when the trip starts, refund paid, seat sold…).
// Call every minute from a cron with
//   Authorization: Bearer <CRON_SECRET>
// (Vercel Cron, or Supabase pg_cron + pg_net — see README → Messages).
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/server/admin';
import { sendSms } from '@/lib/server/messaging';
import { deliverQueued } from '@/lib/server/dispatch';
import { pushPendingNotifications } from '@/lib/server/push';
import { sameSecret } from '@/lib/server/webhook';

export const dynamic = 'force-dynamic';

/**
 * Queues the renewal reminders that are due (the database decides which:
 * 30, 14, 7, 3, 1 days before, on the day, then every 3 days once expired)
 * and texts the owner (OWNER_PHONE) one message listing them.
 */
async function remindRenewals(db: NonNullable<ReturnType<typeof adminClient>>) {
  const { data, error } = await db.rpc('queue_renewal_reminders');
  if (error) return { error: error.message.slice(0, 200) };
  const lines = (data as string[] | null) ?? [];
  if (lines.length === 0) return { reminders: 0 };
  const owner = (process.env.OWNER_PHONE ?? '').trim();
  if (!owner) return { reminders: lines.length, sms: 'OWNER_PHONE not set' };
  const shown = lines.slice(0, 4).join('; ');
  const more = lines.length > 4 ? `; and ${lines.length - 4} more` : '';
  const sent = await sendSms(owner, `Siyan Lanka: to renew. ${shown}${more}. See Staff area, Fleet health.`);
  return { reminders: lines.length, sms: sent.status };
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = adminClient();
  if (!db) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY not set' }, { status: 500 });

  await db.rpc('release_expired_holds');
  // Optional ("on request") stops whose cut-off has passed: the detour runs, or the
  // passengers who booked it are moved to the nearest main stop (notification + text queued).
  const optional = await db.rpc('settle_optional_stops').then((r) => (r.error ? { error: r.error.message.slice(0, 200) } : { moved: r.data }));
  // Push first: it's quick, and a slow SMS provider shouldn't delay reminders.
  // Documents and licences that are about to expire (or have): super admins get a
  // notification (pushed below); the owner also gets one text listing them.
  const renewals = await remindRenewals(db).catch((e) => ({ error: String(e).slice(0, 200) }));
  const push = await pushPendingNotifications(db, { reminders: true }).catch((e) => ({ error: String(e).slice(0, 200) }));
  const { data: batch, error } = await db.from('message_queue').select('*').eq('status', 'pending').order('created_at').limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await deliverQueued(db, batch ?? []);
  return NextResponse.json({ processed: batch?.length ?? 0, ...results, push, renewals, optional });
}

export const GET = handle;
export const POST = handle;
