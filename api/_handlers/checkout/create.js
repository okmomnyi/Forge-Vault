import { z } from 'zod';
import { requireCsrf, requireCustomer } from '../../_lib/customer-auth.js';
import { rpc } from '../../_lib/db.js';
import { siteUrl } from '../../_lib/env.js';
import { applyGiftCard, findSpendableCard } from '../../_lib/gift-cards.js';
import { badRequest, clientIp, conflict, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import {
  abandonOrder,
  createOrder,
  parseOrThrow,
  priceCart,
  sendOrderPaidEmails,
  startPayment,
} from '../../_lib/orders.js';
import { getProvider } from '../../_lib/payments/index.js';

/**
 * POST /api/checkout/create
 *
 * Requires a signed-in, verified customer. Prices the cart from the database,
 * creates the order, initialises payment, and returns where to send the browser.
 *
 * THE IMPORTANT PART: the order's email and identity come from the SESSION, not
 * from the request body. A caller cannot place an order against someone else's
 * address, and cannot redirect a receipt — which contains a home address — to an
 * inbox they do not control. There is no field in this endpoint's schema that
 * lets you say who you are.
 *
 * Email ownership was proven once at signup (/api/auth/verify), so there is no
 * per-checkout OTP. That is the whole reason accounts are mandatory.
 *
 * GIFT CARDS: an optional code. Its credit is held against the order as it is
 * created (see hold_gift_card). When the credit covers the whole total there is
 * nothing for a provider to charge, so the order is confirmed right here through
 * the same atomic confirm_order_payment the webhook uses, with a zero amount.
 */

const schema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1, 'Your cart is empty.')
    .max(50),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  shipping: z.object({
    line1: z.string().trim().min(1, 'Enter your street address.').max(200),
    line2: z.string().trim().max(200).optional().or(z.literal('')),
    city: z.string().trim().min(1, 'Enter your city.').max(120),
    postalCode: z.string().trim().min(1, 'Enter your postal code.').max(32),
    country: z.string().trim().min(2, 'Select your country.').max(80),
  }),
  giftCode: z.string().trim().max(40).optional().or(z.literal('')),
  // Optional only because a gift card can cover the whole order. Required
  // below whenever anything is left to pay.
  paymentMethod: z.enum(['paystack', 'crypto']).optional(),
});

async function create(req, res) {
  const { customer, session } = await requireCustomer(req);
  requireCsrf(req, session);

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  await rateLimit(`checkout:customer:${customer.id}`, { limit: 10, windowSecs: 900 });
  await rateLimit(`checkout:ip:${clientIp(req)}`, { limit: 30, windowSecs: 900 });

  let giftCard = null;
  if (input.giftCode) {
    await rateLimit(`gift-code:customer:${customer.id}`, { limit: 20, windowSecs: 900 });
    giftCard = await findSpendableCard(input.giftCode);
  }

  // Price once, before anything is written, so we know whether a provider is
  // needed and can reject a missing payment method without leaving an order.
  const priced = await priceCart(input.items);
  const { dueCents } = applyGiftCard(priced.totalCents, giftCard?.card);

  let provider = null;
  if (dueCents > 0) {
    if (!input.paymentMethod) {
      throw badRequest('Choose a payment method.', { errors: { paymentMethod: 'Choose how to pay the rest.' } });
    }
    provider = getProvider(input.paymentMethod);
  }

  // Identity comes from the session. Nothing here is caller-supplied.
  const { order, items } = await createOrder({
    customerId: customer.id,
    email: customer.email,
    name: customer.name,
    phone: input.phone,
    items: input.items,
    priced,
    shipping: input.shipping,
    giftCard,
  });

  const orderUrl = `${siteUrl()}/order.html?id=${order.id}&token=${order.access_token}`;
  const summary = {
    orderId: order.id,
    orderNumber: order.order_number,
    accessToken: order.access_token,
    totalCents: order.total_cents,
    giftCardCents: order.gift_card_cents,
    currency: order.currency,
    itemCount: items.length,
  };

  if (!provider) {
    try {
      await rpc('confirm_order_payment', {
        p_order_id: order.id,
        p_provider: 'gift_card',
        p_provider_reference: `gc_${order.id.replace(/-/g, '')}`,
        p_amount_cents: 0,
      });
    } catch (error) {
      // Nothing was charged, so the honest move is to undo the order and give
      // the credit back, then tell them what happened.
      await abandonOrder(order.id);

      if (String(error.message).includes('INSUFFICIENT_STOCK')) {
        throw conflict('A part in your cart sold out a moment ago. Nothing was taken from your gift card.');
      }
      throw error;
    }

    // The order is paid and committed. A failure from here on must not tell the
    // customer their order failed, or they will try again and pay twice.
    try {
      await sendOrderPaidEmails(order.id);
    } catch (error) {
      console.error('[checkout] gift card order paid but receipt failed', { orderId: order.id, message: error.message });
    }

    return ok(res, { ...summary, paidWithGiftCard: true, redirectUrl: orderUrl });
  }

  const init = await startPayment(provider, order, { callbackUrl: orderUrl });

  return ok(res, { ...summary, redirectUrl: init.redirectUrl });
}

export default handler({ POST: create });
