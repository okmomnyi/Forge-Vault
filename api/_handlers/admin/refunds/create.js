import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../../_lib/auth.js';
import { db, rpc, unwrap } from '../../../_lib/db.js';
import { sendEmail } from '../../../_lib/email/send.js';
import { badRequest, conflict, handler, notFound, ok, readJson } from '../../../_lib/http.js';
import { toChargeAmount } from '../../../_lib/env.js';
import { getPurchaseCard } from '../../../_lib/gift-cards.js';
import { getOrder, parseOrThrow } from '../../../_lib/orders.js';
import { getProvider } from '../../../_lib/payments/index.js';

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
 *
 * GIFT CARDS change where the money goes, never how much:
 *
 *   - An order paid partly by gift card is refunded to the paying card FIRST, up
 *     to what that card actually paid, and the remainder goes back onto the gift
 *     card (refunds.gift_card_cents). Paystack would reject a refund larger than
 *     its own transaction anyway; this makes the split explicit and exact.
 *   - A gift card PURCHASE can only be refunded up to its unspent balance, and
 *     that balance is voided BEFORE the provider is called. Otherwise the
 *     recipient could spend it in the gap and the shop would pay out twice. If
 *     the provider then rejects the refund, the void is reversed.
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

  let refundable = order.total_cents - order.refunded_cents;

  if (refundable <= 0) {
    throw conflict('This order has already been fully refunded.');
  }

  const isGiftCardPurchase = order.kind === 'gift_card';

  if (isGiftCardPurchase) {
    // Only the part nobody has spent can go back. The spent part bought parts.
    const card = await getPurchaseCard(order.id);
    const unspent = card?.status === 'pending' ? 0 : (card?.balance_cents ?? 0);

    if (unspent <= 0) {
      throw conflict('This gift card has been fully spent, so there is nothing left to refund.');
    }

    if (input.amountCents !== undefined && input.amountCents > unspent) {
      throw badRequest(
        `Only ${(unspent / 100).toFixed(2)} ${order.currency} of this gift card is unspent, so that is the most you can refund.`,
        { errors: { amountCents: 'Exceeds the unspent balance.' }, refundableCents: Math.min(unspent, refundable) },
      );
    }

    refundable = Math.min(refundable, unspent);
  }

  const amountCents = input.amountCents ?? refundable;

  if (amountCents > refundable) {
    throw badRequest(
      `You can refund at most ${(refundable / 100).toFixed(2)} ${order.currency} against this order.`,
      { errors: { amountCents: 'Exceeds the refundable balance.' }, refundableCents: refundable },
    );
  }

  // Split between the card that paid and the gift card that paid. Refunds still
  // in flight count, or two quick refunds could both send the card portion.
  let giftCardCents = 0;

  if (order.gift_card_cents > 0) {
    const prior = unwrap(
      await db()
        .from('refunds')
        .select('amount_cents, gift_card_cents')
        .eq('order_id', order.id)
        .in('status', ['processing', 'succeeded']),
      'refund:prior',
    );

    const cardPaid = order.total_cents - order.gift_card_cents;
    const cardRefunded = prior.reduce((sum, r) => sum + r.amount_cents - r.gift_card_cents, 0);
    const giftRefunded = prior.reduce((sum, r) => sum + r.gift_card_cents, 0);

    const cardPortion = Math.min(amountCents, Math.max(0, cardPaid - cardRefunded));
    giftCardCents = amountCents - cardPortion;

    if (giftCardCents > order.gift_card_cents - giftRefunded) {
      throw conflict('Another refund on this order is still processing. Wait for it to settle, then try again.');
    }
  }

  const providerPortion = amountCents - giftCardCents;

  // Find the payment that actually took the money. Not needed when the whole
  // refund goes back onto a gift card.
  let payment = null;
  let provider = null;

  if (providerPortion > 0) {
    const payments = unwrap(
      await db()
        .from('payments')
        .select('*')
        .eq('order_id', order.id)
        .eq('status', 'succeeded')
        .neq('provider', 'gift_card')
        .order('created_at', { ascending: false })
        .limit(1),
      'refund:payment',
    );

    payment = payments?.[0];
    if (!payment) throw notFound('No successful payment found for this order.');

    provider = getProvider(payment.provider);

    if (!provider.supportsRefund) {
      throw conflict(
        `${provider.label} payments cannot be refunded automatically. This one has to be returned manually.`,
      );
    }
  }

  // Write the intent first, so a provider timeout cannot leave us with money
  // moved and no record of it.
  const created = unwrap(
    await db()
      .from('refunds')
      .insert({
        order_id: order.id,
        payment_id: payment?.id ?? null,
        amount_cents: amountCents,
        gift_card_cents: giftCardCents,
        reason: input.reason || null,
        status: 'processing',
        processed_by_admin: admin.id,
      })
      .select('*'),
    'refund:create',
  );

  const refund = created[0];

  if (isGiftCardPurchase) {
    try {
      await rpc('void_gift_card_for_refund', { p_refund_id: refund.id });
    } catch (error) {
      unwrap(
        await db()
          .from('refunds')
          .update({ status: 'failed', failure_reason: error.message?.slice(0, 500) })
          .eq('id', refund.id),
        'refund:void-failed',
      );

      if (String(error.message).includes('GIFT_CARD_SPENT')) {
        throw conflict('The gift card was spent while you were refunding it. Reload the order to see what is left.');
      }
      throw error;
    }
  }

  // The refund is accounted in the order's display currency (USD), but the
  // provider moves money in the charged currency (KES). Convert for the provider
  // call; the refunds ledger stays in USD. Prefer the payment's own currency —
  // that is exactly what was charged, so the refund matches to the cent.
  let result = { status: 'succeeded', reference: null };

  if (providerPortion > 0) {
    const chargedInDisplayCurrency = (payment.currency ?? order.currency) === order.currency;
    const providerAmountCents = chargedInDisplayCurrency ? providerPortion : toChargeAmount(providerPortion);

    try {
      result = await provider.refund({
        reference: payment.provider_reference,
        amountCents: providerAmountCents,
        currency: payment.currency ?? order.currency,
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

      // No money moved, so the gift card keeps its balance.
      if (isGiftCardPurchase) {
        await rpc('reverse_gift_card_void', { p_refund_id: refund.id });
      }

      await audit(req, admin, 'refund.failed', {
        entity: 'refund',
        entityId: refund.id,
        after: { amountCents, error: error.message },
      });

      throw badRequest(`The payment provider rejected the refund: ${error.message}`);
    }
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
      after: { amountCents, giftCardCents, provider: provider.id },
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
