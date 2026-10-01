import type { Metadata, Viewport } from 'next';

// Phone-first page for conductors (also usable by office staff).
// Not linked from the customer site; open via /staff/login.
export const metadata: Metadata = { title: 'Conductor', robots: { index: false, follow: false, nocache: true } };
export const viewport: Viewport = { themeColor: '#111216' };

export default function ConductorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
