// Where to send someone after signing in (?next=…). Only paths on this site:
// "/x" is fine; "//evil.com", "/\evil.com" and "https://…" are not (browsers
// read a leading "/\" as "//", i.e. another site).
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || next.length > 2000) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/** Reads ?next= from the current address (browser only). */
export function nextFromLocation(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return safeNext(new URLSearchParams(window.location.search).get('next'), fallback);
}
