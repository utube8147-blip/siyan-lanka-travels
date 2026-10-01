'use client';
/** Send the passenger to PayHere for a held booking. Returns an error message, or never returns (redirects). */
export async function startPayhere(bookingId: string): Promise<string | null> {
  const res = await fetch('/api/payhere/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }) });
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
