'use client';
// Translated text inside a server-rendered page: <Tx k="Bus routes" />.
// (Client components call tx() directly.)
import { tx, useT } from '@/lib/i18n';

export function Tx({ k, v }: { k: string; v?: Record<string, string | number | null | undefined> }) {
  useT(); // redraw when the language changes
  return <>{tx(k, v)}</>;
}
