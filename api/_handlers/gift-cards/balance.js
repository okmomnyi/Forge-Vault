import { z } from 'zod';
import { lookupBalance } from '../../_lib/gift-cards.js';
import { clientIp, handler, notFound, ok, rateLimit, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';

/**
 * POST /api/gift-cards/balance
 *
 * Lets whoever holds a code see what is left on it, without an account: the
 * person who received a gift card may never have shopped here.
 *
 * POST rather than GET so the code never lands in a URL, where it would sit in
 * browser history, server logs and referrer headers. Rate limited per IP; with
 * 80-bit codes the limit is not what stops guessing, but it keeps the endpoint
 * from being hammered.
 */

const schema = z.object({
  code: z.string().trim().min(1, 'Enter the code from your gift card email.').max(40),
});

async function balance(req, res) {
  await rateLimit(`gift-balance:ip:${clientIp(req)}`, { limit: 15, windowSecs: 900 });

  const body = await readJson(req);
  const { code } = parseOrThrow(schema, body);

  const card = await lookupBalance(code);

  if (!card) {
    throw notFound('We could not find a gift card with that code.', {
      errors: { code: 'Check the code and try again.' },
    });
  }

  return ok(res, { giftCard: card });
}

export default handler({ POST: balance });
