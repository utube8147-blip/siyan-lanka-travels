'use client';
// Booking-confirmed tick: circle pops in, then the check mark draws itself.
import { motion } from 'motion/react';

export function SuccessCheck({ size = 72 }: { size?: number }) {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      className="rounded-full bg-[#e8f6ea] flex items-center justify-center relative"
      style={{ width: size, height: size }}
    >
      <motion.span
        className="absolute inset-0 rounded-full border-2 border-[#006e1c]/30"
        initial={{ scale: 1, opacity: 0.8 }}
        animate={{ scale: 1.6, opacity: 0 }}
        transition={{ duration: 0.9, delay: 0.35, ease: 'easeOut' }}
        aria-hidden
      />
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" aria-hidden>
        <motion.path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="#006e1c"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.65, 0, 0.35, 1] }}
        />
      </svg>
    </motion.div>
  );
}
