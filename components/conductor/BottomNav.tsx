'use client';
// The conductor app's bottom bar: Board · Cash · Map. Same capsule as the
// passenger app's tab bar, in the conductor app's dark colours, always shown
// (phones and desktop alike: the conductor app is one column).

import { motion } from 'motion/react';
import { Banknote, Map as MapIcon, ScanLine } from 'lucide-react';
import { tx } from '@/lib/i18n';

export type ConductorTab = 'board' | 'cash' | 'map';

export function BottomNav({ tab, onTab, waiting, unpaid }: { tab: ConductorTab; onTab: (t: ConductorTab) => void; waiting: number; unpaid: number }) {
  const items: { id: ConductorTab; label: string; Icon: typeof ScanLine; badge: number }[] = [
    { id: 'board', label: tx('Board'), Icon: ScanLine, badge: waiting },
    { id: 'cash', label: tx('Cash'), Icon: Banknote, badge: unpaid },
    { id: 'map', label: tx('Map'), Icon: MapIcon, badge: 0 },
  ];
  return (
    <div className="fixed inset-x-0 z-40 px-3 flex justify-center pointer-events-none bottom-[calc(env(safe-area-inset-bottom)+10px)]">
      <nav aria-label={tx('Conductor')} className="pointer-events-auto w-full max-w-[420px] rounded-full bg-[#1c1d22]/95 backdrop-blur border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.6)] p-1.5 select-none">
        <ul className="grid grid-cols-3 gap-1 h-[62px]" role="tablist">
          {items.map(({ id, label, Icon, badge }) => {
            const active = tab === id;
            return (
              <li key={id} className="relative">
                <button role="tab" aria-selected={active} onClick={() => onTab(id)} className="relative w-full h-full flex flex-col items-center justify-center gap-1 rounded-full">
                  {active && <motion.span layoutId="conductor-tab-pill" className="absolute inset-0 rounded-full bg-white/[0.12]" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
                  <motion.span whileTap={{ scale: 0.88 }} className="relative flex items-center justify-center">
                    <Icon className={`w-6 h-6 ${active ? 'text-[#feb700]' : 'text-white/60'}`} strokeWidth={active ? 2.3 : 1.8} />
                    {badge > 0 && (
                      <span className={`absolute -top-1.5 -right-3 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center ${id === 'cash' ? 'bg-[#feb700] text-[#14120a]' : 'bg-white text-[#0d0e11]'}`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </motion.span>
                  <span className={`relative text-[11px] leading-none ${active ? 'font-bold text-white' : 'font-medium text-white/60'}`}>{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
