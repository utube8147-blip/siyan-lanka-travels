'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type Options = {
  /** Hide only after scrolling past this many px from the top. */
  offset?: number;
  /** If set, never hide within this many px of the page bottom (the nav's reserved space is there anyway). */
  showNearBottom?: number;
};

/** true while the user is scrolling down (past `offset`), false when scrolling up, near the top, or (optionally) near the bottom. */
export function useHideOnScroll(offsetOrOptions: number | Options = 64) {
  const { offset = 64, showNearBottom = 0 }: Options = typeof offsetOrOptions === 'number' ? { offset: offsetOrOptions } : offsetOrOptions;
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const pathname = usePathname();
  useEffect(() => {
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      const d = y - lastY.current;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const nearBottom = showNearBottom > 0 && max - y <= showNearBottom;
      if (y < offset || nearBottom) setHidden(false);
      else if (d > 6) setHidden(true);
      else if (d < -6) setHidden(false);
      lastY.current = y;
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [offset, showNearBottom]);
  useEffect(() => setHidden(false), [pathname]);
  return hidden;
}