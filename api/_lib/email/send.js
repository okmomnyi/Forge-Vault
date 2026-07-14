import { db, unwrap } from '../db.js';
import { optionalEnv, requireEnv } from '../env.js';
import * as coreTemplates from './templates.js';
import * as extraTemplates from './templates-extra.js';

const templates = { ...coreTemplates, ...extraTemplates };

/**
 * Email delivery via Brevo (formerly Sendinblue).
 *
 * Uses the transactional REST API directly — no SDK. The endpoint is a single
 * POST, and pulling in a dependency to build one JSON body would only add
 * weight to every serverless cold start.
 *
 * Two rules hold everywhere:
 *
 *   1. Delivery NEVER breaks the operation that triggered it. If Brevo is down,
 *      an order that has been paid for stays paid — we log the failure and move
 *      on. Losing a receipt is bad; rejecting a successful payment because we
 *      couldn't send one is much worse.
 *
 *   2. Every send is written to email_log, success or failure. When a customer
 *      says "I never got my receipt", that table is the answer.
 *
 * Docs: https://developers.brevo.com/reference/sendtransacemail
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const ADMIN_INBOX = optionalEnv('ADMIN_INBOX', 'support@forgevault.shop');
const REPLY_TO = optionalEnv('EMAIL_REPLY_TO', 'support@forgevault.shop');

/**
 * Brevo wants the sender as { name, email }, but EMAIL_FROM is written in the
 * usual "Name <address>" form. Parse it rather than making the operator learn
 * a bespoke format.
 */
function parseSender(raw) {
  const match = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(raw);

  if (match) {
    return { name: match[1].replace(/^"|"$/g, '') || 'ForgeVault', email: match[2] };
  }

  // A bare address with no display name.
  return { name: 'ForgeVault', email: raw.trim() };
}

async function log(entry) {
  try {
    unwrap(await db().from('email_log').insert(entry), 'email_log:insert');
  } catch (error) {
    console.error('[email] could not write email_log', { message: error.message });
  }
}

/**
 * Renders `template` with `data` and sends it.
 *
 * Returns { sent: boolean }. Callers are not expected to branch on it — it
 * exists so tests and the admin panel can assert on delivery.
 */
export async function sendEmail(templateName, to, data, { orderId = null } = {}) {
  const render = templates[templateName];
  if (typeof render !== 'function') {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  const { subject, html, text } = render(data);
  const recipient = String(to).trim();

  try {
    const sender = parseSender(requireEnv('EMAIL_FROM'));

    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': requireEnv('BREVO_API_KEY'),
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: recipient }],
        replyTo: { email: REPLY_TO },
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Brevo reports failures as { code, message } — surface its own wording,
      // which is far more actionable than a bare status code.
      throw new Error(payload.message ?? `Brevo returned ${response.status}`);
    }

    await log({
      to_email: recipient,
      template: templateName,
      subject,
      order_id: orderId,
      provider_id: payload.messageId ?? null,
      status: 'sent',
    });

    return { sent: true, id: payload.messageId };
  } catch (error) {
    console.error('[email] send failed', { template: templateName, to: recipient, message: error.message });

    await log({
      to_email: recipient,
      template: templateName,
      subject,
      order_id: orderId,
      status: 'failed',
      error: error.message?.slice(0, 500),
    });

    return { sent: false, error: error.message };
  }
}

/** Sends to the shop's own inbox. */
export const sendAdminEmail = (templateName, data, options) => sendEmail(templateName, ADMIN_INBOX, data, options);

/**
 * Fire-and-forget: send without making the caller wait.
 *
 * On Vercel a function can be frozen the moment its response is returned, so a
 * genuinely un-awaited promise may never run. Callers must pass this to
 * `waitUntil` where available; otherwise await it. The helper exists to make
 * the "must not throw" contract explicit at the call site.
 */
export function sendQuietly(templateName, to, data, options) {
  return sendEmail(templateName, to, data, options).catch((error) => {
    console.error('[email] unexpected send error', { template: templateName, message: error.message });
    return { sent: false };
  });
}
