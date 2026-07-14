import { z } from 'zod';
import { db, unwrap } from '../../_lib/db.js';
import { sendEmail } from '../../_lib/email/send.js';
import { badRequest, clientIp, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { issueOtp } from '../../_lib/otp.js';

/**
 * POST /api/auth/resend
 *
 * Re-sends the account verification code.
 *
 * This endpoint sends mail to an address supplied by the caller, which makes it
 * the most abusable route on the site — hence the hard limits. It also answers
 * identically whether or not the account exists, so it cannot be used to
 * enumerate registered emails.
 */

const schema = z.object({ email: z.string().trim().email().max(255) });

async function resend(req, res) {
  const body = await readJson(req);
  const { email } = parseOrThrow(schema, body);
  const normalized = email.toLowerCase();

  await rateLimit(`resend-account:email:${normalized}`, { limit: 3, windowSecs: 900 });
  await rateLimit(`resend-account:ip:${clientIp(req)}`, { limit: 10, windowSecs: 900 });

  const rows = unwrap(
    await db().from('customers').select('id, email_verified_at, is_active').eq('email', normalized).limit(1),
    'resend:lookup',
  );

  const customer = rows?.[0];

  // Only actually send for an unverified, active account. Everything else falls
  // through to the same 200 below — silence is what stops enumeration.
  if (customer && customer.is_active && !customer.email_verified_at) {
    const { code, ttlMinutes } = await issueOtp({ email: normalized, purpose: 'customer_verify' });
    const delivery = await sendEmail('otpCheckout', normalized, { code, ttlMinutes });

    // A send failure here is a real dead end — the customer cannot proceed
    // without the code. Tell them, rather than leaving them to keep clicking
    // "resend" at a mail server that is refusing us.
    if (!delivery.sent) {
      console.error('[resend] verification email failed to send', { email: normalized });
      throw badRequest('We could not send the email right now. Please try again shortly, or contact support.');
    }
  }

  return ok(res, {
    message: 'If that account needs verifying, a new code is on its way.',
    ttlMinutes: 10,
  });
}

export default handler({ POST: resend });
