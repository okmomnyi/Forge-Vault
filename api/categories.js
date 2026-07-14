import { db, unwrap } from './_lib/db.js';
import { applySecurityHeaders, handler, ok } from './_lib/http.js';

/**
 * GET /api/categories            every category (used by the admin dropdown)
 * GET /api/categories?tiles=1    only the ones with artwork, for the home grid
 *
 * Products live in more categories than the home page shows tiles for — Seats,
 * Lights, Tires and Transmission are real categories but were never part of the
 * six-tile "Shop by Category" grid. A category qualifies as a tile by having an
 * image_path, so adding a seventh tile is a data change, not a code change.
 */

async function list(req, res) {
  const url = new URL(req.url, 'http://localhost');

  let query = db().from('categories').select('id, slug, name, image_path').order('sort_order');

  if (url.searchParams.get('tiles') === '1') {
    query = query.not('image_path', 'is', null);
  }

  const rows = unwrap(await query, 'categories:list');

  applySecurityHeaders(res);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');

  return ok(res, {
    categories: rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      imagePath: row.image_path,
    })),
  });
}

export default handler({ GET: list });
