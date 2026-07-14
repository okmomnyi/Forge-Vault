import { z } from 'zod';
import { db, unwrap } from '../../_lib/db.js';
import { sendAdminEmail } from '../../_lib/email/send.js';
import { clientIp, conflict, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { getOrderForCustomer, parseOrThrow } from '../../_lib/orders.js';

/**
 * POST /api/refunds/request
 *
 * Customer-initiated refund request. This moves NO money — it files a request
 * and alerts the shop. An admin must explicitly approve it in the panel.
 *
 * Requires the order's access token, so only the person holding the order link
 * can file against it.
 */

const schema = z.object({
  orderId: z.string().uuid(),
  accessToken: z.string().min(10).max(200),
  reason: z.string().trim().min(5, 'Please tell us what went wrong.').max(500),
  amountCents: z.number().int().min(1).optional(),
});

const REFUND_WINDOW_DAYS = 14;

async function request(req, res) {
  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  await rateLimit(`refund-req:ip:${clientIp(req)}`, { limit: 10, windowSecs: 3600 });

  const { order } = await getOrderForCustomer(input.orderId, input.accessToken);

  if (!order.paid_at) {
    throw conflict('This order has not been paid for, so there is nothing to refund.');
  }

  const refundable = order.total_cents - order.refunded_cents;
  if (refundable <= 0) {
    throw conflict('This order has already been fully refunded.');
  }

  // The window runs from delivery where we know it, and from payment otherwise.
  const startedAt = new Date(order.delivered_at ?? order.paid_at);
  const daysElapsed = (Date.now() - startedAt.getTime()) / 86_400_000;

  if (daysElapsed > REFUND_WINDOW_DAYS) {
    throw conflict(
      `The ${REFUND_WINDOW_DAYS}-day return window for this order has closed. Contact support — we may still be able to help.`,
    );
  }

  const existing = unwrap(
    await db()
      .from('refunds')
      .select('id')
      .eq('order_id', order.id)
      .in('status', ['requested', 'approved', 'processing'])
      .limit(1),
    'refund-req:existing',
  );

  if (existing?.length) {
    throw conflict('You already have a refund request open on this order. We are looking at it.');
  }

  const amountCents = Math.min(input.amountCents ?? refundable, refundable);

  const created = unwrap(
    await db()
      .from('refunds')
      .insert({
        order_id: order.id,
        amount_cents: amountCents,
        reason: input.reason,
        status: 'requested', // NOT approved — a human decides
        requested_by_email: order.email,
      })
      .select('*'),
    'refund-req:create',
  );

  const refund = created[0];

  await sendAdminEmail('adminRefundRequest', { order, refund }, { orderId: order.id });

  return ok(res, {
    refund: { id: refund.id, status: refund.status, amountCents },
    message: 'Your refund request has been received. We will review it and email you.',
  });
}

export default handler({ POST: request });
