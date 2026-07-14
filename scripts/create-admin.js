/**
 * Creates an admin user.
 *
 *   node scripts/create-admin.js "Kelvin Momanyi" kelvin@example.com owner
 *
 * The password is NOT taken as an argument — arguments land in your shell
 * history and in the process list, where any other user on the machine can read
 * them. It is prompted for, hidden, and confirmed.
 *
 * Roles:
 *   owner    — everything, including refunds and deleting products
 *   manager  — products, orders, refunds
 *   support  — orders only (can ship, cannot refund)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).');
  process.exit(1);
}

const [name, email, role = 'owner'] = process.argv.slice(2);

if (!name || !email) {
  console.error('Usage: node scripts/create-admin.js "Full Name" email@example.com [owner|manager|support]');
  process.exit(1);
}

if (!['owner', 'manager', 'support'].includes(role)) {
  console.error(`Unknown role "${role}". Use owner, manager, or support.`);
  process.exit(1);
}

/** Reads a line without echoing it to the terminal. */
function prompt(question, { hidden = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  return new Promise((resolve) => {
    if (hidden) {
      // Swallow the echo so the password never appears on screen.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(char.toString())) {
          stdin.removeListener('data', onData);
        } else {
          stdout.clearLine(0);
          stdout.cursorTo(0);
          stdout.write(question + '*'.repeat(rl.line.length));
        }
      };
      stdin.on('data', onData);
    }

    rl.question(question, (answer) => {
      if (hidden) stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Weak admin passwords are how shops get emptied. This is the floor, not a
 * recommendation — use a generated passphrase.
 */
function validatePassword(password) {
  const problems = [];

  if (password.length < 12) problems.push('at least 12 characters');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/\d/.test(password)) problems.push('a number');

  const common = ['password', 'admin', '12345678', 'qwerty', 'letmein', 'forgevault'];
  if (common.some((word) => password.toLowerCase().includes(word))) {
    problems.push('no common words like "password" or "admin"');
  }

  return problems;
}

async function main() {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const normalized = email.trim().toLowerCase();

  const { data: existing } = await db.from('admin_users').select('id').eq('email', normalized).limit(1);

  if (existing?.length) {
    const confirm = await prompt(`An admin with ${normalized} already exists. Reset their password? (yes/no) `);
    if (confirm.trim().toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  const password = await prompt('Password: ', { hidden: true });
  const problems = validatePassword(password);

  if (problems.length) {
    console.error(`\nThat password needs: ${problems.join(', ')}.`);
    process.exit(1);
  }

  const again = await prompt('Confirm password: ', { hidden: true });

  if (password !== again) {
    console.error('\nThose do not match.');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 12);

  const { error } = await db.from('admin_users').upsert(
    {
      email: normalized,
      name,
      role,
      password_hash,
      is_active: true,
      failed_attempts: 0,
      locked_until: null,
      password_changed_at: new Date().toISOString(),
    },
    { onConflict: 'email' },
  );

  if (error) throw error;

  console.log(`\n✓ Admin ready: ${name} <${normalized}> (${role})`);
  console.log('\nSigning in requires this password AND a code emailed to that address,');
  console.log('so make sure BREVO_API_KEY is configured or you will not be able to get in.');
}

main().catch((error) => {
  console.error('\nFailed:', error.message);
  process.exit(1);
});
