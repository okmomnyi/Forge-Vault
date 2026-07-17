-- ============================================================================
-- ForgeVault — database schema (Supabase / PostgreSQL)
--
-- Apply with:  supabase db execute --file db/schema.sql
--         or:  paste into the Supabase SQL editor and run.
--
-- Design notes
--   * All money is stored as INTEGER CENTS. Never floats — 0.1 + 0.2 != 0.3.
--   * Every table is owned by the service role. The anon/public key is NEVER
--     used by this app; all access goes through serverless functions holding
--     the service-role key, so RLS is enabled with no public policy as a
--     defence-in-depth backstop against key leakage.
--   * Stock decrement and payment confirmation live in a SQL function
--     (confirm_order_payment) so they are atomic under concurrent webhook
--     deliveries. Two webhooks for the same order cannot double-decrement.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type order_status as enum (
    'awaiting_verification',  -- email OTP not yet confirmed
    'pending_payment',        -- verified, payment not captured
    'payment_failed',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'partially_refunded',
    'refunded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('initiated', 'succeeded', 'failed', 'abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type refund_status as enum ('requested', 'approved', 'rejected', 'processing', 'succeeded', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type otp_purpose as enum ('checkout_email', 'admin_2fa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admin_role as enum ('owner', 'manager', 'support');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table if not exists categories (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  image_path   text,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  title               text not null,
  brand               text not null,
  category_id         uuid references categories(id) on delete set null,
  part_number         text,
  description         text,

  price_cents         int  not null check (price_cents >= 0),
  old_price_cents     int           check (old_price_cents is null or old_price_cents > price_cents),
  discount_percent    int           check (discount_percent between 0 and 99),

  stock               int  not null default 0 check (stock >= 0),
  image_path          text,
  is_active           boolean not null default true,
  is_featured         boolean not null default false,  -- "Recommended For You"
  is_deal             boolean not null default false,  -- "Deals You May Like"

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists products_active_idx   on products (is_active) where is_active;
create index if not exists products_featured_idx on products (is_featured) where is_featured;
create index if not exists products_deal_idx     on products (is_deal) where is_deal;
create index if not exists products_category_idx on products (category_id);

-- A discounted product must carry both the old price and the badge percentage,
-- or neither. This is what keeps the "-9%" badge honest against the prices.
alter table products drop constraint if exists products_discount_coherent;
alter table products add constraint products_discount_coherent check (
  (old_price_cents is null and discount_percent is null) or
  (old_price_cents is not null and discount_percent is not null)
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table if not exists customers (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  name              text,
  email_verified_at timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create sequence if not exists order_number_seq start 1001;

create table if not exists orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null unique default 'FV-' || lpad(nextval('order_number_seq')::text, 6, '0'),

  customer_id        uuid references customers(id) on delete set null,
  email              citext not null,
  phone              text,

  -- Unguessable token that lets a customer view their own order without an
  -- account. The order id alone is NOT sufficient to view an order — otherwise
  -- anyone who learned an id could read someone else's address and basket.
  access_token       text not null default encode(gen_random_bytes(24), 'hex'),

  status             order_status not null default 'awaiting_verification',
  email_verified_at  timestamptz,

  -- Money. Totals are computed server-side from the DB price at checkout time;
  -- the client's numbers are never trusted.
  currency           text not null default 'USD',
  subtotal_cents     int  not null check (subtotal_cents >= 0),
  shipping_cents     int  not null default 0 check (shipping_cents >= 0),
  tax_cents          int  not null default 0 check (tax_cents >= 0),
  total_cents        int  not null check (total_cents >= 0),
  refunded_cents     int  not null default 0 check (refunded_cents >= 0),

  -- Shipping address
  ship_name          text,
  ship_line1         text,
  ship_line2         text,
  ship_city          text,
  ship_postal_code   text,
  ship_country       text,

  stock_committed    boolean not null default false,  -- guards against double-decrement
  paid_at            timestamptz,
  tracking_number    text,
  carrier            text,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz,

  review_requested_at timestamptz,
  notes               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists orders_email_idx  on orders (email);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_created_idx on orders (created_at desc);

alter table orders drop constraint if exists orders_refund_within_total;
alter table orders add constraint orders_refund_within_total check (refunded_cents <= total_cents);

-- The store prices and records orders in the display currency (USD), but the
-- payment provider may settle in a different currency (Paystack → KES). The
-- amount actually charged, in the provider's currency and subunit, is recorded
-- here so the webhook can verify what the provider reports against what we asked
-- it to charge — not against the USD order total, which would never match.
-- Null means "same as the order total" (no conversion), keeping older rows valid.
alter table orders add column if not exists charge_currency    text;
alter table orders add column if not exists charge_amount_cents int;

create table if not exists order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  product_id        uuid references products(id) on delete restrict,

  -- Snapshot of the product at purchase time. The catalogue may change later;
  -- an invoice must not.
  title             text not null,
  brand             text,
  part_number       text,
  image_path        text,
  unit_price_cents  int  not null check (unit_price_cents >= 0),
  quantity          int  not null check (quantity > 0),
  line_total_cents  int  not null check (line_total_cents >= 0),

  created_at        timestamptz not null default now()
);

create index if not exists order_items_order_idx on order_items (order_id);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  -- Deliberately TEXT, not an enum: adding a payment provider should be a code
  -- change, not a database migration.
  provider            text not null,            -- 'paystack' (others as added)
  provider_reference  text,                     -- the provider's transaction id
  status              payment_status not null default 'initiated',
  amount_cents        int not null check (amount_cents >= 0),
  currency            text not null default 'USD',
  method              text,                     -- 'card', 'bank_transfer', ...
  failure_reason      text,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists payments_provider_ref_idx
  on payments (provider, provider_reference)
  where provider_reference is not null;

create index if not exists payments_order_idx on payments (order_id);

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

create table if not exists refunds (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  payment_id          uuid references payments(id) on delete set null,
  amount_cents        int not null check (amount_cents > 0),
  reason              text,
  status              refund_status not null default 'requested',
  provider_reference  text,
  failure_reason      text,
  requested_by_email  citext,          -- customer-initiated
  processed_by_admin  uuid,            -- admin who approved (FK added below)
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);

create index if not exists refunds_order_idx  on refunds (order_id);
create index if not exists refunds_status_idx on refunds (status);

-- ---------------------------------------------------------------------------
-- One-time passcodes (checkout email verification + admin 2FA)
--
-- The code is never stored in plaintext — only a SHA-256 hash. A leaked DB
-- snapshot therefore does not let an attacker replay an in-flight code.
-- ---------------------------------------------------------------------------

create table if not exists otp_codes (
  id            uuid primary key default gen_random_uuid(),
  purpose       otp_purpose not null,
  email         citext not null,
  code_hash     text not null,
  order_id      uuid references orders(id) on delete cascade,
  admin_id      uuid,
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists otp_lookup_idx on otp_codes (email, purpose, consumed_at);
create index if not exists otp_expiry_idx on otp_codes (expires_at);

-- ---------------------------------------------------------------------------
-- Admin users + sessions
-- ---------------------------------------------------------------------------

create table if not exists admin_users (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  name              text not null,
  password_hash     text not null,          -- bcrypt, cost 12
  role              admin_role not null default 'manager',
  is_active         boolean not null default true,

  -- Online brute-force protection
  failed_attempts   int not null default 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  password_changed_at timestamptz not null default now(),

  created_at        timestamptz not null default now()
);

alter table refunds drop constraint if exists refunds_admin_fk;
alter table refunds add constraint refunds_admin_fk
  foreign key (processed_by_admin) references admin_users(id) on delete set null;

-- Sessions are server-side records. The cookie carries an opaque token whose
-- SHA-256 hash is stored here, so a DB read cannot mint a valid cookie.
create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admin_users(id) on delete cascade,
  token_hash   text not null unique,
  csrf_token   text not null,
  ip           text,
  user_agent   text,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists admin_sessions_admin_idx  on admin_sessions (admin_id);
create index if not exists admin_sessions_expiry_idx on admin_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Webhook idempotency
--
-- Payment providers retry. Recording each delivered event id and refusing to
-- reprocess it is what stops a retry from shipping an order twice or emailing
-- a second receipt.
-- ---------------------------------------------------------------------------

create table if not exists webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  event_id     text not null,
  event_type   text,
  payload      jsonb,
  processed_at timestamptz,
  error        text,
  created_at   timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Email log + audit trail
-- ---------------------------------------------------------------------------

create table if not exists email_log (
  id           uuid primary key default gen_random_uuid(),
  to_email     citext not null,
  template     text not null,
  subject      text,
  order_id     uuid references orders(id) on delete set null,
  provider_id  text,
  status       text not null default 'sent',   -- 'sent' | 'failed'
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists email_log_order_idx on email_log (order_id);

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references admin_users(id) on delete set null,
  action      text not null,          -- 'product.update', 'refund.approve', ...
  entity      text,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_admin_idx   on audit_log (admin_id);
create index if not exists audit_log_created_idx on audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting
--
-- Serverless functions share no memory, so an in-process counter would reset on
-- every cold start and limit nothing. The counter lives in Postgres and is
-- incremented atomically, so it holds across instances.
-- ---------------------------------------------------------------------------

create table if not exists rate_limits (
  bucket       text primary key,      -- e.g. 'otp:203.0.113.7' or 'login:a@b.com'
  count        int not null default 0,
  window_start timestamptz not null default now()
);

-- Increments the bucket and reports whether the caller is over the limit.
-- Returns the number of requests remaining and when the window resets.
create or replace function hit_rate_limit(
  p_bucket        text,
  p_limit         int,
  p_window_secs   int
)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql
as $$
declare
  v_row rate_limits%rowtype;
begin
  insert into rate_limits (bucket, count, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update
    set count = case
                  when rate_limits.window_start < now() - make_interval(secs => p_window_secs)
                  then 1                       -- window expired: start fresh
                  else rate_limits.count + 1
                end,
        window_start = case
                  when rate_limits.window_start < now() - make_interval(secs => p_window_secs)
                  then now()
                  else rate_limits.window_start
                end
  returning * into v_row;

  return query select
    v_row.count <= p_limit,
    greatest(0, p_limit - v_row.count),
    v_row.window_start + make_interval(secs => p_window_secs);
end;
$$;

alter table rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Abandoned carts (lifecycle email)
-- ---------------------------------------------------------------------------

create table if not exists carts (
  id           uuid primary key default gen_random_uuid(),
  email        citext,
  items        jsonb not null,
  total_cents  int,
  reminded_at  timestamptz,
  converted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists carts_reminder_idx on carts (created_at)
  where reminded_at is null and converted_at is null;

-- ============================================================================
-- Atomic payment confirmation
--
-- Called by the payment webhook. Does four things in one transaction:
--   1. Refuses to run twice for the same order (stock_committed guard).
--   2. Locks each product row and decrements stock, failing loudly if any
--      line would go negative — this is what prevents overselling when two
--      customers race for the last item.
--   3. Marks the order paid.
--   4. Records the payment row.
--
-- Returns the new order status. Raises on insufficient stock so the caller
-- can refund the customer and alert the shop.
-- ============================================================================

create or replace function confirm_order_payment(
  p_order_id           uuid,
  p_provider           text,
  p_provider_reference text,
  p_amount_cents       int,
  p_method             text default null,
  p_raw                jsonb default null
)
returns table (order_status_out order_status, already_processed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   orders%rowtype;
  v_item    record;
  v_stock   int;
begin
  -- Lock the order so two concurrent webhooks serialise here.
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND: %', p_order_id;
  end if;

  -- Idempotency: a retried webhook is a no-op, not a second decrement.
  if v_order.stock_committed then
    return query select v_order.status, true;
    return;
  end if;

  -- Verify against the amount we actually asked the provider to charge (in the
  -- provider's currency), falling back to the order total when there was no
  -- conversion. The webhook passes the provider-reported amount.
  if p_amount_cents is distinct from coalesce(v_order.charge_amount_cents, v_order.total_cents) then
    raise exception 'AMOUNT_MISMATCH: expected %, got %', coalesce(v_order.charge_amount_cents, v_order.total_cents), p_amount_cents;
  end if;

  -- Decrement stock, locking product rows in a deterministic order to avoid
  -- deadlocks between concurrent orders touching the same products.
  for v_item in
    select product_id, quantity, title
    from order_items
    where order_id = p_order_id and product_id is not null
    order by product_id
  loop
    select stock into v_stock from products where id = v_item.product_id for update;

    if v_stock < v_item.quantity then
      raise exception 'INSUFFICIENT_STOCK: % (need %, have %)', v_item.title, v_item.quantity, v_stock;
    end if;

    update products
       set stock = stock - v_item.quantity,
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  update orders
     set status = 'paid',
         paid_at = now(),
         stock_committed = true,
         updated_at = now()
   where id = p_order_id;

  insert into payments (order_id, provider, provider_reference, status, amount_cents, currency, method, raw)
  values (p_order_id, p_provider, p_provider_reference, 'succeeded', p_amount_cents,
          coalesce(v_order.charge_currency, v_order.currency), p_method, p_raw)
  on conflict (provider, provider_reference) where provider_reference is not null
  do update set status = 'succeeded', raw = excluded.raw, updated_at = now();

  return query select 'paid'::order_status, false;
end;
$$;

-- ============================================================================
-- Atomic refund recording
--
-- Increments the order's refunded total and moves it to refunded /
-- partially_refunded. The CHECK constraint on orders.refunded_cents is the
-- backstop that makes over-refunding impossible even if callers get it wrong.
-- ============================================================================

create or replace function record_refund_success(
  p_refund_id          uuid,
  p_provider_reference text default null
)
returns order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund  refunds%rowtype;
  v_order   orders%rowtype;
  v_new_total int;
  v_status  order_status;
begin
  select * into v_refund from refunds where id = p_refund_id for update;
  if not found then
    raise exception 'REFUND_NOT_FOUND: %', p_refund_id;
  end if;

  if v_refund.status = 'succeeded' then
    select status into v_status from orders where id = v_refund.order_id;
    return v_status;   -- already applied; stay idempotent
  end if;

  select * into v_order from orders where id = v_refund.order_id for update;

  v_new_total := v_order.refunded_cents + v_refund.amount_cents;

  if v_new_total > v_order.total_cents then
    raise exception 'REFUND_EXCEEDS_TOTAL: order total %, already refunded %, requested %',
      v_order.total_cents, v_order.refunded_cents, v_refund.amount_cents;
  end if;

  v_status := case when v_new_total >= v_order.total_cents
                   then 'refunded'::order_status
                   else 'partially_refunded'::order_status end;

  update orders
     set refunded_cents = v_new_total,
         status = v_status,
         updated_at = now()
   where id = v_order.id;

  update refunds
     set status = 'succeeded',
         provider_reference = coalesce(p_provider_reference, provider_reference),
         processed_at = now()
   where id = p_refund_id;

  return v_status;
end;
$$;

-- Restock a cancelled/refunded order's items.
create or replace function restock_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  if not exists (select 1 from orders where id = p_order_id and stock_committed) then
    return;   -- nothing was ever taken
  end if;

  for v_item in
    select product_id, quantity from order_items
    where order_id = p_order_id and product_id is not null
    order by product_id
  loop
    update products
       set stock = stock + v_item.quantity, updated_at = now()
     where id = v_item.product_id;
  end loop;

  update orders set stock_committed = false, updated_at = now() where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch on products;
create trigger products_touch before update on products
  for each row execute function touch_updated_at();

drop trigger if exists orders_touch on orders;
create trigger orders_touch before update on orders
  for each row execute function touch_updated_at();

drop trigger if exists payments_touch on payments;
create trigger payments_touch before update on payments
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The app never uses the anon key — every query runs through a serverless
-- function holding the service-role key, which bypasses RLS. Enabling RLS with
-- no permissive policy means that if the anon key ever leaks, it grants
-- nothing. This is a backstop, not the primary control.
-- ---------------------------------------------------------------------------

alter table categories     enable row level security;
alter table products       enable row level security;
alter table customers      enable row level security;
alter table orders         enable row level security;
alter table order_items    enable row level security;
alter table payments       enable row level security;
alter table refunds        enable row level security;
alter table otp_codes      enable row level security;
alter table admin_users    enable row level security;
alter table admin_sessions enable row level security;
alter table webhook_events enable row level security;
alter table email_log      enable row level security;
alter table audit_log      enable row level security;
alter table carts          enable row level security;

-- ============================================================================
-- Site imagery (hero slides, category tiles, partner logos)
--
-- Product and category artwork lives on their own rows. Everything else that
-- is "a picture on a page" lives here, keyed by a stable slot name, so a new
-- hero image is a database write rather than a redeploy.
--
-- `url` is an absolute URL (ImgBB, or any host) OR a local /assets/... path.
-- Both work; see api/_lib/images.js.
-- ============================================================================

create table if not exists site_images (
  key        text primary key,          -- 'hero-1', 'partner-scrappers', ...
  url        text,                      -- null = show the gradient placeholder
  alt        text,
  updated_at timestamptz not null default now()
);

alter table site_images enable row level security;

drop trigger if exists site_images_touch on site_images;
create trigger site_images_touch before update on site_images
  for each row execute function touch_updated_at();

-- The slots the site expects. url stays NULL until a real image is uploaded,
-- which is what keeps the placeholders showing instead of broken images.
insert into site_images (key, alt) values
  ('hero-1', 'Find the right part first time'),
  ('hero-2', 'Genuine European parts, verified stock'),
  ('hero-3', 'Fitment confidence starts here'),
  ('hero-4', 'Clear returns, warranty, and shipping'),
  ('partner-scrappers', 'The Scrappers Ltd')
on conflict (key) do nothing;

-- ============================================================================
-- Customer accounts
--
-- Checkout requires a verified account. That is not friction for its own sake:
--   * The order's email comes from the SESSION, never the request body — so a
--     customer cannot place an order against someone else's address, and a
--     receipt (which contains a home address) cannot be redirected.
--   * Email ownership is proven ONCE at signup rather than on every checkout.
--   * Customers get an order history and a refund request path that is tied to
--     an identity, not to whoever holds a link.
-- ============================================================================

alter table customers add column if not exists password_hash   text;
alter table customers add column if not exists is_active       boolean not null default true;
alter table customers add column if not exists failed_attempts int not null default 0;
alter table customers add column if not exists locked_until    timestamptz;
alter table customers add column if not exists last_login_at   timestamptz;

-- Sessions are server-side records, exactly as for admins. The cookie carries an
-- opaque token whose SHA-256 hash is stored here, so read access to the database
-- does not let anyone mint a valid session.
create table if not exists customer_sessions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  token_hash   text not null unique,
  csrf_token   text not null,
  ip           text,
  user_agent   text,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists customer_sessions_customer_idx on customer_sessions (customer_id);
create index if not exists customer_sessions_expiry_idx   on customer_sessions (expires_at);

alter table customer_sessions enable row level security;

-- A new OTP purpose for verifying an account at signup.
do $$ begin
  alter type otp_purpose add value if not exists 'customer_verify';
exception when others then null; end $$;

-- An order must belong to an account. Existing rows (if any) are left alone;
-- the application enforces this on every new order.
create index if not exists orders_customer_idx on orders (customer_id);
