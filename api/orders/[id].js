import { handler, ok, unauthorized } from '../_lib/http.js';
import { getOrderForCustomer, publicOrder } from '../_lib/orders.js';

/**
 * GET /api/orders/:id?token=...
 *
 * Customer-facing order lookup. The access token is mandatory — the id alone
 * proves nothing, so enumerating ids leaks no addresses or baskets.
 */

async function get(req, res) {
  const { id } = req.query ?? {};
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');

  if (!token) throw unauthorized('This link is missing its access token.');

  const { order, items } = await getOrderForCustomer(String(id), token);

  return ok(res, { order: publicOrder(order, items) });
}

export default handler({ GET: get });
