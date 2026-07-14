import { z } from 'zod';
import { handler, ok, readJson } from '../../_lib/http.js';
import { availableProviders } from '../../_lib/payments/index.js';
import { cartItemSchema, parseOrThrow, priceCart } from '../../_lib/orders.js';

/**
 * POST /api/checkout/quote
 *
 * Re-prices the cart server-side and returns the authoritative totals plus the
 * payment methods on offer. The cart page shows these numbers rather than
 * anything it computed itself, so what the customer sees is what they will be
 * charged — and a tampered localStorage cart is corrected here, before payment,
 * rather than silently ignored at capture time.
 *
 * Throws 409 with a per-item `problems` array when stock has moved.
 */

const schema = z.object({ items: z.array(cartItemSchema).min(1).max(50) });

async function quote(req, res) {
  const body = await readJson(req);
  const { items } = parseOrThrow(schema, body);

  const priced = await priceCart(items);

  return ok(res, {
    currency: priced.currency,
    subtotalCents: priced.subtotalCents,
    shippingCents: priced.shippingCents,
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
    items: priced.lines.map((line) => ({
      productId: line.product_id,
      title: line.title,
      brand: line.brand,
      imagePath: line.image_path,
      unitPriceCents: line.unit_price_cents,
      quantity: line.quantity,
      lineTotalCents: line.line_total_cents,
    })),
    paymentMethods: availableProviders(),
  });
}

export default handler({ POST: quote });
