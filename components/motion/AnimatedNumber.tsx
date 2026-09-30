'use client';
// Adapted from React Bits "CountUp" (MIT + Commons Clause, © David Haz) —
// see components/motion/README.md. Differences: the real value is in the
// server HTML, it counts when first seen, and it re-animates whenever the
// value changes (e.g. a seat gets booked, or the total goes up).

import { useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { useEffect, useRef } from 'react';

type Props = {
  value: number;
  /** Turn the number into text, e.g. formatLKR. */
  format?: (n: number) => string;
  className?: string;
  /** Start counting from this on first view (default 0). */
  from?: number;
  duration?: number;
};

export default function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-LK'), className = '', from = 0, duration = 0.9 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const mv = useMotionValue(from);
  const spring = useSpring(mv, { damping: 20 + 40 / duration, stiffness: 100 / duration });
  const inView = useInView(ref, { once: true });
  const started = useRef(false);

  useEffect(() => {
    if (reduce) {
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    if (!inView) return;
    if (!started.current && ref.current) ref.current.textContent = format(from);
    started.current = true;
    mv.set(value);
  }, [inView, value, reduce, mv, from, format]);

  useEffect(() => spring.on('change', (v) => ref.current && (ref.current.textContent = format(v))), [spring, format]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {format(value)}
    </span>
  );
}
