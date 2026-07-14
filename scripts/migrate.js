/**
 * Applies db/schema.sql to the database.
 *
 *   npm run migrate
 *
 * Creating tables is DDL, which the Supabase REST API cannot do — it only talks
 * to tables that already exist. So this connects straight to Postgres using
 * DATABASE_URL (Supabase → Settings → Database → Connection string → URI).
 *
 * DATABASE_URL is needed ONLY for this. The running application never uses it,
 * and it must NOT be set in Vercel.
 *
 * The schema is written to be idempotent (create if not exists / or replace),
 * so running this twice is safe and is how you apply a schema change.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'db', 'schema.sql');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(`
DATABASE_URL is not set.

Get it from:  Supabase → Settings → Database → Connection string → URI
Pick the "Session pooler" (port 5432) string and replace [YOUR-PASSWORD]
with your database password, then put it in .env:

  DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
`);
  process.exit(1);
}

// Supabase terminates TLS with a certificate this client won't have in its
// trust store. The connection is still encrypted; we just don't verify the
// chain. Acceptable for a one-shot migration from a trusted machine.
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const sql = readFileSync(schemaPath, 'utf8');

  console.log('Connecting…');
  await client.connect();

  const { rows: [{ db, host }] } = await client.query(
    'select current_database() as db, inet_server_addr()::text as host',
  );
  console.log(`Connected to "${db}"`);

  console.log(`Applying ${schemaPath}…`);
  await client.query(sql);

  // Report what now exists, so a silent partial apply can't masquerade as success.
  const { rows: tables } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);

  const { rows: functions } = await client.query(`
    select routine_name from information_schema.routines
    where routine_schema = 'public' and routine_type = 'FUNCTION'
    order by routine_name
  `);

  console.log(`\n✓ ${tables.length} tables:`);
  console.log('   ' + tables.map((t) => t.table_name).join(', '));

  console.log(`\n✓ ${functions.length} functions:`);
  console.log('   ' + functions.map((f) => f.routine_name).join(', '));

  const required = ['confirm_order_payment', 'record_refund_success', 'restock_order', 'hit_rate_limit'];
  const missing = required.filter((fn) => !functions.some((f) => f.routine_name === fn));

  if (missing.length) {
    throw new Error(`Schema applied but these critical functions are missing: ${missing.join(', ')}`);
  }

  console.log('\n✓ Schema applied. Next: npm run seed');
}

main()
  .catch((error) => {
    console.error('\nMigration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
