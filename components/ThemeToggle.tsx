'use client';
// components/ThemeToggle.tsx — light/dark switch. The choice is saved in this
// browser; until someone picks, the site follows the device setting.
// The inline script in app/layout.tsx applies it before the first paint so
// there's no white flash.

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export const THEME_KEY = 'theme';

/** Runs in <head> before React loads. Keep it tiny and dependency-free. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function ThemeToggle({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    // Follow the device setting live, unless the visitor picked one.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(THEME_KEY)) return;
      } catch {
        /* ignore */
      }
      document.documentElement.classList.toggle('dark', e.matches);
      setDark(e.matches);
    };
    mq.addEventListener('change', onChange);
    const sync = () => setDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('themechange', sync);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('themechange', sync);
    };
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    setDark(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${onDark ? 'text-white/80 hover:text-white hover:bg-white/10' : 'text-[#46464f] hover:text-[#050a44] hover:bg-[#f2f4f6]'} ${className}`}
    >
      {dark === null ? <span className="w-5 h-5" /> : dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}

export type ThemeChoice = 'light' | 'dark' | 'system';

export function applyTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* ignore */
  }
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  window.dispatchEvent(new Event('themechange'));
}

/** Light / Dark / System picker (Profile screen). */
export function ThemeSegmented() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      setChoice(t === 'light' || t === 'dark' ? t : 'system');
    } catch {
      setChoice('system');
    }
  }, []);
  const opts: { v: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { v: 'light', label: 'Light', Icon: Sun },
    { v: 'dark', label: 'Dark', Icon: Moon },
    { v: 'system', label: 'Auto', Icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#f2f4f6]">
      {opts.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={choice === v}
          onClick={() => {
            applyTheme(v);
            setChoice(v);
          }}
          className={`flex items-center justify-center gap-1.5 h-9 rounded-lg text-[13px] font-semibold transition-colors ${
            choice === v ? 'bg-white text-[#050a44] shadow-sm' : 'text-[#46464f]'
          }`}
        >
          <Icon className="w-4 h-4" /> {label}
        </button>
      ))}
    </div>
  );
}
