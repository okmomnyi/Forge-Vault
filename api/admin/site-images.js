import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../_lib/auth.js';
import { db, unwrap } from '../_lib/db.js';
import { handler, notFound, ok, readJson } from '../_lib/http.js';
import { parseOrThrow } from '../_lib/orders.js';
import { assertSafeImageUrl } from '../_lib/storage.js';

/**
 * GET /api/admin/site-images   — every slot, including empty ones
 * PUT /api/admin/site-images   — set (or clear) one slot's image
 *
 * Slots are fixed rows created by the schema. This endpoint deliberately cannot
 * create new keys: a typo'd slot name would silently do nothing on the page,
 * which is far more confusing than a clear "unknown slot" error.
 */

const schema = z.object({
  key: z.string().trim().min(1).max(60),
  url: z.string().trim().max(500).nullable(),
  alt: z.string().trim().max(200).optional(),
});

async function list(req, res) {
  await requireAdmin(req);

  const rows = unwrap(
    await db().from('site_images').select('*').order('key'),
    'admin:site-images',
  );

  return ok(res, { images: rows });
}

async function update(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  // Rejects javascript:, data:, and any host we have not allow-listed.
  const url = input.url ? assertSafeImageUrl(input.url) : null;

  const before = unwrap(
    await db().from('site_images').select('*').eq('key', input.key).limit(1),
    'admin:site-image',
  );

  if (!before?.length) {
    throw notFound(`Unknown image slot "${input.key}".`);
  }

  const patch = { url };
  if (input.alt !== undefined) patch.alt = input.alt;

  const after = unwrap(
    await db().from('site_images').update(patch).eq('key', input.key).select('*'),
    'admin:site-image-update',
  );

  await audit(req, admin, url ? 'site_image.set' : 'site_image.clear', {
    entity: 'site_image',
    entityId: input.key,
    before: before[0],
    after: after[0],
  });

  return ok(res, { image: after[0] });
}

export default handler({ GET: list, PUT: update });
