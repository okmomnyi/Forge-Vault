import { applySecurityHeaders, clientIp, fail } from './_lib/http.js';

/**
 * The single API entry point.
 * ============================================================================
 * Every /api/* request lands here and is dispatched to a handler in
 * api/_handlers/. The handlers are ordinary Vercel-style functions — they were
 * not rewritten for this; only their location changed.
 *
 * WHY ONE FUNCTION INSTEAD OF 32
 *
 *   Vercel's Hobby plan hard-caps a deployment at 12 Serverless Functions, and
 *   it treats every file under api/ as one. With 32 handlers the build passed
 *   and the DEPLOY failed. Directories prefixed with `_` are not routed, so
 *   moving the handlers under _handlers/ leaves exactly one function: this file.
 *
 *   This is not merely a workaround. One function means one warm instance
 *   serving every route, so a customer hitting checkout benefits from the
 *   instance that already served the product page — fewer cold starts, not more.
 *   The cost is a slightly larger bundle, which is paid once per cold start.
 *
 * BODY PARSING
 *
 *   bodyParser is disabled for the whole API. The Paystack webhook verifies its
 *   HMAC over the exact bytes received, and letting Vercel parse and re-serialise
 *   the JSON would change the whitespace and break every signature. The handlers
 *   already read the stream themselves (readJson / readRaw in _lib/http.js), so
 *   they are unaffected.
 */

export const config = {
  api: { bodyParser: false },
};

/**
 * Route table. Order matters only in that a static path must not be shadowed by
 * a dynamic one — so dynamic routes are sorted last at match time.
 *
 * Handlers are imported lazily. A request to /api/products does not pay to parse
 * the admin refund logic.
 */
const ROUTES = [
  // ---- Public storefront ----
  ['/api/products', () => import('./_handlers/products/index.js')],
  ['/api/products/:slug', () => import('./_handlers/products/[slug].js')],
  ['/api/categories', () => import('./_handlers/categories.js')],
  ['/api/site-images', () => import('./_handlers/site-images.js')],
  ['/api/contact', () => import('./_handlers/contact.js')],

  // ---- Customer accounts ----
  ['/api/auth/register', () => import('./_handlers/auth/register.js')],
  ['/api/auth/verify', () => import('./_handlers/auth/verify.js')],
  ['/api/auth/login', () => import('./_handlers/auth/login.js')],
  ['/api/auth/resend', () => import('./_handlers/auth/resend.js')],
  ['/api/auth/session', () => import('./_handlers/auth/session.js')],

  // ---- Cart & checkout ----
  ['/api/cart/save', () => import('./_handlers/cart/save.js')],
  ['/api/checkout/quote', () => import('./_handlers/checkout/quote.js')],
  ['/api/checkout/create', () => import('./_handlers/checkout/create.js')],

  // ---- Orders & refunds (customer) ----
  ['/api/orders', () => import('./_handlers/orders/index.js')],
  ['/api/orders/:id', () => import('./_handlers/orders/[id].js')],
  ['/api/refunds/request', () => import('./_handlers/refunds/request.js')],

  // ---- Payment webhooks ----
  ['/api/webhooks/paystack', () => import('./_handlers/webhooks/paystack.js')],

  // ---- Cron ----
  ['/api/cron/lifecycle', () => import('./_handlers/cron/lifecycle.js')],

  // ---- Admin ----
  ['/api/admin/auth/login', () => import('./_handlers/admin/auth/login.js')],
  ['/api/admin/auth/verify', () => import('./_handlers/admin/auth/verify.js')],
  ['/api/admin/auth/session', () => import('./_handlers/admin/auth/session.js')],
  ['/api/admin/stats', () => import('./_handlers/admin/stats.js')],
  ['/api/admin/upload', () => import('./_handlers/admin/upload.js')],
  ['/api/admin/categories', () => import('./_handlers/admin/categories.js')],
  ['/api/admin/site-images', () => import('./_handlers/admin/site-images.js')],
  ['/api/admin/products', () => import('./_handlers/admin/products/index.js')],
  ['/api/admin/products/:id', () => import('./_handlers/admin/products/[id].js')],
  ['/api/admin/orders', () => import('./_handlers/admin/orders/index.js')],
  ['/api/admin/orders/:id', () => import('./_handlers/admin/orders/[id].js')],
  ['/api/admin/refunds', () => import('./_handlers/admin/refunds/index.js')],
  ['/api/admin/refunds/create', () => import('./_handlers/admin/refunds/create.js')],
  ['/api/admin/refunds/:id', () => import('./_handlers/admin/refunds/[id].js')],
];

/** Compiles '/api/products/:slug' into a matcher. */
function compile(pattern) {
  const names = [];
  const source = pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });

  return {
    pattern,
    regex: new RegExp(`^${source}/?$`),
    names,
    dynamic: names.length > 0,
  };
}

// Static routes first: /api/admin/refunds/create must win over
// /api/admin/refunds/:id, which would otherwise swallow it.
const COMPILED = ROUTES.map(([pattern, load]) => ({ ...compile(pattern), load })).sort(
  (a, b) => a.dynamic - b.dynamic,
);

export default async function router(req, res) {
  applySecurityHeaders(res);

  const url = new URL(req.url, 'http://localhost');

  const match = COMPILED.map((route) => ({ route, result: route.regex.exec(url.pathname) })).find(
    ({ result }) => result,
  );

  if (!match) {
    return fail(res, 404, 'Not found.');
  }

  // Rebuild the request shape the handlers expect: query string params plus any
  // dynamic path segments, exactly as Vercel's own file-based routing provides.
  req.query = Object.fromEntries(url.searchParams);
  match.route.names.forEach((name, i) => {
    req.query[name] = decodeURIComponent(match.result[i + 1]);
  });

  try {
    const module = await match.route.load();
    return await module.default(req, res);
  } catch (error) {
    // A handler that throws past its own error handling. Log it with enough
    // context to find it; tell the client nothing useful.
    console.error('[api] unhandled error', {
      path: url.pathname,
      method: req.method,
      ip: clientIp(req),
      message: error.message,
      stack: error.stack,
    });

    if (!res.writableEnded) {
      return fail(res, 500, 'Something went wrong. Please try again.');
    }
  }
}
