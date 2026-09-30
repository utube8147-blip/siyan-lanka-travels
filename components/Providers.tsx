'use client';
import { AuthProvider } from '../contexts/AuthContext';
import { StoreProvider } from '../lib/store';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <StoreProvider>{children}</StoreProvider>
    </AuthProvider>
  );
}
