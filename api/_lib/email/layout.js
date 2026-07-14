import { siteUrl } from '../env.js';

/**
 * Shared email chrome.
 *
 * Email clients are a hostile rendering target: no external CSS, no flexbox in
 * Outlook, no <style> at all in some. Everything here is table-based with
 * inline styles, which is ugly but is what actually renders.
 */

const BRAND = {
  blue: '#2563eb',
  navy: '#0b1220',
  ink: '#0f172a',
  body: '#475569',
  muted: '#94a3b8',
  line: '#e2e8f0',
  bg: '#f1f5f9',
  green: '#16a34a',
  red: '#dc2626',
};

export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export const formatMoney = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents ?? 0) / 100);

export function button(label, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr>
        <td style="border-radius:10px;background:${BRAND.blue};">
          <a href="${escapeHtml(href)}"
             style="display:inline-block;padding:13px 26px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** Renders an order's line items as an invoice table. */
export function itemsTable(items, order) {
  const currency = order.currency ?? 'USD';

  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${BRAND.line};font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.ink};">
          <strong style="font-weight:600;">${escapeHtml(item.title)}</strong><br>
          <span style="font-size:12px;color:${BRAND.muted};">
            ${escapeHtml(item.brand ?? '')}${item.part_number ? ` &bull; ${escapeHtml(item.part_number)}` : ''} &bull; Qty ${item.quantity}
          </span>
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${BRAND.line};font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${BRAND.ink};white-space:nowrap;">
          ${formatMoney(item.line_total_cents, currency)}
        </td>
      </tr>`,
    )
    .join('');

  const totalRow = (label, value, bold = false, color = BRAND.body) => `
      <tr>
        <td style="padding:6px 0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:${bold ? '16px' : '14px'};font-weight:${bold ? '700' : '400'};color:${bold ? BRAND.ink : color};">${escapeHtml(label)}</td>
        <td align="right" style="padding:6px 0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:${bold ? '16px' : '14px'};font-weight:${bold ? '700' : '600'};color:${bold ? BRAND.ink : color};white-space:nowrap;">${value}</td>
      </tr>`;

  const refunded =
    order.refunded_cents > 0
      ? totalRow('Refunded', `-${formatMoney(order.refunded_cents, currency)}`, false, BRAND.green)
      : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      ${rows}
      <tr><td colspan="2" style="height:12px;"></td></tr>
      ${totalRow('Subtotal', formatMoney(order.subtotal_cents, currency))}
      ${totalRow('Shipping', order.shipping_cents ? formatMoney(order.shipping_cents, currency) : 'Free')}
      ${order.tax_cents ? totalRow('Tax', formatMoney(order.tax_cents, currency)) : ''}
      ${refunded}
      <tr><td colspan="2" style="border-top:2px solid ${BRAND.ink};height:8px;"></td></tr>
      ${totalRow('Total', formatMoney(order.total_cents, currency), true)}
    </table>`;
}

/** Renders a shipping address block, or nothing if the order has no address. */
export function addressBlock(order) {
  if (!order.ship_line1) return '';

  const lines = [
    order.ship_name,
    order.ship_line1,
    order.ship_line2,
    [order.ship_postal_code, order.ship_city].filter(Boolean).join(' '),
    order.ship_country,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr>
        <td style="padding:16px;background:${BRAND.bg};border-radius:10px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.body};">
          <strong style="display:block;margin-bottom:6px;color:${BRAND.ink};font-size:12px;text-transform:uppercase;letter-spacing:.08em;">Shipping to</strong>
          ${lines}
        </td>
      </tr>
    </table>`;
}

/**
 * Wraps body HTML in the ForgeVault shell.
 * `preheader` is the grey snippet mail clients show next to the subject.
 */
export function layout({ title, preheader = '', body }) {
  const site = siteUrl();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08);">

          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:${BRAND.navy};">
              <a href="${site}" style="text-decoration:none;font-family:Inter,Helvetica,Arial,sans-serif;font-size:19px;letter-spacing:.14em;text-transform:uppercase;color:#ffffff;">
                <strong style="font-weight:800;">Forge</strong><span style="font-weight:300;">Vault</span>
              </a>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#000000;">
              <p style="margin:0 0 10px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.muted};">
                ForgeVault &bull; Nijverheidsweg 27, Heinenoord, Netherlands<br>
                Questions? <a href="mailto:support@forgevault.shop" style="color:#ffffff;">support@forgevault.shop</a>
              </p>
              <p style="margin:0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:11px;color:#64748b;">
                &copy; 2026 ForgeVault. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const heading = (text) =>
  `<h1 style="margin:0 0 16px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:24px;line-height:1.25;font-weight:800;color:${BRAND.ink};">${escapeHtml(text)}</h1>`;

export const paragraph = (html) =>
  `<p style="margin:0 0 16px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.body};">${html}</p>`;

/** A big, monospaced, selectable one-time code. */
export const codeBlock = (code) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="padding:18px 32px;background:${BRAND.bg};border:1px solid ${BRAND.line};border-radius:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:32px;font-weight:700;letter-spacing:.35em;color:${BRAND.ink};text-align:center;">
        ${escapeHtml(code)}
      </td>
    </tr>
  </table>`;

export const callout = (html, tone = 'info') => {
  const tones = {
    info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e3a8a' },
    success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
    warn: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
    danger: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
  };
  const t = tones[tone] ?? tones.info;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="padding:14px 16px;background:${t.bg};border:1px solid ${t.border};border-radius:10px;font-family:Inter,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${t.text};">
          ${html}
        </td>
      </tr>
    </table>`;
};

export { BRAND };
