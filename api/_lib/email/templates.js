import { CURRENCY, siteUrl } from '../env.js';
import {
  addressBlock,
  button,
  callout,
  codeBlock,
  escapeHtml,
  formatMoney,
  heading,
  itemsTable,
  layout,
  paragraph,
} from './layout.js';

/**
 * Every transactional email the shop sends.
 *
 * A template is a pure function: (data) -> { subject, html, text }. No I/O, no
 * database, no side effects — which means each one can be rendered and eyeballed
 * in isolation (see `npm run email:preview`).
 *
 * Each returns a plain-text alternative too. Plain text is not optional: it is
 * what a screen reader, a watch, and a spam filter all read.
 */

const orderUrl = (order) => `${siteUrl()}/order.html?id=${order.id}&token=${order.access_token ?? ''}`;
const adminOrderUrl = (order) => `${siteUrl()}/admin/orders.html?order=${order.id}`;

/* ==========================================================================
   1. Checkout email verification (OTP)
   ========================================================================== */

export const otpCheckout = ({ code, ttlMinutes }) => ({
  subject: `${code} is your ForgeVault verification code`,
  html: layout({
    title: 'Verify your email',
    preheader: `Your code is ${code}. It expires in ${ttlMinutes} minutes.`,
    body: `
      ${heading('Verify your email to place your order')}
      ${paragraph('Enter this code on the checkout page to confirm your email address. We ask for this so order updates and your receipt reach the right inbox.')}
      ${codeBlock(code)}
      ${paragraph(`This code expires in <strong>${ttlMinutes} minutes</strong> and can only be used once.`)}
      ${callout('If you did not start a checkout at ForgeVault, you can ignore this email — nothing has been charged and no order exists.', 'warn')}
    `,
  }),
  text: `Your ForgeVault verification code is ${code}.\n\nIt expires in ${ttlMinutes} minutes and can only be used once.\n\nIf you did not start a checkout, ignore this email — nothing has been charged.`,
});

/* ==========================================================================
   2. Admin 2FA
   ========================================================================== */

export const otpAdmin2fa = ({ code, ttlMinutes, name, ip }) => ({
  subject: `${code} is your ForgeVault admin sign-in code`,
  html: layout({
    title: 'Admin sign-in code',
    preheader: `Your admin code is ${code}.`,
    body: `
      ${heading('Confirm your admin sign-in')}
      ${paragraph(`Hi ${escapeHtml(name ?? 'there')} — someone entered your password and is trying to sign in to the ForgeVault admin panel.`)}
      ${codeBlock(code)}
      ${paragraph(`This code expires in <strong>${ttlMinutes} minutes</strong>.`)}
      ${callout(
        `Sign-in attempt from IP <strong>${escapeHtml(ip ?? 'unknown')}</strong>.<br><br>
         <strong>If this was not you, your password is compromised.</strong> Do not enter this code. Change your password immediately and check the audit log.`,
        'danger',
      )}
    `,
  }),
  text: `Your ForgeVault admin sign-in code is ${code}. It expires in ${ttlMinutes} minutes.\n\nSign-in attempt from IP ${ip ?? 'unknown'}.\n\nIf this was not you, your password is compromised — do not enter this code, and change your password immediately.`,
});

/* ==========================================================================
   3. Order confirmation / receipt
   ========================================================================== */

export const orderConfirmation = ({ order, items }) => ({
  subject: `Order ${order.order_number} confirmed — ForgeVault`,
  html: layout({
    title: `Order ${order.order_number} confirmed`,
    preheader: `We've received your payment of ${formatMoney(order.total_cents, order.currency)}.`,
    body: `
      ${heading('Thank you — your order is confirmed')}
      ${paragraph(`We've received your payment. This email is your receipt for order <strong>${escapeHtml(order.order_number)}</strong>, placed on ${new Date(order.paid_at ?? order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`)}
      ${itemsTable(items, order)}
      ${addressBlock(order)}
      ${paragraph("We'll email you again with tracking details as soon as your parts are on their way.")}
      ${button('View your order', orderUrl(order))}
      ${callout(
        'Wrong part? Fitment issues are covered — reply to this email within 14 days of delivery and we will sort out a return or exchange.',
        'info',
      )}
    `,
  }),
  text: [
    `Order ${order.order_number} confirmed`,
    '',
    'Thank you — we have received your payment. This is your receipt.',
    '',
    ...items.map((i) => `  ${i.quantity} x ${i.title} — ${formatMoney(i.line_total_cents, order.currency)}`),
    '',
    `Subtotal: ${formatMoney(order.subtotal_cents, order.currency)}`,
    `Shipping: ${order.shipping_cents ? formatMoney(order.shipping_cents, order.currency) : 'Free'}`,
    `Total:    ${formatMoney(order.total_cents, order.currency)}`,
    '',
    `View your order: ${orderUrl(order)}`,
  ].join('\n'),
});

/* ==========================================================================
   4. Payment failed
   ========================================================================== */

export const paymentFailed = ({ order, reason }) => ({
  subject: `Payment could not be completed — order ${order.order_number}`,
  html: layout({
    title: 'Payment failed',
    preheader: 'Your payment did not go through. Your order is still reserved.',
    body: `
      ${heading('We could not take your payment')}
      ${paragraph(`Your payment for order <strong>${escapeHtml(order.order_number)}</strong> did not complete, so the order has not been placed. <strong>You have not been charged.</strong>`)}
      ${reason ? callout(`Reason given by the payment provider: ${escapeHtml(reason)}`, 'danger') : ''}
      ${paragraph('The most common causes are an expired card, insufficient funds, or a bank declining an international transaction. Trying again — or using a different payment method — usually resolves it.')}
      ${button('Try payment again', `${siteUrl()}/checkout.html?retry=${order.id}`)}
      ${paragraph('If it keeps failing, reply to this email and we will help you complete the order another way.')}
    `,
  }),
  text: `Payment failed for order ${order.order_number}.\n\nYou have NOT been charged and the order has not been placed.${reason ? `\n\nReason: ${reason}` : ''}\n\nTry again: ${siteUrl()}/checkout.html?retry=${order.id}`,
});

/* ==========================================================================
   5. Shipped / tracking
   ========================================================================== */

export const orderShipped = ({ order, items, trackingUrl }) => ({
  subject: `Your order ${order.order_number} has shipped`,
  html: layout({
    title: 'Your order has shipped',
    preheader: order.tracking_number ? `Tracking: ${order.tracking_number}` : 'Your parts are on the way.',
    body: `
      ${heading('Your parts are on the way')}
      ${paragraph(`Order <strong>${escapeHtml(order.order_number)}</strong> left our warehouse${order.carrier ? ` with ${escapeHtml(order.carrier)}` : ''}.`)}
      ${
        order.tracking_number
          ? callout(
              `<strong>Tracking number</strong><br>
               <span style="font-family:monospace;font-size:15px;letter-spacing:.05em;">${escapeHtml(order.tracking_number)}</span>`,
              'success',
            )
          : ''
      }
      ${trackingUrl ? button('Track your shipment', trackingUrl) : ''}
      ${itemsTable(items, order)}
      ${addressBlock(order)}
      ${paragraph('Please check the parts against your vehicle before fitting them. If anything looks wrong, contact us before installation — a fitted part cannot be returned.')}
    `,
  }),
  text: [
    `Your order ${order.order_number} has shipped.`,
    order.carrier ? `Carrier: ${order.carrier}` : '',
    order.tracking_number ? `Tracking: ${order.tracking_number}` : '',
    trackingUrl ? `Track: ${trackingUrl}` : '',
    '',
    'Please check the parts against your vehicle before fitting. A fitted part cannot be returned.',
  ]
    .filter(Boolean)
    .join('\n'),
});

/* ==========================================================================
   6. Delivered
   ========================================================================== */

export const orderDelivered = ({ order }) => ({
  subject: `Delivered — order ${order.order_number}`,
  html: layout({
    title: 'Your order was delivered',
    preheader: 'Check your parts before fitting them.',
    body: `
      ${heading('Your order has been delivered')}
      ${paragraph(`The carrier has marked order <strong>${escapeHtml(order.order_number)}</strong> as delivered.`)}
      ${callout(
        `<strong>Before you fit anything:</strong> compare the part against the one you are replacing, and check the part number. If it does not match, contact us <em>before</em> installation — we cannot accept a return on a part that has been fitted.`,
        'warn',
      )}
      ${paragraph('Returns are open for 14 days from delivery. Damaged in transit? Send us a photo and we will replace it.')}
      ${button('View your order', orderUrl(order))}
    `,
  }),
  text: `Order ${order.order_number} has been delivered.\n\nBefore fitting: check the part number against the one you are replacing. If it does not match, contact us BEFORE installation — a fitted part cannot be returned.\n\nReturns are open for 14 days from delivery.`,
});

/* ==========================================================================
   7. Refund issued
   ========================================================================== */

export const refundIssued = ({ order, refund, isPartial }) => ({
  subject: `Refund issued for order ${order.order_number}`,
  html: layout({
    title: 'Refund issued',
    preheader: `${formatMoney(refund.amount_cents, order.currency)} is on its way back to you.`,
    body: `
      ${heading(isPartial ? 'Your partial refund is on its way' : 'Your refund is on its way')}
      ${paragraph(`We have refunded <strong>${formatMoney(refund.amount_cents, order.currency)}</strong> against order <strong>${escapeHtml(order.order_number)}</strong>.`)}
      ${refund.reason ? callout(`<strong>Reason:</strong> ${escapeHtml(refund.reason)}`, 'info') : ''}
      ${paragraph('The money goes back to the original payment method. Card refunds typically take <strong>5&ndash;10 business days</strong> to appear, depending on your bank — that timing is on their side, not ours.')}
      ${
        isPartial
          ? paragraph(
              `This was a partial refund. Total refunded against this order so far: <strong>${formatMoney(order.refunded_cents, order.currency)}</strong> of ${formatMoney(order.total_cents, order.currency)}.`,
            )
          : ''
      }
      ${button('View your order', orderUrl(order))}
    `,
  }),
  text: `Refund issued: ${formatMoney(refund.amount_cents, order.currency)} against order ${order.order_number}.${refund.reason ? `\n\nReason: ${refund.reason}` : ''}\n\nThe money returns to your original payment method and typically takes 5-10 business days to appear.`,
});

/* ==========================================================================
   8. Abandoned cart
   ========================================================================== */

export const abandonedCart = ({ cart, items }) => ({
  subject: 'You left parts in your cart — ForgeVault',
  html: layout({
    title: 'Your cart is waiting',
    preheader: 'Your selected parts are still available.',
    body: `
      ${heading('You left something behind')}
      ${paragraph('Your cart is still saved. Stock on used and OEM parts moves quickly, so if you still need these, it is worth completing the order.')}
      ${itemsTable(items, { subtotal_cents: cart.total_cents, shipping_cents: 0, total_cents: cart.total_cents, currency: CURRENCY, refunded_cents: 0 })}
      ${button('Complete your order', `${siteUrl()}/cart.html`)}
      ${paragraph('Not sure it fits? Reply with your VIN and we will confirm compatibility before you pay.')}
    `,
  }),
  text: `You left parts in your ForgeVault cart.\n\n${items.map((i) => `  ${i.quantity} x ${i.title}`).join('\n')}\n\nComplete your order: ${siteUrl()}/cart.html\n\nNot sure it fits? Reply with your VIN and we'll confirm compatibility.`,
});

/* ==========================================================================
   9. Review request
   ========================================================================== */

export const reviewRequest = ({ order }) => ({
  subject: `How did the parts fit? — order ${order.order_number}`,
  html: layout({
    title: 'How did we do?',
    preheader: 'A quick word on how the parts fitted would help other buyers.',
    body: `
      ${heading('Did the part fit?')}
      ${paragraph(`Your order <strong>${escapeHtml(order.order_number)}</strong> was delivered a little while ago. We build this shop around fitment confidence, so the single most useful thing you can tell us is whether the part actually fitted.`)}
      ${button('Leave a review', `${siteUrl()}/order.html?id=${order.id}&review=1`)}
      ${paragraph('If something did not fit, please tell us instead of leaving a bad review — we would much rather fix it. Reply to this email and we will make it right.')}
    `,
  }),
  text: `How did the parts from order ${order.order_number} fit?\n\nLeave a review: ${siteUrl()}/order.html?id=${order.id}&review=1\n\nIf something did not fit, reply to this email instead — we would rather fix it than leave you with the wrong part.`,
});

/* ==========================================================================
   10. Admin alert — new order
   ========================================================================== */

export const adminNewOrder = ({ order, items }) => ({
  subject: `New order ${order.order_number} — ${formatMoney(order.total_cents, order.currency)}`,
  html: layout({
    title: `New order ${order.order_number}`,
    preheader: `${formatMoney(order.total_cents, order.currency)} from ${order.email}`,
    body: `
      ${heading(`New order: ${order.order_number}`)}
      ${callout(
        `<strong>${formatMoney(order.total_cents, order.currency)}</strong> &bull; paid &bull; ${escapeHtml(order.email)}`,
        'success',
      )}
      ${itemsTable(items, order)}
      ${addressBlock(order)}
      ${button('Open in admin', adminOrderUrl(order))}
    `,
  }),
  text: `New order ${order.order_number} — ${formatMoney(order.total_cents, order.currency)} from ${order.email}\n\n${items.map((i) => `  ${i.quantity} x ${i.title}`).join('\n')}\n\nAdmin: ${adminOrderUrl(order)}`,
});

/* ==========================================================================
   11. Admin alert — refund requested
   ========================================================================== */

export const adminRefundRequest = ({ order, refund }) => ({
  subject: `Refund requested — order ${order.order_number} (${formatMoney(refund.amount_cents, order.currency)})`,
  html: layout({
    title: 'Refund requested',
    preheader: `${order.email} is asking for ${formatMoney(refund.amount_cents, order.currency)} back.`,
    body: `
      ${heading('A customer has requested a refund')}
      ${callout(
        `<strong>${formatMoney(refund.amount_cents, order.currency)}</strong> requested against order <strong>${escapeHtml(order.order_number)}</strong><br>
         Customer: ${escapeHtml(order.email)}`,
        'warn',
      )}
      ${refund.reason ? paragraph(`<strong>Reason given:</strong> ${escapeHtml(refund.reason)}`) : ''}
      ${paragraph('No money has moved. This needs an explicit approval in the admin panel before anything is refunded.')}
      ${button('Review this request', `${siteUrl()}/admin/refunds.html?refund=${refund.id}`)}
    `,
  }),
  text: `Refund requested: ${formatMoney(refund.amount_cents, order.currency)} on order ${order.order_number} by ${order.email}.${refund.reason ? `\n\nReason: ${refund.reason}` : ''}\n\nNo money has moved — approve or reject in the admin panel:\n${siteUrl()}/admin/refunds.html?refund=${refund.id}`,
});

/* ==========================================================================
   12. Admin alert — order paid but stock ran out (needs a human, urgently)
   ========================================================================== */

export const adminStockConflict = ({ order, error }) => ({
  subject: `URGENT: paid order ${order.order_number} could not be fulfilled`,
  html: layout({
    title: 'Paid order cannot be fulfilled',
    preheader: 'A customer paid for stock that is no longer available.',
    body: `
      ${heading('A paid order could not be committed')}
      ${callout(
        `Order <strong>${escapeHtml(order.order_number)}</strong> was paid, but stock could not be reserved:<br><br>
         <span style="font-family:monospace;">${escapeHtml(error)}</span>`,
        'danger',
      )}
      ${paragraph("The customer's money has been taken. This almost always means two customers bought the last unit at the same time. Refund them or source the part — but do it now, before they chase you.")}
      ${button('Open in admin', adminOrderUrl(order))}
    `,
  }),
  text: `URGENT: order ${order.order_number} was PAID but stock could not be committed.\n\n${error}\n\nThe customer has been charged. Refund or source the part immediately.\n\n${adminOrderUrl(order)}`,
});

/* ==========================================================================
   13. Contact form relay
   ========================================================================== */

export const contactMessage = ({ name, email, subject, location, message }) => ({
  subject: `[Contact] ${subject}`,
  html: layout({
    title: 'New contact form message',
    preheader: `From ${name} <${email}>`,
    body: `
      ${heading('New contact form message')}
      ${paragraph(`<strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;<br>
                   <strong>Location:</strong> ${escapeHtml(location)}<br>
                   <strong>Subject:</strong> ${escapeHtml(subject)}`)}
      ${callout(escapeHtml(message).replace(/\n/g, '<br>'), 'info')}
      ${button('Reply', `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Re: ${subject}`)}`)}
    `,
  }),
  text: `New contact message\n\nFrom: ${name} <${email}>\nLocation: ${location}\nSubject: ${subject}\n\n${message}`,
});
