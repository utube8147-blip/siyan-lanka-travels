'use client';
// Shows a small notice when the connection drops, and "Back online" briefly
// when it returns. Saved tickets keep working offline.

import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [state, setState] = useState<'online' | 'offline' | 'back'>('online');
  useEffect(() => {
    if (!navigator.onLine) setState('offline');
    let t: ReturnType<typeof setTimeout>;
    const off = () => setState('offline');
    const on = () => {
      setState('back');
      t = setTimeout(() => setState('online'), 2500);
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => {
      window.removeEventListener('offline', off);
      window.removeEventListener('online', on);
      clearTimeout(t);
    };
  }, []);
  if (state === 'online') return null;
  return (
    <div
      role="status"
      className={`fixed z-[70] left-1/2 -translate-x-1/2 top-[calc(env(safe-area-inset-top)+64px)] md:top-24 px-4 py-2 rounded-full text-[13px] font-semibold shadow-lg flex items-center gap-2 ${
        state === 'offline' ? 'bg-[#1f2026] text-white' : 'bg-[#006e1c] text-white'
      }`}
    >
      {state === 'offline' ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
      {state === 'offline' ? "You're offline. Saved tickets still work." : 'Back online'}
    </div>
  );
}
