import { createHash, randomInt } from 'node:crypto';
import { db, unwrap } from './db.js';
import { sendEmail } from './email/send.js';
import { CURRENCY } from './env.js';
import { badRequest, conflict } from './http.js';

/**
 * Gift cards.
 * ============================================================================
 * The balance itself only ever moves inside the SQL functions in db/schema.sql
 * (hold_gift_card, release_gift_card_hold, confirm_order_payment, ...). This
 * file handles what Postgres should not: generating codes, hashing what a
 * customer typed, and turning the functions' raised errors into messages a
 * customer can act on.
 *
 * THE CODE IS MONEY. Anyone holding it can spend the balance, so:
 *   - it is 16 characters of Crockford base32 from a CSPRNG (80 bits), which
 *     makes guessing one hopeless even before the rate limits;
 *   - only its SHA-256 is stored. A plain hash (not bcrypt) is right here for
 *     the same reason it is right for session tokens: the input is random, not
 *     a human-chosen password, so there is nothing to brute-force offline;
 *   - the plaintext is shown exactly once, in the recipient's email. The buyer's
 *     receipt does not carry it, and nothing can look it up again. A lost code
 *     is replaced with a reissue.
 */

export const GIFT_CARD_MIN_CENTS = 500; // $5
export const GIFT_CARD_MAX_CENTS = 50000; // $500
export const GIFT_CARD_PRESETS_CENTS = [2500, 5000, 10000, 25000];
export const GIFT_CARD_MESSAGE_MAX = 300;

// Crockford base32: no I, L, O or U, so a code read aloud or copied off a phone
// cannot be misread as a different valid code.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

/** Uppercases and strips separators, folding the look-alike letters Crockford excludes. */
export function normalizeCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

const isWellFormed = (normalized) =>
  normalized.length === CODE_LENGTH && [...normalized].every((char) => ALPHABET.includes(char));

export const hashCode = (normalized) => createHash('sha256').update(normalized, 'utf8').digest('hex');

/** A fresh code: the display form for the email, and what gets stored. */
export function newCode() {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];

  return {
    code: raw.match(/.{4}/g).join('-'), // XXXX-XXXX-XXXX-XXXX
    hash: hashCode(raw),
    last4: raw.slice(-4),
  };
}

/* ==========================================================================
   Lookup
   ========================================================================== */

/**
 * Resolves a code a customer typed to a spendable card.
 *
 * An unknown code, a malformed one and a disabled one all get the same answer,
 * so the endpoint cannot be used to learn which codes once existed.
 */
export async function findSpendableCard(input, { field = 'giftCode' } = {}) {
  const normalized = normalizeCode(input);
  const invalid = () =>
    badRequest('That gift card code is not valid.', { errors: { [field]: 'Check the code and try again.' } });

  if (!isWellFormed(normalized)) throw invalid();

  const codeHash = hashCode(normalized);
  const rows = unwrap(
    await db().from('gift_cards').select('*').eq('code_hash', codeHash).limit(1),
    'gift-card:lookup',
  );

  const card = rows?.[0];
  if (!card || card.status !== 'active') throw invalid();

  if (card.currency !== CURRENCY) {
    throw badRequest('This gift card is in a different currency and cannot be used here.', {
      errors: { [field]: 'Wrong currency for this store.' },
    });
  }

  if (card.balance_cents <= 0) {
    throw badRequest('This gift card has been fully spent.', { errors: { [field]: 'No balance left on this card.' } });
  }

  return { card, codeHash };
}

/** Public balance check. Same privacy rule as above: no hint whether a code ever existed. */
export async function lookupBalance(input) {
  const normalized = normalizeCode(input);
  if (!isWellFormed(normalized)) return null;

  const rows = unwrap(
    await db()
      .from('gift_cards')
      .select('status, balance_cents, currency, code_last4')
      .eq('code_hash', hashCode(normalized))
      .limit(1),
    'gift-card:balance',
  );

  const card = rows?.[0];
  if (!card || card.status === 'pending') return null;

  return {
    status: card.status,
    balanceCents: card.balance_cents,
    currency: card.currency,
    last4: card.code_last4,
  };
}

export async function getPurchaseCard(orderId) {
  const rows = unwrap(
    await db().from('gift_cards').select('*').eq('purchase_order_id', orderId).limit(1),
    'gift-card:for-purchase',
  );
  return rows?.[0] ?? null;
}

export async function getCard(cardId) {
  const rows = unwrap(await db().from('gift_cards').select('*').eq('id', cardId).limit(1), 'gift-card:get');
  return rows?.[0] ?? null;
}

/**
 * How much of a priced cart a card pays for, and what is left for the provider.
 * Used by both the quote and order creation, so the number the customer sees is
 * the number that gets held.
 */
export function applyGiftCard(totalCents, card) {
  const appliedCents = card ? Math.min(card.balance_cents, totalCents) : 0;
  return { appliedCents, dueCents: totalCents - appliedCents };
}

/**
 * Translates a raised gift card error into something the customer can act on.
 * Returns null for anything that is not a gift card problem, so the caller
 * rethrows it as the 500 it is.
 */
export function giftCardApiError(error) {
  const message = error?.message ?? '';
  const field = { errors: { giftCode: 'Apply the card again.' } };

  if (message.includes('GIFT_CARD_INSUFFICIENT')) {
    return conflict('The balance on this gift card just changed. Apply it again to see what it covers now.', field);
  }
  if (message.includes('GIFT_CARD_INVALID')) {
    return badRequest('That gift card code is not valid.', { errors: { giftCode: 'Check the code and try again.' } });
  }
  if (message.includes('GIFT_CARD_CURRENCY')) {
    return badRequest('This gift card is in a different currency and cannot be used here.', field);
  }

  return null;
}

/* ==========================================================================
   Shapes handed out
   ========================================================================== */

/** What the buyer sees on their order. Never the code, never its hash. */
export const publicPurchaseCard = (card) =>
  card && {
    status: card.status,
    amountCents: card.initial_cents,
    currency: card.currency,
    recipientEmail: card.recipient_email,
    recipientName: card.recipient_name,
    activatedAt: card.activated_at,
  };

/** Admin view: everything except the hash. */
export function adminCard(card) {
  if (!card) return null;
  const { code_hash: _omit, ...rest } = card;
  return rest;
}

/* ==========================================================================
   Delivery
   ========================================================================== */

/**
 * Emails a code to the recipient. A gift card is "delivered" when that email is
 * accepted, so a paid order moves to delivered only on a successful send. If the
 * send fails the order stays "paid", which is exactly what puts it in front of
 * staff as needing action (a reissue).
 */
export async function deliverGiftCard({ order, card, code, reissued = false }) {
  const result = await sendEmail('giftCardDelivery', card.recipient_email, { card, code, reissued }, { orderId: order.id });

  if (result.sent) {
    unwrap(
      await db()
        .from('orders')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', order.id)
        .in('status', ['paid', 'processing']),
      'gift-card:delivered',
    );
  }

  return result;
}
