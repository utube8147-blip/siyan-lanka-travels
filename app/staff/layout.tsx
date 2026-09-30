import type { Metadata } from 'next';

// Staff area entrance. Not linked from the customer site; share the link
// (https://your-domain/staff/login) with staff directly.
export const metadata: Metadata = {
  title: 'Staff sign-in',
  robots: { index: false, follow: false, nocache: true },
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
