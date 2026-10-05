// Web Push sender (reminders and updates when the app is closed).
// Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY on the server
// (`npx web-push generate-vapid-keys`). Without them it does nothing.
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR } from '@/config/operator';

let configured: boolean | null = null;
function configure() {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${OPERATOR.contact.email}`, pub, priv);
  return (configured = true);
}
export const pushConfigured = () => configure();

type Note = { id: string; user_id: string; title: string; body: string; url: string; tag: string | null };

/**
 * Queues due trip reminders, then pushes every in-app notification that
 * hasn't gone out yet (reminders, waitlist offers, refund paid, slip sent
 * back, seat sold…) to each of that passenger's browsers. Subscriptions the
 * browser has dropped are deleted. Each notification is pushed once.
 */
export async function pushPendingNotifications(db: SupabaseClient) {
  const out = { reminders: 0, pushed: 0, no_device: 0, failed: 0 };
  if (!configure()) return { ...out, skipped: 'VAPID keys not set' };

  const due = await db.rpc('queue_trip_reminders', { p_hours: 3 });
  out.reminders = (due.data as number | null) ?? 0;

  // Only fresh ones: a reminder that is hours late is worse than none.
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: notes } = await db.from('notifications').select('id, user_id, title, body, url, tag').is('pushed_at', null).gte('created_at', since).order('created_at').limit(100);
  const list = (notes ?? []) as Note[];
  if (list.length === 0) return out;

  const { data: subs } = await db.from('push_subscriptions').select('endpoint, user_id, p256dh, auth').in('user_id', [...new Set(list.map((n) => n.user_id))]);
  const byUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  for (const n of list) {
    // Claim it first so an overlapping run can't send it twice.
    const claim = await db.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', n.id).is('pushed_at', null).select('id');
    if (!claim.data?.length) continue;
    const devices = byUser.get(n.user_id) ?? [];
    if (devices.length === 0) {
      out.no_device += 1;
      continue;
    }
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag ?? `note-${n.id}` });
    let ok = false;
    for (const d of devices) {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 3 * 3600, urgency: 'high' });
        ok = true;
        await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('endpoint', d.endpoint);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', d.endpoint); // browser unsubscribed
      }
    }
    if (ok) out.pushed += 1;
    else out.failed += 1;
  }
  return out;
}

/**
 * Pushes one message straight to every device of one user, and says what
 * happened. Used by "Send a test from the server", which goes through the
 * same path as real reminders (keys, saved subscription, the push service),
 * so if the test arrives, reminders can.
 */
export async function pushToUser(db: SupabaseClient, userId: string, note: { title: string; body: string; url: string; tag: string }) {
  if (!configure()) return { devices: 0, delivered: 0, problem: 'no_keys' as const };
  const { data: subs, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
  if (error) return { devices: 0, delivered: 0, problem: 'no_table' as const };
  const devices = subs ?? [];
  if (devices.length === 0) return { devices: 0, delivered: 0, problem: 'no_device' as const };
  let delivered = 0;
  let lastCode: number | null = null;
  for (const d of devices) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(note), { TTL: 600, urgency: 'high' });
      delivered += 1;
      await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('endpoint', d.endpoint);
    } catch (e) {
      lastCode = (e as { statusCode?: number }).statusCode ?? 0;
      // Gone, or made with different keys: this saved subscription can never work again.
      if (lastCode === 404 || lastCode === 410 || lastCode === 401 || lastCode === 403) await db.from('push_subscriptions').delete().eq('endpoint', d.endpoint);
    }
  }
  return { devices: devices.length, delivered, problem: delivered > 0 ? null : lastCode === 401 || lastCode === 403 ? ('key_mismatch' as const) : ('refused' as const), code: lastCode };
}
