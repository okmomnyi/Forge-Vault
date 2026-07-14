import { db, unwrap } from '../../_lib/db.js';
import { applySecurityHeaders, handler, ok } from '../../_lib/http.js';

/**
 * GET /api/products
 *
 * Query: ?featured=1 | ?deals=1 | ?category=seats | ?q=zafira | ?limit=24
 *
 * Public and cacheable. Deliberately never exposes stock beyond a coarse
 * number, and never exposes cost, supplier, or internal notes.
 */

const publicProduct = (row) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  brand: row.brand,
  category: row.category?.name ?? null,
  categorySlug: row.category?.slug ?? null,
  partNumber: row.part_number,
  priceCents: row.price_cents,
  oldPriceCents: row.old_price_cents,
  discountPercent: row.discount_percent,
  stock: row.stock,
  imagePath: row.image_path,
});

async function list(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const params = url.searchParams;

  const limit = Math.min(Number(params.get('limit')) || 24, 60);

  let query = db()
    .from('products')
    .select('*, category:categories(slug, name)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.get('featured') === '1') query = query.eq('is_featured', true);
  if (params.get('deals') === '1') query = query.eq('is_deal', true);

  const category = params.get('category');
  if (category) {
    const rows = unwrap(
      await db().from('categories').select('id').eq('slug', category).limit(1),
      'products:category',
    );
    // An unknown category slug yields an empty list, not every product.
    if (!rows?.length) return ok(res, { products: [] });
    query = query.eq('category_id', rows[0].id);
  }

  const search = params.get('q');
  if (search) {
    const safe = search.replace(/[%_,()]/g, ' ').trim().slice(0, 80);
    if (safe) {
      query = query.or(`title.ilike.%${safe}%,brand.ilike.%${safe}%,part_number.ilike.%${safe}%`);
    }
  }

  const products = unwrap(await query, 'products:list');

  // Safe to cache at the edge: no per-user content. Short TTL so a price or
  // stock change goes live quickly; stale-while-revalidate keeps it fast.
  applySecurityHeaders(res);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');

  return ok(res, { products: products.map(publicProduct) });
}

export default handler({ GET: list });
