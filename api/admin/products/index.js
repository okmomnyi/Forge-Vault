import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../_lib/auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { badRequest, handler, ok, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { assertSafeImageUrl } from '../../_lib/storage.js';

/**
 * GET  /api/admin/products   — list, including inactive
 * POST /api/admin/products   — create
 */

export const productSchema = z.object({
  title: z.string().trim().min(3).max(300),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens.')
    .max(200),
  brand: z.string().trim().min(1).max(80),
  categorySlug: z.string().trim().max(80).optional().or(z.literal('')),
  partNumber: z.string().trim().max(120).optional().or(z.literal('')),
  description: z.string().trim().max(5000).optional().or(z.literal('')),

  priceCents: z.number().int().min(0).max(100_000_00),
  oldPriceCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  stock: z.number().int().min(0).max(10_000),

  // An ImgBB URL or a local /assets/... path — assertSafeImageUrl decides which
  // is acceptable. Longer than a filename because it now holds a full URL.
  imagePath: z.string().trim().max(500).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isDeal: z.boolean().default(false),
});

/**
 * The badge percentage is DERIVED, never accepted from the client. An admin
 * cannot typo a "-50%" badge onto a product that is 9% off — the number on the
 * badge is always the number the prices actually imply.
 */
export function derivePricing(input) {
  const oldPrice = input.oldPriceCents || null;

  if (!oldPrice) {
    return { price_cents: input.priceCents, old_price_cents: null, discount_percent: null };
  }

  if (oldPrice <= input.priceCents) {
    throw badRequest('The "was" price must be higher than the current price.', {
      errors: { oldPriceCents: 'Must be greater than the current price.' },
    });
  }

  return {
    price_cents: input.priceCents,
    old_price_cents: oldPrice,
    discount_percent: Math.round(((oldPrice - input.priceCents) / oldPrice) * 100),
  };
}

export async function resolveCategoryId(slug) {
  if (!slug) return null;

  const rows = unwrap(
    await db().from('categories').select('id').eq('slug', slug).limit(1),
    'admin:category',
  );

  if (!rows?.length) {
    throw badRequest('Unknown category.', { errors: { categorySlug: 'Not a known category.' } });
  }

  return rows[0].id;
}

/** Builds the DB row. Shared by create and update so they cannot drift apart. */
export async function toRow(input) {
  return {
    title: input.title,
    slug: input.slug,
    brand: input.brand,
    category_id: await resolveCategoryId(input.categorySlug),
    part_number: input.partNumber || null,
    description: input.description || null,
    stock: input.stock,
    // Rejects javascript:, data:, and any host that is not allow-listed.
    image_path: assertSafeImageUrl(input.imagePath),
    is_active: input.isActive,
    is_featured: input.isFeatured,
    is_deal: input.isDeal,
    ...derivePricing(input),
  };
}

async function list(req, res) {
  await requireAdmin(req);

  const rows = unwrap(
    await db()
      .from('products')
      .select('*, category:categories(slug, name)')
      .order('created_at', { ascending: false })
      .limit(200),
    'admin:products',
  );

  return ok(res, { products: rows });
}

async function create(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const body = await readJson(req);
  const input = parseOrThrow(productSchema, body);

  const { data, error } = await db()
    .from('products')
    .insert(await toRow(input))
    .select('*');

  if (error) {
    if (error.code === '23505') {
      throw badRequest('A product with that slug already exists.', {
        errors: { slug: 'Already taken.' },
      });
    }
    throw new Error(`admin:product-create: ${error.message}`);
  }

  const created = data[0];
  await audit(req, admin, 'product.create', { entity: 'product', entityId: created.id, after: created });

  return ok(res, { product: created });
}

export default handler({ GET: list, POST: create });
