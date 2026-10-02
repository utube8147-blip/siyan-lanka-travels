// Starts a PayHere payment for the signed-in passenger's held booking, or for
// a resale ticket they have reserved ({ resaleOrder }).
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

  const { bookingId, resaleOrder } = (await req.json().catch(() => ({}))) as { bookingId?: string; resaleOrder?: string };
  const origin = req.nextUrl.origin;
  const notifyUrl = `${process.env.PAYHERE_NOTIFY_BASE || OPERATOR.siteUrl}/api/payhere/notify`;

  if (resaleOrder) {
    // Row-level security: a buyer can only read their own resale orders.
    const { data: o } = await sb.from('resale_orders').select('*').eq('order_ref', resaleOrder).maybeSingle();
    if (!o || o.buyer_id !== u.user.id) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if (o.status !== 'pending' || new Date(o.expires_at).getTime() < Date.now())
      return NextResponse.json({ error: 'That reservation has run out. Go back and try again.' }, { status: 409 });
    const [first, ...rest] = String(o.passenger?.name || 'Passenger').split(' ');
    return NextResponse.json({
      action: cfg.action,
      fields: {
        merchant_id: cfg.merchantId,
        return_url: `${origin}/my-bookings?paid=${o.order_ref}`,
        cancel_url: `${origin}/marketplace?unpaid=${o.order_ref}`,
        notify_url: notifyUrl,
        order_id: o.order_ref,
        items: 'Resale bus ticket',
        currency: 'LKR',
        amount: payhereAmount(o.amount),
        first_name: first,
        last_name: rest.join(' ') || '-',
        email: o.contact?.email || u.user.email || '',
        phone: o.contact?.phone || o.passenger?.phone || '',
        address: 'N/A',
        city: 'Colombo',
        country: 'Sri Lanka',
        hash: checkoutHash(cfg.merchantId, o.order_ref, o.amount, 'LKR', cfg.secret),
      },
    });
  }
  // Row-level security: the passenger can only read their own booking.
  const { data: b } = await sb.from('bookings').select('*').eq('id', bookingId ?? '').maybeSingle();
  if (!b || b.user_id !== u.user.id) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 });
  if (b.payment_status !== 'unpaid' || b.status !== 'held') return NextResponse.json({ error: 'This booking is not waiting for payment.' }, { status: 409 });

  const [first, ...rest] = (b.passenger_name || 'Passenger').split(' ');
  const fields = {
    merchant_id: cfg.merchantId,
    return_url: `${origin}/my-bookings?paid=${b.ref}`,
    cancel_url: `${origin}/my-bookings?unpaid=${b.ref}`,
    notify_url: notifyUrl,
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
