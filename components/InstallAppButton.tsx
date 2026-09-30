'use client';
// "Install the app" button. Android/desktop Chrome & Edge: opens the browser's
// install prompt. iPhone Safari (no prompt API): shows how to add it by hand.
// Hidden when already installed or not installable.

import { useEffect, useState } from 'react';
import { Download, Share } from 'lucide-react';

export function InstallAppButton({ className = '' }: { className?: string }) {
  const [canPrompt, setCanPrompt] = useState(false);
  const [ios, setIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone) return;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const update = () => setCanPrompt(!!window.__installPrompt);
    update();
    window.addEventListener('installable', update);
    return () => window.removeEventListener('installable', update);
  }, []);

  if (!canPrompt && !ios) return null;

  const install = async () => {
    if (ios) return setShowIosHelp((v) => !v);
    const p = window.__installPrompt;
    if (!p) return;
    await p.prompt();
    await p.userChoice;
    window.__installPrompt = null;
    setCanPrompt(false);
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#feb700] text-[#050a44] text-[14px] font-bold hover:brightness-105"
      >
        <Download className="w-4 h-4" /> Install the app
      </button>
      {showIosHelp && (
        <p className="mt-2 text-[13px] text-white/80 flex items-center gap-1.5 flex-wrap">
          Tap <Share className="w-4 h-4 inline" /> Share, then <strong>Add to Home Screen</strong>.
        </p>
      )}
    </div>
  );
}
