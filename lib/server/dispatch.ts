// Sends rows of the message queue (SMS, WhatsApp, email) and records the
// result. Used by the every-minute cron (/api/messages/dispatch) and by
// /api/messages/send-booking, which sends a booking's messages the moment it
// is made so they don't wait for the cron (and still go out where no cron is
// running, e.g. on a developer's machine).
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms, sendWhatsApp, type SendResult } from './messaging';
import { sendEmail, ticketEmailHtml, type TicketData } from './email';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueueRow = any;

export async function deliverQueued(db: SupabaseClient, batch: QueueRow[]) {
  const results = { sent: 0, failed: 0, skipped: 0 };
  for (const m of batch) {
    // Claim it first: the cron and "send now" can pick up the same row in the
    // same second, and a passenger must not get the text twice. Only the run
    // whose update matches the attempts it read goes on to send.
    const claim = await db.from('message_queue').update({ attempts: m.attempts + 1 }).eq('id', m.id).eq('status', 'pending').eq('attempts', m.attempts).select('id');
    if (!claim.data?.length) continue;

    let r: SendResult =
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
      .update({ channel: retry ? m.channel : channel, status: retry ? 'pending' : r.status, error: r.error ?? null, sent_at: r.status === 'sent' ? new Date().toISOString() : null })
      .eq('id', m.id);
    results[r.status] += 1;
  }
  return results;
}
