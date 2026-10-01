// PayHere (Sri Lanka) checkout helpers. Docs: https://support.payhere.lk/api-&-mobile-sdk/checkout-api
import { createHash } from 'crypto';

const md5 = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();
export const payhereAmount = (n: number) => n.toFixed(2);

export function payhereConfig() {
  const merchantId = process.env.PAYHERE_MERCHANT_ID;
  const secret = process.env.PAYHERE_MERCHANT_SECRET;
  const sandbox = process.env.PAYHERE_SANDBOX !== 'false';
  if (!merchantId || !secret) return null;
  return { merchantId, secret, action: sandbox ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout' };
}

/** hash = MD5(merchant_id + order_id + amount + currency + MD5(secret)) — all upper-case hex. */
export function checkoutHash(merchantId: string, orderId: string, amount: number, currency: string, secret: string) {
  return md5(merchantId + orderId + payhereAmount(amount) + currency + md5(secret));
}

/** md5sig = MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + MD5(secret)) */
export function verifyNotify(f: Record<string, string>, secret: string) {
  const expected = md5((f.merchant_id ?? '') + (f.order_id ?? '') + (f.payhere_amount ?? '') + (f.payhere_currency ?? '') + (f.status_code ?? '') + md5(secret));
  return expected === (f.md5sig ?? '').toUpperCase();
}
