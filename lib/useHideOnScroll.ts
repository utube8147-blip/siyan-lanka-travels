'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/** true while the user is scrolling down (past `offset`), false when scrolling up or near the top. */
export function useHideOnScroll(offset = 64) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const pathname = usePathname();
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const d = y - lastY.current;
        if (y < offset) setHidden(false);
        else if (d > 6) setHidden(true);
        else if (d < -6) setHidden(false);
        lastY.current = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [offset]);
  useEffect(() => setHidden(false), [pathname]);
  return hidden;
}
