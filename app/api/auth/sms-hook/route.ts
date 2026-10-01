// Supabase "Send SMS" auth hook → Notify.lk.
// Supabase calls this whenever it needs to text a sign-in / sign-up code.
// Set up in Supabase: Authentication → Hooks → Send SMS hook → HTTPS
//   URL:    https://your-domain/api/auth/sms-hook
//   Secret: copy into SUPABASE_SMS_HOOK_SECRET
// and NOTIFYLK_USER_ID / NOTIFYLK_API_KEY / NOTIFYLK_SENDER_ID on the server.
import { NextResponse } from 'next/server';
import { verifyStandardWebhook } from '@/lib/server/webhook';
import { sendSms } from '@/lib/server/messaging';

export const dynamic = 'force-dynamic';

const fail = (status: number, message: string) => NextResponse.json({ error: { http_code: status, message } }, { status });

export async function POST(req: Request) {
  const secret = process.env.SUPABASE_SMS_HOOK_SECRET;
  if (!secret) return fail(500, 'SMS hook secret not configured');
  const body = await req.text();
  if (!verifyStandardWebhook(body, req.headers, secret)) return fail(401, 'Invalid signature');

  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    return fail(400, 'Bad payload');
  }
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) return fail(400, 'Missing phone or code');

  const r = await sendSms(phone, `${otp} is your Siyan Lanka code. It expires in 10 minutes. Never share it with anyone.`);
  if (r.status !== 'sent') return fail(502, `Could not send SMS${r.error ? `: ${r.error}` : ''}`);
  return NextResponse.json({});
}
