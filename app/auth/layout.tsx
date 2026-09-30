import type { Metadata } from 'next';

// Page title/description for search engines and browser tabs.
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
