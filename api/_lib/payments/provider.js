/**
 * The payment-provider interface.
 *
 * Every adapter implements this shape, so checkout, the webhooks, and the admin
 * refund flow never branch on which provider an order used. Adding a provider
 * means writing one file and registering it — not editing the order logic.
 *
 * @typedef {object} PaymentProvider
 * @property {string}  id            Stable key stored on payments.provider.
 * @property {string}  label         Shown to the customer at checkout.
 * @property {boolean} enabled       Whether its credentials are configured.
 * @property {boolean} supportsRefund
 *
 * @property {(args: InitArgs)   => Promise<InitResult>}   initialize
 *   Starts a payment. Returns where to send the customer.
 *
 * @property {(reference: string) => Promise<VerifyResult>} verify
 *   Asks the provider what actually happened. This is the source of truth —
 *   never the browser's redirect back to us, which a customer can forge.
 *
 * @property {(args: RefundArgs) => Promise<RefundResult>} refund
 *
 * @property {(raw: string, headers: object) => Promise<WebhookEvent|null>} parseWebhook
 *   Verifies the signature and normalises the payload. MUST return null (or
 *   throw) if the signature does not check out.
 *
 * @typedef {object} InitArgs
 * @property {object} order
 * @property {string} email
 * @property {number} amountCents
 * @property {string} currency
 * @property {string} callbackUrl
 *
 * @typedef {object} InitResult
 * @property {string}  reference     Provider-side id, stored on the payment row.
 * @property {string}  redirectUrl   Where to send the browser.
 * @property {object} [clientData]   Anything the front-end SDK needs.
 *
 * @typedef {object} VerifyResult
 * @property {'succeeded'|'failed'|'pending'} status
 * @property {number}  amountCents
 * @property {string}  currency
 * @property {string} [method]
 * @property {string} [failureReason]
 * @property {object}  raw
 *
 * @typedef {object} RefundArgs
 * @property {string} reference       The original payment reference.
 * @property {number} amountCents
 * @property {string} currency
 * @property {string} [reason]
 *
 * @typedef {object} RefundResult
 * @property {'succeeded'|'pending'|'failed'} status
 * @property {string} [reference]
 * @property {string} [failureReason]
 *
 * @typedef {object} WebhookEvent
 * @property {string}  id            Provider event id — the idempotency key.
 * @property {string}  type
 * @property {'payment_succeeded'|'payment_failed'|'refund_succeeded'|'ignored'} kind
 * @property {string} [reference]
 * @property {number} [amountCents]
 * @property {string} [method]
 * @property {string} [failureReason]
 * @property {object}  raw
 */

export class PaymentError extends Error {
  constructor(message, { provider, cause } = {}) {
    super(message);
    this.name = 'PaymentError';
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * A signature that does not verify is not a payment event — it is someone
 * trying to mark an order paid for free. Distinguished from PaymentError so it
 * can be answered with a 401 and logged loudly.
 */
export class WebhookSignatureError extends Error {
  constructor(provider) {
    super(`Invalid webhook signature from ${provider}`);
    this.name = 'WebhookSignatureError';
    this.provider = provider;
  }
}
