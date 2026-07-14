import { z } from 'zod';
import { audit, requireAdmin, requireCsrf, requireRole } from '../../_lib/auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { sendEmail } from '../../_lib/email/send.js';
import { conflict, handler, notFound, ok, readJson } from '../../_lib/http.js';
import { getOrder, parseOrThrow } from '../../_lib/orders.js';

/**
 * PATCH /api/admin/refunds/:id  — reject a customer's refund request.
 *
 * Approval lives in refunds/create.js, because approving is really "issue a
 * refund". This endpoint only closes a request WITHOUT moving money — and it
 * always emails the customer a reason, because silently closing a refund
 * request is how a disappointed customer becomes a chargeback.
 */

const schema = z.object({
  action: z.literal('reject'),
  reason: z.string().trim().min(5, 'Tell the customer why. They get this verbatim.').max(500),
});

async function patch(req, res) {
  const { admin, session } = await requireAdmin(req);
  requireCsrf(req, session);
  requireRole(admin, 'manager');

  const { id } = req.query ?? {};
  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  const rows = unwrap(
    await db().from('refunds').select('*').eq('id', String(id)).limit(1),
    'admin:refund',
  );

  const refund = rows?.[0];
  if (!refund) throw notFound('Refund request not found.');

  if (refund.status !== 'requested') {
    throw conflict(`This request is already "${refund.status}" and cannot be rejected.`);
  }

  const updated = unwrap(
    await db()
      .from('refunds')
      .update({
        status: 'rejected',
        failure_reason: input.reason,
        processed_by_admin: admin.id,
        processed_at: new Date().toISOString(),
      })
      .eq('id', refund.id)
      .eq('status', 'requested') // lost-update guard: two admins cannot both act
      .select('*'),
    'admin:refund-reject',
  );

  if (!updated?.length) {
    throw conflict('Someone else just actioned this request.');
  }

  const { order } = await getOrder(refund.order_id, { withItems: false });

  await audit(req, admin, 'refund.reject', {
    entity: 'refund',
    entityId: refund.id,
    before: refund,
    after: updated[0],
  });

  await sendEmail(
    'refundRejected',
    order.email,
    { order, refund, reason: input.reason },
    { orderId: order.id },
  );

  return ok(res, { refund: updated[0] });
}

export default handler({ PATCH: patch });
