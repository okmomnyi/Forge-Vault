import { db, unwrap } from '../../_lib/db.js';
import { applySecurityHeaders, handler, notFound, ok } from '../../_lib/http.js';

/** GET /api/products/:slug — single product detail. */

async function detail(req, res) {
  const { slug } = req.query ?? {};

  const rows = unwrap(
    await db()
      .from('products')
      .select('*, category:categories(slug, name)')
      .eq('slug', String(slug))
      .eq('is_active', true)
      .limit(1),
    'product:detail',
  );

  const row = rows?.[0];
  if (!row) throw notFound('That part could not be found.');

  applySecurityHeaders(res);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');

  return ok(res, {
    product: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      category: row.category?.name ?? null,
      categorySlug: row.category?.slug ?? null,
      partNumber: row.part_number,
      description: row.description,
      priceCents: row.price_cents,
      oldPriceCents: row.old_price_cents,
      discountPercent: row.discount_percent,
      stock: row.stock,
      imagePath: row.image_path,
    },
  });
}

export default handler({ GET: detail });
