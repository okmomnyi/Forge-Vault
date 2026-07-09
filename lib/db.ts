import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

/**
 * Neon serverless client. Raw parameterized SQL only — no ORM (build spec §2).
 *
 * The client is created lazily on first use rather than at import time, so that
 * building the app (which imports route modules to collect metadata) doesn't
 * require a live/valid DATABASE_URL, and modules that never hit the DB stay free
 * of that requirement.
 *
 * Two ways to run a query:
 *   const db = getSql();
 *   db`SELECT * FROM parts WHERE id = ${id}`              -> tagged template
 *   query<Part>('SELECT * FROM parts WHERE id = $1', [id]) -> dynamic query text
 *
 * Both are parameterized under the hood; never interpolate user input into the
 * query text yourself.
 */

let client: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  client = neon(url);
  return client;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  // The neon http function is callable directly with a query string + params
  // array for dynamic query text (as opposed to the tagged-template form).
  const rows = await getSql()(text, params as unknown[]);
  return rows as T[];
}
