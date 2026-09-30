'use client';
// Install buttons. Only rendered when the browser can actually install the
// app (Chrome/Edge/Samsung: native prompt; iPhone: Share → Add to Home Screen).
//   variant="footer" — gold button with text
//   variant="icon"   — round header icon
//   variant="menu"   — row in the account menu

import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { useInstall } from '@/lib/pwa';

export function IosInstallHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Install the app">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl p-6 shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-8 h-8 rounded-full hover:bg-[#f2f4f6] flex items-center justify-center">
          <X className="w-4 h-4 text-[#46464f]" />
        </button>
        <h2 className="text-[17px] font-bold text-[#050a44] mb-3">Add Siyan Lanka to your Home Screen</h2>
        <ol className="space-y-3 text-[14px] text-[#46464f]">
          <li className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#050a44] text-white text-[12px] font-bold flex items-center justify-center shrink-0">1</span>
            Tap <Share className="w-4 h-4 text-[#050a44]" /> <strong className="text-[#050a44]">Share</strong> in Safari&apos;s toolbar
          </li>
          <li className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#050a44] text-white text-[12px] font-bold flex items-center justify-center shrink-0">2</span>
            Choose <strong className="text-[#050a44]">Add to Home Screen</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#050a44] text-white text-[12px] font-bold flex items-center justify-center shrink-0">3</span>
            Tap <strong className="text-[#050a44]">Add</strong>
          </li>
        </ol>
      </div>
    </div>
  );
}

export function InstallAppButton({ variant = 'footer', className = '', onDone }: { variant?: 'footer' | 'icon' | 'menu'; className?: string; onDone?: () => void }) {
  const { mode, install } = useInstall();
  const [iosHelp, setIosHelp] = useState(false);
  if (!mode) return null;

  const go = async () => {
    const r = await install();
    if (r === 'ios') setIosHelp(true);
    onDone?.();
  };

  const button =
    variant === 'icon' ? (
      <button
        type="button"
        onClick={go}
        aria-label="Install the app"
        title="Install the app"
        className={`w-10 h-10 rounded-full flex items-center justify-center text-[#feb700] hover:bg-white/10 transition-colors ${className}`}
      >
        <Download className="w-5 h-5" />
      </button>
    ) : variant === 'menu' ? (
      <button type="button" onClick={go} className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#050a44] hover:bg-[#f2f4f6] transition-all ${className}`}>
        <Download className="w-4 h-4" /> Install the app
      </button>
    ) : (
      <button
        type="button"
        onClick={go}
        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#feb700] text-[#050a44] text-[14px] font-bold hover:brightness-105 ${className}`}
      >
        <Download className="w-4 h-4" /> Install the app
      </button>
    );

  return (
    <>
      {button}
      {iosHelp && <IosInstallHelp onClose={() => setIosHelp(false)} />}
    </>
  );
}
