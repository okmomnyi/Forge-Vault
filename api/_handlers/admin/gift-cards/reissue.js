import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../../_lib/auth.js';
import { rpc } from '../../../_lib/db.js';
import { adminCard, deliverGiftCard, getCard, newCode } from '../../../_lib/gift-cards.js';
import { conflict, handler, notFound, ok, readJson } from '../../../_lib/http.js';
import { getOrder, parseOrThrow } from '../../../_lib/orders.js';

/**
 * POST /api/admin/gift-cards/:id/reissue
 *
 * Replaces a card's code and emails the new one. The balance carries over; the
 * old code stops working in the same statement. This is the recovery path for
 * every "the code never arrived" case, since the old code cannot be looked up:
 * a bounced email, a mistyped recipient (pass `recipientEmail` to correct it),
 * or a code that got shared somewhere it should not have.
 *
 * Manager or owner only. It sends a spendable credential to an address of the
 * admin's choosing, so it is audited like a refund.
 */

const schema = z.object({
  recipientEmail: z.string().trim().email('Enter a valid email address.').max(255).optional().or(z.literal('')),
});

async function reissue(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const { id } = req.query ?? {};
  const input = parseOrThrow(schema, await readJson(req));

  const before = await getCard(String(id));
  if (!before) throw notFound('Gift card not found.');

  const code = newCode();

  try {
    await rpc('reissue_gift_card', {
      p_card_id: before.id,
      p_code_hash: code.hash,
      p_code_last4: code.last4,
      p_admin_id: admin.id,
      p_recipient_email: input.recipientEmail ? input.recipientEmail.toLowerCase() : null,
    });
  } catch (error) {
    if (String(error.message).includes('GIFT_CARD_NOT_ACTIVE')) {
      throw conflict(`This card is ${before.status}, so there is nothing to reissue.`);
    }
    throw error;
  }

  const after = await getCard(before.id);
  const { order } = await getOrder(after.purchase_order_id, { withItems: false });

  await audit(req, admin, 'gift_card.reissue', {
    entity: 'gift_card',
    entityId: after.id,
    before: { recipient_email: before.recipient_email, code_last4: before.code_last4 },
    after: { recipient_email: after.recipient_email, code_last4: after.code_last4 },
  });

  const email = await deliverGiftCard({ order, card: after, code: code.code, reissued: true });

  return ok(res, {
    giftCard: adminCard(after),
    emailSent: email.sent,
    message: email.sent
      ? `New code ending ${after.code_last4} sent to ${after.recipient_email}. The old code no longer works.`
      : `The code was replaced (old one no longer works) but the email failed: ${email.error}. Fix email delivery and reissue again.`,
  });
}

export default handler({ POST: reissue });
