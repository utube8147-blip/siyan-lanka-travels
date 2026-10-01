// Verifies Supabase Auth hook requests (Standard Webhooks signatures).
// Secret from Supabase looks like "v1,whsec_<base64>".
import { createHmac, timingSafeEqual } from 'crypto';

export function verifyStandardWebhook(body: string, headers: Headers, secret: string, toleranceSec = 300) {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigs = headers.get('webhook-signature');
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  const key = Buffer.from(secret.replace(/^v1,/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
