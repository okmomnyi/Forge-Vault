import { db, rpc, unwrap } from './db.js';
import { sendAdminEmail, sendEmail } from './email/send.js';
import { WebhookSignatureError } from './payments/index.js';
import { getOrder } from './orders.js';

/**
 * Shared webhook processing.
 * ============================================================================
 * This is the only place in the system where an order becomes paid, so it is
 * where the money-safety properties have to hold. Four of them:
 *
 *   1. SIGNATURE FIRST. The body is verified against the provider's signature
 *      before a single field is read. An unsigned request is an attempt to get
 *      free parts, not a payment.
 *
 *   2. IDEMPOTENT. Providers retry — on timeout, on 500, sometimes just
 *      because. Every event id is recorded under a unique index; a replay is a
 *      no-op that returns 200. Stock is decremented once, the receipt is sent
 *      once.
 *
 *   3. TRUST THE PROVIDER'S API, NOT ITS PAYLOAD. Even with a valid signature
 *      we call back to verify() and use *that* amount and status. The webhook
 *      body tells us which transaction to look at; it does not tell us what
 *      happened to it.
 *
 *   4. ALWAYS 200 ON A HANDLED EVENT. A non-2xx makes the provider retry, and
 *      an event we have already processed (or deliberately ignore) must not
 *      cause a retry storm. Only a signature failure returns 401.
 */

/** Records the event, returning false if we have already seen it. */
async function claimEvent(provider, event) {
  const { error } = await db().from('webhook_events').insert({
    provider,
    event_id: event.id,
    event_type: event.type,
    payload: event.raw,
  });

  if (!error) return true;

  // 23505 = unique_violation on (provider, event_id): a replay.
  if (error.code === '23505') return false;

  throw new Error(`webhook:claim: ${error.message}`);
}

const markProcessed = (provider, eventId, failure = null) =>
  db()
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString(), error: failure })
    .eq('provider', provider)
    .eq('event_id', eventId);

/** Finds the order a provider reference belongs to. */
async function findOrderByReference(provider, reference, fallbackOrderId) {
  if (reference) {
    const rows = unwrap(
      await db()
        .from('payments')
        .select('order_id')
        .eq('provider', provider)
        .eq('provider_reference', reference)
        .limit(1),
      'webhook:find-payment',
    );

    if (rows?.[0]) return rows[0].order_id;
  }

  // Fallback for a provider that echoes our own order id back on the event
  // (Paystack does, via metadata). Lets us recover even if the payment row was
  // never written — e.g. the process died between initialize() and the insert.
  return fallbackOrderId ?? null;
}

/* ==========================================================================
   Event handlers
   ========================================================================== */

async function onPaymentSucceeded(provider, event) {
  const orderId = await findOrderByReference(provider.id, event.reference, event.orderId);

  if (!orderId) {
    console.error('[webhook] payment succeeded for an unknown order', {
      provider: provider.id,
      reference: event.reference,
    });
    return;
  }

  // Source of truth: ask the provider what actually happened, rather than
  // believing a payload that merely arrived with a valid signature.
  const confirmed = await provider.verify(event.reference);

  if (confirmed.status !== 'succeeded') {
    console.warn('[webhook] provider reports this payment did not succeed', {
      orderId,
      status: confirmed.status,
    });
    return;
  }

  const { order } = await getOrder(orderId, { withItems: false });

  try {
    // Atomic: decrements stock, marks paid, records the payment. Refuses to run
    // twice for the same order. Raises if any line would go negative.
    const result = await rpc('confirm_order_payment', {
      p_order_id: orderId,
      p_provider: provider.id,
      p_provider_reference: event.reference,
      p_amount_cents: confirmed.amountCents,
      p_method: confirmed.method ?? null,
      p_raw: confirmed.raw ?? null,
    });

    const row = Array.isArray(result) ? result[0] : result;

    if (row?.already_processed) {
      // A retry landed after we had already committed. Nothing more to do —
      // and crucially, do not send a second receipt.
      return;
    }
  } catch (error) {
    const message = error.message ?? String(error);

    if (message.includes('INSUFFICIENT_STOCK')) {
      // The customer has been charged for something we cannot ship. This is
      // the last-unit race. We do NOT silently swallow it and we do NOT
      // auto-refund without a human — we take the money off the table and shout.
      console.error('[webhook] PAID ORDER CANNOT BE FULFILLED', { orderId, message });

      unwrap(
        await db()
          .from('orders')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            notes: `STOCK CONFLICT — paid but not committed: ${message}`,
          })
          .eq('id', orderId),
        'webhook:stock-conflict',
      );

      unwrap(
        await db().from('payments').upsert(
          {
            order_id: orderId,
            provider: provider.id,
            provider_reference: event.reference,
            status: 'succeeded',
            amount_cents: confirmed.amountCents,
            currency: confirmed.currency,
            method: confirmed.method ?? null,
            raw: confirmed.raw ?? null,
          },
          { onConflict: 'provider,provider_reference' },
        ),
        'webhook:stock-conflict-payment',
      );

      await sendAdminEmail('adminStockConflict', { order, error: message }, { orderId });
      return;
    }

    if (message.includes('AMOUNT_MISMATCH')) {
      // Someone paid an amount that is not the order total. Never ship on this.
      console.error('[webhook] AMOUNT MISMATCH — refusing to fulfil', { orderId, message });
      await sendAdminEmail('adminStockConflict', { order, error: message }, { orderId });
      return;
    }

    throw error;
  }

  // Committed. Send the receipt and tell the shop.
  const { order: paid, items } = await getOrder(orderId);

  await sendEmail('orderConfirmation', paid.email, { order: paid, items }, { orderId });
  await sendAdminEmail('adminNewOrder', { order: paid, items }, { orderId });
}

async function onPaymentFailed(provider, event) {
  const orderId = await findOrderByReference(provider.id, event.reference, event.orderId);
  if (!orderId) return;

  const { order } = await getOrder(orderId, { withItems: false });

  // A failure after we have already been paid is noise (e.g. a retried card
  // attempt on an order that later succeeded). Never un-pay a paid order.
  if (order.stock_committed || order.status === 'paid') return;

  unwrap(
    await db().from('orders').update({ status: 'payment_failed' }).eq('id', orderId),
    'webhook:order-failed',
  );

  if (event.reference) {
    unwrap(
      await db()
        .from('payments')
        .update({ status: 'failed', failure_reason: event.failureReason ?? null, raw: event.raw })
        .eq('provider', provider.id)
        .eq('provider_reference', event.reference),
      'webhook:payment-failed',
    );
  }

  await sendEmail('paymentFailed', order.email, { order, reason: event.failureReason }, { orderId });
}

async function onRefundSucceeded(provider, event) {
  const orderId = await findOrderByReference(provider.id, event.reference, event.orderId);
  if (!orderId) return;

  // Match the refund we issued. A provider-side refund we never recorded
  // (someone refunded from the Paystack dashboard) has no row here — record it
  // so the order total stays honest.
  const rows = unwrap(
    await db()
      .from('refunds')
      .select('*')
      .eq('order_id', orderId)
      .in('status', ['processing', 'approved', 'requested'])
      .order('created_at', { ascending: false })
      .limit(1),
    'webhook:find-refund',
  );

  let refund = rows?.[0];

  if (!refund) {
    const created = unwrap(
      await db()
        .from('refunds')
        .insert({
          order_id: orderId,
          amount_cents: event.amountCents ?? 0,
          reason: 'Refunded directly in the provider dashboard',
          status: 'processing',
        })
        .select('*'),
      'webhook:refund-adopt',
    );
    refund = created[0];
  }

  await rpc('record_refund_success', {
    p_refund_id: refund.id,
    p_provider_reference: event.reference ?? null,
  });

  const { order } = await getOrder(orderId, { withItems: false });

  await sendEmail(
    'refundIssued',
    order.email,
    { order, refund, isPartial: order.refunded_cents < order.total_cents },
    { orderId },
  );
}

/* ==========================================================================
   Entry point
   ========================================================================== */

export async function processWebhook(provider, raw, headers) {
  let event;

  try {
    event = await provider.parseWebhook(raw, headers);
  } catch (error) {
    if (error instanceof WebhookSignatureError) throw error;
    throw new Error(`Could not parse ${provider.id} webhook: ${error.message}`);
  }

  if (!event) throw new WebhookSignatureError(provider.id);

  const fresh = await claimEvent(provider.id, event);
  if (!fresh) {
    return { status: 'duplicate', eventId: event.id };
  }

  try {
    switch (event.kind) {
      case 'payment_succeeded':
        await onPaymentSucceeded(provider, event);
        break;
      case 'payment_failed':
        await onPaymentFailed(provider, event);
        break;
      case 'refund_succeeded':
        await onRefundSucceeded(provider, event);
        break;
      default:
        break; // an event type we do not act on
    }

    await markProcessed(provider.id, event.id);
    return { status: 'processed', eventId: event.id, kind: event.kind };
  } catch (error) {
    // Record the failure, then rethrow so the route answers 500 and the
    // provider retries. The event row stays claimed but unprocessed, so the
    // retry re-runs it rather than being swallowed as a duplicate.
    await markProcessed(provider.id, event.id, error.message?.slice(0, 500));

    await db().from('webhook_events').delete().eq('provider', provider.id).eq('event_id', event.id);

    throw error;
  }
}
