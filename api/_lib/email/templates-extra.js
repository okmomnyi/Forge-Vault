import { siteUrl } from '../env.js';
import { button, callout, escapeHtml, formatMoney, heading, layout, paragraph } from './layout.js';

/**
 * Refund request declined.
 *
 * Kept honest on purpose: a declined request tells the customer *why*, and
 * points them at a human. Closing a refund request silently is how you turn a
 * disappointed customer into a chargeback.
 */
export const refundRejected = ({ order, refund, reason }) => ({
  subject: `About your refund request — order ${order.order_number}`,
  html: layout({
    title: 'Your refund request',
    preheader: 'We have reviewed your refund request.',
    body: `
      ${heading('We could not approve this refund')}
      ${paragraph(`We have reviewed your request for <strong>${formatMoney(refund.amount_cents, order.currency)}</strong> against order <strong>${escapeHtml(order.order_number)}</strong>.`)}
      ${callout(`<strong>Our reason:</strong> ${escapeHtml(reason)}`, 'warn')}
      ${paragraph('If you think this is wrong, reply to this email. A person reads every reply, and we would rather sort it out with you directly than leave you with a part you cannot use.')}
      ${button('Contact support', `${siteUrl()}/contact.html`)}
    `,
  }),
  text: `We could not approve your refund request for ${formatMoney(refund.amount_cents, order.currency)} on order ${order.order_number}.\n\nReason: ${reason}\n\nIf you think this is wrong, reply to this email — a person reads every reply.`,
});
