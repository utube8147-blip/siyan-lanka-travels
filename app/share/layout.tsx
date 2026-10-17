import type { Metadata } from 'next';

// Shared route plans are private links: keep them out of search engines.
export const metadata: Metadata = {
  title: 'Shared route',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
