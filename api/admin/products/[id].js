import { audit, requireAdmin, requireCsrf, requireRole } from '../../_lib/auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { badRequest, conflict, handler, notFound, ok, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { productSchema, toRow } from './index.js';

/**
 * PUT    /api/admin/products/:id  — update
 * DELETE /api/admin/products/:id  — deactivate (soft) or delete (hard, if unsold)
 */

async function load(id) {
  const rows = unwrap(await db().from('products').select('*').eq('id', id).limit(1), 'admin:product');
  const product = rows?.[0];
  if (!product) throw notFound('Product not found.');
  return product;
}

async function update(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const { id } = req.query ?? {};
  const before = await load(String(id));

  const body = await readJson(req);
  const input = parseOrThrow(productSchema, body);

  const { data, error } = await db()
    .from('products')
    .update(await toRow(input))
    .eq('id', before.id)
    .select('*');

  if (error) {
    if (error.code === '23505') {
      throw badRequest('A product with that slug already exists.', { errors: { slug: 'Already taken.' } });
    }
    throw new Error(`admin:product-update: ${error.message}`);
  }

  const after = data[0];
  await audit(req, admin, 'product.update', { entity: 'product', entityId: after.id, before, after });

  return ok(res, { product: after });
}

async function remove(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const { id } = req.query ?? {};
  const product = await load(String(id));

  // A product that appears on a past order can never be hard-deleted — the
  // invoice must stay reconstructable. Deactivating hides it from the shop and
  // leaves history intact. (order_items.product_id is ON DELETE RESTRICT, so
  // the database would refuse anyway; this turns that into a clear message.)
  const sold = unwrap(
    await db().from('order_items').select('id').eq('product_id', product.id).limit(1),
    'admin:product-sold',
  );

  if (sold?.length) {
    if (!product.is_active) {
      throw conflict('This product has already been sold and is already hidden. It cannot be deleted.');
    }

    const { data } = await db()
      .from('products')
      .update({ is_active: false })
      .eq('id', product.id)
      .select('*');

    await audit(req, admin, 'product.deactivate', {
      entity: 'product',
      entityId: product.id,
      before: product,
      after: data?.[0],
    });

    return ok(res, {
      deactivated: true,
      message: 'This part appears on past orders, so it was hidden rather than deleted.',
    });
  }

  unwrap(await db().from('products').delete().eq('id', product.id), 'admin:product-delete');
  await audit(req, admin, 'product.delete', { entity: 'product', entityId: product.id, before: product });

  return ok(res, { deleted: true });
}

export default handler({ PUT: update, DELETE: remove });
