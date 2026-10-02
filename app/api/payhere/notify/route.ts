// PayHere calls this server-to-server after a payment. We check the signature
// and the amount, then confirm the held booking, or (order ids starting RS-)
// hand a reserved resale ticket to its buyer. status_code 2 = success.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/server/admin';
import { payhereConfig, verifyNotify } from '@/lib/server/payhere';

export async function POST(req: Request) {
  const cfg = payhereConfig();
  const db = adminClient();
  if (!cfg || !db) return new NextResponse('not configured', { status: 503 });
  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  if (form.merchant_id !== cfg.merchantId || !verifyNotify(form, cfg.secret)) return new NextResponse('bad signature', { status: 400 });
  if (form.status_code !== '2') return new NextResponse('ignored', { status: 200 }); // pending / cancelled / failed
  const method = /EZCASH|MCASH|GENIE|FRIMI/i.test(form.method ?? '') ? 'wallet' : 'card';
  if (form.payhere_currency !== 'LKR') return new NextResponse('bad currency', { status: 400 });
  const isResale = (form.order_id ?? '').startsWith('RS-');
  const { error } = await db.rpc(isResale ? 'complete_resale' : 'mark_paid_by_gateway', {
    [isResale ? 'p_order_ref' : 'p_ref']: form.order_id,
    p_amount: Number(form.payhere_amount),
    p_gateway_ref: form.payment_id ?? '',
    p_method: method,
  });
  if (error) return new NextResponse(error.message, { status: 400 });
  return new NextResponse('ok');
}
