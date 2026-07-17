/**
 * Environment configuration.
 *
 * Every secret is read here and nowhere else, so there is exactly one place to
 * audit. `requireEnv` throws at call time rather than import time: a missing
 * Paystack key should break checkout, not take the whole site down.
 */

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const optionalEnv = (name, fallback = '') => process.env[name] || fallback;

export const isProduction = () => process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

/** Public origin, used to build links in emails and payment callbacks. */
export function siteUrl() {
  const explicit = optionalEnv('SITE_URL');
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel = optionalEnv('VERCEL_URL');
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:5173';
}

export const CURRENCY = optionalEnv('CURRENCY', 'USD');

/** Flat shipping, in cents. Kept trivial on purpose — swap for a real rate table when you have one. */
export const SHIPPING_FLAT_CENTS = Number(optionalEnv('SHIPPING_FLAT_CENTS', '1500'));

/** Free shipping above this order subtotal, in cents. 0 disables the threshold. */
export const FREE_SHIPPING_THRESHOLD_CENTS = Number(optionalEnv('FREE_SHIPPING_THRESHOLD_CENTS', '50000'));

/** Tax rate as a decimal, e.g. 0.21 for 21% VAT. 0 disables tax. */
export const TAX_RATE = Number(optionalEnv('TAX_RATE', '0'));

/* ---------------------------------------------------------------------------
   Payment-currency conversion
   ---------------------------------------------------------------------------
   The store displays and records orders in CURRENCY (USD). Some providers can't
   settle that currency — Paystack rejects USD on a KES account. When a charge
   currency is configured, the amount is converted to it at the payment step
   only; nothing the customer sees changes.

   Both USD and KES use a ×100 subunit, so converting is a straight multiply by
   the rate on the integer "cents".
   ---------------------------------------------------------------------------- */

export const CHARGE_CURRENCY = optionalEnv('PAYMENT_CHARGE_CURRENCY', '').toUpperCase() || CURRENCY;

export const FX_RATE = Number(optionalEnv('PAYMENT_FX_RATE', '1')) || 1;

/** True when a real conversion is in effect (different currency AND a rate). */
export const conversionActive = () => CHARGE_CURRENCY !== CURRENCY && FX_RATE > 0 && FX_RATE !== 1;

/**
 * Converts a display-currency amount (cents) to the charge currency (cents).
 * Rounds to the nearest whole charge-currency unit so the provider page shows a
 * tidy figure. A no-op when no conversion is configured.
 */
export function toChargeAmount(displayCents) {
  if (!conversionActive()) return displayCents;
  return Math.round((displayCents * FX_RATE) / 100) * 100;
}
