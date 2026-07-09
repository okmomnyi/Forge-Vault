import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/**
 * Protects every /admin/* route except /admin/login. If there's no valid
 * session cookie, redirect to the login page. Runs on the Edge runtime, so it
 * uses jose (via verifySession) rather than node crypto.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The login page itself must stay public.
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (!session) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
