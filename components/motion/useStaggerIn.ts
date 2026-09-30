'use client';
// Cascade a list in: add `ref={useStaggerIn()}` to any list container and its
// children slide up + fade in one after another, once, when they first appear.
// Skipped for people who prefer reduced motion.

import { animate, stagger, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';

export function useStaggerIn<T extends HTMLElement>(ready: boolean = true) {
  const ref = useRef<T>(null);
  const reduce = useReducedMotion();
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || reduce || done.current || el.children.length === 0) return;
    done.current = true;
    const items = Array.from(el.children) as HTMLElement[];
    animate(items, { opacity: [0, 1], y: [16, 0] }, { delay: stagger(0.055), type: 'spring', stiffness: 360, damping: 30 });
  }, [ready, reduce]);
  return ref;
}
