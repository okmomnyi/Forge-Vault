import { z } from 'zod';
import bcrypt from 'bcryptjs';
import {
  assertNotLockedOut,
  recordFailedLogin,
  verifyPassword,
} from '../../_lib/auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { sendEmail } from '../../_lib/email/send.js';
import { clientIp, handler, ok, rateLimit, readJson, unauthorized } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { issueOtp } from '../../_lib/otp.js';

/**
 * POST /api/admin/auth/login
 *
 * Step 1 of 2. A correct password does NOT sign you in — it sends a 6-digit
 * code to the admin's email. Step 2 is /api/admin/auth/verify.
 *
 * Two-factor is mandatory here rather than optional because this account can
 * issue refunds and read every customer's address.
 */

const schema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
});

// A bcrypt hash of a value nobody knows, compared against when the email does
// not exist. Without this the endpoint answers noticeably faster for unknown
// addresses, which hands an attacker a list of valid admin emails.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO.9Zt2fZbCM0GcQ8kmhAhAqzHqK0nlZO';

async function login(req, res) {
  const body = await readJson(req);
  const { email, password } = parseOrThrow(schema, body);
  const normalized = email.toLowerCase();

  await rateLimit(`admin-login:ip:${clientIp(req)}`, { limit: 10, windowSecs: 900 });
  await rateLimit(`admin-login:email:${normalized}`, { limit: 8, windowSecs: 900 });

  const rows = unwrap(
    await db().from('admin_users').select('*').eq('email', normalized).limit(1),
    'admin:lookup',
  );

  const admin = rows?.[0];

  if (!admin) {
    // Burn the same time a real comparison would take, then give the same
    // answer a wrong password gives. Enumeration learns nothing.
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Incorrect email or password.');
  }

  await assertNotLockedOut(admin);

  if (!admin.is_active) {
    throw unauthorized('Incorrect email or password.');
  }

  const valid = await verifyPassword(password, admin.password_hash);

  if (!valid) {
    await recordFailedLogin(admin);
    throw unauthorized('Incorrect email or password.');
  }

  // Password is right. Now prove control of the mailbox.
  const { code, ttlMinutes } = await issueOtp({
    email: admin.email,
    purpose: 'admin_2fa',
    adminId: admin.id,
  });

  await sendEmail('otpAdmin2fa', admin.email, {
    code,
    ttlMinutes,
    name: admin.name,
    ip: clientIp(req),
  });

  return ok(res, {
    next: 'verify_2fa',
    email: admin.email,
    ttlMinutes,
  });
}

export default handler({ POST: login });
