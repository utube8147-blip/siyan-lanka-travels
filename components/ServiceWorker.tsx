'use client';
// Registers the service worker (production only, so it never caches your
// dev server) and remembers the browser's "install app" prompt so the
// Install button can show it later.

import { useEffect } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global {
  interface Window {
    __installPrompt?: InstallEvent | null;
  }
}

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline support is a bonus; ignore failures */
      });
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__installPrompt = e as InstallEvent;
      window.dispatchEvent(new Event('installable'));
    };
    const onInstalled = () => {
      window.__installPrompt = null;
      window.dispatchEvent(new Event('installable'));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}
