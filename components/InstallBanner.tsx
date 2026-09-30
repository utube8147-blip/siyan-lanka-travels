'use client';
// Small "Install the app" card that slides up once the browser allows install.
// Waits a few seconds so it doesn't greet people on arrival; "Not now" hides it
// for 14 days. Sits above the phone tab bar.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useInstall } from '@/lib/pwa';
import { IosInstallHelp } from './InstallAppButton';

const KEY = 'install-banner-dismissed';
const SNOOZE_DAYS = 14;

export function InstallBanner() {
  const { mode, install } = useInstall();
  const [show, setShow] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    if (!mode) return setShow(false);
    try {
      const at = Number(localStorage.getItem(KEY) || 0);
      if (at && Date.now() - at < SNOOZE_DAYS * 86_400_000) return;
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setShow(true), 6000);
    return () => clearTimeout(t);
  }, [mode]);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  if (!show && !iosHelp) return null;
  return (
    <>
      {show && (
        <div
          role="dialog"
          aria-label="Install the app"
          className="fixed z-[60] left-3 right-3 bottom-[calc(80px+env(safe-area-inset-bottom))] md:bottom-6 md:left-auto md:right-6 md:w-[380px] bg-white rounded-2xl border border-[#e1e2e4] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] p-4 flex gap-3 items-center animate-[slideUp_.35s_ease-out]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="w-12 h-12 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold text-[#050a44]">Install Siyan Lanka</p>
            <p className="text-[12px] text-[#46464f] leading-snug">Open your tickets in one tap, even without signal.</p>
          </div>
          <button
            onClick={async () => {
              const r = await install();
              if (r === 'ios') setIosHelp(true);
              setShow(false);
            }}
            className="shrink-0 px-4 py-2 rounded-xl bg-[#feb700] text-[#050a44] text-[13px] font-bold hover:brightness-105"
          >
            Install
          </button>
          <button onClick={dismiss} aria-label="Not now" className="shrink-0 -mr-1 w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#f2f4f6]">
            <X className="w-4 h-4 text-[#46464f]" />
          </button>
        </div>
      )}
      {iosHelp && <IosInstallHelp onClose={() => setIosHelp(false)} />}
    </>
  );
}
