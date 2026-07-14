/**
 * Creates the public storage bucket that product photos and site imagery live in.
 *
 *   npm run setup-storage
 *
 * Idempotent — safe to run repeatedly.
 *
 * The bucket is PUBLIC on purpose: these are product photos on a storefront,
 * meant to be seen by anyone. Public here means "readable", not "writable" —
 * uploads still go through /api/admin/upload, which requires an authenticated
 * admin session and the service-role key. An anonymous visitor can view an
 * image; they cannot add, replace, or delete one.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media';

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const MB = 1024 * 1024;

async function main() {
  const { data: existing } = await db.storage.getBucket(bucket);

  const options = {
    public: true,
    fileSizeLimit: 5 * MB,
    // Belt and braces: the API already sniffs magic bytes, but the storage layer
    // refuses anything outside this list too. Note SVG is deliberately absent —
    // it can carry script and would be a stored-XSS vector served from our origin.
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  };

  if (existing) {
    const { error } = await db.storage.updateBucket(bucket, options);
    if (error) throw error;
    console.log(`✓ Bucket "${bucket}" already existed — settings refreshed.`);
  } else {
    const { error } = await db.storage.createBucket(bucket, options);
    if (error) throw error;
    console.log(`✓ Bucket "${bucket}" created.`);
  }

  console.log(`
  public:           yes (readable by anyone — they are product photos)
  max file size:    5 MB
  allowed types:    JPEG, PNG, GIF, WebP  (no SVG — it can carry script)
  public URL:       ${url.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/

Uploads still require an admin session: /api/admin/upload.
`);
}

main().catch((error) => {
  console.error('\nFailed:', error.message);
  process.exit(1);
});
