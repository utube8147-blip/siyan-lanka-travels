// The translation functions, usable anywhere: client components, shared lib
// code and server components (on the server the language is always English;
// the browser redraws in the chosen language). The language picker and
// provider are in lib/i18n.tsx. See that file for how translations work.
import { Fragment } from 'react';

export type Lang = 'en' | 'ta' | 'si';

type Pack = Record<string, string>;
// The language in use right now (always English on the server).
let current: Lang = 'en';
let pack: Pack | null = null;

function fill(s: string, vars?: Record<string, string | number | null | undefined>) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}

/** The text in the current language (or the English when there's no translation). */
export function tx(s: string, vars?: Record<string, string | number | null | undefined>): string {
  if (typeof s !== 'string') return s; // a lookup that found nothing: keep `?? fallback` working
  const hit = current !== 'en' && pack ? pack[s] : undefined;
  return fill(hit || s, vars);
}

type Rich = React.ReactNode | ((children: React.ReactNode) => React.ReactNode);
/**
 * A sentence with parts in bold, links or icons, translated as one piece:
 *   txr('Tap {icon} <b>Share</b> in the toolbar', { icon: <ShareIcon />, b: (c) => <strong>{c}</strong> })
 * {name} is replaced by a value; <name>…</name> wraps the words in between.
 */
export function txr(s: string, parts: Record<string, Rich> = {}): React.ReactNode {
  const text = current !== 'en' && pack && pack[s] ? pack[s] : s;
  const out: React.ReactNode[] = [];
  const re = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[1] ?? m[3];
    const part = parts[name];
    if (m[1] !== undefined) {
      // Text inside a tag can hold placeholders too: <a>{email}</a>.
      const inner = m[2].replace(/\{(\w+)\}/g, (x, k) => (typeof parts[k] === 'string' || typeof parts[k] === 'number' ? String(parts[k]) : x));
      out.push(<Fragment key={i++}>{typeof part === 'function' ? part(inner) : inner}</Fragment>);
    }
    else out.push(<Fragment key={i++}>{typeof part === 'function' ? part(null) : part === undefined ? m[0] : part}</Fragment>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * A count with the right word for one and for many, translated:
 *   txn(n, '{n} seat', '{n} seats')   → "1 seat" / "3 seats"
 */
export function txn(n: number, one: string, other: string, vars?: Record<string, string | number | null | undefined>): string {
  return tx(n === 1 ? one : other, { n, ...vars });
}

/** Marks English text kept in a constant, so the translation checker sees it. Returns it unchanged. */
export const N_ = (s: string) => s;

/** The language in use (for code outside React). */
export const currentLang = () => current;

// Messages that arrive with values already filled in (errors from the
// database, e.g. "Seat 3A does not exist on this bus.") are matched against
// the keys that have {placeholders}.
let patterns: { re: RegExp; key: string; names: string[] }[] | null = null;
function buildPatterns() {
  patterns = [];
  if (!pack) return;
  for (const key of Object.keys(pack)) {
    if (!key.includes('{')) continue;
    const names: string[] = [];
    const src = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, name) => {
      names.push(name);
      return '(.+?)';
    });
    try {
      patterns.push({ re: new RegExp(`^${src}$`), key, names });
    } catch {
      /* not a usable pattern */
    }
  }
}
/** Translates a message that may already contain values ("Seat 3A is taken"). */
export function txMessage(message: string): string {
  if (current === 'en' || !pack || !message) return message;
  if (pack[message]) return pack[message];
  if (!patterns) buildPatterns();
  for (const p of patterns!) {
    const m = message.match(p.re);
    if (m) return tx(p.key, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]])));
  }
  return message;
}

/** Used by the language provider (lib/i18n.tsx). */
export function setLanguagePack(l: Lang, p: Pack | null) {
  current = l;
  pack = p;
  patterns = null;
}
