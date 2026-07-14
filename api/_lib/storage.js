import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { optionalEnv, requireEnv } from './env.js';
import { badRequest } from './http.js';

/**
 * Image hosting — Supabase Storage.
 * ============================================================================
 * One interface, so nothing downstream knows or cares where an image lives:
 *
 *   upload(base64, filename) -> { url }
 *
 * Supabase Storage rather than ImgBB, because:
 *   - It is included in the free plan (1 GB, 5 GB egress) and is already
 *     provisioned — no extra account, no extra key.
 *   - The images are YOURS. A free image host can delete them, has no uptime
 *     guarantee, and hotlinking one from a shop that takes money is not what
 *     its terms contemplate. A product photo vanishing mid-sale is a real cost.
 *   - It is served from a CDN with proper cache headers.
 *
 * To swap providers, implement `upload` and change PROVIDER. Nothing else moves.
 */

const BUCKET = optionalEnv('SUPABASE_STORAGE_BUCKET', 'media');

/** Public URL prefix for the bucket, derived from SUPABASE_URL. */
function publicPrefix() {
  const base = requireEnv('SUPABASE_URL').trim().replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/`;
}

/** The host we will render images from. Derived, so it can never drift from the project. */
export function allowedImageHost() {
  return new URL(requireEnv('SUPABASE_URL')).hostname;
}

const EXT = { jpeg: 'jpg', png: 'png', gif: 'gif', webp: 'webp' };

const supabaseStorage = {
  id: 'supabase',

  get enabled() {
    // Storage rides on the same credentials as the database. If the app can
    // talk to Supabase at all, it can store images — nothing extra to configure.
    return Boolean(optionalEnv('SUPABASE_URL') && optionalEnv('SUPABASE_SERVICE_ROLE_KEY'));
  },

  async upload(base64, filename, format = 'jpeg') {
    const buffer = Buffer.from(base64, 'base64');

    // Never trust the client's filename for the storage path — it is a path
    // traversal and overwrite vector. Keep a slug of it for human readability,
    // but the uniqueness comes from random bytes we generate.
    const slug =
      filename
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'image';

    const key = `${slug}-${randomBytes(8).toString('hex')}.${EXT[format] ?? 'jpg'}`;

    const { error } = await db()
      .storage.from(BUCKET)
      .upload(key, buffer, {
        contentType: `image/${format}`,
        cacheControl: '31536000', // a year — the filename is unique, so it can be cached hard
        upsert: false, // a collision means our randomness failed; fail loudly rather than clobber
      });

    if (error) {
      if (/bucket not found/i.test(error.message)) {
        throw badRequest(
          `Storage bucket "${BUCKET}" does not exist. Run: npm run setup-storage`,
        );
      }
      throw badRequest(`Upload failed: ${error.message}`);
    }

    return { url: publicPrefix() + key, key };
  },

  /** Removes an image. Used when a slot is cleared, so the bucket does not fill with orphans. */
  async remove(url) {
    const prefix = publicPrefix();
    if (!url?.startsWith(prefix)) return; // not ours; nothing to delete

    const key = url.slice(prefix.length);
    const { error } = await db().storage.from(BUCKET).remove([key]);

    // A failed cleanup must not break the operation that triggered it — the
    // worst case is a few orphaned bytes, not a broken admin panel.
    if (error) console.error('[storage] could not remove orphan', { key, message: error.message });
  },
};

const PROVIDER = supabaseStorage;

export const storageEnabled = () => PROVIDER.enabled;

export function storage() {
  if (!PROVIDER.enabled) {
    throw badRequest('Image storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return PROVIDER;
}

/* ==========================================================================
   Validation
   ========================================================================== */

const MAGIC = {
  // Sniff the real format from the first bytes. A file called photo.jpg that is
  // actually an HTML document or an SVG with an onload handler is a stored-XSS
  // attempt, not a photo — and the extension is attacker-controlled, so it
  // proves nothing.
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  gif: [0x47, 0x49, 0x46, 0x38],
  webp: [0x52, 0x49, 0x46, 0x46], // "RIFF" — WEBP confirmed at offset 8
};

const MAX_BYTES = 4 * 1024 * 1024; // Vercel caps a request body at 4.5 MB

/**
 * Rejects anything that is not genuinely an image, and reports which format it
 * actually is, so the stored content-type matches the bytes.
 */
export function assertValidImage(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw badRequest('No image data received.');
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw badRequest('Image data is not valid base64.');
  }

  if (buffer.length === 0) throw badRequest('The image is empty.');

  if (buffer.length > MAX_BYTES) {
    throw badRequest(
      `That image is ${(buffer.length / 1048576).toFixed(1)} MB. The limit is ${MAX_BYTES / 1048576} MB — resize it and try again.`,
    );
  }

  const starts = (bytes) => bytes.every((byte, i) => buffer[i] === byte);

  let format = null;
  if (starts(MAGIC.jpeg)) format = 'jpeg';
  else if (starts(MAGIC.png)) format = 'png';
  else if (starts(MAGIC.gif)) format = 'gif';
  else if (starts(MAGIC.webp) && buffer.subarray(8, 12).toString('ascii') === 'WEBP') format = 'webp';

  if (!format) {
    throw badRequest('That file is not a JPEG, PNG, GIF, or WebP image.');
  }

  return { bytes: buffer.length, format };
}

/**
 * Guards what we will store as an image URL.
 *
 * Without this, anyone who got hold of an admin session could point a product
 * image at `javascript:...` or at a server that logs every one of your visitors.
 * Only our own Supabase Storage bucket and local /assets paths are permitted.
 */
export function assertSafeImageUrl(value) {
  if (!value) return null;

  const url = String(value).trim();

  // Local asset — still supported so existing /assets/... paths keep working.
  if (url.startsWith('/assets/')) return url;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest('Image must be a full https:// URL or a local /assets/... path.');
  }

  if (parsed.protocol !== 'https:') {
    throw badRequest('Image URLs must use https.');
  }

  // Exact hostname match — a suffix check would accept `my-project.supabase.co.evil.com`.
  if (parsed.hostname !== allowedImageHost()) {
    throw badRequest('Images must be uploaded here. Use the upload button and the URL is filled in for you.');
  }

  if (!parsed.pathname.startsWith(`/storage/v1/object/public/${BUCKET}/`)) {
    throw badRequest('That is not a valid media URL.');
  }

  return parsed.toString();
}
