// Sri Lankan mobile numbers: accept 077 123 4567 / 77 123 4567 / +94 77 123 4567 / 0094…
export function toE164LK(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('0094')) d = d.slice(2);
  if (d.startsWith('94')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return /^7\d{8}$/.test(d) ? `+94${d}` : null;
}

/** +94771234567 → 077 123 4567 */
export function formatLK(e164: string) {
  const d = e164.replace(/^\+94/, '0');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : e164;
}
