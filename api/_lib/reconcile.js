import { db, unwrap } from './db.js';
import { OPEN_ORDER_STATUSES } from './orders.js';
import { providerById } from './payments/index.js';
import { closeUnpaidOrder, commitVerifiedPayment } from './webhooks.js';

/**
 * Payment reconciliation: asking the provider what happened to an order that is
 * still "awaiting payment".
 * ============================================================================
 * WHY THIS EXISTS
 *
 *   Orders only ever moved out of pending_payment through a webhook, and
 *   Paystack does not send one when a card is declined or a customer closes the
 *   payment page. Only charge.success arrives. Every failed or abandoned checkout
 *   therefore sat in the admin panel as "Awaiting payment" forever.
 *
 *   A missed or delayed success webhook had the same blind spot: the customer
 *   paid, and nothing would ever notice.
 *
 * WHAT IT DOES
 *
 *   Calls provider.verify(), the same source of truth the webhook trusts, and
 *   acts on the answer through the same code the webhook uses:
 *
 *     succeeded → commitVerifiedPayment   (paid, stock taken, receipt sent)
 *     failed    → closeUnpaidOrder        (order: payment_failed)
 *     abandoned → closeUnpaidOrder        (order: cancelled), once left long enough
 *     pending   → nothing yet
 *
 * WHO RUNS IT
 *
 *   - the daily cron, for every open order past the grace period;
 *   - the customer's own order page, which Paystack redirects back to (the
 *     redirect is only a prompt to go and ask; the answer comes from the API);
 *   - an admin, from the orders page.
 */

/**
 * How long an unfinished payment is left alone before it counts as abandoned.
 * Paystack reports a transaction nobody has attempted yet as "abandoned", so
 * without this a customer still typing their card number would have their order
 * cancelled under them.
 */
export const ABANDONED_AFTER_MINUTES = 60;

/** Pure: what to do with a provider's answer. Exported for tests. */
export function decideOutcome(verifyStatus, startedAt, now = Date.now()) {
  if (verifyStatus === 'succeeded') return 'paid';
  if (verifyStatus === 'failed') return 'failed';

  if (verifyStatus === 'abandoned') {
    const age = now - new Date(startedAt).getTime();
    return age >= ABANDONED_AFTER_MINUTES * 60_000 ? 'abandoned' : 'pending';
  }

  return 'pending';
}

/**
 * Checks one order with its provider and applies the outcome.
 * Never throws for a provider problem: returns { outcome: 'error' } instead, so
 * one bad reference cannot stop a batch.
 */
export async function reconcileOrderPayment(orderId) {
  const [order] = unwrap(
    await db().from('orders').select('id, status, paid_at, created_at').eq('id', orderId).limit(1),
    'reconcile:order',
  );

  if (!order) return { orderId, outcome: 'not_found' };

  if (order.paid_at || !OPEN_ORDER_STATUSES.includes(order.status)) {
    return { orderId, outcome: 'not_open', status: order.status };
  }

  const [payment] = unwrap(
    await db()
      .from('payments')
      .select('provider, provider_reference, created_at')
      .eq('order_id', order.id)
      .eq('status', 'initiated')
      .not('provider_reference', 'is', null)
      .neq('provider', 'gift_card')
      .order('created_at', { ascending: false })
      .limit(1),
    'reconcile:payment',
  );

  if (!payment) {
    // The payment never started (the process died between creating the order
    // and reaching the provider). Nobody can pay it, so once it is old enough it
    // is abandoned by definition.
    if (decideOutcome('abandoned', order.created_at) !== 'abandoned') return { orderId, outcome: 'pending' };

    const closed = await closeUnpaidOrder(null, order.id, null, { outcome: 'abandoned' });
    return { orderId, outcome: closed ? 'abandoned' : 'not_open', reason: 'Payment was never started.' };
  }

  const provider = providerById(payment.provider);

  if (!provider?.enabled) {
    return { orderId, outcome: 'skipped', reason: `${payment.provider} is not configured on this deployment.` };
  }

  let verified;
  try {
    verified = await provider.verify(payment.provider_reference);
  } catch (error) {
    console.error('[reconcile] verify failed', { orderId, provider: provider.id, message: error.message });
    return { orderId, outcome: 'error', reason: error.message };
  }

  const outcome = decideOutcome(verified.status, payment.created_at);

  if (outcome === 'paid') {
    console.warn('[reconcile] payment succeeded but was never confirmed by webhook; committing now', { orderId });
    await commitVerifiedPayment(provider, order.id, payment.provider_reference, verified);
  } else if (outcome === 'failed' || outcome === 'abandoned') {
    const closed = await closeUnpaidOrder(provider, order.id, payment.provider_reference, {
      outcome,
      reason: verified.failureReason,
    });
    if (!closed) return { orderId, outcome: 'not_open' };
  }

  return { orderId, outcome, reason: verified.failureReason ?? null };
}

/**
 * Checks every open order created before `olderThanMinutes` ago, newest first.
 * Sequential on purpose: these are provider API calls, and a burst of them is
 * the fastest way to get rate limited by the provider during a real checkout.
 */
export async function reconcileOpenOrders({ olderThanMinutes = 0, limit = 25 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const orders = unwrap(
    await db()
      .from('orders')
      .select('id, order_number')
      .in('status', OPEN_ORDER_STATUSES)
      .is('paid_at', null)
      .lte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit),
    'reconcile:open-orders',
  );

  const results = [];
  for (const order of orders) {
    const result = await reconcileOrderPayment(order.id);
    results.push({ ...result, orderNumber: order.order_number });
  }

  const summary = results.reduce((acc, { outcome }) => {
    acc[outcome] = (acc[outcome] ?? 0) + 1;
    return acc;
  }, {});

  return { checked: results.length, summary, results };
}
