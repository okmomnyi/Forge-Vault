import { requireCustomer } from '../_lib/customer-auth.js';
import { db, unwrap } from '../_lib/db.js';
import { handler, ok } from '../_lib/http.js';
import { publicOrder } from '../_lib/orders.js';

/**
 * GET /api/orders — the signed-in customer's own orders.
 *
 * Scoped by customer_id from the session. There is no query parameter that lets
 * a caller ask for anyone else's orders, so there is nothing to forge.
 */

async function list(req, res) {
  const { customer } = await requireCustomer(req);

  const rows = unwrap(
    await db()
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(50),
    'orders:mine',
  );

  return ok(res, {
    orders: rows.map((row) => ({
      ...publicOrder(row, row.items ?? []),
      // The customer owns these orders, so they get the link that opens them.
      accessToken: row.access_token,
    })),
  });
}

export default handler({ GET: list });
