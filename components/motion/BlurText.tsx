'use client';
// Adapted from React Bits "BlurText" (MIT + Commons Clause, © David Haz) —
// see components/motion/README.md. Words fade in from a soft blur, one after
// another. Renders as any element (e.g. h1) and is announced as one phrase.

import { motion, useReducedMotion } from 'motion/react';
import { createElement, type ElementType } from 'react';

type Props = {
  text: string;
  as?: ElementType;
  className?: string;
  /** ms between words */
  delay?: number;
  stepDuration?: number;
};

export default function BlurText({ text, as = 'p', className = '', delay = 70, stepDuration = 0.32 }: Props) {
  const reduce = useReducedMotion();
  const words = text.split(' ');
  return createElement(
    as,
    { className, 'aria-label': text },
    words.map((w, i) => (
      <motion.span
        key={`${w}-${i}`}
        aria-hidden
        className="inline-block will-change-[transform,filter,opacity]"
        initial={reduce ? false : { filter: 'blur(10px)', opacity: 0, y: 14 }}
        animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
        transition={{ duration: stepDuration * 2, delay: (i * delay) / 1000, ease: [0.22, 1, 0.36, 1] }}
      >
        {w}
        {i < words.length - 1 && '\u00A0'}
      </motion.span>
    )),
  );
}
