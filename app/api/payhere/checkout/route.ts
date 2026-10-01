// Starts a PayHere payment for the signed-in passenger's held booking.
// Returns the form fields; the browser posts them to PayHere.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { OPERATOR } from '@/config/operator';
import { checkoutHash, payhereAmount, payhereConfig } from '@/lib/server/payhere';

export async function POST(req: NextRequest) {
  const cfg = payhereConfig();
  if (!cfg) return NextResponse.json({ error: 'PayHere is not set up yet.' }, { status: 503 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  const sb = createServerClient(url, key, { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } });
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });

  const { bookingId } = (await req.json().catch(() => ({}))) as { bookingId?: string };
  // Row-level security: the passenger can only read their own booking.
  const { data: b } = await sb.from('bookings').select('*').eq('id', bookingId ?? '').maybeSingle();
  if (!b || b.user_id !== u.user.id) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (b.payment_status !== 'unpaid' || b.status !== 'held') return NextResponse.json({ error: 'This booking is not waiting for payment.' }, { status: 409 });

  const site = OPERATOR.siteUrl;
  const origin = req.nextUrl.origin;
  const [first, ...rest] = (b.passenger_name || 'Passenger').split(' ');
  const fields = {
    merchant_id: cfg.merchantId,
    return_url: `${origin}/my-bookings?paid=${b.ref}`,
    cancel_url: `${origin}/my-bookings?unpaid=${b.ref}`,
    notify_url: `${process.env.PAYHERE_NOTIFY_BASE || site}/api/payhere/notify`,
    order_id: b.ref,
    items: `Bus ticket ${b.from_stop} to ${b.to_stop} (${(b.seats as string[]).join(', ')})`,
    currency: 'LKR',
    amount: payhereAmount(b.total),
    first_name: first,
    last_name: rest.join(' ') || '-',
    email: b.contact_email || u.user.email || '',
    phone: b.contact_phone || b.passenger_phone || '',
    address: 'N/A',
    city: b.from_stop,
    country: 'Sri Lanka',
    hash: checkoutHash(cfg.merchantId, b.ref, b.total, 'LKR', cfg.secret),
  };
  return NextResponse.json({ action: cfg.action, fields });
}
