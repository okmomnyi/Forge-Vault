import { z } from 'zod';
import { audit, requireAdmin, requireCsrf } from '../../../_lib/auth.js';
import { handler, ok, rateLimit, readJson } from '../../../_lib/http.js';
import { parseOrThrow } from '../../../_lib/orders.js';
import { reconcileOpenOrders, reconcileOrderPayment } from '../../../_lib/reconcile.js';

/**
 * POST /api/admin/orders/reconcile            — check every order awaiting payment
 * POST /api/admin/orders/reconcile { orderId } — check one
 *
 * Asks the payment provider what actually happened to orders stuck on "Awaiting
 * payment", and closes or commits them. See api/_lib/reconcile.js.
 *
 * Any admin role may run it. It cannot move money or invent an outcome: every
 * change it makes is what the provider's own API reports, applied through the
 * same code as the webhook.
 */

const schema = z.object({ orderId: z.string().uuid().optional() });

const LABELS = {
  paid: 'confirmed as paid',
  failed: 'marked payment failed',
  abandoned: 'cancelled as abandoned',
  pending: 'still in progress at the provider',
  error: 'could not be checked',
  skipped: 'skipped',
  not_open: 'already settled',
};

async function reconcile(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);

  const { orderId } = parseOrThrow(schema, await readJson(req));

  await rateLimit(`reconcile:admin:${admin.id}`, { limit: 10, windowSecs: 300 });

  const batch = orderId
    ? { checked: 1, results: [await reconcileOrderPayment(orderId)] }
    : await reconcileOpenOrders({ olderThanMinutes: 0, limit: 25 });

  const summary = batch.results.reduce((acc, { outcome }) => {
    acc[outcome] = (acc[outcome] ?? 0) + 1;
    return acc;
  }, {});

  const changed = batch.results.filter((r) => ['paid', 'failed', 'abandoned'].includes(r.outcome));

  if (changed.length) {
    await audit(req, admin, 'order.reconcile', {
      entity: 'order',
      entityId: orderId ?? null,
      after: { summary, changed: changed.map(({ orderId: id, outcome, reason }) => ({ id, outcome, reason })) },
    });
  }

  const parts = Object.entries(summary).map(([outcome, count]) => `${count} ${LABELS[outcome] ?? outcome}`);

  return ok(res, {
    checked: batch.checked,
    summary,
    results: batch.results,
    message: batch.checked
      ? `Checked ${batch.checked} order${batch.checked === 1 ? '' : 's'} with the payment provider: ${parts.join(', ')}.`
      : 'No orders are waiting on payment.',
  });
}

export default handler({ POST: reconcile });
