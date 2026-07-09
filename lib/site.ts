/**
 * Central site config. Contact details live here (not the DB) since they change
 * rarely; edit them for the real shop. The WhatsApp number comes from env so it
 * can differ per deployment.
 */
export const site = {
  name: 'Forge Auto Parts',
  location: 'Mombasa',
  addressLines: ['Jomo Kenyatta Ave', 'Mombasa, Kenya'],
  hours: 'Mon–Sat, 8:00am – 6:00pm',
  // Displayed phone (with +). Digits-only WhatsApp number comes from env below.
  phoneDisplay: '+254 700 000 000',
  phoneTel: '+254700000000',
  email: 'sales@forgeautoparts.co.ke',
  tagline: 'New, used & refurbished spare parts — ordered over WhatsApp.',
} as const;

/** Absolute site origin, used for building shareable product links. */
export function siteUrl(): string {
  // Vercel sets VERCEL_PROJECT_PRODUCTION_URL; fall back to localhost in dev.
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  return (fromEnv || 'http://localhost:3000').replace(/\/$/, '');
}

export function partUrl(slug: string): string {
  return `${siteUrl()}/parts/${slug}`;
}
