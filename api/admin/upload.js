import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../_lib/auth.js';
import { handler, ok, rateLimit, readJson } from '../_lib/http.js';
import { parseOrThrow } from '../_lib/orders.js';
import { assertValidImage, storage } from '../_lib/storage.js';

/**
 * POST /api/admin/upload
 *
 * Takes a base64 image from the admin panel, validates it, stores it in
 * Supabase Storage, and returns the public URL.
 *
 * The browser never gets the service-role key — if it did, anyone could read and
 * write your entire database. Uploading through this authenticated endpoint keeps
 * the key server-side, and means only a signed-in admin can write to the bucket.
 */

const schema = z.object({
  // Accepts a bare base64 string or a full data: URL (which is what
  // canvas.toDataURL gives you).
  image: z.string().min(16),
  filename: z.string().trim().max(120).default('upload'),
});

async function upload(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  // Uploading is the one admin action that costs money (quota) and touches a
  // third party, so it gets its own ceiling on top of the session check.
  await rateLimit(`upload:admin:${admin.id}`, { limit: 60, windowSecs: 3600 });

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  // Strip the data: URL prefix if present.
  const base64 = input.image.replace(/^data:image\/[a-z+]+;base64,/i, '');

  // Sniffs the magic bytes — an attacker-supplied extension proves nothing.
  // The format it reports is what we store as the content-type, so the served
  // Content-Type can never disagree with the actual bytes.
  const { bytes, format } = assertValidImage(base64);

  const result = await storage().upload(base64, input.filename, format);

  await audit(req, admin, 'image.upload', {
    entity: 'image',
    entityId: result.key,
    after: { url: result.url, bytes, format },
  });

  return ok(res, { url: result.url, key: result.key, bytes, format });
}

export default handler({ POST: upload });
