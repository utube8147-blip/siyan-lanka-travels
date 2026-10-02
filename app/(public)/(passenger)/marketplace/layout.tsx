import type { Metadata } from 'next';
import { ResaleGate } from '@/components/ResaleGate';

export const metadata: Metadata = {
  title: 'Resale tickets',
  description: "Can't travel? Buy or sell Siyan Lanka Travels seats from other passengers.",
  alternates: { canonical: '/marketplace' },
  robots: { index: false },
};

// Staff area → Settings → Seat resale decides whether customers see this.
// ResaleGate reads the switch fresh on every visit; the database also refuses
// to list, reserve or buy while it's off.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ResaleGate>{children}</ResaleGate>;
}
