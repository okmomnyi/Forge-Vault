import { z } from 'zod';
import { db, unwrap } from './db.js';
import {
  CHARGE_CURRENCY,
  CURRENCY,
  FREE_SHIPPING_THRESHOLD_CENTS,
  SHIPPING_FLAT_CENTS,
  TAX_RATE,
  toChargeAmount,
} from './env.js';
import { badRequest, conflict, notFound } from './http.js';

/* ==========================================================================
   Validation
   ========================================================================== */

export const cartItemSchema = z.object({
  productId: z.string().uuid('Invalid product.'),
  quantity: z.number().int().min(1).max(99),
});

// NOTE: there is deliberately no shared "checkout schema" that accepts an email
// or a name from the request body. Checkout takes the buyer's identity from
// their session (see api/checkout/create.js) — a schema that let a caller name
// themselves would be an invitation to reintroduce that hole.

/** Turns a Zod failure into a flat { field: message } map for the form. */
export function parseOrThrow(schema, payload) {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'form';
    errors[key] ??= issue.message;
  }

  throw badRequest('Please correct the highlighted fields.', { errors });
}

/* ==========================================================================
   Pricing
   ==========================================================================
   THE RULE: the browser sends product ids and quantities. Nothing else about
   money is believed. Prices, discounts, shipping and tax are all recomputed
   here from the database row, every time.

   If you ever find yourself reading a price out of the request body, stop.
   ========================================================================== */

export async function priceCart(items) {
  const ids = [...new Set(items.map((item) => item.productId))];

  const products = unwrap(
    await db()
      .from('products')
      .select('id, slug, title, brand, part_number, image_path, price_cents, stock, is_active')
      .in('id', ids),
    'cart:products',
  );

  const byId = new Map(products.map((product) => [product.id, product]));

  // Merge duplicate lines for the same product so quantity checks are correct.
  const merged = new Map();
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  const lines = [];
  const problems = [];

  for (const [productId, quantity] of merged) {
    const product = byId.get(productId);

    if (!product || !product.is_active) {
      problems.push({ productId, reason: 'This part is no longer available.' });
      continue;
    }

    if (product.stock < 1) {
      problems.push({ productId, title: product.title, reason: 'Out of stock.' });
      continue;
    }

    if (product.stock < quantity) {
      problems.push({
        productId,
        title: product.title,
        reason: `Only ${product.stock} left in stock.`,
        available: product.stock,
      });
      continue;
    }

    lines.push({
      product_id: product.id,
      title: product.title,
      brand: product.brand,
      part_number: product.part_number,
      image_path: product.image_path,
      unit_price_cents: product.price_cents, // <- from the DB, always
      quantity,
      line_total_cents: product.price_cents * quantity,
    });
  }

  if (problems.length > 0) {
    throw conflict('Some items in your cart are no longer available.', { problems });
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.line_total_cents, 0);

  const shippingCents =
    FREE_SHIPPING_THRESHOLD_CENTS > 0 && subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
      ? 0
      : SHIPPING_FLAT_CENTS;

  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const totalCents = subtotalCents + shippingCents + taxCents;

  return {
    lines,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    currency: CURRENCY,
  };
}

/* ==========================================================================
   Order creation
   ========================================================================== */

/**
 * Creates an order.
 *
 * `customerId` and `email` come from the caller's SESSION — see
 * api/checkout/create.js. They are never read from a request body, which is what
 * stops an order (and the receipt containing a home address) being placed
 * against an inbox the buyer does not control.
 */
export async function createOrder(input) {
  const priced = await priceCart(input.items);
  const email = input.email.trim().toLowerCase();
  const customerId = input.customerId;

  if (!customerId) {
    // Should be unreachable: the only caller requires a session first. Loud
    // rather than silently creating an orphan order.
    throw new Error('createOrder: refusing to create an order with no customer.');
  }

  const order = unwrap(
    await db()
      .from('orders')
      .insert({
        customer_id: customerId,
        email,
        phone: input.phone || null,
        // Email was proven at signup, so the order starts ready to pay.
        status: 'pending_payment',
        email_verified_at: new Date().toISOString(),
        currency: priced.currency,
        subtotal_cents: priced.subtotalCents,
        shipping_cents: priced.shippingCents,
        tax_cents: priced.taxCents,
        total_cents: priced.totalCents,
        // What the payment provider will actually be asked to charge. Equal to
        // the total when no conversion is configured; KES-converted otherwise.
        charge_currency: CHARGE_CURRENCY,
        charge_amount_cents: toChargeAmount(priced.totalCents),
        ship_name: input.name,
        ship_line1: input.shipping.line1,
        ship_line2: input.shipping.line2 || null,
        ship_city: input.shipping.city,
        ship_postal_code: input.shipping.postalCode,
        ship_country: input.shipping.country,
      })
      .select('*'),
    'order:create',
  );

  const created = order[0];

  unwrap(
    await db()
      .from('order_items')
      .insert(priced.lines.map((line) => ({ ...line, order_id: created.id }))),
    'order:items',
  );

  return { order: created, items: priced.lines, priced };
}

/* ==========================================================================
   Reads
   ========================================================================== */

export async function getOrder(orderId, { withItems = true } = {}) {
  const rows = unwrap(
    await db().from('orders').select('*').eq('id', orderId).limit(1),
    'order:get',
  );

  const order = rows?.[0];
  if (!order) throw notFound('Order not found.');

  if (!withItems) return { order, items: [] };

  const items = unwrap(
    await db().from('order_items').select('*').eq('order_id', orderId).order('created_at'),
    'order:get-items',
  );

  return { order, items };
}

/**
 * Fetches an order for a customer, requiring the access token.
 *
 * Comparing the token is what stops order-id enumeration from leaking other
 * people's addresses. The id alone proves nothing.
 */
export async function getOrderForCustomer(orderId, accessToken) {
  const { order, items } = await getOrder(orderId);

  if (!accessToken || order.access_token !== accessToken) {
    throw notFound('Order not found.');
  }

  return { order, items };
}

/** Strips internals before an order is handed to the browser. */
export function publicOrder(order, items = []) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    email: order.email,
    currency: order.currency,
    subtotalCents: order.subtotal_cents,
    shippingCents: order.shipping_cents,
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
    refundedCents: order.refunded_cents,
    trackingNumber: order.tracking_number,
    carrier: order.carrier,
    paidAt: order.paid_at,
    shippedAt: order.shipped_at,
    deliveredAt: order.delivered_at,
    createdAt: order.created_at,
    shipping: {
      name: order.ship_name,
      line1: order.ship_line1,
      line2: order.ship_line2,
      city: order.ship_city,
      postalCode: order.ship_postal_code,
      country: order.ship_country,
    },
    items: items.map((item) => ({
      title: item.title,
      brand: item.brand,
      partNumber: item.part_number,
      imagePath: item.image_path,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
      lineTotalCents: item.line_total_cents,
    })),
  };
}
