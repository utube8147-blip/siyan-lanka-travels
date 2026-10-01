// proxy.ts (Next.js 16's name for middleware)
// With Supabase connected this:
//  1. keeps the sign-in session fresh (Supabase stores it in cookies), and
//  2. turns away anyone who isn't staff before /admin even loads.
// The database's row-level security is the real lock; this is the front door.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { AUTH_COOKIE_MAX_AGE } from '@/lib/features';

/** Business pages: super admins only. */
const ADMIN_ONLY = ['/admin/finance', '/admin/fleet-health', '/admin/crew', '/admin/accounts', '/admin/settings'];

/** Pages that need a signed-in passenger (with Supabase connected). */
const SIGNED_IN_ONLY = ['/my-bookings', '/dashboard', '/payment', '/refund', '/marketplace/buy', '/track'];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // demo mode

  let response = NextResponse.next({ request });
  const sb = createServerClient(url, key, {
    cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await sb.auth.getUser();

  const path = request.nextUrl.pathname;
  const to = (dest: string) => {
    const r = NextResponse.redirect(new URL(dest, request.url));
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };
  const signIn = () => to(`/auth/login?next=${encodeURIComponent(path + request.nextUrl.search)}`);

  if (SIGNED_IN_ONLY.some((p) => path === p || path.startsWith(`${p}/`)) && !user) return signIn();
  // Signed in already? Skip the sign-in / sign-up pages.
  if (user && (path === '/auth/login' || path === '/auth/signup')) {
    const next = request.nextUrl.searchParams.get('next');
    return to(next && next.startsWith('/') && !next.startsWith('//') ? next : '/my-bookings');
  }

  if (path === '/staff/login') return response;

  // Phone-first conductor page: conductors, office staff and super admins.
  if (path.startsWith('/conductor')) {
    if (!user) return to(`/staff/login?next=${encodeURIComponent(path + request.nextUrl.search)}`);
    const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!['conductor', 'staff', 'admin'].includes(prof?.role ?? '')) return to('/');
    return response;
  }

  if (path.startsWith('/admin')) {
    // Staff have their own sign-in page, separate from passengers.
    if (!user) return to(`/staff/login?next=${encodeURIComponent(path + request.nextUrl.search)}`);
    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const role = profile?.role;
    if (role === 'conductor') return to('/conductor');
    if (role !== 'staff' && role !== 'admin') return to('/');
    if (role !== 'admin' && ADMIN_ONLY.some((p) => path.startsWith(p))) return to('/admin');
  }
  return response;
}

export const config = {
  // Skip static files, images, the service worker and manifest.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|brand/|sw.js|manifest.webmanifest|offline.html|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
