'use client';
import { MotionConfig } from 'motion/react';

/** Honour the device's "Reduce motion" setting for every animation. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
