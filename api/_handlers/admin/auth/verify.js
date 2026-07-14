import { z } from 'zod';
import { audit, createSession, recordSuccessfulLogin, setSessionCookie } from '../../../_lib/auth.js';
import { db, unwrap } from '../../../_lib/db.js';
import { clientIp, handler, ok, rateLimit, readJson, unauthorized } from '../../../_lib/http.js';
import { parseOrThrow } from '../../../_lib/orders.js';
import { verifyOtp } from '../../../_lib/otp.js';

/**
 * POST /api/admin/auth/verify
 *
 * Step 2 of 2. Consumes the emailed code and issues the session.
 *
 * The CSRF token is returned in the BODY, not in a cookie — the front-end holds
 * it in memory and echoes it in a header on every mutation. A cross-site page
 * can cause the session cookie to be sent but cannot read this response, so it
 * cannot produce the header.
 */

const schema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

async function verify(req, res) {
  const body = await readJson(req);
  const { email, code } = parseOrThrow(schema, body);
  const normalized = email.toLowerCase();

  await rateLimit(`admin-2fa:ip:${clientIp(req)}`, { limit: 15, windowSecs: 900 });

  const rows = unwrap(
    await db().from('admin_users').select('*').eq('email', normalized).limit(1),
    'admin:lookup',
  );

  const admin = rows?.[0];
  if (!admin || !admin.is_active) {
    throw unauthorized('That code is not valid.');
  }

  // Throws on wrong / expired / exhausted. Consumes it on success.
  await verifyOtp({ email: normalized, purpose: 'admin_2fa', code });

  const { token, csrfToken, expiresAt } = await createSession(req, admin.id);

  await recordSuccessfulLogin(admin.id);
  await audit(req, admin, 'admin.login', { entity: 'admin_user', entityId: admin.id });

  setSessionCookie(res, token);

  return ok(res, {
    csrfToken,
    expiresAt,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  });
}

export default handler({ POST: verify });
