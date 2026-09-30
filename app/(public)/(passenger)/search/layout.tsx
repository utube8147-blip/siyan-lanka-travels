import type { Metadata } from 'next';

// Page title/description for search engines and browser tabs.
export const metadata: Metadata = {
  title: 'Search buses and book seats',
  description: 'Find overnight AC coach departures between Colombo and Batticaloa, Kalmunai, Akkaraipattu and towns on the way. See seats left and book online.',
  alternates: { canonical: '/search' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
