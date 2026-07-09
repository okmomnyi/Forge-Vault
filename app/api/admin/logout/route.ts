import { NextResponse } from 'next/server';
import { sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 });
  // Expire the cookie immediately.
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return response;
}
