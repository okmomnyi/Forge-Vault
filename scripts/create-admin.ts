/**
 * One-off admin seed script — build spec §6.
 *
 * Run locally against the Neon connection string. There is deliberately NO
 * public admin-creation endpoint.
 *
 *   npm run create-admin -- admin@example.com "a-strong-password"
 *
 * Re-running with an existing email updates that admin's password (upsert),
 * so it doubles as a password-reset tool.
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

async function main() {
  const [, , emailArg, passwordArg] = process.argv;

  if (!emailArg || !passwordArg) {
    console.error('Usage: npm run create-admin -- <email> <password>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Create a .env file (see .env.example).');
    process.exit(1);
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg;
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const passwordHash = await bcrypt.hash(password, 12);

  await sql(
    `INSERT INTO admins (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, passwordHash],
  );

  console.log(`✓ Admin account ready: ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
