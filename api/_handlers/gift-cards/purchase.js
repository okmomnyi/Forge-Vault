import { z } from 'zod';
import { requireCsrf, requireCustomer } from '../../_lib/customer-auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { CHARGE_CURRENCY, CURRENCY, conversionActive, FX_RATE, siteUrl, toChargeAmount } from '../../_lib/env.js';
import {
  GIFT_CARD_MAX_CENTS,
  GIFT_CARD_MESSAGE_MAX,
  GIFT_CARD_MIN_CENTS,
  GIFT_CARD_PRESETS_CENTS,
} from '../../_lib/gift-cards.js';
import { clientIp, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { abandonOrder, parseOrThrow, startPayment } from '../../_lib/orders.js';
import { availableProviders, getProvider } from '../../_lib/payments/index.js';

/**
 * GET  /api/gift-cards/purchase — the limits and payment methods the form needs
 * POST /api/gift-cards/purchase
 *
 * Buys a gift card. It is an ordinary order (kind = 'gift_card') with one line
 * and nothing to ship, paid through the same provider and confirmed by the same
 * signed webhook as a parts order. The card row starts 'pending' with no code;
 * the code is created only when confirm_order_payment activates it, so an
 * unpaid purchase never produces anything spendable.
 *
 * The BUYER comes from the session, like checkout. The RECIPIENT is typed in,
 * which is the point of a gift. That is safe because nothing goes to the
 * recipient until a real payment has cleared, and what they receive (a code, the
 * sender's chosen name, a short message) contains nothing of the buyer's — not
 * their email, not their address.
 *
 * No tax is charged here. A gift card is a prepayment, not a sale of goods; tax
 * applies when it is spent on parts, and checkout already prices that.
 */

const schema = z.object({
  amountCents: z
    .number({ error: 'Choose an amount.' })
    .int('Choose a whole-dollar amount.')
    .min(GIFT_CARD_MIN_CENTS, `Gift cards start at $${GIFT_CARD_MIN_CENTS / 100}.`)
    .max(GIFT_CARD_MAX_CENTS, `Gift cards go up to $${GIFT_CARD_MAX_CENTS / 100}.`)
    .refine((cents) => cents % 100 === 0, 'Choose a whole-dollar amount.'),
  recipientEmail: z.string().trim().email("Enter the recipient's email address.").max(255),
  recipientName: z.string().trim().max(80).optional().or(z.literal('')),
  senderName: z.string().trim().max(80).optional().or(z.literal('')),
  message: z
    .string()
    .trim()
    .max(GIFT_CARD_MESSAGE_MAX, `Keep the message under ${GIFT_CARD_MESSAGE_MAX} characters.`)
    .optional()
    .or(z.literal('')),
  paymentMethod: z.enum(['paystack', 'crypto'], { error: 'Choose a payment method.' }),
});

/** Everything the purchase form shows comes from here, so it cannot drift from what POST enforces. */
async function options(_req, res) {
  return ok(res, {
    currency: CURRENCY,
    minCents: GIFT_CARD_MIN_CENTS,
    maxCents: GIFT_CARD_MAX_CENTS,
    presetsCents: GIFT_CARD_PRESETS_CENTS,
    messageMax: GIFT_CARD_MESSAGE_MAX,
    paymentMethods: availableProviders(),
    // The page shows the exact amount the provider will charge in its currency,
    // using the same whole-unit rounding as toChargeAmount.
    charge: conversionActive() ? { currency: CHARGE_CURRENCY, rate: FX_RATE } : null,
  });
}

async function purchase(req, res) {
  const { customer, session } = await requireCustomer(req);
  requireCsrf(req, session);

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  await rateLimit(`gift-buy:customer:${customer.id}`, { limit: 5, windowSecs: 3600 });
  await rateLimit(`gift-buy:ip:${clientIp(req)}`, { limit: 20, windowSecs: 3600 });

  const provider = getProvider(input.paymentMethod);
  const amountCents = input.amountCents;

  const [order] = unwrap(
    await db()
      .from('orders')
      .insert({
        kind: 'gift_card',
        customer_id: customer.id,
        email: customer.email,
        status: 'pending_payment',
        email_verified_at: new Date().toISOString(),
        currency: CURRENCY,
        subtotal_cents: amountCents,
        shipping_cents: 0,
        tax_cents: 0,
        total_cents: amountCents,
        charge_currency: CHARGE_CURRENCY,
        charge_amount_cents: toChargeAmount(amountCents),
      })
      .select('*'),
    'gift-buy:order',
  );

  try {
    unwrap(
      await db().from('order_items').insert({
        order_id: order.id,
        product_id: null,
        title: 'Forge Vault gift card',
        brand: 'Forge Vault',
        unit_price_cents: amountCents,
        quantity: 1,
        line_total_cents: amountCents,
      }),
      'gift-buy:item',
    );

    unwrap(
      await db().from('gift_cards').insert({
        currency: CURRENCY,
        initial_cents: amountCents,
        purchase_order_id: order.id,
        purchaser_customer_id: customer.id,
        recipient_email: input.recipientEmail.toLowerCase(),
        recipient_name: input.recipientName || null,
        sender_name: input.senderName || customer.name || null,
        message: input.message || null,
      }),
      'gift-buy:card',
    );
  } catch (error) {
    // An order with no card behind it could be paid for and deliver nothing.
    await abandonOrder(order.id);
    throw error;
  }

  const init = await startPayment(provider, order, {
    callbackUrl: `${siteUrl()}/order.html?id=${order.id}&token=${order.access_token}`,
  });

  return ok(res, {
    orderId: order.id,
    orderNumber: order.order_number,
    accessToken: order.access_token,
    redirectUrl: init.redirectUrl,
  });
}

export default handler({ GET: options, POST: purchase });
