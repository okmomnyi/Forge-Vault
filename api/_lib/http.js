import { rpc } from './db.js';
import { isProduction } from './env.js';

/* ==========================================================================
   Security headers
   ==========================================================================
   Applied to every API response. The static pages get an equivalent set from
   vercel.json — these are here so an API response can never be framed,
   sniffed, or cached by a shared proxy.
   ========================================================================== */

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // API responses carry order and session data. They must never sit in a CDN
  // or browser cache where the next visitor could pull them out.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (isProduction()) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
}

/* ==========================================================================
   Responses
   ========================================================================== */

export function json(res, status, payload) {
  applySecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
  return res;
}

export const ok = (res, payload = {}) => json(res, 200, { ok: true, ...payload });

export const fail = (res, status, error, extra = {}) => json(res, status, { ok: false, error, ...extra });

/**
 * A thrown ApiError becomes a clean client-facing response. Anything else that
 * escapes a handler becomes a generic 500 — internal messages and stack traces
 * never reach the client.
 */
export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Every one of these forwards `extra` — it is what carries the actionable
// detail to the client (field errors, and the per-item `problems` array the
// cart uses to show WHICH part sold out and offer to remove it). Dropping it
// leaves the user with a generic message and no way forward.
export const badRequest = (message, extra) => new ApiError(400, message, extra);
export const unauthorized = (message = 'Authentication required.', extra) => new ApiError(401, message, extra);
export const forbidden = (message = 'Not permitted.', extra) => new ApiError(403, message, extra);
export const notFound = (message = 'Not found.', extra) => new ApiError(404, message, extra);
export const conflict = (message, extra) => new ApiError(409, message, extra);
export const tooMany = (message = 'Too many requests. Please slow down.', extra) => new ApiError(429, message, extra);

/* ==========================================================================
   Handler wrapper
   ========================================================================== */

/**
 * Wraps a handler with method checking, security headers, and error
 * normalisation.
 *
 *   export default handler({ POST: createOrder });
 */
export function handler(methods) {
  return async function route(req, res) {
    applySecurityHeaders(res);

    const fn = methods[req.method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(methods).join(', '));
      return fail(res, 405, 'Method not allowed.');
    }

    try {
      return await fn(req, res);
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(res, error.status, error.message, error.extra);
      }

      // Unexpected. Log it server-side; tell the client nothing useful.
      console.error('[api] unhandled error', {
        path: req.url,
        method: req.method,
        message: error.message,
        stack: error.stack,
      });
      return fail(res, 500, 'Something went wrong. Please try again.');
    }
  };
}

/* ==========================================================================
   Request helpers
   ========================================================================== */

/** Parses a JSON body. Vercel usually pre-parses; this covers the cases it doesn't. */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw badRequest('Malformed JSON body.');
    }
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('Malformed JSON body.');
  }
}

/** Reads the raw body as a string. Required for webhook signature verification. */
export async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/* ==========================================================================
   Rate limiting
   ========================================================================== */

/**
 * Atomically increments a Postgres-backed counter and throws 429 when the
 * caller is over the limit. Backed by the DB rather than process memory
 * because serverless instances share nothing.
 *
 * Fails OPEN on infrastructure error: if the limiter itself is broken we would
 * rather serve traffic than take checkout down. The endpoints that most need a
 * hard stop (OTP, admin login) have a second, independent limit — a per-record
 * attempt counter — that does not depend on this.
 */
export async function rateLimit(bucket, { limit, windowSecs }) {
  let result;
  try {
    const rows = await rpc('hit_rate_limit', {
      p_bucket: bucket,
      p_limit: limit,
      p_window_secs: windowSecs,
    });
    result = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    console.error('[rate-limit] backend unavailable, failing open', { bucket, message: error.message });
    return;
  }

  if (result && result.allowed === false) {
    const retryAfter = Math.max(1, Math.ceil((new Date(result.reset_at) - Date.now()) / 1000));
    throw new ApiError(429, 'Too many requests. Please wait and try again.', { retryAfter });
  }
}
