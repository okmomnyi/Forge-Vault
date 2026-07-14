import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, unwrap } from './db.js';
import { isProduction } from './env.js';
import { clientIp, forbidden, unauthorized } from './http.js';

/**
 * Admin authentication.
 *
 * Shape of the login flow (two steps, because the admin can issue refunds):
 *   1. POST /api/admin/auth/login   email + password  -> emails a 2FA code
 *   2. POST /api/admin/auth/verify  the 6-digit code  -> sets the session cookie
 *
 * The session cookie holds an opaque 32-byte random token. Only its SHA-256
 * hash is stored, so read access to the database does not let you mint a valid
 * cookie. It is a server-side session, not a JWT: revocation is immediate and
 * does not have to wait for an expiry to lapse.
 */

const SESSION_COOKIE = 'fv_admin_session';
const SESSION_TTL_HOURS = 8;
const BCRYPT_COST = 12;

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/* ==========================================================================
   Cookies
   ========================================================================== */

function serializeCookie(name, value, { maxAge, expires }) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly', // JS cannot read it, so XSS cannot exfiltrate the session
    'SameSite=Strict', // the browser will not attach it to cross-site requests — kills CSRF at the source
  ];

  if (isProduction()) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  if (expires) parts.push(`Expires=${expires.toUTCString()}`);

  return parts.join('; ');
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_HOURS * 3600 }));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAge: 0, expires: new Date(0) }));
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/* ==========================================================================
   Login throttling
   ========================================================================== */

export async function assertNotLockedOut(admin) {
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(admin.locked_until) - Date.now()) / 60_000);
    throw forbidden(`Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

export async function recordFailedLogin(admin) {
  const attempts = (admin.failed_attempts ?? 0) + 1;
  const patch = { failed_attempts: attempts };

  if (attempts >= MAX_FAILED_LOGINS) {
    patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    patch.failed_attempts = 0;
  }

  unwrap(await db().from('admin_users').update(patch).eq('id', admin.id), 'admin:fail');
}

export async function recordSuccessfulLogin(adminId) {
  unwrap(
    await db()
      .from('admin_users')
      .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq('id', adminId),
    'admin:success',
  );
}

/* ==========================================================================
   Sessions
   ========================================================================== */

export async function createSession(req, adminId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();

  unwrap(
    await db().from('admin_sessions').insert({
      admin_id: adminId,
      token_hash: sha256(token),
      csrf_token: csrfToken,
      ip: clientIp(req),
      user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500),
      expires_at: expiresAt,
    }),
    'session:create',
  );

  return { token, csrfToken, expiresAt };
}

export async function revokeSession(token) {
  if (!token) return;
  unwrap(
    await db()
      .from('admin_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', sha256(token))
      .is('revoked_at', null),
    'session:revoke',
  );
}

/**
 * Resolves the session cookie to an admin, or throws 401.
 * Returns { admin, session }.
 */
export async function requireAdmin(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) throw unauthorized('Sign in to continue.');

  const rows = unwrap(
    await db()
      .from('admin_sessions')
      .select('*, admin:admin_users(*)')
      .eq('token_hash', sha256(token))
      .is('revoked_at', null)
      .limit(1),
    'session:lookup',
  );

  const session = rows?.[0];
  if (!session) throw unauthorized('Your session is no longer valid. Sign in again.');

  if (new Date(session.expires_at) < new Date()) {
    throw unauthorized('Your session has expired. Sign in again.');
  }

  const admin = session.admin;
  if (!admin || !admin.is_active) {
    throw forbidden('This account has been deactivated.');
  }

  return { admin, session, token };
}

/**
 * CSRF: double-submit. The session cookie is SameSite=Strict, which already
 * prevents a cross-site form from carrying it. This header check is the second
 * layer — it also fails closed for any same-site content injection that can
 * issue a request but cannot read the session record to learn the token.
 *
 * Required on every state-changing admin call.
 */
export function requireCsrf(req, session) {
  const header = req.headers['x-csrf-token'];
  if (!header || typeof header !== 'string') {
    throw forbidden('Missing CSRF token.');
  }

  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(session.csrf_token, 'utf8');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw forbidden('Invalid CSRF token.');
  }
}

/** Guards an endpoint behind a role. `owner` implicitly satisfies everything. */
export function requireRole(admin, ...roles) {
  if (admin.role === 'owner') return;
  if (!roles.includes(admin.role)) {
    throw forbidden('Your role does not permit this action.');
  }
}

/* ==========================================================================
   Audit log
   ========================================================================== */

export async function audit(req, admin, action, { entity, entityId, before, after } = {}) {
  try {
    unwrap(
      await db().from('audit_log').insert({
        admin_id: admin?.id ?? null,
        action,
        entity: entity ?? null,
        entity_id: entityId ? String(entityId) : null,
        before: before ?? null,
        after: after ?? null,
        ip: clientIp(req),
      }),
      'audit:insert',
    );
  } catch (error) {
    // An audit write must never break the operation it is recording, but a
    // silent failure would be worse — make it loud in the logs.
    console.error('[audit] failed to record action', { action, message: error.message });
  }
}
