// Email sender for tickets (booking confirmed). Uses Resend's HTTP API
// (https://resend.com → API Keys), so there is nothing extra to install.
// Needs RESEND_API_KEY and EMAIL_FROM on the server; without them it returns
// 'skipped' so the queue still drains. To use another provider, change
// sendEmail() only.
import { OPERATOR } from '@/config/operator';
import type { SendResult } from './messaging';

export type TicketData = {
  ref?: string;
  name?: string;
  from?: string;
  to?: string;
  departs?: string;
  seats?: string;
  bus?: string;
  pay?: string;
  ticket_url?: string;
  track_url?: string;
  trips_url?: string;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Only our own https links go into a button. */
const safeUrl = (u?: string) => (u && /^https?:\/\//.test(u) ? esc(u) : '');

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { status: 'skipped', error: 'Email not configured (RESEND_API_KEY, EMAIL_FROM)' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}) }),
      cache: 'no-store',
    });
    if (res.ok) return { status: 'sent' };
    return { status: 'failed', error: (await res.text()).slice(0, 300) };
  } catch (e) {
    return { status: 'failed', error: String(e).slice(0, 300) };
  }
}

/** The ticket email. Tables and inline styles only: that is what mail apps support. */
export function ticketEmailHtml(d: TicketData) {
  const row = (label: string, value?: string) =>
    value
      ? `<tr><td style="padding:8px 0;color:#6b6d78;font-size:13px;width:38%;vertical-align:top">${label}</td><td style="padding:8px 0;color:#050a44;font-size:15px;font-weight:600">${esc(value)}</td></tr>`
      : '';
  const button = (label: string, url: string | undefined, primary: boolean) => {
    const href = safeUrl(url);
    if (!href) return '';
    const style = primary ? 'background:#feb700;color:#050a44' : 'background:#f2f4f6;color:#050a44';
    return `<tr><td style="padding:6px 0"><a href="${href}" style="display:block;text-align:center;padding:14px 16px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;${style}">${label}</a></td></tr>`;
  };
  const hotline = OPERATOR.contact.phone ? ` or call ${esc(OPERATOR.contact.phone)}` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your ticket ${esc(d.ref ?? '')}</title></head>
<body style="margin:0;background:#f2f4f6;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#050a44;padding:22px 24px;color:#ffffff">
  <div style="font-size:13px;color:#feb700;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${esc(OPERATOR.name)}</div>
  <div style="font-size:22px;font-weight:700;margin-top:6px">Booking confirmed</div>
  <div style="font-size:14px;margin-top:4px;color:#d6d8f0">Booking number <b style="color:#ffffff">${esc(d.ref ?? '')}</b></div>
</td></tr>
<tr><td style="padding:22px 24px 6px">
  <div style="font-size:15px;color:#46464f">${d.name ? `Hello ${esc(d.name)}, your` : 'Your'} seat is booked. Show the ticket to the conductor when you board.</div>
  <div style="font-size:22px;font-weight:700;color:#050a44;margin-top:18px">${esc(d.from ?? '')} to ${esc(d.to ?? '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px dashed #c7c5d1">
    ${row('Leaves', d.departs)}${row('Seat', d.seats)}${row('Bus', d.bus)}${row('Payment', d.pay)}
  </table>
</td></tr>
<tr><td style="padding:10px 24px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  ${button('Open my ticket', d.ticket_url, true)}${button('Track my bus', d.track_url, false)}${button('My trips', d.trips_url, false)}
</table></td></tr>
<tr><td style="padding:10px 24px 24px;font-size:13px;line-height:1.5;color:#6b6d78">
  Please be at the boarding point 20 minutes early. The tracking link shows the bus live on the day of travel.<br>
  Need help? Reply to this email${hotline}.
</td></tr>
</table></td></tr></table>
</body></html>`;
}
