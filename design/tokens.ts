/**
 * Forge Auto Parts — design tokens.
 *
 * Direction: blueprint / exploded-view technical drawing. Flat plated panels,
 * 1px cyan linework, no soft shadows or material rounding. See build spec §9.
 *
 * These values are the single source of truth: Tailwind reads them in
 * tailwind.config.ts, and components import them directly where a raw hex is
 * needed (e.g. inline SVG stroke colors on the exploded-diagram card).
 */

export const colors = {
  blueprintNavy: '#0E2A4A', // primary background
  gridLine: '#1C3F63', // subtle background grid, dividers
  diagramCyan: '#6FB7DE', // linework, borders, hover states
  forgeOrange: '#E8622C', // primary accent — CTAs, price highlights, active filters
  steelWhite: '#EDEFF2', // primary text (cool white, not warm cream)
  mutedSteel: '#8B95A1', // secondary text, labels
  whatsappGreen: '#25D366', // deliberate palette exception — WhatsApp affordance only
} as const;

export const fonts = {
  display: 'var(--font-oswald)', // condensed stamped-plate headers, uppercase
  body: 'var(--font-work-sans)', // clean geometric body / UI
  mono: 'var(--font-space-mono)', // prices, part numbers — dimension-callout feel
} as const;

/** Condition + stock status label maps used across catalog and admin. */
export const conditionLabels: Record<string, string> = {
  new: 'New',
  used: 'Used',
  refurbished: 'Refurbished',
};

export const stockStatusLabels: Record<string, string> = {
  in_stock: 'In Stock',
  preorder: 'Preorder',
  out_of_stock: 'Out of Stock',
};

/** Stock status → accent color, for the "LED"-style status pill. */
export const stockStatusColor: Record<string, string> = {
  in_stock: colors.diagramCyan,
  preorder: colors.forgeOrange,
  out_of_stock: colors.mutedSteel,
};
