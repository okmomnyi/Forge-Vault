import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, unwrap } from './db.js';
import { isProduction } from './env.js';
import { clientIp, forbidden, unauthorized } from './http.js';

/**
 * Customer accounts.
 *
 * Same session model as the admin side (server-side record, opaque cookie token,
 * only its hash stored) but a separate cookie and table, so a customer session
 * can never be mistaken for an admin one. That separation is the point: the two
 * must not share a code path where a bug could promote one to the other.
 */

const COOKIE = 'fv_customer_session';
const SESSION_TTL_DAYS = 30; // long — this is a shop, not a bank
const BCRYPT_COST = 12;

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/* ==========================================================================
   Cookie
   ========================================================================== */

function serialize(name, value, { maxAge, expires }) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly', // JS cannot read it, so XSS cannot exfiltrate the session
    'SameSite=Lax', // Lax, not Strict: a customer following a link from their
    // confirmation email must arrive still signed in. The CSRF
    // token below is what protects state-changing requests.
  ];

  if (isProduction()) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  if (expires) parts.push(`Expires=${expires.toUTCString()}`);

  return parts.join('; ');
}

export const setSessionCookie = (res, token) =>
  res.setHeader('Set-Cookie', serialize(COOKIE, token, { maxAge: SESSION_TTL_DAYS * 86400 }));

export const clearSessionCookie = (res) =>
  res.setHeader('Set-Cookie', serialize(COOKIE, '', { maxAge: 0, expires: new Date(0) }));

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

export function assertNotLockedOut(customer) {
  if (customer.locked_until && new Date(customer.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(customer.locked_until) - Date.now()) / 60_000);
    throw forbidden(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
}

export async function recordFailedLogin(customer) {
  const attempts = (customer.failed_attempts ?? 0) + 1;
  const patch = { failed_attempts: attempts };

  if (attempts >= MAX_FAILED_LOGINS) {
    patch.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
    patch.failed_attempts = 0;
  }

  unwrap(await db().from('customers').update(patch).eq('id', customer.id), 'customer:fail');
}

export const recordSuccessfulLogin = (id) =>
  unwrap(
    db()
      .from('customers')
      .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq('id', id),
    'customer:success',
  );

/* ==========================================================================
   Sessions
   ========================================================================== */

export async function createSession(req, customerId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();

  unwrap(
    await db().from('customer_sessions').insert({
      customer_id: customerId,
      token_hash: sha256(token),
      csrf_token: csrfToken,
      ip: clientIp(req),
      user_agent: String(req.headers['user-agent'] ?? '').slice(0, 500),
      expires_at: expiresAt,
    }),
    'customer-session:create',
  );

  return { token, csrfToken, expiresAt };
}

export async function revokeSession(token) {
  if (!token) return;
  unwrap(
    await db()
      .from('customer_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', sha256(token))
      .is('revoked_at', null),
    'customer-session:revoke',
  );
}

/** Resolves the session cookie to a customer, or null. Does not throw. */
export async function getCustomer(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;

  const rows = unwrap(
    await db()
      .from('customer_sessions')
      .select('*, customer:customers(*)')
      .eq('token_hash', sha256(token))
      .is('revoked_at', null)
      .limit(1),
    'customer-session:lookup',
  );

  const session = rows?.[0];
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const customer = session.customer;
  if (!customer?.is_active || !customer.email_verified_at) return null;

  return { customer, session, token };
}

/** Same, but throws 401. Use on anything that must not be reachable anonymously. */
export async function requireCustomer(req) {
  const result = await getCustomer(req);
  if (!result) throw unauthorized('Please sign in to continue.');
  return result;
}

/**
 * CSRF for customer mutations. The cookie is SameSite=Lax, which stops
 * cross-site FORM posts from carrying it, but a cross-site fetch with
 * credentials is still worth a second layer — and this one fails closed for any
 * caller that cannot read the session record to learn the token.
 */
export function requireCsrf(req, session) {
  const header = req.headers['x-csrf-token'];
  if (!header || typeof header !== 'string') throw forbidden('Missing CSRF token.');

  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(session.csrf_token, 'utf8');

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw forbidden('Invalid CSRF token.');
  }
}

/** Shape handed to the browser. Never includes the password hash. */
export const publicCustomer = (customer) => ({
  id: customer.id,
  email: customer.email,
  name: customer.name,
  verifiedAt: customer.email_verified_at,
});
