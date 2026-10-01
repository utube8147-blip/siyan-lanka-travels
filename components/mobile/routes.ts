// Screen titles, back targets and which chrome shows on phones.

/** Tab roots: no back arrow, tab bar visible. */
export const TAB_ROOTS = ['/', '/search', '/my-bookings', '/profile'];

/** Focused flows (checkout, sign-in): tab bar and floating button hidden. */
export const FOCUSED = ['/seats', '/payment', '/marketplace/buy', '/auth'];

/** Screens where "Book a seat" isn't already the main thing on screen. */
export const FAB_ROUTES = ['/my-bookings', '/profile', '/dashboard', '/marketplace', '/bus', '/legal', '/refund'];

const startsWith = (path: string, base: string) => path === base || path.startsWith(`${base}/`);
export const isFocused = (p: string) => FOCUSED.some((b) => startsWith(p, b));
export const showFab = (p: string) => FAB_ROUTES.some((b) => startsWith(p, b)) && !isFocused(p);

const cap = (s: string) => s.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');

export function screenTitle(path: string, params: URLSearchParams): string {
  if (path === '/search') {
    const f = params.get('from');
    const t = params.get('to');
    return f && t ? `${f} → ${t}` : 'Book a seat';
  }
  if (path.startsWith('/bus/')) {
    const [a, b] = path.slice(5).split('-to-');
    return b ? `${cap(a)} → ${cap(b)}` : 'Route';
  }
  const map: [string, string][] = [
    ['/seats', 'Passenger & seats'],
    ['/payment', 'Payment'],
    ['/my-bookings', 'My trips'],
    ['/dashboard', 'Account'],
    ['/marketplace/buy', 'Buy ticket'],
    ['/marketplace', 'Resale tickets'],
    ['/refund', 'Refund'],
    ['/profile', 'Profile'],
    ['/bus', 'Routes & timetables'],
    ['/legal', 'Terms & policies'],
    ['/services', 'Parcels & bus hire'],
    ['/track', 'Track my bus'],
  ];
  return map.find(([b]) => startsWith(path, b))?.[1] ?? '';
}

/** Where Back goes if there's no in-app history (e.g. opened from a link). */
export function parentOf(path: string) {
  const map: [string, string][] = [
    ['/seats', '/search'],
    ['/payment', '/search'],
    ['/marketplace/buy', '/marketplace'],
    ['/marketplace', '/profile'],
    ['/bus/', '/bus'],
    ['/bus', '/'],
    ['/dashboard', '/profile'],
    ['/legal', '/profile'],
    ['/services', '/profile'],
    ['/track', '/my-bookings'],
    ['/refund', '/my-bookings'],
  ];
  return map.find(([b]) => path.startsWith(b))?.[1] ?? '/';
}
