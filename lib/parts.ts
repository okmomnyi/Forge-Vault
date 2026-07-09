import { query } from '@/lib/db';
import { generateUniquePartSlug } from '@/lib/slug';
import type {
  Category,
  Compatibility,
  PartDetail,
  PartImage,
  PartListItem,
  Condition,
  StockStatus,
  UploadedImage,
} from '@/lib/types';

export interface PartInput {
  name: string;
  part_number: string | null;
  category_id: number | null;
  description: string | null;
  price_kes: number;
  condition: Condition;
  stock_status: StockStatus;
  is_active: boolean;
  images: UploadedImage[]; // ordered images (url + imgbb delete_url)
  compatibility: Compatibility[];
}

export interface CatalogFilters {
  categorySlug?: string;
  make?: string;
  model?: string;
  search?: string;
}

// ---- reads -----------------------------------------------------------------

export async function getCategories(): Promise<Category[]> {
  return query<Category>('SELECT id, name, slug FROM categories ORDER BY name');
}

export async function listPartsForAdmin(): Promise<PartListItem[]> {
  return query<PartListItem>(
    `SELECT p.id, p.name, p.slug, p.part_number, p.price_kes, p.condition,
            p.stock_status, p.is_active, p.updated_at,
            c.name AS category_name,
            (SELECT image_url FROM part_images pi WHERE pi.part_id = p.id
             ORDER BY sort_order, id LIMIT 1) AS primary_image
     FROM parts p
     LEFT JOIN categories c ON c.id = p.category_id
     ORDER BY p.updated_at DESC`,
  );
}

export async function getRecentParts(limit = 8): Promise<PartListItem[]> {
  return query<PartListItem>(
    `SELECT p.id, p.name, p.slug, p.part_number, p.price_kes, p.condition,
            p.stock_status, p.is_active, p.updated_at,
            c.name AS category_name,
            (SELECT image_url FROM part_images pi WHERE pi.part_id = p.id
             ORDER BY sort_order, id LIMIT 1) AS primary_image
     FROM parts p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit],
  );
}

export async function listActiveParts(filters: CatalogFilters = {}): Promise<PartListItem[]> {
  const conditions: string[] = ['p.is_active = true'];
  const params: unknown[] = [];

  if (filters.categorySlug) {
    params.push(filters.categorySlug);
    conditions.push(`c.slug = $${params.length}`);
  }
  if (filters.make) {
    params.push(filters.make);
    conditions.push(
      `EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.part_id = p.id AND lower(pc.make) = lower($${params.length}))`,
    );
  }
  if (filters.model) {
    params.push(filters.model);
    conditions.push(
      `EXISTS (SELECT 1 FROM part_compatibility pc WHERE pc.part_id = p.id AND lower(pc.model) = lower($${params.length}))`,
    );
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const idx = params.length;
    conditions.push(`(p.name ILIKE $${idx} OR p.part_number ILIKE $${idx})`);
  }

  return query<PartListItem>(
    `SELECT p.id, p.name, p.slug, p.part_number, p.price_kes, p.condition,
            p.stock_status, p.is_active, p.updated_at,
            c.name AS category_name,
            (SELECT image_url FROM part_images pi WHERE pi.part_id = p.id
             ORDER BY sort_order, id LIMIT 1) AS primary_image
     FROM parts p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.created_at DESC`,
    params,
  );
}

async function loadChildren(partId: string): Promise<{ images: PartImage[]; compatibility: Compatibility[] }> {
  const [images, compatibility] = await Promise.all([
    query<PartImage>(
      'SELECT id, image_url, delete_url, sort_order FROM part_images WHERE part_id = $1 ORDER BY sort_order, id',
      [partId],
    ),
    query<Compatibility>(
      'SELECT id, make, model, year_start, year_end FROM part_compatibility WHERE part_id = $1 ORDER BY make, model',
      [partId],
    ),
  ]);
  return { images, compatibility };
}

export async function getPartBySlug(slug: string): Promise<PartDetail | null> {
  const rows = await query<PartDetail>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM parts p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1 AND p.is_active = true LIMIT 1`,
    [slug],
  );
  const part = rows[0];
  if (!part) return null;
  const { images, compatibility } = await loadChildren(part.id);
  return { ...part, images, compatibility };
}

/** Admin edit view — includes inactive parts, keyed by id. */
export async function getPartById(id: string): Promise<PartDetail | null> {
  const rows = await query<PartDetail>(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM parts p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = $1 LIMIT 1`,
    [id],
  );
  const part = rows[0];
  if (!part) return null;
  const { images, compatibility } = await loadChildren(part.id);
  return { ...part, images, compatibility };
}

export async function getRelatedParts(
  categoryId: number | null,
  excludePartId: string,
  limit = 4,
): Promise<PartListItem[]> {
  if (categoryId == null) return [];
  return query<PartListItem>(
    `SELECT p.id, p.name, p.slug, p.part_number, p.price_kes, p.condition,
            p.stock_status, p.is_active, p.updated_at,
            c.name AS category_name,
            (SELECT image_url FROM part_images pi WHERE pi.part_id = p.id
             ORDER BY sort_order, id LIMIT 1) AS primary_image
     FROM parts p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true AND p.category_id = $1 AND p.id <> $2
     ORDER BY p.created_at DESC
     LIMIT $3`,
    [categoryId, excludePartId, limit],
  );
}

/** Distinct makes/models for the catalog filter bar. */
export async function getCompatibilityFacets(): Promise<{ makes: string[]; models: string[] }> {
  const [makes, models] = await Promise.all([
    query<{ make: string }>('SELECT DISTINCT make FROM part_compatibility ORDER BY make'),
    query<{ model: string }>('SELECT DISTINCT model FROM part_compatibility ORDER BY model'),
  ]);
  return { makes: makes.map((m) => m.make), models: models.map((m) => m.model) };
}

/** Active part slugs + last-modified, for the sitemap. */
export async function getActivePartSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  return query<{ slug: string; updated_at: string }>(
    'SELECT slug, updated_at FROM parts WHERE is_active = true ORDER BY updated_at DESC',
  );
}

// ---- writes ----------------------------------------------------------------

async function replaceImages(partId: string, images: UploadedImage[]): Promise<void> {
  await query('DELETE FROM part_images WHERE part_id = $1', [partId]);
  if (images.length === 0) return;
  const params: unknown[] = [partId];
  const rows = images.map((img, i) => {
    params.push(img.url, img.delete_url, i);
    const base = params.length - 3;
    return `($1, $${base + 1}, $${base + 2}, $${base + 3})`;
  });
  await query(
    `INSERT INTO part_images (part_id, image_url, delete_url, sort_order) VALUES ${rows.join(', ')}`,
    params,
  );
}

async function replaceCompatibility(partId: string, compat: Compatibility[]): Promise<void> {
  await query('DELETE FROM part_compatibility WHERE part_id = $1', [partId]);
  const valid = compat.filter((c) => c.make.trim() && c.model.trim());
  if (valid.length === 0) return;
  const params: unknown[] = [partId];
  const rows = valid.map((c) => {
    params.push(c.make.trim(), c.model.trim(), c.year_start, c.year_end);
    const base = params.length - 4;
    return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });
  await query(
    `INSERT INTO part_compatibility (part_id, make, model, year_start, year_end) VALUES ${rows.join(', ')}`,
    params,
  );
}

export async function createPart(input: PartInput): Promise<{ id: string; slug: string }> {
  const slug = await generateUniquePartSlug(input.name);
  const rows = await query<{ id: string; slug: string }>(
    `INSERT INTO parts
       (name, slug, part_number, category_id, description, price_kes, condition, stock_status, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, slug`,
    [
      input.name,
      slug,
      input.part_number,
      input.category_id,
      input.description,
      input.price_kes,
      input.condition,
      input.stock_status,
      input.is_active,
    ],
  );
  const part = rows[0];
  await replaceImages(part.id, input.images);
  await replaceCompatibility(part.id, input.compatibility);
  return part;
}

export async function updatePart(id: string, input: PartInput): Promise<{ id: string; slug: string } | null> {
  const existing = await query<{ slug: string; name: string }>(
    'SELECT slug, name FROM parts WHERE id = $1 LIMIT 1',
    [id],
  );
  if (existing.length === 0) return null;

  // Only regenerate the slug if the name actually changed, to keep URLs stable.
  const slug =
    existing[0].name === input.name
      ? existing[0].slug
      : await generateUniquePartSlug(input.name, id);

  const rows = await query<{ id: string; slug: string }>(
    `UPDATE parts SET
       name = $1, slug = $2, part_number = $3, category_id = $4, description = $5,
       price_kes = $6, condition = $7, stock_status = $8, is_active = $9,
       updated_at = now()
     WHERE id = $10
     RETURNING id, slug`,
    [
      input.name,
      slug,
      input.part_number,
      input.category_id,
      input.description,
      input.price_kes,
      input.condition,
      input.stock_status,
      input.is_active,
      id,
    ],
  );
  await replaceImages(id, input.images);
  await replaceCompatibility(id, input.compatibility);
  return rows[0];
}

export async function setStockStatus(id: string, status: StockStatus): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'UPDATE parts SET stock_status = $1, updated_at = now() WHERE id = $2 RETURNING id',
    [status, id],
  );
  return rows.length > 0;
}

/**
 * Deletes a part. part_images cascade, so we collect their imgbb delete URLs
 * first and return them — imgbb has no delete API, so the admin removes them
 * manually via these links.
 */
export async function deletePart(id: string): Promise<{ deleted: boolean; deleteUrls: string[] }> {
  const images = await query<{ delete_url: string | null }>(
    'SELECT delete_url FROM part_images WHERE part_id = $1',
    [id],
  );
  const rows = await query<{ id: string }>('DELETE FROM parts WHERE id = $1 RETURNING id', [id]);
  return {
    deleted: rows.length > 0,
    deleteUrls: images
      .map((r) => r.delete_url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0),
  };
}
