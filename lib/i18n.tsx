'use client';
// lib/i18n.tsx — English, Tamil (தமிழ்) and Sinhala (සිංහල) for the whole app.
//
//   tx('Buses from {from} to {to}', { from, to })
//
// returns the text in the language the visitor picked (English is the key).
// It can be called anywhere: in components, in event handlers and in lib
// code. When the language changes, the page is redrawn in the new language.
//
// Where the words live:
//   i18n/messages/*.mjs   English → [Tamil, Sinhala]  (edit these)
//   lib/i18n-ta.ts, lib/i18n-si.ts  made from them by `npm run i18n`
//   `npm run i18n:check`  fails if any text in the app has no translation
// Each language pack is downloaded only when someone picks that language.
//
// Text kept in a constant outside a component (a list of labels, say) is
// marked with N_('…') so the checker finds it, and translated where it is
// shown: tx(LABELS[x]).
// Server-rendered pages use <Tx k="…" /> (components/Tx.tsx).

import { Fragment, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { setDateLocale } from './trips';
import { setLanguagePack, tx, type Lang } from './i18n-core';

export { tx, txn, txr, txMessage, N_, currentLang, type Lang } from './i18n-core';

type Pack = Record<string, string>;
const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<Pack>> = {
  ta: () => import('./i18n-ta').then((m) => m.default),
  si: () => import('./i18n-si').then((m) => m.default),
};
export const LANGS: { id: Lang; label: string; short: string; locale: string }[] = [
  { id: 'en', label: 'English', short: 'EN', locale: 'en-GB' },
  { id: 'ta', label: 'தமிழ்', short: 'த', locale: 'ta-LK' },
  { id: 'si', label: 'සිංහල', short: 'සි', locale: 'si-LK' },
];

const KEY = 'lang';

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: typeof tx };
const LangContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: tx });

/** The staff area (/admin) is English only, whatever language is picked elsewhere. */
const englishOnly = (path: string | null) => !!path && (path === '/admin' || path.startsWith('/admin/'));

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [lang, setLangState] = useState<Lang>('en'); // what is on screen
  const [chosen, setChosen] = useState<Lang>('en'); // what the visitor picked
  const apply = useCallback(async (l: Lang) => {
    let next: Pack | null = null;
    if (l !== 'en') {
      try {
        next = await LOADERS[l]();
      } catch {
        return; // offline and never downloaded: stay as we are
      }
    }
    setLanguagePack(l, next);
    const meta = LANGS.find((x) => x.id === l)!;
    document.documentElement.lang = l;
    document.documentElement.dataset.lang = l;
    setDateLocale(meta.locale);
    setLangState(l);
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      if (saved && LANGS.some((x) => x.id === saved)) setChosen(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const want: Lang = englishOnly(pathname) ? 'en' : chosen;
  useEffect(() => {
    if (want !== lang) apply(want);
  }, [want, lang, apply]);
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
      document.cookie = `${KEY}=${l}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
    } catch {
      /* ignore */
    }
    setChosen(l);
  }, []);
  // Text is worked out while drawing, so a new language redraws the page.
  return (
    <LangContext.Provider value={{ lang, setLang, t: tx }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  );
}

export const useT = () => useContext(LangContext);

/** Compact EN / த / සි switcher. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <div role="radiogroup" aria-label={tx('Language')} className={`inline-flex rounded-full bg-[#f2f4f6] p-0.5 ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={lang === l.id}
          title={l.label}
          lang={l.id}
          onClick={() => setLang(l.id)}
          className={`min-w-8 h-8 px-2 rounded-full text-[13px] font-semibold transition-colors ${lang === l.id ? 'bg-[#050a44] text-white' : 'text-[#46464f] hover:text-[#050a44]'}`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
