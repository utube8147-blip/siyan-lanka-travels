'use client';
// Pull-to-refresh for the installed app. Browsers already have their own in
// a normal tab, so this only switches on in standalone (installed) mode.
// Refresh = reload saved data + re-fetch the page.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { useStore } from '@/lib/store';

const TRIGGER = 72;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { reload } = useStore();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (!standalone || !('ontouchstart' in window)) return;
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !busy ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const d = e.touches[0].clientY - start.current;
      setPull(d > 0 ? Math.min(120, d * 0.5) : 0);
    };
    const up = async () => {
      if (start.current === null) return;
      start.current = null;
      if (pull >= TRIGGER) {
        setBusy(true);
        setPull(TRIGGER);
        reload();
        router.refresh();
        await new Promise((r) => setTimeout(r, 700));
        setBusy(false);
      }
      setPull(0);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [pull, busy, reload, router]);

  return (
    <>
      <div
        aria-hidden={!busy}
        role={busy ? 'status' : undefined}
        className="md:hidden fixed left-1/2 z-50 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-lg border border-[#edeef0] flex items-center justify-center transition-opacity"
        style={{ top: `calc(env(safe-area-inset-top) + ${pull - 30}px)`, opacity: pull > 8 || busy ? 1 : 0 }}
      >
        <RotateCw className={`w-5 h-5 text-[#050a44] ${busy ? 'animate-spin' : ''}`} style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)` }} />
        {busy && <span className="sr-only">Refreshing</span>}
      </div>
      {children}
    </>
  );
}
