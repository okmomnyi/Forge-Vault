import { SignJWT, jwtVerify } from 'jose';

/**
 * Admin session primitives — build spec §6.
 *
 * Session = short-lived JWT signed with jose, stored in an HttpOnly cookie. jose
 * is used (not jsonwebtoken) because verifySession runs in middleware, which
 * executes on the Edge runtime where node's crypto is unavailable. Password
 * hashing lives in lib/password.ts so bcryptjs never enters the Edge bundle.
 *
 * MFA note: this is a single small operation, so Phase 1 has no TOTP. If the
 * team grows, add a TOTP check in the login route between password verification
 * and createSessionToken() — e.g. via `otplib` — and store a per-admin secret.
 */

export const SESSION_COOKIE = 'forge_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  adminId: string;
  email: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error('SESSION_JWT_SECRET is not set.');
  }
  return new TextEncoder().encode(secret);
}

/** Signs a session JWT. The caller is responsible for setting it as a cookie. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.adminId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

/** Verifies a session JWT. Returns the payload, or null if invalid/expired. */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return { adminId: payload.sub, email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}

/** Cookie options shared by the login (set) and logout (clear) routes. */
export function sessionCookieOptions(maxAge: number = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
