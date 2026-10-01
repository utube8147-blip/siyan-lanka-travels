// SMS (Notify.lk) and WhatsApp (Meta WhatsApp Cloud API) senders.
// Without credentials they return 'skipped' so the queue still drains.

export type SendResult = { status: 'sent' | 'failed' | 'skipped'; error?: string };

/** "077 123 4567" / "+94771234567" → "94771234567" */
export function toLkMsisdn(phone: string) {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = `94${d.slice(1)}`;
  if (d.length === 9 && d.startsWith('7')) d = `94${d}`;
  return d;
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const user = process.env.NOTIFYLK_USER_ID;
  const key = process.env.NOTIFYLK_API_KEY;
  const sender = process.env.NOTIFYLK_SENDER_ID || 'NotifyDEMO';
  if (!user || !key) return { status: 'skipped', error: 'Notify.lk not configured' };
  const url = new URL('https://app.notify.lk/api/v1/send');
  url.search = new URLSearchParams({ user_id: user, api_key: key, sender_id: sender, to: toLkMsisdn(to), message: body }).toString();
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    const json = (await res.json().catch(() => ({}))) as { status?: string; errors?: unknown };
    return res.ok && json.status === 'success' ? { status: 'sent' } : { status: 'failed', error: JSON.stringify(json).slice(0, 300) };
  } catch (e) {
    return { status: 'failed', error: String(e).slice(0, 300) };
  }
}

/**
 * WhatsApp Cloud API. Messages a business starts must use an approved
 * template, so we send a template with the text as its single body variable
 * (create one named e.g. "siyan_update" with body "{{1}}" in WhatsApp Manager).
 */
export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE || 'siyan_update';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
  if (!token || !phoneId) return { status: 'skipped', error: 'WhatsApp not configured' };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toLkMsisdn(to),
        type: 'template',
        template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: body.slice(0, 1000) }] }] },
      }),
      cache: 'no-store',
    });
    if (res.ok) return { status: 'sent' };
    return { status: 'failed', error: (await res.text()).slice(0, 300) };
  } catch (e) {
    return { status: 'failed', error: String(e).slice(0, 300) };
  }
}
