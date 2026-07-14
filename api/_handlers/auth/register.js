import { z } from 'zod';
import { hashPassword } from '../../_lib/customer-auth.js';
import { db, unwrap } from '../../_lib/db.js';
import { sendEmail } from '../../_lib/email/send.js';
import { badRequest, clientIp, handler, ok, rateLimit, readJson } from '../../_lib/http.js';
import { parseOrThrow } from '../../_lib/orders.js';
import { issueOtp } from '../../_lib/otp.js';

/**
 * POST /api/auth/register
 *
 * Creates an unverified account and emails a 6-digit code. The account cannot
 * sign in or check out until that code is confirmed at /api/auth/verify.
 */

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(255),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200)
    .regex(/[a-z]/, 'Include a lowercase letter.')
    .regex(/[A-Z]/, 'Include an uppercase letter.')
    .regex(/\d/, 'Include a number.'),
});

async function register(req, res) {
  const body = await readJson(req);
  const input = parseOrThrow(schema, body);
  const email = input.email.toLowerCase();

  await rateLimit(`register:ip:${clientIp(req)}`, { limit: 10, windowSecs: 3600 });
  await rateLimit(`register:email:${email}`, { limit: 5, windowSecs: 3600 });

  const existing = unwrap(
    await db().from('customers').select('*').eq('email', email).limit(1),
    'register:lookup',
  );

  const found = existing?.[0];

  if (found?.email_verified_at && found.password_hash) {
    // The account is real and usable. Do NOT confirm that to an anonymous
    // caller — "that email is already registered" is an account-enumeration
    // oracle. Point them at sign-in and say nothing either way.
    throw badRequest('That email cannot be registered. Try signing in instead.', {
      errors: { email: 'Already registered — sign in?' },
    });
  }

  const password_hash = await hashPassword(input.password);

  // A previously-created-but-never-verified record (an abandoned signup, or one
  // created by an older guest checkout) is claimed here rather than blocking a
  // genuine customer from ever registering.
  const customerId = found
    ? unwrap(
        await db()
          .from('customers')
          .update({ name: input.name, password_hash, is_active: true })
          .eq('id', found.id)
          .select('id'),
        'register:claim',
      )[0].id
    : unwrap(
        await db().from('customers').insert({ email, name: input.name, password_hash }).select('id'),
        'register:create',
      )[0].id;

  const { code, ttlMinutes } = await issueOtp({ email, purpose: 'customer_verify' });

  const delivery = await sendEmail('otpCheckout', email, { code, ttlMinutes });

  // Elsewhere a failed email is logged and swallowed — losing a receipt must
  // never undo a payment. Here it is the opposite: the code is the ONLY way
  // forward, so a silent failure would strand the customer on the verify screen
  // forever, waiting for a mail that is never coming. Say so.
  if (!delivery.sent) {
    console.error('[register] verification email failed to send', { email });
    throw badRequest(
      'Your account was created, but we could not send the verification email. Try requesting a new code, or contact support.',
      { next: 'verify', email },
    );
  }

  return ok(res, { email, ttlMinutes, next: 'verify' });
}

export default handler({ POST: register });
