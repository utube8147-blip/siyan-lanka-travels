'use client';
import { AuthProvider } from '../contexts/AuthContext';
import { StoreProvider } from '../lib/store';
import { MotionProvider } from './motion/MotionProvider';
import { LanguageProvider } from '../lib/i18n';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <StoreProvider>
        <MotionProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </MotionProvider>
      </StoreProvider>
    </AuthProvider>
  );
}
