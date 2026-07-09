-- Forge Auto Parts — schema. Run once against the Neon database before first deploy.
-- Idempotent-ish: uses IF NOT EXISTS so it can be re-run safely during setup.

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  part_number TEXT,
  category_id INT REFERENCES categories(id),
  description TEXT,
  price_kes NUMERIC NOT NULL,
  condition TEXT NOT NULL DEFAULT 'used', -- 'new' | 'used' | 'refurbished'
  stock_status TEXT NOT NULL DEFAULT 'in_stock', -- 'in_stock' | 'preorder' | 'out_of_stock'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parts_active_created ON parts (is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS part_images (
  id BIGSERIAL PRIMARY KEY,
  part_id BIGINT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  delete_url TEXT, -- imgbb delete-page URL, used for manual removal from imgbb
  sort_order INT NOT NULL DEFAULT 0
);
-- For databases created before delete_url existed.
ALTER TABLE part_images ADD COLUMN IF NOT EXISTS delete_url TEXT;

CREATE TABLE IF NOT EXISTS part_compatibility (
  id BIGSERIAL PRIMARY KEY,
  part_id BIGINT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INT,
  year_end INT
);
CREATE INDEX IF NOT EXISTS idx_compat_make_model ON part_compatibility (make, model);

-- Seed the common spare-parts categories so the admin isn't starting from zero.
INSERT INTO categories (name, slug) VALUES
  ('Engine', 'engine'),
  ('Suspension', 'suspension'),
  ('Brakes', 'brakes'),
  ('Body', 'body'),
  ('Electrical', 'electrical'),
  ('Interior', 'interior')
ON CONFLICT (slug) DO NOTHING;
