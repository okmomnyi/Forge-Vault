import { requireAdmin } from '../_lib/auth.js';
import { db, unwrap } from '../_lib/db.js';
import { handler, ok } from '../_lib/http.js';

/** GET /api/admin/stats — dashboard tiles. */

const PAID = ['paid', 'processing', 'shipped', 'delivered', 'partially_refunded'];

async function stats(req, res) {
  await requireAdmin(req);

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [orders, lowStock, openRefunds, failedEmails] = await Promise.all([
    db().from('orders').select('status, total_cents, refunded_cents, created_at').gte('created_at', since),
    db().from('products').select('id, title, stock').eq('is_active', true).lte('stock', 2).order('stock'),
    db().from('refunds').select('id, amount_cents').in('status', ['requested', 'processing']),
    db().from('email_log').select('id').eq('status', 'failed').gte('created_at', since),
  ]);

  const rows = unwrap(orders, 'stats:orders');

  const paid = rows.filter((row) => PAID.includes(row.status));

  // Revenue is net of refunds. Reporting gross here would be flattering and wrong.
  const revenueCents = paid.reduce((sum, row) => sum + row.total_cents - row.refunded_cents, 0);

  const byStatus = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  const needsAction = rows.filter((row) => row.status === 'paid').length;

  return ok(res, {
    window: '30d',
    revenueCents,
    orderCount: paid.length,
    averageOrderCents: paid.length ? Math.round(revenueCents / paid.length) : 0,
    awaitingFulfilment: needsAction,
    byStatus,
    lowStock: unwrap(lowStock, 'stats:low-stock'),
    openRefunds: unwrap(openRefunds, 'stats:refunds'),
    failedEmails: unwrap(failedEmails, 'stats:emails').length,
  });
}

export default handler({ GET: stats });
