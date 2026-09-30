'use client';
// Re-mounts on every navigation, so each screen eases in like an app screen.
// Only opacity and a small lift; the transform clears when done so fixed
// elements (sheets, dialogs) inside pages still position correctly.
import { motion } from 'motion/react';

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
