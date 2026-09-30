// app/(public)/(passenger)/layout.tsx
import React from 'react';
import { AppLayout } from '@/components/AppLayout';

export default function PassengerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Passenger layout can add any passenger-specific wrapper here
  // Currently just renders children - inherits public layout from parent
  return <>
     <AppLayout>
      {children}
    </AppLayout>
  </>;
}
