import type { Metadata } from 'next';

// Page title/description for search engines and browser tabs.
export const metadata: Metadata = {
  title: 'Resale tickets',
  description: "Can't travel? Buy or sell Siyan Lanka Travels seats from other passengers.",
  alternates: { canonical: '/marketplace' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
