import { badRequest } from '../http.js';
import cryptoProvider from './crypto.js';
import paystack from './paystack.js';

export { PaymentError, WebhookSignatureError } from './provider.js';

/**
 * Registered payment providers.
 *
 * Paystack (cards) is the only live one. The crypto adapter implements the
 * interface but reports enabled:false, so it is never offered at checkout —
 * see crypto.js for why it is deliberately not implemented.
 *
 * PayPal was removed: the adapter was written against the Orders v2 docs but
 * never exercised against live sandbox credentials, so its capture, refund and
 * webhook-verification paths were unproven. Shipping an unverified payment
 * integration is how you end up taking money you cannot reconcile. To add it
 * back, write an adapter to the PaymentProvider interface in provider.js and
 * register it here — nothing else in the system needs to change.
 */
const PROVIDERS = {
  [paystack.id]: paystack,
  [cryptoProvider.id]: cryptoProvider,
};

/** Resolves a provider by id, rejecting anything unknown or unconfigured. */
export function getProvider(id) {
  const provider = PROVIDERS[id];

  if (!provider) {
    throw badRequest(`Unknown payment method: ${id}`);
  }

  if (!provider.enabled) {
    throw badRequest(`${provider.label} is not available right now. Please choose another payment method.`);
  }

  return provider;
}

/**
 * The methods the customer may actually pick. A provider whose credentials are
 * absent is not offered — which is why the crypto stub cannot be selected and
 * cannot 500 someone's checkout.
 */
export function availableProviders() {
  return Object.values(PROVIDERS)
    .filter((provider) => provider.enabled)
    .map(({ id, label, supportsRefund }) => ({ id, label, supportsRefund }));
}

/** Used by the webhook routes; does not filter on `enabled`. */
export const providerById = (id) => PROVIDERS[id] ?? null;
