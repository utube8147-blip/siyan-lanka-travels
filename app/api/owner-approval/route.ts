// Reserved seats: asks the owner to release one. A staff member calls this
// from the "Sell seats" window; the owner gets a 6-digit code by text on the
// number in OWNER_PHONE (.env, server only) and reads it to the staff member.
// The code itself never reaches the browser.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { sendSms } from '@/lib/server/messaging';

export const runtime = 'nodejs';

const clean = (m: string) => m.replace(/^[A-Z_]+:\s*/, '');

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const owner = (process.env.OWNER_PHONE ?? '').trim();
  const db = adminClient();
  if (!url || !key) return NextResponse.json({ error: 'The database is not configured.' }, { status: 503 });
  if (!owner) return NextResponse.json({ error: "The owner's number isn't set (OWNER_PHONE in .env)." }, { status: 503 });
  if (!db) return NextResponse.json({ error: 'SUPABASE_SECRET_KEY is not set, so the code cannot be sent.' }, { status: 503 });

  // The request is made as the signed-in staff member; the database checks they are staff.
  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { scheduleId?: string; date?: string; seats?: string[]; note?: string };
  if (!body.scheduleId || !body.date || !Array.isArray(body.seats) || body.seats.length === 0) return NextResponse.json({ error: 'Choose the seats first.' }, { status: 400 });

  const { data: id, error } = await sb.rpc('request_seat_approval', { p_schedule: body.scheduleId, p_date: body.date, p_seats: body.seats, p_note: body.note ?? '' });
  if (error || !id) return NextResponse.json({ error: clean(error?.message ?? 'Could not create the request.') }, { status: 400 });

  const [{ data: a }, { data: who }, { data: sch }] = await Promise.all([
    db.from('seat_approvals').select('code, seats, note').eq('id', id).maybeSingle(),
    db.from('profiles').select('full_name').eq('id', u.user.id).maybeSingle(),
    db.from('schedules').select('departure, routes(stops)').eq('id', body.scheduleId).maybeSingle(),
  ]);
  if (!a) return NextResponse.json({ error: 'Could not read the request.' }, { status: 500 });

  const day = new Date(`${body.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stops = ((sch as any)?.routes?.stops ?? []) as { name: string }[];
  const route = stops.length > 1 ? `${stops[0].name} to ${stops[stops.length - 1].name}` : '';
  const text =
    `Siyan Lanka: ${who?.full_name || 'Staff'} asks to sell reserved seat ${a.seats.join(', ')} on ${day} ${sch?.departure ?? ''}${route ? ` ${route}` : ''}` +
    `${a.note ? ` for ${a.note}` : ''}. If you agree, give them this code: ${a.code} (valid 10 minutes). If not, ignore this message.`;
  const sent = await sendSms(owner, text);
  if (sent.status !== 'sent') {
    // No text went out: cancel the request so staff can try again straight away.
    await db.from('seat_approvals').delete().eq('id', id);
    return NextResponse.json({ error: `The text to the owner didn't go out (${sent.error ?? sent.status}).` }, { status: 502 });
  }
  return NextResponse.json({ id, sentTo: owner.replace(/\d(?=\d{3})/g, '•') });
}
