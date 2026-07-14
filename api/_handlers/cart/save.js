import { z } from 'zod';
import { db, unwrap } from '../../_lib/db.js';
import { clientIp, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { cartItemSchema, parseOrThrow, priceCart } from '../../_lib/orders.js';

/**
 * POST /api/cart/save
 *
 * Persists a cart against an email so the abandoned-cart job can find it. The
 * checkout page calls this once the customer has typed their address — not on
 * every keystroke.
 *
 * Prices are recomputed here rather than stored from the client, so an
 * abandoned-cart email can never quote a total the customer invented.
 */

const schema = z.object({
  cartId: z.string().uuid().optional(),
  email: z.string().trim().email().max(255),
  items: z.array(cartItemSchema).min(1).max(50),
});

async function save(req, res) {
  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  await rateLimit(`cart-save:ip:${clientIp(req)}`, { limit: 30, windowSecs: 900 });

  let priced;
  try {
    priced = await priceCart(input.items);
  } catch {
    // A cart with an out-of-stock line is still worth saving — we just cannot
    // price it. Skip silently; this is a marketing nicety, not a checkout step.
    return ok(res, { saved: false });
  }

  const row = {
    email: input.email.trim().toLowerCase(),
    items: priced.lines.map((line) => ({
      title: line.title,
      brand: line.brand,
      quantity: line.quantity,
      line_total_cents: line.line_total_cents,
    })),
    total_cents: priced.totalCents,
    updated_at: new Date().toISOString(),
  };

  const saved = input.cartId
    ? unwrap(await db().from('carts').update(row).eq('id', input.cartId).select('id'), 'cart:update')
    : unwrap(await db().from('carts').insert(row).select('id'), 'cart:insert');

  return ok(res, { saved: true, cartId: saved?.[0]?.id ?? input.cartId });
}

export default handler({ POST: save });
