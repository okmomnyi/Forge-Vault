import { siteUrl } from '../env.js';
import { BRAND, button, callout, escapeHtml, formatMoney, heading, itemsTable, layout, paragraph } from './layout.js';

/**
 * Gift card emails.
 *
 * Two different people, two different emails, and only one carries the code:
 *
 *   giftCardDelivery → the RECIPIENT. The code, the sender's name and message.
 *                      Nothing about the buyer beyond the name they chose.
 *   giftCardReceipt  → the BUYER. What they paid and who it went to. Never the
 *                      code: a receipt gets forwarded to accounts, and a gift the
 *                      giver can still spend is not much of a gift.
 */

const orderUrl = (order) => `${siteUrl()}/order.html?id=${order.id}&token=${order.access_token ?? ''}`;

/**
 * The code in a block sized for a phone. The OTP codeBlock is spaced for six
 * digits; at that tracking a 19-character code runs off a narrow screen.
 */
const giftCodeBlock = (code) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="padding:20px 16px;background:${BRAND.bg};border:1px solid ${BRAND.line};border-radius:12px;text-align:center;">
        <div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.muted};">Gift card code</div>
        <div style="margin-top:8px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:22px;font-weight:700;letter-spacing:.06em;color:${BRAND.ink};word-break:break-all;">
          ${escapeHtml(code)}
        </div>
      </td>
    </tr>
  </table>`;

/** A personal message, escaped, with the sender's line breaks kept. */
const messageBlock = (message) =>
  message
    ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
    <tr>
      <td style="padding:16px 18px;border-left:3px solid ${BRAND.ink};background:${BRAND.bg};font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:${BRAND.ink};">
        ${escapeHtml(message).replace(/\r?\n/g, '<br>')}
      </td>
    </tr>
  </table>`
    : '';

export const giftCardDelivery = ({ card, code, reissued = false }) => {
  const amount = formatMoney(card.initial_cents, card.currency);
  const sender = card.sender_name?.trim() || 'Someone';
  const greeting = card.recipient_name ? `Hi ${escapeHtml(card.recipient_name)},` : 'Hi,';

  const subject = reissued
    ? 'Your replacement Forge Vault gift card code'
    : `${sender} sent you a ${amount} Forge Vault gift card`;

  return {
    subject,
    html: layout({
      title: subject,
      preheader: reissued
        ? 'Your gift card has a new code. The old one no longer works.'
        : `${amount} to spend on parts at Forge Vault.`,
      body: `
        ${heading(reissued ? 'Your gift card has a new code' : `You have a ${amount} gift card`)}
        ${
          reissued
            ? paragraph(
                `${greeting} here is a new code for your Forge Vault gift card. It carries the same balance as before.`,
              )
            : paragraph(
                `${greeting} <strong>${escapeHtml(sender)}</strong> sent you a gift card for Forge Vault, where you can buy parts for Opel, Skoda and Ford cars.`,
              )
        }
        ${reissued ? '' : messageBlock(card.message)}
        ${giftCodeBlock(code)}
        ${reissued ? callout('The code we sent before has been switched off. Only the code above works now.', 'warn') : ''}
        ${paragraph('<strong>To use it:</strong> add parts to your cart, and enter this code at checkout. If your order costs less than the card, the rest stays on the card for next time. If it costs more, you pay the difference by card.')}
        ${button('Shop parts', `${siteUrl()}/products.html`)}
        ${paragraph(`Check what is left on it any time at <a href="${siteUrl()}/gift-cards.html#balance" style="color:${BRAND.blue};">forgevault.shop/gift-cards</a>.`)}
        ${callout('<strong>Treat this code like cash.</strong> Anyone who has it can spend the balance. We will never ask you to send it to us.', 'info')}
        ${paragraph(`<span style="font-size:13px;">The card does not expire and cannot be exchanged for cash.</span>`)}
      `,
    }),
    text: [
      reissued
        ? 'Your Forge Vault gift card has a new code. The old code no longer works.'
        : `${sender} sent you a ${amount} Forge Vault gift card.`,
      '',
      !reissued && card.message ? `"${card.message}"\n` : null,
      `Gift card code: ${code}`,
      '',
      'To use it: add parts to your cart and enter this code at checkout. Any balance left over stays on the card.',
      '',
      `Shop parts: ${siteUrl()}/products.html`,
      `Check your balance: ${siteUrl()}/gift-cards.html#balance`,
      '',
      'Treat this code like cash. Anyone who has it can spend the balance.',
      'The card does not expire and cannot be exchanged for cash.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  };
};

export const giftCardReceipt = ({ order, items, card }) => {
  const amount = formatMoney(order.total_cents, order.currency);
  const to = card?.recipient_name
    ? `${escapeHtml(card.recipient_name)} (${escapeHtml(card.recipient_email)})`
    : escapeHtml(card?.recipient_email ?? 'the recipient');

  return {
    subject: `Receipt for your ${amount} gift card, order ${order.order_number}`,
    html: layout({
      title: `Order ${order.order_number}`,
      preheader: `Your ${amount} gift card is paid for and on its way.`,
      body: `
        ${heading('Your gift card is paid for')}
        ${paragraph(`This is your receipt for order <strong>${escapeHtml(order.order_number)}</strong>. We are emailing the gift card to <strong>${to}</strong> now.`)}
        ${itemsTable(items, order)}
        ${callout('For security, the code goes only to the recipient, not to you. Anyone holding the code can spend it, so a receipt should not carry it.', 'info')}
        ${paragraph('If it has not arrived within the hour, ask them to check their spam folder, then reply to this email. We can send a new code, or send it to a corrected address.')}
        ${button('View your order', orderUrl(order))}
      `,
    }),
    text: [
      `Receipt: ${amount} Forge Vault gift card, order ${order.order_number}`,
      '',
      `We are emailing the gift card to ${card?.recipient_email ?? 'the recipient'} now.`,
      'For security, the code goes only to the recipient, not to you.',
      '',
      'If it has not arrived within the hour, reply to this email and we can send a new code.',
      '',
      `View your order: ${orderUrl(order)}`,
    ].join('\n'),
  };
};
