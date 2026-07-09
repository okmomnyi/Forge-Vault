import type { PartInput } from '@/lib/parts';
import { CONDITIONS, STOCK_STATUSES, type Compatibility, type UploadedImage } from '@/lib/types';

type ParseResult = { ok: true; input: PartInput } | { ok: false; error: string };

function asOptionalString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

function parseYear(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1900 || n > 2100) return null;
  return n;
}

/**
 * Validates an admin part payload. Required fields are the minimum that makes a
 * listing usable (build spec §8): name, price, category, and at least one image.
 * Everything else is optional at creation.
 */
export function parsePartInput(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Invalid request body.' };
  }
  const body = raw as Record<string, unknown>;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'Name is required.' };

  const price = Number(body.price_kes);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: 'A valid price is required.' };
  }

  const category_id =
    body.category_id === null || body.category_id === undefined || body.category_id === ''
      ? null
      : Number(body.category_id);
  if (category_id === null || !Number.isInteger(category_id)) {
    return { ok: false, error: 'Category is required.' };
  }

  const condition = String(body.condition ?? 'used');
  if (!CONDITIONS.includes(condition as (typeof CONDITIONS)[number])) {
    return { ok: false, error: 'Invalid condition.' };
  }

  const stock_status = String(body.stock_status ?? 'in_stock');
  if (!STOCK_STATUSES.includes(stock_status as (typeof STOCK_STATUSES)[number])) {
    return { ok: false, error: 'Invalid stock status.' };
  }

  const images: UploadedImage[] = Array.isArray(body.images)
    ? body.images
        .map((raw): UploadedImage | null => {
          const row = (raw ?? {}) as Record<string, unknown>;
          const url = typeof row.url === 'string' ? row.url : '';
          if (!url) return null;
          return { url, delete_url: typeof row.delete_url === 'string' ? row.delete_url : null };
        })
        .filter((img): img is UploadedImage => img !== null)
    : [];
  if (images.length === 0) {
    return { ok: false, error: 'At least one image is required.' };
  }

  const compatibility: Compatibility[] = Array.isArray(body.compatibility)
    ? body.compatibility
        .map((c) => {
          const row = (c ?? {}) as Record<string, unknown>;
          return {
            make: typeof row.make === 'string' ? row.make.trim() : '',
            model: typeof row.model === 'string' ? row.model.trim() : '',
            year_start: parseYear(row.year_start),
            year_end: parseYear(row.year_end),
          };
        })
        .filter((c) => c.make && c.model)
    : [];

  const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

  return {
    ok: true,
    input: {
      name,
      part_number: asOptionalString(body.part_number),
      category_id,
      description: asOptionalString(body.description),
      price_kes: price,
      condition: condition as PartInput['condition'],
      stock_status: stock_status as PartInput['stock_status'],
      is_active,
      images,
      compatibility,
    },
  };
}
