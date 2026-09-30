'use client';
// Registers the service worker and remembers Chrome's install prompt so our
// Install buttons can show it. In development the worker is registered with
// ?dev=1, which switches its caching off (so it never serves stale dev files)
// but keeps install and notifications working for testing.

import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const url = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1';
      navigator.serviceWorker.register(url).catch(() => {
        /* offline support is a bonus; ignore failures */
      });
    }
    const onPrompt = (e: Event) => {
      // Stop Chrome's mini-infobar; we show our own button/banner instead.
      e.preventDefault();
      window.__installPrompt = e as typeof window.__installPrompt;
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
