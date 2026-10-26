// Local testing without real texts: NEXT_PUBLIC_MOCK_VERIFICATION=true in .env.local.
//
// With it on (and only on your own computer), every code check uses a fixed
// test code (NEXT_PUBLIC_MOCK_VERIFICATION_CODE, default 123456) and nothing is
// texted or sent on WhatsApp: messages are printed in the terminal running
// `npm run dev` and kept in a test outbox (/api/dev/outbox). It covers:
//   - passenger sign-in / sign-up by phone (signs you in to a real account in
//     your Supabase project, no SMS),
//   - the booking confirmation code,
//   - the owner's code for releasing a reserved seat,
//   - trip texts and WhatsApp messages from the message dispatcher.
// It switches itself off on Vercel and on any address other than localhost /
// your local network, so leaving the flag in a file can't open the live site.

export const MOCK_CODE = (process.env.NEXT_PUBLIC_MOCK_VERIFICATION_CODE || '123456').replace(/\D/g, '').slice(0, 6).padEnd(6, '0');

const flagOn = () => process.env.NEXT_PUBLIC_MOCK_VERIFICATION === 'true';

const localHost = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.local') || /^(192\.168|10)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);

/** In the browser: the flag is on and the page is on this computer / local network. */
export function mockVerificationOn(): boolean {
  if (!flagOn()) return false;
  if (typeof window === 'undefined') return serverMockOn();
  return localHost(window.location.hostname);
}

/** On the server: the flag is on and this isn't a hosted deployment. Pass the request's host when there is one. */
export function serverMockOn(host?: string | null): boolean {
  if (!flagOn()) return false;
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) return false;
  if (host) return localHost(host.split(':')[0].replace(/^\[|\]$/g, ''));
  return true;
}

export interface MockMessage {
  at: string;
  channel: 'sms' | 'whatsapp';
  to: string;
  body: string;
}

const g = globalThis as unknown as { __mockOutbox?: MockMessage[] };

/** Keeps a message instead of sending it (newest first, last 100). */
export function mockSend(channel: MockMessage['channel'], to: string, body: string) {
  const m = { at: new Date().toISOString(), channel, to, body };
  g.__mockOutbox = [m, ...(g.__mockOutbox ?? [])].slice(0, 100);
  console.info(`[mock ${channel}] to ${to}: ${body}`);
}

export const mockOutbox = () => g.__mockOutbox ?? [];

// ---- Mock payment gateway (NEXT_PUBLIC_MOCK_PAYMENTS=true in .env.local) ----
// Card / wallet payments go to a test page (/mock-gateway) where you choose
// "Payment succeeds" or "Payment fails", instead of PayHere. Same safety rule:
// only on your own computer, never on Vercel, never on a public address.
const paymentsFlag = () => process.env.NEXT_PUBLIC_MOCK_PAYMENTS === 'true';

export function mockPaymentsOn(): boolean {
  if (!paymentsFlag()) return false;
  if (typeof window === 'undefined') return serverMockPaymentsOn();
  return localHost(window.location.hostname);
}

export function serverMockPaymentsOn(host?: string | null): boolean {
  if (!paymentsFlag()) return false;
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) return false;
  if (host) return localHost(host.split(':')[0].replace(/^\[|\]$/g, ''));
  return true;
}
