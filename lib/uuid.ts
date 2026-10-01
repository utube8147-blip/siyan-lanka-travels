// UUID v4 for database ids and file names. Uses crypto.randomUUID where the
// browser offers it (https / localhost) and a getRandomValues fallback
// elsewhere (e.g. testing on a phone at http://192.168.x.x:3000).
export function uuid(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch {
      /* not a secure context; fall through */
    }
  }
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Keep a real UUID; replace anything else (e.g. an old "exp-…" demo id) with a new one. */
export const asUuid = (s: string) => (isUuid(s) ? s : uuid());
