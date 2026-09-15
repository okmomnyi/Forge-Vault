# Forge Vault

E-commerce storefront and admin panel for European auto parts (Opel / Stellantis, Skoda, Ford).

Vite + vanilla JS + Tailwind on the front, Vercel serverless functions + Supabase Postgres on the back.
No framework, no ORM.

```bash
npm install
cp .env.example .env      # fill it in — see below
npm run dev               # http://localhost:5173
npm run build
```

## Pages

| Route             | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `/`               | Home — hero slider, reviews, Recommended, Deals, Categories         |
| `/products.html`  | Catalogue with search and category filter                           |
| `/product.html`   | Part detail                                                         |
| `/cart.html`      | Cart (totals priced server-side)                                    |
| `/checkout.html`  | Details → emailed code → payment (accepts a gift card code)         |
| `/gift-cards.html`| Buy a gift card, check a balance, gift card terms                   |
| `/order.html`     | Order status + refund request (needs the access token from email)   |
| `/about.html`     | About                                                               |
| `/contact.html`   | Contact + map + form                                                |
| `/admin/*`        | Login (2FA), dashboard, orders, products, refunds                   |

## Setup

**1. Database.** Create a Supabase project, then run `db/schema.sql` in the SQL editor.
It creates 19 tables plus the SQL functions that make payment, refunds and gift card balances atomic.
The file is idempotent, so on an existing database `npm run migrate` applies new changes (such as gift cards) in place.

**2. Seed and create an admin.**

```bash
npm run seed                                              # categories + the 12 parts
npm run create-admin "Your Name" you@example.com owner    # prompts for a password
```

**3. Fill in `.env`** — every variable is documented in `.env.example`.
The minimum for a working checkout is `SUPABASE_*`, `BREVO_API_KEY`, and `PAYSTACK_SECRET_KEY`.

**4. Register the webhooks.** Paid orders are confirmed by webhook, not by the browser
redirect — without these, customers will be charged and their orders will never be confirmed.

- Paystack → `https://YOUR-DOMAIN/api/webhooks/paystack`

## How checkout works

**Checkout requires an account.** There is no guest checkout.

```
register  →  POST /api/auth/register   creates the account, emails a 6-digit code
          →  POST /api/auth/verify     confirms the code, signs them in

checkout  →  POST /api/checkout/create  REQUIRES a session. Prices the cart from the
                                        DB, creates the order, starts payment.
          →  customer pays at Paystack
          →  POST /api/webhooks/paystack  ← this is what actually confirms the order
                                            verifies signature, re-checks with the
                                            provider, decrements stock atomically,
                                            emails the receipt
```

The order's email and identity come from the **session**, never the request body. There is
no field in the checkout schema that lets a caller say who they are — so an order (and the
receipt, which carries a home address) cannot be placed against an inbox the buyer does not
control. Email ownership is proven once at signup, which is why there is no per-checkout OTP.

The browser redirect back from the provider is **not** trusted — a customer can forge it.
Only a signed webhook, re-confirmed against the provider's own API, marks an order paid.

**Declined and abandoned payments.** Paystack sends a webhook only for `charge.success`, never for a
declined card or a closed payment page, so those orders would otherwise sit on "Awaiting payment"
forever. `api/_lib/reconcile.js` asks Paystack's verify API instead and applies its answer through the
same code as the webhook: declined → `payment_failed`, abandoned for over an hour → `cancelled`, and
paid-but-webhook-missed → committed as paid. It runs from the daily cron, when a customer lands back on
their order page, and from **Check pending payments** on the admin orders page. The one-hour grace exists
because Paystack reports a transaction nobody has tried to pay yet as "abandoned" too; a payment that
completes after an order was closed is still confirmed by its webhook.

## Payments

Adapters behind one interface (`api/_lib/payments/`), so nothing else in the system
branches on which provider an order used.

| Provider     | Status                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| **Paystack** | Implemented and tested. Cards. HMAC-SHA512 webhook signatures.                     |
| **Crypto**   | **Stub — not implemented.** See below.                                            |

PayPal was removed: the adapter was written from the Orders v2 docs but never exercised
against live sandbox credentials, so its capture, refund and webhook-verification paths were
unproven. To add it back, write one file against the interface in `provider.js` and register
it — nothing else in the system changes.

**On crypto:** The crypto adapter implements the interface but every method throws, and it
reports `enabled: false` so checkout never offers it. This is deliberate — crypto differs
from cards in ways that would quietly corrupt the order state machine if guessed at:
settlement is probabilistic (how many confirmations count as paid?), under- and overpayment
are routine (the code currently rejects any amount mismatch outright), the price moves while
the customer pays, and **refunds do not exist** — a "refund" is a fresh outbound send with no
chargeback and no recall. Pick a provider (Coinbase Commerce, BTCPay, NOWPayments), decide
those policies, then fill in the four methods. `api/_lib/payments/crypto.js` documents exactly
what has to be decided.

## Gift cards

Customers buy a card for $5 to $500 on `/gift-cards.html`. It is emailed to a recipient, and spent at checkout.

```
buy     →  POST /api/gift-cards/purchase   REQUIRES a session. Creates an order (kind = 'gift_card')
                                           and a PENDING card with no code, then starts payment.
        →  POST /api/webhooks/paystack     confirm_order_payment activates the card with a freshly
                                           generated code, in the same transaction as the payment.
                                           The code is emailed to the recipient; the buyer's receipt
                                           does not carry it.

spend   →  POST /api/checkout/quote        with giftCode: shows what the card covers
        →  POST /api/checkout/create       with giftCode: holds the credit as the order is created.
                                           If the card covers everything, the order is confirmed on
                                           the spot (no provider); otherwise the rest goes to Paystack.

balance →  POST /api/gift-cards/balance    no account needed, rate limited, code in the body not the URL
```

The properties, and where they live:

- **The code is money, so only its SHA-256 is stored** (`gift_cards.code_hash`), like a session token. It is
  16 characters of Crockford base32 from a CSPRNG (80 bits). The plaintext exists once, in the recipient's
  email. A lost or misdirected code is fixed by **reissuing** from the admin order page: new code, same
  balance, old code dead in the same statement.
- **Balances only move inside SQL functions** (`hold_gift_card`, `release_gift_card_hold`,
  `confirm_order_payment`, `record_refund_success`, `void_gift_card_for_refund`, `reverse_gift_card_void`,
  `reissue_gift_card`). Each locks the row and writes an append-only `gift_card_transactions` ledger row.
  CHECK constraints are the backstop: a balance cannot go negative, cannot exceed what was paid, and an
  order cannot have more credit returned than it used.
- **Credit is held when the order is created**, so it cannot be spent twice while the customer is on the
  payment page. An unpaid order's hold is released when it is cancelled, when payment fails to start, and by
  the daily cron after 24 hours. If a payment lands after release, the confirm re-takes the credit, or, if
  it has been spent meanwhile, flags the paid order for a human exactly like a last-unit stock race.
- **Refunds follow the money.** On an order paid partly by gift card, the paying card is refunded first (up
  to what it paid) and the rest goes back onto the gift card. Refunding a gift card *purchase* is capped at
  the unspent balance, which is voided **before** the provider is called, and restored if the provider refuses.
- **Revenue is not double-counted.** A card is counted when sold; parts paid for with it are not counted again.
- Gift cards cannot buy gift cards (enforced by a CHECK), carry no tax (tax applies when spent on parts),
  and do not expire.

## Emails

Brevo (transactional REST API), via `api/_lib/email/`. Templates are pure functions — no I/O — so each can be
rendered in isolation. Every send is written to `email_log`, so "I never got my receipt"
has an answer.

Customer: verification code · order confirmation/receipt · payment failed · shipped ·
delivered · refund issued · refund declined · abandoned cart · review request ·
gift card delivery (to the recipient, with the code) · gift card receipt (to the buyer, without it)
Admin: 2FA code · new order · refund requested · **paid-but-unfulfillable** (urgent)

Delivery never breaks the operation that triggered it. If Brevo is down, a paid order stays
paid — losing a receipt is bad, rejecting a successful payment because we couldn't send one
is much worse. The exception is the signup/verification code: that IS the only way forward,
so a failed send there is surfaced to the user rather than swallowed.

### The verified-sender trap

`EMAIL_FROM` **must** be an address Brevo has verified on your account. If it is not, Brevo
answers `201 Accepted`, the app logs the mail as `sent`, and it is silently dropped
downstream — because Brevo is not authorised to send for that domain. Everything reports
success and no code ever arrives.

Before trusting email, run:

```bash
npm run check-email                 # is EMAIL_FROM actually a verified sender?
npm run check-email you@email.com   # ...and send a real message to prove it
```

The two time-based emails (abandoned cart, review request), and releasing gift card holds on abandoned orders, are driven by Vercel Cron hitting
`/api/cron/lifecycle` daily at 03:00 (Vercel's Hobby plan rejects any cron more frequent than once a day). That endpoint requires `CRON_SECRET` — an unguarded endpoint
that sends email is an open relay.

## Security

The properties worth knowing about, and where they live:

- **Prices are never taken from the client.** The browser sends product ids and quantities;
  everything monetary is recomputed from the database (`api/_lib/orders.js`). The cart in
  localStorage stores no prices at all — editing it changes what you buy, never what it costs.
- **Payment confirmation is atomic** (`confirm_order_payment` in `db/schema.sql`). It locks
  the order, decrements stock under row locks, and refuses to run twice. A retried webhook is
  a no-op; a race for the last unit fails loudly rather than overselling; an amount that
  doesn't match the order total is rejected.
- **Refunds cannot exceed the order.** Enforced in `record_refund_success` *and* by a CHECK
  constraint, so a bug in the former still can't over-refund.
- **Webhooks verify signatures over the raw bytes** before reading a single field, and are
  idempotent via a unique index on `(provider, event_id)`.
- **Admin login is password + a code emailed to the admin** — mandatory, not optional, because
  that account can issue refunds. Sessions are server-side records; the cookie holds an opaque
  token whose SHA-256 hash is stored, so DB read access cannot mint a session.
  HttpOnly + SameSite=Strict + Secure, plus a CSRF token echoed in a header.
- **OTPs are stored hashed**, compared timing-safely, single-use, 10-minute TTL, 5 attempts,
  and issuing a new one invalidates the old.
- **Rate limits live in Postgres**, not process memory — serverless instances share nothing,
  so an in-process counter would reset on every cold start and limit nothing.
- **Order pages need an access token.** The order id alone proves nothing, so enumerating ids
  leaks no addresses.
- **RLS is on with no public policy** as a backstop. The app only ever uses the service-role
  key from server code; if the anon key leaked it would grant nothing.
- Security headers (CSP, HSTS, frame-deny, nosniff) in `vercel.json`, and on every API
  response in `api/_lib/http.js`.

### Verified

- `db/schema.sql` applied to a real Postgres 17; the money-safety functions were tested against
  it: double-webhook replay does not double-decrement, a race for the last unit is rejected,
  a wrong payment amount is rejected, over-refunding is rejected, and refund replay is a no-op.
- 28 HTTP boundary tests pass: forged and wrong-signature webhooks are rejected 401, all admin
  routes 401 without a session, the cron endpoint 401s without its bearer token, method guards,
  input validation, security headers, and a client-supplied price is ignored.
- All 13 pages render with zero console errors, exactly one `<h1>` each, and all four admin
  pages redirect to login when unauthenticated.

## Images

Uploaded from the admin panel and stored in **Supabase Storage** (included free: 1 GB, CDN-served).

- `/admin/media.html` — hero slides, category tiles, partner logos
- `/admin/products.html` — product photos, with a live preview

The URL is stored in the database, so a new photo is live immediately — no redeploy. Anything
without an image shows a gradient placeholder, and the site makes **zero requests for images
that do not exist** (no 404s, no console errors).

Uploads are hardened: photos are downscaled in the browser (a 12 MB phone photo becomes
~300 KB, under Vercel's 4.5 MB body cap), the server sniffs **magic bytes** rather than
trusting the file extension, SVG is refused outright (it can carry script), and the stored URL
must be on our own bucket — `javascript:`, `data:`, foreign hosts and hostname-suffix spoofs
(`ourproject.supabase.co.evil.com`) are all rejected.

Run `npm run setup-storage` once to create the bucket. No stock photos are hotlinked.

## Deploying

Vercel detects Vite, builds to `dist/`, and deploys `api/**` as Node functions.

```bash
npx vercel --prod
```

Set every variable from `.env.example` in **Project → Settings → Environment Variables** first.
`CRON_SECRET` is required or the lifecycle cron will refuse to run; `SUPABASE_SERVICE_ROLE_KEY`
must never be given a `VITE_` prefix.

## Layout

```
api/
  _lib/           db · env · http (headers, rate limit) · auth · otp · orders · webhooks · gift-cards
    email/        layout · templates · templates-gift-cards · send
    payments/     provider (interface) · paystack · crypto (stub)
  admin/          auth/{login,verify,session} · products · orders · refunds · stats
  checkout/       quote · create · verify · resend-code
  gift-cards/     purchase · balance        (admin: gift-cards/:id/reissue)
  webhooks/       paystack
  cron/           lifecycle
db/schema.sql     19 tables + atomic payment/refund/restock/gift card functions
scripts/          seed.js · create-admin.js
src/
  lib/            api · cart · format · images · ui
  main.js         storefront   shop.js  products/cart/checkout/order   admin.js  admin panel
  gift-cards.js   gift card purchase + balance check
  partials.js     shared header + footer
```
