// Texts the booking code. Whoever is signed in (email or phone account) asks
// for a 6-digit code on the mobile number they are booking with; the code is
// made and stored by the database and sent here, so it never reaches the
// browser.
//
// Testing without real texts: set BOOKING_OTP_TEST_CODE=123456 (server .env).
// No text is sent and that code works for every number. NEVER set it on the
// live site: anyone could then confirm a booking on any number.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { sendSms } from '@/lib/server/messaging';

export const runtime = 'nodejs';

const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '');

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = adminClient();
  if (!url || !key) return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  if (!db) return NextResponse.json({ error: "We can't send codes right now (the server key is not set)." }, { status: 503 });

  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const { phone } = (await req.json().catch(() => ({}))) as { phone?: string };
  // The database checks the number, the rate limits, and creates the code.
  const { data: id, error } = await sb.rpc('request_booking_code', { p_phone: phone ?? '' });
  if (error || !id) return NextResponse.json({ error: clean(error?.message ?? 'Could not create the code.') }, { status: 400 });

  const { data: row } = await db.from('booking_codes').select('code, phone').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Could not read the code.' }, { status: 500 });
  const masked = `0${row.phone.slice(2, 4)} ••• •${row.phone.slice(-3)}`;

  const testCode = (process.env.BOOKING_OTP_TEST_CODE ?? '').trim();
  if (/^\d{6}$/.test(testCode)) {
    await db.from('booking_codes').update({ code: testCode }).eq('id', id);
    return NextResponse.json({ id, sentTo: masked, test: true });
  }

  const sent = await sendSms(`+${row.phone}`, `Siyan Lanka: ${row.code} is your code to confirm your booking. It works for 10 minutes. Don't share it.`);
  if (sent.status !== 'sent') {
    await db.from('booking_codes').delete().eq('id', id); // nothing went out: let them try again straight away
    return NextResponse.json({ error: "We couldn't send the text just now. Try again in a minute." }, { status: 502 });
  }
  return NextResponse.json({ id, sentTo: masked });
}
