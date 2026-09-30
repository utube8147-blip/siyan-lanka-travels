'use client';
// Floating "Book a seat" button on phones, above the tab bar. Collapses to an
// icon while scrolling down so it doesn't cover content.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useHideOnScroll } from '@/lib/useHideOnScroll';
import { showFab } from './routes';

export function Fab() {
  const pathname = usePathname() || '/';
  const compact = useHideOnScroll(120);
  if (!showFab(pathname)) return null;
  return (
    <Link
      href="/search"
      aria-label="Book a seat"
      className={`md:hidden fixed z-40 right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] h-14 rounded-2xl bg-[#feb700] text-[#14120a] shadow-[0_10px_24px_-8px_rgba(0,0,0,0.45)] flex items-center justify-center gap-2 font-semibold text-[15px] transition-all duration-300 active:scale-95 ${
        compact ? 'w-14' : 'px-5'
      }`}
    >
      <Plus className="w-6 h-6 shrink-0" strokeWidth={2.4} />
      {!compact && <span>Book a seat</span>}
    </Link>
  );
}
