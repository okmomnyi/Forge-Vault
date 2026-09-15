import { z } from 'zod';
import { requireCustomer } from '../../_lib/customer-auth.js';
import { CHARGE_CURRENCY, conversionActive, toChargeAmount } from '../../_lib/env.js';
import { applyGiftCard, findSpendableCard } from '../../_lib/gift-cards.js';
import { clientIp, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
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
 * With a `giftCode`, also reports how much the card covers. That part needs a
 * signed-in customer: checkout requires one anyway, and it keeps an anonymous
 * caller from using this endpoint as a free balance oracle beyond the public,
 * rate-limited /api/gift-cards/balance.
 *
 * Throws 409 with a per-item `problems` array when stock has moved.
 */

const schema = z.object({
  items: z.array(cartItemSchema).min(1).max(50),
  giftCode: z.string().trim().max(40).optional().or(z.literal('')),
});

async function quote(req, res) {
  const body = await readJson(req);
  const { items, giftCode } = parseOrThrow(schema, body);

  let giftCard = null;
  if (giftCode) {
    const { customer } = await requireCustomer(req);
    await rateLimit(`gift-code:customer:${customer.id}`, { limit: 20, windowSecs: 900 });
    await rateLimit(`gift-code:ip:${clientIp(req)}`, { limit: 40, windowSecs: 900 });
    ({ card: giftCard } = await findSpendableCard(giftCode));
  }

  const priced = await priceCart(items);
  const { appliedCents, dueCents } = applyGiftCard(priced.totalCents, giftCard);

  return ok(res, {
    currency: priced.currency,
    subtotalCents: priced.subtotalCents,
    shippingCents: priced.shippingCents,
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
    giftCard: giftCard
      ? { last4: giftCard.code_last4, balanceCents: giftCard.balance_cents, appliedCents }
      : null,
    // What is left for a payment provider after gift card credit. Zero means the
    // card covers everything and no payment method is needed.
    dueCents,
    // When settlement is in a different currency, tell the customer what they
    // will actually be charged, so seeing KES on the provider page is expected.
    charge:
      conversionActive() && dueCents > 0
        ? { currency: CHARGE_CURRENCY, amountCents: toChargeAmount(dueCents) }
        : null,
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
