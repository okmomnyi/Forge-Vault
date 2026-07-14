import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../_lib/auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { handler, notFound, ok, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { assertSafeImageUrl } from '../../_lib/storage.js';

/**
 * GET /api/admin/categories   — all categories, with their tile artwork
 * PUT /api/admin/categories   — set (or clear) one category's image
 *
 * Only the image is editable here. Category names and slugs are referenced by
 * product rows and by the home page, so renaming one is a migration, not a
 * form field.
 *
 * Note the side effect worth knowing about: a category becomes a home-page tile
 * by HAVING an image (see /api/categories?tiles=1). Uploading artwork for
 * "Seats" therefore puts Seats on the landing page. That is deliberate — it is
 * how you add a seventh tile without touching code — but it is not obvious, so
 * the admin UI says so.
 */

const schema = z.object({
  slug: z.string().trim().min(1).max(80),
  imagePath: z.string().trim().max(500).nullable(),
});

async function list(req, res) {
  await requireAdmin(req);

  const rows = unwrap(
    await db().from('categories').select('id, slug, name, image_path, sort_order').order('sort_order'),
    'admin:categories',
  );

  return ok(res, { categories: rows });
}

async function update(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  const url = input.imagePath ? assertSafeImageUrl(input.imagePath) : null;

  const before = unwrap(
    await db().from('categories').select('*').eq('slug', input.slug).limit(1),
    'admin:category',
  );

  if (!before?.length) throw notFound(`Unknown category "${input.slug}".`);

  const after = unwrap(
    await db().from('categories').update({ image_path: url }).eq('slug', input.slug).select('*'),
    'admin:category-update',
  );

  await audit(req, admin, url ? 'category.set_image' : 'category.clear_image', {
    entity: 'category',
    entityId: input.slug,
    before: before[0],
    after: after[0],
  });

  return ok(res, { category: after[0] });
}

export default handler({ GET: list, PUT: update });
