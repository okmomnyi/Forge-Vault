import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../../_lib/auth.js';
import { db, rpc, unwrap } from '../../../_lib/db.js';
import { sendEmail } from '../../../_lib/email/send.js';
import { conflict, handler, ok, readJson } from '../../../_lib/http.js';
import { adminCard, getCard, getPurchaseCard } from '../../../_lib/gift-cards.js';
import { getOrder, parseOrThrow } from '../../../_lib/orders.js';

/**
 * GET   /api/admin/orders/:id
 * PATCH /api/admin/orders/:id  — advance fulfilment (ship / deliver / cancel)
 *
 * Fulfilment transitions are gated by an explicit state machine. You cannot
 * ship an unpaid order, deliver an unshipped one, or cancel a shipped one — the
 * admin UI hides those buttons, but the check lives here because the UI is not
 * a security boundary.
 *
 * Gift card purchases have nothing to ship: they are delivered by email the
 * moment payment confirms, and resent with a reissue. So the shipping actions
 * are refused for them, and a paid one cannot be cancelled either, because
 * cancelling would leave a live card behind. Refunding is what voids a card.
 */

const schema = z.object({
  action: z.enum(['mark_processing', 'mark_shipped', 'mark_delivered', 'cancel', 'update_notes']),
  trackingNumber: z.string().trim().max(120).optional().or(z.literal('')),
  carrier: z.string().trim().max(80).optional().or(z.literal('')),
  trackingUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

const ALLOWED_FROM = {
  mark_processing: ['paid'],
  mark_shipped: ['paid', 'processing'],
  mark_delivered: ['shipped'],
  cancel: ['awaiting_verification', 'pending_payment', 'payment_failed', 'paid', 'processing'],
  update_notes: null, // always allowed
};

async function get(req, res) {
  await requireAdmin(req);

  const { id } = req.query ?? {};
  const { order, items } = await getOrder(String(id));

  const payments = unwrap(
    await db().from('payments').select('*').eq('order_id', order.id).order('created_at'),
    'admin:order-payments',
  );

  const refunds = unwrap(
    await db().from('refunds').select('*').eq('order_id', order.id).order('created_at'),
    'admin:order-refunds',
  );

  const emails = unwrap(
    await db()
      .from('email_log')
      .select('template, status, created_at, error')
      .eq('order_id', order.id)
      .order('created_at'),
    'admin:order-emails',
  );

  // The card this order bought, or the card that paid for it.
  const card =
    order.kind === 'gift_card'
      ? await getPurchaseCard(order.id)
      : order.gift_card_id
        ? await getCard(order.gift_card_id)
        : null;

  const giftCardTransactions = card
    ? unwrap(
        await db()
          .from('gift_card_transactions')
          .select('kind, amount_cents, balance_after_cents, order_id, refund_id, created_at')
          .eq('gift_card_id', card.id)
          .order('created_at', { ascending: false })
          .limit(50),
        'admin:order-gift-card-tx',
      )
    : [];

  return ok(res, { order, items, payments, refunds, emails, giftCard: adminCard(card), giftCardTransactions });
}

async function patch(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager', 'support');

  const { id } = req.query ?? {};
  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  const { order, items } = await getOrder(String(id));

  if (order.kind === 'gift_card') {
    if (['mark_processing', 'mark_shipped', 'mark_delivered'].includes(input.action)) {
      throw conflict('Gift cards are delivered by email when payment clears. To resend one, reissue the card.');
    }
    if (input.action === 'cancel' && order.paid_at) {
      throw conflict('This gift card is paid for and live. Refund it instead: a refund voids its unspent balance.');
    }
  }

  const allowed = ALLOWED_FROM[input.action];
  if (allowed && !allowed.includes(order.status)) {
    throw conflict(`Cannot ${input.action.replace('_', ' ')} an order that is "${order.status}".`);
  }

  const now = new Date().toISOString();
  let patchRow = {};
  let email = null;

  switch (input.action) {
    case 'mark_processing':
      patchRow = { status: 'processing' };
      break;

    case 'mark_shipped':
      patchRow = {
        status: 'shipped',
        shipped_at: now,
        tracking_number: input.trackingNumber || order.tracking_number,
        carrier: input.carrier || order.carrier,
      };
      email = 'orderShipped';
      break;

    case 'mark_delivered':
      patchRow = { status: 'delivered', delivered_at: now };
      email = 'orderDelivered';
      break;

    case 'cancel':
      patchRow = { status: 'cancelled', cancelled_at: now };
      break;

    case 'update_notes':
      patchRow = { notes: input.notes || null };
      break;
  }

  const updated = unwrap(
    await db().from('orders').update(patchRow).eq('id', order.id).select('*'),
    'admin:order-update',
  );

  const after = updated[0];

  // Cancelling a paid order puts the stock back on the shelf. Without this the
  // parts stay invisibly reserved against an order that will never ship.
  if (input.action === 'cancel' && order.stock_committed) {
    await rpc('restock_order', { p_order_id: order.id });
  }

  // Cancelling an unpaid order hands back any gift card credit it was holding.
  // (Does nothing for a paid order: that credit comes back through a refund.)
  if (input.action === 'cancel') {
    await rpc('release_gift_card_hold', { p_order_id: order.id });
  }

  await audit(req, admin, `order.${input.action}`, {
    entity: 'order',
    entityId: order.id,
    before: order,
    after,
  });

  if (email) {
    await sendEmail(
      email,
      after.email,
      { order: after, items, trackingUrl: input.trackingUrl || null },
      { orderId: after.id },
    );
  }

  return ok(res, { order: after });
}

export default handler({ GET: get, PATCH: patch });
