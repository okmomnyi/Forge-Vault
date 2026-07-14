import { z } from 'zod';
import { createSession, publicCustomer, setSessionCookie } from '../../_lib/customer-auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { badRequest, clientIp, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { verifyOtp } from '../../_lib/otp.js';

/**
 * POST /api/auth/verify
 *
 * Confirms the emailed code, marks the account verified, and signs them in.
 * This is the only place email ownership is proven — checkout relies on it
 * having happened, which is why it does not re-verify on every order.
 */

const schema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your email.'),
});

async function verify(req, res) {
  const body = await readJson(req);
  const { email, code } = parseOrThrow(schema, body);
  const normalized = email.toLowerCase();

  await rateLimit(`verify-account:ip:${clientIp(req)}`, { limit: 20, windowSecs: 900 });

  const rows = unwrap(
    await db().from('customers').select('*').eq('email', normalized).limit(1),
    'verify:lookup',
  );

  const customer = rows?.[0];
  if (!customer || !customer.is_active) {
    throw badRequest('That code is not valid.');
  }

  // Throws on wrong / expired / exhausted. Consumes it on success.
  await verifyOtp({ email: normalized, purpose: 'customer_verify', code });

  const updated = unwrap(
    await db()
      .from('customers')
      .update({ email_verified_at: customer.email_verified_at ?? new Date().toISOString() })
      .eq('id', customer.id)
      .select('*'),
    'verify:mark',
  );

  const { token, csrfToken, expiresAt } = await createSession(req, customer.id);
  setSessionCookie(res, token);

  return ok(res, {
    customer: publicCustomer(updated[0]),
    csrfToken,
    expiresAt,
  });
}

export default handler({ POST: verify });
