import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  assertNotLockedOut,
  createSession,
  publicCustomer,
  recordFailedLogin,
  recordSuccessfulLogin,
  setSessionCookie,
  verifyPassword,
} from '../_lib/customer-auth.js';
import { db, unwrap } from '../_lib/db.js';
import { sendEmail } from '../_lib/email/send.js';
import { clientIp, handler, ok, rateLimit, readJson, unauthorized } from '../_lib/http.js';
import { parseOrThrow } from '../_lib/orders.js';
import { issueOtp } from '../_lib/otp.js';

/**
 * POST /api/auth/login
 *
 * Email + password. No 2FA — this is a customer buying a wing mirror, not an
 * admin who can issue refunds. (Admins get mandatory email 2FA; see
 * /api/admin/auth/login.)
 */

const schema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

// bcrypt hash of a value nobody knows. Compared against when the email does not
// exist, so an unknown address takes just as long to reject as a wrong password
// — otherwise the response time is an account-enumeration oracle.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO.9Zt2fZbCM0GcQ8kmhAhAqzHqK0nlZO';

async function login(req, res) {
  const body = await readJson(req);
  const { email, password } = parseOrThrow(schema, body);
  const normalized = email.toLowerCase();

  await rateLimit(`login:ip:${clientIp(req)}`, { limit: 20, windowSecs: 900 });
  await rateLimit(`login:email:${normalized}`, { limit: 10, windowSecs: 900 });

  const rows = unwrap(
    await db().from('customers').select('*').eq('email', normalized).limit(1),
    'login:lookup',
  );

  const customer = rows?.[0];

  if (!customer?.password_hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Incorrect email or password.');
  }

  assertNotLockedOut(customer);

  if (!customer.is_active) {
    throw unauthorized('Incorrect email or password.');
  }

  if (!(await verifyPassword(password, customer.password_hash))) {
    await recordFailedLogin(customer);
    throw unauthorized('Incorrect email or password.');
  }

  // Correct password, but they never confirmed the email. Send a fresh code and
  // route them to verification rather than signing them in — the whole point of
  // requiring an account is that the address is proven.
  if (!customer.email_verified_at) {
    const { code, ttlMinutes } = await issueOtp({ email: normalized, purpose: 'customer_verify' });
    await sendEmail('otpCheckout', normalized, { code, ttlMinutes });

    return ok(res, { next: 'verify', email: normalized, ttlMinutes });
  }

  const { token, csrfToken, expiresAt } = await createSession(req, customer.id);
  await recordSuccessfulLogin(customer.id);
  setSessionCookie(res, token);

  return ok(res, { customer: publicCustomer(customer), csrfToken, expiresAt });
}

export default handler({ POST: login });
