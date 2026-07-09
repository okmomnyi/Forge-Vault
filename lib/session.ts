import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, type SessionPayload } from '@/lib/auth';

/**
 * Server-side session helpers for Route Handlers and Server Components.
 *
 * Kept separate from lib/auth.ts because this imports next/headers (`cookies()`),
 * which is only available in the Node server context — not in middleware (Edge).
 * Mutating /api/admin/* routes call requireAdmin() since the /admin/* middleware
 * matcher does not cover the API paths.
 */

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** Returns the session or throws UnauthorizedError (caller maps to 401). */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}
