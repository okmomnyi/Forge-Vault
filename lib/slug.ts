import { query } from '@/lib/db';

/** URL-safe slug from arbitrary text. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'part';
}

/**
 * Generate a slug that doesn't collide with an existing part. Appends -2, -3…
 * (optionally ignoring one part id, for edits that keep the same name).
 */
export async function generateUniquePartSlug(name: string, ignoreId?: string): Promise<string> {
  const base = slugify(name);
  const rows = await query<{ slug: string }>(
    ignoreId
      ? 'SELECT slug FROM parts WHERE (slug = $1 OR slug LIKE $2) AND id <> $3'
      : 'SELECT slug FROM parts WHERE slug = $1 OR slug LIKE $2',
    ignoreId ? [base, `${base}-%`, ignoreId] : [base, `${base}-%`],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
