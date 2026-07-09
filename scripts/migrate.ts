/**
 * Runs db/schema.sql against the Neon database in DATABASE_URL.
 *
 *   npm run migrate
 *
 * The Neon HTTP driver executes one statement per call, so we strip SQL comments
 * and split the file on semicolons, then run each statement in order. schema.sql
 * is written to be idempotent (IF NOT EXISTS / ON CONFLICT), so re-running is safe.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Create a .env file (see .env.example).');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = join(here, '..', 'db', 'schema.sql');
  const raw = readFileSync(schemaPath, 'utf8');

  const statements = raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, '')) // strip line comments
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const sql = neon(process.env.DATABASE_URL);

  console.log(`Running ${statements.length} statements from db/schema.sql…`);
  for (const [i, statement] of statements.entries()) {
    const preview = statement.replace(/\s+/g, ' ').slice(0, 60);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}… `);
    await sql(statement);
    console.log('ok');
  }

  console.log('✓ Schema applied.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
