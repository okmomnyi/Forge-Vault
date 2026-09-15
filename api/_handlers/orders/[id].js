import { getPurchaseCard, publicPurchaseCard } from '../../_lib/gift-cards.js';
import { ApiError, handler, ok, rateLimit, unauthorized } from '../../_lib/http.js';
import { OPEN_ORDER_STATUSES, getOrderForCustomer, publicOrder } from '../../_lib/orders.js';
import { reconcileOrderPayment } from '../../_lib/reconcile.js';

/**
 * GET /api/orders/:id?token=...
 *
 * Customer-facing order lookup. The access token is mandatory — the id alone
 * proves nothing, so enumerating ids leaks no addresses or baskets.
 *
 * This is where Paystack sends the customer back after paying. If the order is
 * still waiting on payment, the page asks Paystack what happened before
 * answering, so a declined card shows as declined at once, and a payment whose
 * webhook is late shows as paid. The redirect itself proves nothing and is not
 * trusted: it only prompts the check, and the provider's API decides.
 */

async function get(req, res) {
  const { id } = req.query ?? {};
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');

  if (!token) throw unauthorized('This link is missing its access token.');

  let { order, items } = await getOrderForCustomer(String(id), token);

  if (!order.paid_at && OPEN_ORDER_STATUSES.includes(order.status) && (await mayReconcile(order.id))) {
    try {
      const { outcome } = await reconcileOrderPayment(order.id);
      if (['paid', 'failed', 'abandoned'].includes(outcome)) {
        ({ order, items } = await getOrderForCustomer(String(id), token));
      }
    } catch (error) {
      // Showing the order matters more than refreshing its status.
      console.error('[orders] reconcile on view failed', { orderId: order.id, message: error.message });
    }
  }

  const giftCard = order.kind === 'gift_card' ? publicPurchaseCard(await getPurchaseCard(order.id)) : null;

  return ok(res, { order: publicOrder(order, items, { giftCard }) });
}

/** A reload-happy customer should not turn into a stream of provider API calls. */
async function mayReconcile(orderId) {
  try {
    await rateLimit(`reconcile:order:${orderId}`, { limit: 3, windowSecs: 60 });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return false;
    throw error;
  }
}

export default handler({ GET: get });
