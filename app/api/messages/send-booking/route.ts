// Sends one booking's queued messages now (the booking text with the ticket
// and tracking links, the ticket email, a payment receipt…), so the passenger
// has them seconds after booking and not up to a minute later. The cron on
// /api/messages/dispatch still sends everything else and anything this missed.
// Called by the app right after a booking is made or paid. Only the booking's
// own passenger, whoever made it, or staff may ask.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { adminClient } from '@/lib/server/admin';
import { deliverQueued } from '@/lib/server/dispatch';
import { pushPendingNotifications } from '@/lib/server/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = adminClient();
  if (!url || !key || !db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const { bookingId } = (await req.json().catch(() => ({}))) as { bookingId?: string };
  if (!bookingId || !/^[0-9a-f-]{36}$/i.test(bookingId)) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const [{ data: booking }, { data: me }] = await Promise.all([
    db.from('bookings').select('id, user_id, created_by').eq('id', bookingId).maybeSingle(),
    db.from('profiles').select('role').eq('id', u.user.id).maybeSingle(),
  ]);
  if (!booking) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const staff = ['conductor', 'staff', 'admin'].includes(me?.role ?? '');
  if (!staff && booking.user_id !== u.user.id && booking.created_by !== u.user.id) return NextResponse.json({ error: 'not allowed' }, { status: 403 });

  const { data: batch, error } = await db.from('message_queue').select('*').eq('booking_id', bookingId).eq('status', 'pending').order('created_at').limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = await deliverQueued(db, batch ?? []);
  // …and the push that goes with it ("Booking confirmed", "Payment received").
  const push = await pushPendingNotifications(db).catch((e) => ({ error: String(e).slice(0, 200) }));
  return NextResponse.json({ processed: batch?.length ?? 0, ...results, push });
}
