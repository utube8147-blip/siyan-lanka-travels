'use client';
/** Send the passenger to PayHere for a held booking. Returns an error message, or never returns (redirects). */
export async function startPayhere(bookingId: string): Promise<string | null> {
  return start({ bookingId });
}
/** Same, for a reserved resale ticket (see reserveResale in lib/resale.ts). */
export async function startPayhereResale(orderRef: string): Promise<string | null> {
  return start({ resaleOrder: orderRef });
}
async function start(body: { bookingId: string } | { resaleOrder: string }): Promise<string | null> {
  const res = await fetch('/api/payhere/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return j.error ?? 'Could not start the payment.';
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = j.action;
  Object.entries(j.fields as Record<string, string>).forEach(([k, v]) => {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    form.appendChild(i);
  });
  document.body.appendChild(form);
  form.submit();
  return null;
}
