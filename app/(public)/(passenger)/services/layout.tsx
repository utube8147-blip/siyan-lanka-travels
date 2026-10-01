import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Send a parcel or hire a bus',
  description: 'Send parcels on our Colombo ⇄ Batticaloa, Kalmunai and Akkaraipattu night bus, or hire a luxury AC coach for weddings, trips and events.',
  alternates: { canonical: '/services' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
