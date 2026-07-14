import { timingSafeEqual } from 'node:crypto';
import { db, unwrap } from '../../_lib/db.js';
import { optionalEnv } from '../../_lib/env.js';
import { sendEmail } from '../../_lib/email/send.js';
import { applySecurityHeaders, fail, ok } from '../../_lib/http.js';

/**
 * GET /api/cron/lifecycle  — invoked by Vercel Cron (see vercel.json)
 *
 * The time-based emails: abandoned-cart nudges and review requests. These are
 * the only two emails not triggered by a user action, so they need something to
 * drive them.
 *
 * SCHEDULE: daily at 03:00 (`0 3 * * *`). It is daily rather than hourly because
 * Vercel's Hobby plan REJECTS any cron that would run more than once a day —
 * `0 * * * *` fails the deployment outright. On Pro you can safely lower it to
 * hourly in vercel.json; nothing in this file assumes a particular cadence
 * (every candidate is selected by timestamp and marked once processed, so a
 * missed or delayed run just catches up on the next one).
 *
 * Authenticated with CRON_SECRET. Vercel Cron sends it as a bearer token. Left
 * open, this endpoint would be a free "email anyone on my list" button for the
 * whole internet.
 */

const ABANDONED_AFTER_HOURS = 4;
const ABANDONED_GIVE_UP_HOURS = 72;
const REVIEW_AFTER_DAYS = 7;

function authorize(req) {
  const secret = optionalEnv('CRON_SECRET');
  if (!secret) return false;

  const header = String(req.headers.authorization ?? '');
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

/* -------------------------------------------------------------------------
   Abandoned carts: has an email, has sat unconverted for a few hours, and has
   not already been nudged. One nudge only — a second is spam, not marketing.
   ---------------------------------------------------------------------- */

async function abandonedCarts() {
  const now = Date.now();

  const carts = unwrap(
    await db()
      .from('carts')
      .select('*')
      .not('email', 'is', null)
      .is('reminded_at', null)
      .is('converted_at', null)
      .lte('created_at', new Date(now - ABANDONED_AFTER_HOURS * 3600_000).toISOString())
      .gte('created_at', new Date(now - ABANDONED_GIVE_UP_HOURS * 3600_000).toISOString())
      .limit(50),
    'cron:carts',
  );

  let sent = 0;

  for (const cart of carts) {
    const items = Array.isArray(cart.items) ? cart.items : [];
    if (items.length === 0) continue;

    // Mark BEFORE sending. If the send then fails we have not nudged them, but
    // marking after would risk a crash mid-loop re-emailing everyone already
    // contacted on the next run. Under-emailing beats double-emailing.
    unwrap(
      await db().from('carts').update({ reminded_at: new Date().toISOString() }).eq('id', cart.id),
      'cron:cart-mark',
    );

    const result = await sendEmail('abandonedCart', cart.email, { cart, items });
    if (result.sent) sent += 1;
  }

  return { candidates: carts.length, sent };
}

/* -------------------------------------------------------------------------
   Review requests: delivered a week ago, never asked before.
   ---------------------------------------------------------------------- */

async function reviewRequests() {
  const cutoff = new Date(Date.now() - REVIEW_AFTER_DAYS * 86_400_000).toISOString();

  const orders = unwrap(
    await db()
      .from('orders')
      .select('*')
      .eq('status', 'delivered')
      .is('review_requested_at', null)
      .lte('delivered_at', cutoff)
      .limit(50),
    'cron:review-orders',
  );

  let sent = 0;

  for (const order of orders) {
    unwrap(
      await db().from('orders').update({ review_requested_at: new Date().toISOString() }).eq('id', order.id),
      'cron:review-mark',
    );

    const result = await sendEmail('reviewRequest', order.email, { order }, { orderId: order.id });
    if (result.sent) sent += 1;
  }

  return { candidates: orders.length, sent };
}

/* -------------------------------------------------------------------------
   Housekeeping: consumed and expired OTPs, and stale rate-limit buckets.
   ---------------------------------------------------------------------- */

async function prune() {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  unwrap(await db().from('otp_codes').delete().lt('expires_at', dayAgo), 'cron:prune-otp');
  unwrap(await db().from('rate_limits').delete().lt('window_start', dayAgo), 'cron:prune-rate');

  return { pruned: true };
}

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (!authorize(req)) {
    console.error('[cron] rejected unauthorised invocation');
    return fail(res, 401, 'Unauthorized.');
  }

  try {
    const [carts, reviews, pruned] = await Promise.all([abandonedCarts(), reviewRequests(), prune()]);
    return ok(res, { carts, reviews, pruned });
  } catch (error) {
    console.error('[cron] lifecycle run failed', { message: error.message, stack: error.stack });
    return fail(res, 500, 'Cron run failed.');
  }
}
