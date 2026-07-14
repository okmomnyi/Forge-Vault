import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../_lib/auth.js';
import { db, rpc, unwrap } from '../../_lib/db.js';
import { sendEmail } from '../../_lib/email/send.js';
import { badRequest, conflict, handler, notFound, ok, readJson } from '../../_lib/http.js';
import { getOrder, parseOrThrow } from '../../_lib/orders.js';
import { getProvider } from '../../_lib/payments/index.js';

/**
 * POST /api/admin/refunds/create
 *
 * Issues a refund against an order. This is the single most dangerous endpoint
 * in the application — it moves money out — so it is the most heavily guarded:
 *
 *   - `owner` or `manager` only. Support staff cannot refund.
 *   - CSRF token required.
 *   - The amount is clamped server-side to what is actually still refundable.
 *     A client asking to refund more than the order was worth is rejected, and
 *     the DB CHECK constraint on orders.refunded_cents is the backstop if this
 *     check is ever wrong.
 *   - The refund row is written BEFORE the provider is called. If the provider
 *     call then times out but actually succeeded, the webhook reconciles
 *     against that row instead of creating a second refund.
 *   - Refunding restocks the parts.
 */

const schema = z.object({
  orderId: z.string().uuid(),
  amountCents: z.number().int().min(1).optional(), // omit for a full refund
  reason: z.string().trim().max(500).optional().or(z.literal('')),
  restock: z.boolean().default(true),
});

async function create(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager'); // owner passes implicitly; support does not

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  const { order } = await getOrder(input.orderId, { withItems: false });

  if (!order.paid_at) {
    throw conflict('This order was never paid, so there is nothing to refund.');
  }

  const refundable = order.total_cents - order.refunded_cents;

  if (refundable <= 0) {
    throw conflict('This order has already been fully refunded.');
  }

  const amountCents = input.amountCents ?? refundable;

  if (amountCents > refundable) {
    throw badRequest(
      `You can refund at most ${(refundable / 100).toFixed(2)} ${order.currency} against this order.`,
      { errors: { amountCents: 'Exceeds the refundable balance.' }, refundableCents: refundable },
    );
  }

  // Find the payment that actually took the money.
  const payments = unwrap(
    await db()
      .from('payments')
      .select('*')
      .eq('order_id', order.id)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(1),
    'refund:payment',
  );

  const payment = payments?.[0];
  if (!payment) throw notFound('No successful payment found for this order.');

  const provider = getProvider(payment.provider);

  if (!provider.supportsRefund) {
    throw conflict(
      `${provider.label} payments cannot be refunded automatically. This one has to be returned manually.`,
    );
  }

  // Write the intent first, so a provider timeout cannot leave us with money
  // moved and no record of it.
  const created = unwrap(
    await db()
      .from('refunds')
      .insert({
        order_id: order.id,
        payment_id: payment.id,
        amount_cents: amountCents,
        reason: input.reason || null,
        status: 'processing',
        processed_by_admin: admin.id,
      })
      .select('*'),
    'refund:create',
  );

  const refund = created[0];

  let result;
  try {
    result = await provider.refund({
      reference: payment.provider_reference,
      amountCents,
      currency: order.currency,
      reason: input.reason,
    });
  } catch (error) {
    unwrap(
      await db()
        .from('refunds')
        .update({ status: 'failed', failure_reason: error.message?.slice(0, 500) })
        .eq('id', refund.id),
      'refund:failed',
    );

    await audit(req, admin, 'refund.failed', {
      entity: 'refund',
      entityId: refund.id,
      after: { amountCents, error: error.message },
    });

    throw badRequest(`The payment provider rejected the refund: ${error.message}`);
  }

  // Some providers settle asynchronously and confirm by webhook. In that case
  // we leave the refund 'processing' and let the webhook finalise it, so the
  // customer is not emailed "refunded" before the money has actually moved.
  if (result.status !== 'succeeded') {
    unwrap(
      await db()
        .from('refunds')
        .update({ provider_reference: result.reference ?? null })
        .eq('id', refund.id),
      'refund:pending',
    );

    await audit(req, admin, 'refund.pending', {
      entity: 'refund',
      entityId: refund.id,
      after: { amountCents, provider: provider.id },
    });

    return ok(res, {
      refund: { ...refund, status: 'processing' },
      message: 'The refund is being processed by the provider. The customer will be emailed once it settles.',
    });
  }

  // Settled immediately. Apply it atomically.
  await rpc('record_refund_success', {
    p_refund_id: refund.id,
    p_provider_reference: result.reference ?? null,
  });

  if (input.restock) {
    await rpc('restock_order', { p_order_id: order.id });
  }

  const { order: after } = await getOrder(order.id, { withItems: false });

  await audit(req, admin, 'refund.succeeded', {
    entity: 'refund',
    entityId: refund.id,
    before: order,
    after,
  });

  await sendEmail(
    'refundIssued',
    after.email,
    { order: after, refund, isPartial: after.refunded_cents < after.total_cents },
    { orderId: after.id },
  );

  return ok(res, { refund: { ...refund, status: 'succeeded' }, order: after });
}

export default handler({ POST: create });
