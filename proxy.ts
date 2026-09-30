// proxy.ts (Next.js 16's name for middleware)
// With Supabase connected this:
//  1. keeps the sign-in session fresh (Supabase stores it in cookies), and
//  2. turns away anyone who isn't staff before /admin even loads.
// The database's row-level security is the real lock; this is the front door.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // demo mode

  let response = NextResponse.next({ request });
  const sb = createServerClient(url, key, {
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

  if (request.nextUrl.pathname.startsWith('/admin')) {
    const to = (path: string) => {
      const r = NextResponse.redirect(new URL(path, request.url));
      response.cookies.getAll().forEach((c) => r.cookies.set(c));
      return r;
    };
    if (!user) return to(`/auth/login?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`);
    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profile?.role !== 'staff') return to('/profile');
  }
  return response;
}

export const config = {
  // Skip static files, images, the service worker and manifest.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|brand/|sw.js|manifest.webmanifest|offline.html|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
