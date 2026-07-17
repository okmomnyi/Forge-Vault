/**
 * Seeds the catalogue: the six categories and the twelve parts the storefront
 * was designed around.
 *
 *   node scripts/seed.js
 *
 * Idempotent — upserts on slug, so running it twice is harmless and running it
 * after a price change resets prices to these values.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const CATEGORIES = [
  { slug: 'body', name: 'Body', image_path: '/assets/categories/body.jpg', sort_order: 1 },
  { slug: 'brakes', name: 'Brakes', image_path: '/assets/categories/brakes.jpg', sort_order: 2 },
  { slug: 'bumpers', name: 'Bumpers', image_path: '/assets/categories/bumpers.jpg', sort_order: 3 },
  { slug: 'electricals', name: 'Electricals', image_path: '/assets/categories/electricals.jpg', sort_order: 4 },
  { slug: 'engines', name: 'Engines', image_path: '/assets/categories/engines.jpg', sort_order: 5 },
  { slug: 'exhaust', name: 'Exhaust', image_path: '/assets/categories/exhaust.jpg', sort_order: 6 },
  // Not tiles on the home page, but products reference them.
  { slug: 'seats', name: 'Seats', image_path: null, sort_order: 7 },
  { slug: 'lights', name: 'Lights', image_path: null, sort_order: 8 },
  { slug: 'tires', name: 'Tires', image_path: null, sort_order: 9 },
  { slug: 'transmission', name: 'Transmission', image_path: null, sort_order: 10 },
];

/** Prices in cents. The discount badge is derived, never hand-written. */
const PRODUCTS = [
  // ---- Recommended For You ----
  {
    slug: 'skoda-fabia-seat-set',
    title: 'Skoda Fabia 2007–14 2 II 5J Seat Set front left right rear seat',
    brand: 'Skoda',
    category: 'seats',
    price_cents: 45000,
    stock: 1,
    image_path: '/assets/products/skoda-fabia-seat-set.jpg',
    is_featured: true,
  },
  {
    slug: 'opel-zafira-c-ecu',
    title: 'Opel Zafira C P12 1.4 Turbo 140PS Engine Control Unit 12649905 AA7Y',
    brand: 'Opel',
    category: 'electricals',
    part_number: '12649905',
    price_cents: 34000,
    stock: 2,
    image_path: '/assets/products/opel-zafira-c-ecu.jpg',
    is_featured: true,
  },
  {
    slug: 'opel-zafira-c-tourer-seat-set',
    title: 'Opel Zafira C Tourer P12 Seat Set Rear Seat Front Rear Airbag Left',
    brand: 'Opel',
    category: 'seats',
    price_cents: 32000,
    old_price_cents: 35000,
    stock: 1,
    image_path: '/assets/products/opel-zafira-c-tourer-seat-set.jpg',
    is_featured: true,
  },
  {
    slug: 'opel-adam-driver-seat',
    title: "Opel Adam M13 from 2013 Seat SET Driver's Seat",
    brand: 'Opel',
    category: 'seats',
    price_cents: 50000,
    stock: 1,
    image_path: '/assets/products/opel-adam-driver-seat.jpg',
    is_featured: true,
  },
  {
    slug: 'opel-corsa-d-seat-set',
    title: "Opel Corsa D Seat Set 4-door Rear Seat Driver's Seat Trim",
    brand: 'Opel',
    category: 'seats',
    price_cents: 32000,
    stock: 1,
    image_path: '/assets/products/opel-corsa-d-seat-set.jpg',
    is_featured: true,
  },
  {
    slug: 'ford-fiesta-abs-hydraulic-block',
    title: 'FORD FIESTA D1B1-2C405-AF D1B1-2C013-BD hydraulic block ABS',
    brand: 'Ford',
    category: 'electricals',
    part_number: 'D1B1-2C405-AF',
    price_cents: 32000,
    stock: 1,
    image_path: '/assets/products/ford-fiesta-abs-hydraulic-block.jpg',
    is_featured: true,
  },

  // ---- Deals You May Like ----
  {
    slug: 'stellantis-taillights',
    title: 'Genuine Stellantis taillights, like new, for Ducato, Boxer, Jumper.',
    brand: 'Opel',
    category: 'lights',
    price_cents: 18000,
    old_price_cents: 21000,
    stock: 2,
    image_path: '/assets/products/stellantis-taillights.jpg',
    is_deal: true,
  },
  {
    slug: 'opel-zafira-c-tourer-ecu-speedometer',
    title: 'Opel Zafira C Tourer 2.0 CDTI Engine Control Unit Speedometer 55585024',
    brand: 'Opel',
    category: 'electricals',
    part_number: '55585024',
    price_cents: 24000,
    old_price_cents: 28000,
    stock: 2,
    image_path: '/assets/products/opel-zafira-c-tourer-ecu-speedometer.jpg',
    is_deal: true,
  },
  {
    slug: 'opel-zafira-c-intake-manifold',
    title: 'OPEL ZAFIRA C 2.0(CDTI) INTAKE MANIFOLD 55578249',
    brand: 'Opel',
    category: 'transmission',
    part_number: '55578249',
    price_cents: 31000,
    old_price_cents: 35000,
    stock: 7,
    image_path: '/assets/products/opel-zafira-c-intake-manifold.jpg',
    is_deal: true,
  },
  {
    slug: 'opel-vectra-c-opc-exhaust',
    title: 'Opel Vectra C Sedan GTS 2.8 V6 OPC Friedrich Exhaust System 76mm',
    brand: 'Opel',
    category: 'exhaust',
    price_cents: 97900,
    old_price_cents: 109900,
    stock: 7,
    image_path: '/assets/products/opel-vectra-c-opc-exhaust.jpg',
    is_deal: true,
  },
  {
    slug: 'stellantis-spacetourer-seat',
    title: 'Like-new single seat for Spacetourer / Stellantis Group',
    brand: 'Stellantis',
    category: 'seats',
    price_cents: 33000,
    old_price_cents: 38000,
    stock: 1,
    image_path: '/assets/products/stellantis-spacetourer-seat.jpg',
    is_deal: true,
  },
  {
    slug: 'stellantis-wheels',
    title: 'New wheels for Ducato, Movano, Jumper and other Stellantis vehicles',
    brand: 'Stellantis',
    category: 'tires',
    price_cents: 130000,
    old_price_cents: 155000,
    stock: 8,
    image_path: '/assets/products/stellantis-wheels.jpg',
    is_deal: true,
  },
];

/**
 * Prices are stored in USD (the display currency). Paystack settles this account
 * in KES, but that conversion happens at the payment step only — see
 * api/_lib/orders.js and PAYMENT_FX_RATE. The catalogue and orders stay USD.
 */
const discountPercent = (price, oldPrice) =>
  oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : null;

async function main() {
  console.log('Seeding categories…');

  // image_path is deliberately omitted from the upsert payload. On a conflict,
  // PostgREST only updates the columns present, so an existing category keeps
  // whatever artwork the admin (or generate-art) uploaded — re-seeding never
  // wipes images. The same applies to products below.
  const categoryRows = CATEGORIES.map(({ image_path, ...rest }) => rest);

  const { data: categories, error: catError } = await db
    .from('categories')
    .upsert(categoryRows, { onConflict: 'slug' })
    .select('id, slug');

  if (catError) throw catError;

  const categoryId = new Map(categories.map((row) => [row.slug, row.id]));
  console.log(`  ${categories.length} categories`);

  console.log('Seeding products…');

  const rows = PRODUCTS.map((product) => ({
    slug: product.slug,
    title: product.title,
    brand: product.brand,
    category_id: categoryId.get(product.category) ?? null,
    part_number: product.part_number ?? null,
    description: product.description ?? null,
    price_cents: product.price_cents,
    old_price_cents: product.old_price_cents ?? null,
    discount_percent: discountPercent(product.price_cents, product.old_price_cents),
    stock: product.stock,
    // image_path omitted on purpose — see the note above. Uploaded product
    // photos survive a re-seed.
    is_active: true,
    is_featured: product.is_featured ?? false,
    is_deal: product.is_deal ?? false,
  }));

  const { data: products, error: prodError } = await db
    .from('products')
    .upsert(rows, { onConflict: 'slug' })
    .select('slug');

  if (prodError) throw prodError;

  console.log(`  ${products.length} products`);
  console.log('\nDone. The storefront will now render from the database.');
}

main().catch((error) => {
  console.error('\nSeed failed:', error.message);
  process.exit(1);
});
