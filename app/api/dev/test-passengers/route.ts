// Local testing only (NEXT_PUBLIC_MOCK_VERIFICATION=true, on your computer):
// adds / deletes test passengers on a departure so the conductor app can be
// tried with a full bus. Office staff only. Test bookings are marked
// (bookings.is_test) and only those can be deleted here.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { serverMockOn } from '@/lib/mockVerification';
import type { Booking } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!serverMockOn(req.headers.get('host'))) return NextResponse.json({ error: 'Test passengers work only in test mode on your computer (NEXT_PUBLIC_MOCK_VERIFICATION=true).' }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = adminClient();
  if (!url || !key || !db) return NextResponse.json({ error: 'Needs the Supabase keys and SUPABASE_SECRET_KEY in .env.local.' }, { status: 503 });
  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const { data: prof } = await db.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  if (!['staff', 'admin'].includes(String(prof?.role))) return NextResponse.json({ error: 'Office staff only.' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; bookings?: Booking[]; ids?: string[] };
  if (body.action === 'delete') {
    const ids = (body.ids ?? []).filter((x) => typeof x === 'string');
    if (!ids.length) return NextResponse.json({ ok: true });
    const { error } = await db.from('bookings').delete().in('id', ids).eq('is_test', true);
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true });
  }
  if (body.action === 'add') {
    const rows = (body.bookings ?? []).slice(0, 60).map((b) => ({
      ref: b.ref,
      schedule_id: b.scheduleId,
      travel_date: b.date,
      from_stop: b.from,
      to_stop: b.to,
      seats: b.seats,
      passenger_name: b.passenger.name,
      passenger_gender: b.passenger.gender || null,
      passenger_phone: b.passenger.phone,
      contact_phone: b.contact.phone || b.passenger.phone,
      channel: 'counter',
      fare: b.fare,
      fee: 0,
      discount: 0,
      total: b.total,
      status: b.status,
      payment_method: b.paymentMethod,
      payment_status: b.paymentStatus,
      is_test: true,
    }));
    const { error } = await db.from('bookings').insert(rows);
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ ok: true, added: rows.length });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
