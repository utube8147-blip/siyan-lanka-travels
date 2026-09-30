'use client';
import { AuthProvider } from '../contexts/AuthContext';
import { StoreProvider } from '../lib/store';
import { MotionProvider } from './motion/MotionProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <StoreProvider>
        <MotionProvider>{children}</MotionProvider>
      </StoreProvider>
    </AuthProvider>
  );
}
