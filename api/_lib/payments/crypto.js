import { optionalEnv } from '../env.js';
import { PaymentError } from './provider.js';

/**
 * Crypto — ADAPTER STUB. Not wired to a provider, and deliberately so.
 * ============================================================================
 *
 * This file implements the PaymentProvider interface so that crypto can be
 * dropped in without touching checkout, the webhook router, or the admin panel.
 * What it does NOT do is pretend to take money. `enabled` is false until you
 * set CRYPTO_PROVIDER, and every method throws rather than returning a
 * plausible-looking fake.
 *
 * That is not laziness — crypto does not behave like a card, and the
 * differences are exactly the things that would silently break the rest of this
 * system if I guessed:
 *
 *   1. SETTLEMENT IS NOT INSTANT. A card either authorises or declines within
 *      seconds. A crypto payment is "seen" and then gains confirmations. You
 *      must decide how many confirmations count as paid (1? 3? 6?) before
 *      confirm_order_payment() runs and stock is decremented. Commit too early
 *      and a reorg un-pays a shipped order.
 *
 *   2. UNDERPAYMENT AND OVERPAYMENT ARE NORMAL. Customers send the wrong amount
 *      routinely — fee estimation, wallet rounding, exchange withdrawal fees.
 *      confirm_order_payment() currently REJECTS an amount mismatch outright,
 *      which is right for cards and wrong for crypto. You need an explicit
 *      tolerance policy and an underpaid/overpaid state.
 *
 *   3. THE PRICE MOVES WHILE THEY PAY. You quote 0.0041 BTC, they pay twenty
 *      minutes later, and it is worth 4% less. Someone has to eat that. Most
 *      providers give you a locked-rate window; you must decide what happens
 *      when it lapses.
 *
 *   4. REFUNDS DO NOT EXIST. There is no "refund" primitive — you are making a
 *      fresh outbound send to an address the customer gives you, which means a
 *      new set of risks (wrong address = money gone forever, no chargeback, no
 *      recall). refund() below throws rather than lie about this, because the
 *      admin panel's refund button must not appear to work when it cannot.
 *
 * TO IMPLEMENT
 * ------------
 * Pick a provider and fill in the four methods:
 *
 *   Coinbase Commerce  — charges API; webhook signed HMAC-SHA256 with the
 *                        shared secret over the raw body (same shape as
 *                        paystack.js, so copy that verification).
 *   BTCPay Server      — self-hosted, no custody, no KYC; Greenfield API.
 *   NOWPayments        — many coins, custodial, IPN callback signed HMAC-512.
 *
 * Then set CRYPTO_PROVIDER=<name> plus its keys, and decide on:
 *   CRYPTO_CONFIRMATIONS_REQUIRED  (1 for low-value, 3+ for high)
 *   CRYPTO_UNDERPAYMENT_TOLERANCE_BPS  (e.g. 100 = accept 1% short)
 */

const notImplemented = (method) => {
  throw new PaymentError(
    `Crypto payments are not configured. Implement ${method}() in api/_lib/payments/crypto.js and set CRYPTO_PROVIDER.`,
    { provider: 'crypto' },
  );
};

const crypto = {
  id: 'crypto',
  label: 'Crypto',
  supportsRefund: false, // see (4) above — refunds are an outbound send, not a reversal

  get enabled() {
    // Stays false until a real provider is chosen. Checkout therefore never
    // offers crypto, and the front-end needs no special-casing for it.
    return Boolean(optionalEnv('CRYPTO_PROVIDER'));
  },

  async initialize() {
    return notImplemented('initialize');
  },

  async verify() {
    return notImplemented('verify');
  },

  async refund() {
    return notImplemented('refund');
  },

  async parseWebhook() {
    return notImplemented('parseWebhook');
  },
};

export default crypto;
