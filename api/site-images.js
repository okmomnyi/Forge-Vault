import { db, unwrap } from './_lib/db.js';
import { applySecurityHeaders, handler, ok } from './_lib/http.js';

/**
 * GET /api/site-images
 *
 * The hero slides and partner logos, keyed by slot. Public and cacheable.
 *
 * A slot whose url is null is simply omitted, so the front end shows its
 * gradient placeholder rather than requesting a URL that does not exist.
 */

async function list(req, res) {
  const rows = unwrap(
    await db().from('site_images').select('key, url, alt').not('url', 'is', null),
    'site-images:list',
  );

  applySecurityHeaders(res);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');

  // Keyed object rather than an array — every consumer wants it by slot name.
  const images = Object.fromEntries(rows.map((row) => [row.key, { url: row.url, alt: row.alt }]));

  return ok(res, { images });
}

export default handler({ GET: list });
