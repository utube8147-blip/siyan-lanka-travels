'use client';
// components/ThemeToggle.tsx — light/dark switch. The choice is saved in this
// browser; until someone picks, the site follows the device setting.
// The inline script in app/layout.tsx applies it before the first paint so
// there's no white flash.

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_KEY = 'theme';

/** Runs in <head> before React loads. Keep it tiny and dependency-free. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function ThemeToggle({ className = '' }: { className?: string }) {
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
    return () => mq.removeEventListener('change', onChange);
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
      className={`w-10 h-10 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors ${className}`}
    >
      {dark === null ? <span className="w-5 h-5" /> : dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
