import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

/**
 * Supabase client holding the SERVICE ROLE key.
 *
 * This key bypasses Row Level Security and can read and write everything. It
 * must never be sent to the browser — it is only ever imported by files under
 * api/, which run server-side. There is deliberately no anon-key client in
 * this codebase: the browser talks to our own endpoints, never to Supabase.
 */

let client;

/**
 * Catches the single most common Supabase misconfiguration before it turns into
 * a pile of confusing 404s: pasting the REST endpoint instead of the project
 * URL. The client appends /rest/v1 itself, so a URL that already contains it
 * produces .../rest/v1//rest/v1/... and every query fails.
 */
function normalizeUrl(raw) {
  const url = raw.trim().replace(/\/+$/, '');

  if (/\/rest\/v\d/.test(url)) {
    throw new Error(
      `SUPABASE_URL must be the bare project URL, not the REST endpoint. ` +
        `Got "${raw}" — remove the /rest/v1 path so it reads like https://<project>.supabase.co`,
    );
  }

  return url;
}

export function db() {
  if (!client) {
    client = createClient(normalizeUrl(requireEnv('SUPABASE_URL')), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'forgevault-api' } },
    });
  }
  return client;
}

/**
 * Unwraps a PostgREST result, turning its error into a thrown exception so
 * callers can use ordinary try/catch instead of checking `.error` every time.
 */
export function unwrap({ data, error }, context = 'query') {
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}

/** Calls a Postgres function (RPC) and unwraps the result. */
export async function rpc(fn, args) {
  return unwrap(await db().rpc(fn, args), `rpc:${fn}`);
}
