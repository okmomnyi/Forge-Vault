import { requireAdmin } from '../../../_lib/auth.js';
import { db, unwrap } from '../../../_lib/db.js';
import { handler, ok } from '../../../_lib/http.js';

/** GET /api/admin/refunds?status=requested */

async function list(req, res) {
  await requireAdmin(req);

  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status');

  let query = db()
    .from('refunds')
    .select('*, order:orders(id, order_number, email, total_cents, refunded_cents, currency, status)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);

  const refunds = unwrap(await query, 'admin:refunds');

  return ok(res, { refunds });
}

export default handler({ GET: list });
