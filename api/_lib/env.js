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
