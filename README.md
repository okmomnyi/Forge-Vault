# Forge Auto Parts

A catalog website for a car spare-parts shop in Mombasa. Customers browse parts
and complete every purchase or query over **WhatsApp** via a pre-filled deep link
— there is no on-site cart, checkout, or payment gateway. The admin adds new parts
daily with minimal friction.

## Stack

- **Next.js 14** (App Router) + **TypeScript** (`strict`)
- **Tailwind CSS** — design tokens in [`design/tokens.ts`](design/tokens.ts)
- **Neon Postgres** via `@neondatabase/serverless`, raw parameterized SQL (no ORM)
- **imgbb** for image hosting — resized in-browser, proxied through a server route
  (`/api/admin/upload`) so the API key stays server-side. imgbb has no delete API,
  so each image's `delete_url` is stored and surfaced in the admin UI for manual
  removal (per-image links in the edit form; a cleanup panel on part deletion).
- Custom admin auth: bcrypt password hashing + `jose`-signed HttpOnly session cookie, enforced in [`middleware.ts`](middleware.ts)
- Hosted on **Vercel**

## Local setup

```bash
npm install
cp .env.example .env        # then fill in the values
```

Environment variables (see [`.env.example`](.env.example)):

| Var | What it's for |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `IMGBB_API_KEY` | imgbb API key (image uploads) — get one at api.imgbb.com |
| `SESSION_JWT_SECRET` | signs the admin session cookie — `openssl rand -base64 32` |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | WhatsApp number, digits only (e.g. `254700000000`) |
| `NEXT_PUBLIC_SITE_URL` | *(optional)* canonical origin for share links / sitemap |

**Note:** `NEXT_PUBLIC_WHATSAPP_NUMBER` is inlined at build time — set it before
`next build` / deploy, not just at runtime.

### Initialise the database

Run the schema once (Neon SQL editor or `psql`). It creates all tables and seeds
the default categories (Engine, Suspension, Brakes, Body, Electrical, Interior):

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

### Create the first admin

There is no public signup. Seed an admin locally:

```bash
npm run create-admin -- admin@example.com "a-strong-password"
```

(Re-running with the same email resets that admin's password.)

### Run

```bash
npm run dev      # http://localhost:3000
```

## Routes

Public: `/` · `/parts` (filter by category / make / model / search) · `/parts/[slug]` · `/contact`
Admin: `/admin/login` · `/admin` (dashboard + one-click stock toggle) · `/admin/parts/new` · `/admin/parts/[id]/edit`
SEO: `/sitemap.xml` · `/robots.txt`

## Deploy to Vercel

1. Push to GitHub, import the repo into Vercel.
2. Add the **Neon** integration (Marketplace) → auto-populates `DATABASE_URL`.
3. Set `IMGBB_API_KEY`, `SESSION_JWT_SECRET`, and `NEXT_PUBLIC_WHATSAPP_NUMBER` manually.
5. Run `db/schema.sql` against the Neon DB, then `npm run create-admin` locally
   against the same `DATABASE_URL`.
6. Deploy.

## End-to-end smoke test

Add a part in `/admin` → confirm it appears on `/parts` → open it → tap **Order
This Part** → WhatsApp opens pre-filled with the part name, number, price, and link.

## Scope (Phase 1)

No cart, no checkout, no payment gateway, no customer accounts, no contact form —
every "get in touch" action is a `wa.me`, `tel:`, or `mailto:` link. See the build
prompt for the full spec.
