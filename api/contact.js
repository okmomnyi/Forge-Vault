import { z } from 'zod';
import { sendAdminEmail } from './_lib/email/send.js';
import { badRequest, clientIp, handler, ok, rateLimit, readJson } from './_lib/http.js';
import { parseOrThrow } from './_lib/orders.js';

/**
 * POST /api/contact
 *
 * Relays the contact form to the shop's inbox.
 *
 * There is no CAPTCHA. Spam protection is therefore entirely server-side:
 *
 *   - Rate limited to 5 submissions per IP per 15 minutes, counted in Postgres
 *     (see http.js) so the limit holds across serverless instances rather than
 *     resetting on every cold start.
 *   - A honeypot field that a human never fills in and a naive bot always does.
 *
 * That stops casual abuse and scripted floods. It will NOT stop a determined
 * spammer rotating IPs — if this inbox starts filling up, a CAPTCHA is the fix.
 */

const schema = z.object({
  name: z.string().trim().min(1, 'This field is required.').max(100),
  email: z.string().trim().min(1, 'This field is required.').email('Enter a valid email address.').max(255),
  subject: z.string().trim().min(1, 'This field is required.').max(200),
  location: z.enum(['Kenya', 'Netherlands', 'Germany', 'United Kingdom', 'Other']),
  message: z.string().trim().min(1, 'This field is required.').max(5000),

  // Honeypot. Accepted permissively ON PURPOSE: if the schema rejected a filled
  // value, the 400 would name this field and tell the bot exactly what to clear.
  // It is validated by hand below, and a hit is answered with a fake success.
  website: z.string().max(200).optional(),
});

async function contact(req, res) {
  const body = await readJson(req);
  const input = parseOrThrow(schema, body);

  // A filled honeypot is a bot. Answer with the SAME 200 a real submission gets,
  // so it believes it succeeded and does not retry with the field cleared —
  // but send no email.
  if (input.website?.trim()) {
    console.warn('[contact] honeypot triggered — dropping submission', { ip: clientIp(req) });
    return ok(res, { message: 'Thanks — your message has been sent.' });
  }

  await rateLimit(`contact:ip:${clientIp(req)}`, { limit: 5, windowSecs: 900 });

  const result = await sendAdminEmail('contactMessage', input);

  if (!result.sent) {
    throw badRequest('We could not send your message right now. Please email us directly.');
  }

  return ok(res, { message: 'Thanks — your message has been sent.' });
}

export default handler({ POST: contact });
