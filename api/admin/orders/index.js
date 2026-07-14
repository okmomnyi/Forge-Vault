import { requireAdmin } from '../../_lib/auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { handler, ok } from '../../_lib/http.js';

/** GET /api/admin/orders?status=paid&q=FV-001042&limit=50 */

async function list(req, res) {
  await requireAdmin(req);

  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('q');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  let query = db()
    .from('orders')
    .select('*, items:order_items(*)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status && status !== 'all') query = query.eq('status', status);

  if (search) {
    const safe = search.replace(/[%_,()]/g, ' ').trim().slice(0, 80);
    if (safe) query = query.or(`order_number.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const orders = unwrap(await query, 'admin:orders');

  return ok(res, { orders });
}

export default handler({ GET: list });
