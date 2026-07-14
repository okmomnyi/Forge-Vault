import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { db, unwrap } from './db.js';
import { badRequest, tooMany } from './http.js';

/**
 * One-time passcodes for checkout email verification and admin 2FA.
 *
 * Properties this enforces:
 *   - Codes are generated with a CSPRNG (randomInt), not Math.random.
 *   - Only a SHA-256 hash is stored. A stolen DB snapshot can't replay a live code.
 *   - Comparison is timing-safe.
 *   - Single-use: consuming a code marks it, and a consumed code never verifies again.
 *   - Bounded attempts (5) and a short TTL (10 min) — guessing a 6-digit code
 *     needs ~500k tries on average; five kills that.
 *   - Issuing a new code for the same purpose invalidates the previous one, so
 *     an attacker can't keep old codes alive by requesting more.
 */

const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

const hashCode = (code) => createHash('sha256').update(code, 'utf8').digest('hex');

function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function generateCode() {
  // randomInt is rejection-sampled and uniform — no modulo bias.
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += randomInt(0, 10).toString();
  return code;
}

/**
 * Issues a code and returns the plaintext ONCE, for the caller to email.
 * It is never returned to the browser and never logged.
 */
export async function issueOtp({ email, purpose, orderId = null, adminId = null }) {
  const normalized = String(email).trim().toLowerCase();

  // Supersede any live code for this (email, purpose). Without this, an
  // attacker who requests repeatedly would widen the pool of valid codes.
  unwrap(
    await db()
      .from('otp_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('email', normalized)
      .eq('purpose', purpose)
      .is('consumed_at', null),
    'otp:supersede',
  );

  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  unwrap(
    await db().from('otp_codes').insert({
      email: normalized,
      purpose,
      code_hash: hashCode(code),
      order_id: orderId,
      admin_id: adminId,
      max_attempts: MAX_ATTEMPTS,
      expires_at: expiresAt,
    }),
    'otp:insert',
  );

  return { code, expiresAt, ttlMinutes: TTL_MINUTES };
}

/**
 * Verifies a submitted code and consumes it. Throws on every failure path;
 * returns the OTP row on success.
 */
export async function verifyOtp({ email, purpose, code }) {
  const normalized = String(email).trim().toLowerCase();
  const submitted = String(code ?? '').trim();

  if (!/^\d{6}$/.test(submitted)) {
    throw badRequest('Enter the 6-digit code from your email.');
  }

  const rows = unwrap(
    await db()
      .from('otp_codes')
      .select('*')
      .eq('email', normalized)
      .eq('purpose', purpose)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
    'otp:lookup',
  );

  const record = rows?.[0];
  if (!record) {
    throw badRequest('That code is no longer valid. Request a new one.');
  }

  if (new Date(record.expires_at) < new Date()) {
    throw badRequest('That code has expired. Request a new one.');
  }

  if (record.attempts >= record.max_attempts) {
    // Burn it so it can't be attacked further.
    unwrap(
      await db().from('otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', record.id),
      'otp:burn',
    );
    throw tooMany('Too many incorrect attempts. Request a new code.');
  }

  if (!safeEqual(hashCode(submitted), record.code_hash)) {
    const attempts = record.attempts + 1;
    unwrap(await db().from('otp_codes').update({ attempts }).eq('id', record.id), 'otp:attempt');

    const left = record.max_attempts - attempts;
    throw badRequest(
      left > 0
        ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
        : 'Incorrect code. Request a new one.',
    );
  }

  // Correct. Consume it — conditionally, so two concurrent submissions of the
  // same code cannot both succeed.
  const consumed = unwrap(
    await db()
      .from('otp_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', record.id)
      .is('consumed_at', null)
      .select(),
    'otp:consume',
  );

  if (!consumed?.length) {
    throw badRequest('That code has already been used. Request a new one.');
  }

  return record;
}
