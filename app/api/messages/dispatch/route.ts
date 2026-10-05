// Sends queued SMS / WhatsApp messages (booking confirmed with the ticket and
// tracking links, seat held, trip updates, waitlist offers…), the ticket by
// email, and push notifications (trip reminders 1 day, 3 hours and 1 hour
// before boarding and when the trip starts, refund paid, seat sold…).
// Call every minute from a cron with
//   Authorization: Bearer <CRON_SECRET>
// (Vercel Cron, or Supabase pg_cron + pg_net — see README → Messages).
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/server/admin';
import { sendSms, sendWhatsApp } from '@/lib/server/messaging';
import { pushPendingNotifications } from '@/lib/server/push';
import { sendEmail, ticketEmailHtml, type TicketData } from '@/lib/server/email';

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
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = adminClient();
  if (!db) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY not set' }, { status: 500 });

  await db.rpc('release_expired_holds');
  // Push first: it's quick, and a slow SMS provider shouldn't delay reminders.
  // Documents and licences that are about to expire (or have): super admins get a
  // notification (pushed below); the owner also gets one text listing them.
  const renewals = await remindRenewals(db).catch((e) => ({ error: String(e).slice(0, 200) }));
  const push = await pushPendingNotifications(db).catch((e) => ({ error: String(e).slice(0, 200) }));
  const { data: batch, error } = await db.from('message_queue').select('*').eq('status', 'pending').order('created_at').limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const m of batch ?? []) {
    let r =
      m.channel === 'email'
        ? await sendEmail(m.to_email ?? '', m.subject || 'Siyan Lanka Travels', m.body, m.data ? ticketEmailHtml(m.data as TicketData) : undefined)
        : m.channel === 'whatsapp'
          ? await sendWhatsApp(m.to_phone, m.body)
          : await sendSms(m.to_phone, m.body);
    let channel: string = m.channel;
    // "WhatsApp if they have it, otherwise a text": when WhatsApp isn't set up
    // or can't deliver to this number, the same message goes out as SMS.
    if (m.channel === 'whatsapp' && m.fallback_sms && r.status !== 'sent') {
      const viaWhatsApp = r.error;
      r = await sendSms(m.to_phone, m.body);
      channel = 'sms';
      if (r.status !== 'sent') r = { ...r, error: `WhatsApp: ${viaWhatsApp ?? 'not sent'}; SMS: ${r.error ?? 'not sent'}` };
    }
    const retry = r.status === 'failed' && m.attempts < 2;
    await db
      .from('message_queue')
      .update({ channel: retry ? m.channel : channel, status: retry ? 'pending' : r.status, attempts: m.attempts + 1, error: r.error ?? null, sent_at: r.status === 'sent' ? new Date().toISOString() : null })
      .eq('id', m.id);
    results[r.status] += 1;
  }
  return NextResponse.json({ processed: batch?.length ?? 0, ...results, push, renewals });
}

export const GET = handle;
export const POST = handle;
