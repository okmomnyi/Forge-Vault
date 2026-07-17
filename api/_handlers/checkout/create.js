import { z } from 'zod';
import { requireCsrf, requireCustomer } from '../../_lib/customer-auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { siteUrl } from '../../_lib/env.js';
import { badRequest, clientIp, conflict, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { createOrder, parseOrThrow } from '../../_lib/orders.js';
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
  paymentMethod: z.enum(['paystack', 'crypto']),
});

async function create(req, res) {
  const { customer, session } = await requireCustomer(req);
  requireCsrf(req, session);

  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  await rateLimit(`checkout:customer:${customer.id}`, { limit: 10, windowSecs: 900 });
  await rateLimit(`checkout:ip:${clientIp(req)}`, { limit: 30, windowSecs: 900 });

  const provider = getProvider(input.paymentMethod);

  // Identity comes from the session. Nothing here is caller-supplied.
  const { order, items } = await createOrder({
    customerId: customer.id,
    email: customer.email,
    name: customer.name,
    phone: input.phone,
    items: input.items,
    shipping: input.shipping,
  });

  let init;
  try {
    init = await provider.initialize({
      order,
      email: order.email,
      // Charge in the provider's currency (KES), not the display currency (USD).
      // These equal the order total when no conversion is configured.
      amountCents: order.charge_amount_cents ?? order.total_cents,
      currency: order.charge_currency ?? order.currency,
      callbackUrl: `${siteUrl()}/order.html?id=${order.id}&token=${order.access_token}`,
    });
  } catch (error) {
    console.error('[checkout] provider init failed', {
      provider: input.paymentMethod,
      message: error.message,
    });

    // The order exists but can never be paid for. Cancel it so it does not sit
    // in the admin panel forever looking like a lost sale.
    unwrap(
      await db().from('orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', order.id),
      'checkout:abandon',
    );

    throw badRequest('We could not start the payment. Please try again, or choose another method.');
  }

  // Record the attempt so the webhook can find this order by its reference.
  unwrap(
    await db().from('payments').insert({
      order_id: order.id,
      provider: provider.id,
      provider_reference: init.reference,
      status: 'initiated',
      // Payments are recorded in the charged currency (what the provider moves).
      amount_cents: order.charge_amount_cents ?? order.total_cents,
      currency: order.charge_currency ?? order.currency,
    }),
    'payment:init',
  );

  unwrap(
    await db().from('orders').update({ status: 'pending_payment' }).eq('id', order.id),
    'checkout:pending',
  );

  return ok(res, {
    orderId: order.id,
    orderNumber: order.order_number,
    accessToken: order.access_token,
    totalCents: order.total_cents,
    currency: order.currency,
    itemCount: items.length,
    redirectUrl: init.redirectUrl,
  });
}

export default handler({ POST: create });
