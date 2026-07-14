/**
 * Verifies that email will actually be DELIVERED, not merely accepted.
 *
 *   npm run check-email              validate configuration
 *   npm run check-email you@mail.com validate, then send a real test message
 *
 * WHY THIS EXISTS
 *
 *   Brevo returns 201 Accepted for a message whose sender address is not a
 *   verified sender on the account. The API call succeeds, the app logs "sent",
 *   and the mail is then silently dropped or spam-binned downstream because
 *   Brevo is not authorised to send for that domain.
 *
 *   That is the worst possible failure mode for a one-time code: everything
 *   reports success and the customer simply never receives anything. It cost us
 *   a round of "why does no OTP arrive". This script makes it loud.
 */

import 'dotenv/config';

const key = process.env.BREVO_API_KEY;
const from = process.env.EMAIL_FROM ?? '';
const replyTo = process.env.EMAIL_REPLY_TO;
const adminInbox = process.env.ADMIN_INBOX;

const fail = (message) => {
  console.error(`\n\x1b[31m✗ ${message}\x1b[0m\n`);
  process.exit(1);
};

const parseAddress = (value) => {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value).trim();
};

if (!key) fail('BREVO_API_KEY is not set. No email can be sent at all.');
if (!from) fail('EMAIL_FROM is not set.');

const fromAddress = parseAddress(from);

const brevo = (path, init = {}) =>
  fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json', ...init.headers },
  });

console.log('\nChecking email delivery configuration…\n');

/* ---- 1. Is the key even valid? ---- */
const account = await brevo('/account');
if (!account.ok) {
  fail(`BREVO_API_KEY was rejected (HTTP ${account.status}). Generate a new one at https://app.brevo.com/settings/keys/api`);
}
const acct = await account.json();
console.log(`  \x1b[32m✓\x1b[0m API key valid — account ${acct.email}`);

/* ---- 2. Is EMAIL_FROM a sender Brevo will actually send for? ---- */
const senderRes = await brevo('/senders');
if (!senderRes.ok) fail(`Could not list senders (HTTP ${senderRes.status}).`);

const { senders = [] } = await senderRes.json();
const active = senders.filter((s) => s.active).map((s) => s.email.toLowerCase());

if (active.length === 0) {
  fail('Brevo has no active senders. Add and verify one: https://app.brevo.com/senders');
}

if (!active.includes(fromAddress.toLowerCase())) {
  console.error(`\n\x1b[31m✗ EMAIL_FROM is "${fromAddress}", which is NOT a verified Brevo sender.\x1b[0m`);
  console.error('\n  Brevo will still answer 201 Accepted, the app will log the mail as "sent",');
  console.error('  and it will never arrive. This is exactly the silent failure to avoid.\n');
  console.error('  Verified senders on this account:');
  active.forEach((e) => console.error(`    - ${e}`));
  console.error('\n  Either set EMAIL_FROM to one of the above, or verify your domain at');
  console.error('  https://app.brevo.com/senders/domain/list\n');
  process.exit(1);
}

console.log(`  \x1b[32m✓\x1b[0m EMAIL_FROM (${fromAddress}) is a verified sender`);

/* ---- 3. Sanity-check the other addresses ---- */
const emailish = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

if (!adminInbox || !emailish.test(adminInbox)) {
  fail(`ADMIN_INBOX ("${adminInbox ?? ''}") is not a valid email address. Order and refund alerts would go nowhere.`);
}
console.log(`  \x1b[32m✓\x1b[0m ADMIN_INBOX (${adminInbox}) looks valid`);

if (replyTo && !emailish.test(replyTo)) {
  fail(`EMAIL_REPLY_TO ("${replyTo}") is not a valid email address.`);
}

/* ---- 4. Optional: prove it end-to-end ---- */
const target = process.argv[2];

if (!target) {
  console.log(`
  Configuration is sound.

  To prove delivery end-to-end, send a real message:
      npm run check-email your@email.com
`);
  process.exit(0);
}

if (!emailish.test(target)) fail(`"${target}" is not a valid email address.`);

console.log(`\n  Sending a live test to ${target} …`);

const send = await brevo('/smtp/email', {
  method: 'POST',
  body: JSON.stringify({
    sender: { email: fromAddress, name: 'ForgeVault' },
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    to: [{ email: target }],
    subject: 'ForgeVault — email delivery test',
    htmlContent:
      '<p style="font-family:sans-serif">If you are reading this, ForgeVault can deliver one-time codes, receipts and refund notices to this address.</p>',
  }),
});

const body = await send.json().catch(() => ({}));

if (!send.ok) {
  fail(`Brevo rejected the message (HTTP ${send.status}): ${JSON.stringify(body)}`);
}

console.log(`  \x1b[32m✓\x1b[0m Brevo accepted it — messageId ${body.messageId}`);
console.log(`
  Now go and LOOK in that inbox (and its spam folder).

  Brevo returning 201 only means it accepted the message for delivery. If it
  does not turn up, the sending domain most likely lacks SPF/DKIM records —
  check https://app.brevo.com/senders/domain/list
`);
