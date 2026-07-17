/**
 * Generates the hero banners and category tiles, and uploads them to Supabase
 * Storage.
 *
 *   npm run generate-art
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 *   It produces original ABSTRACT artwork — dark gradients with geometric
 *   motifs drawn from the site's palette. Decorative backgrounds for the hero
 *   banners and category tiles.
 *
 *   It deliberately does NOT generate product photos. A synthetic image on a
 *   listing for "Opel Zafira C ECU 12649905" would tell the buyer they are
 *   looking at that part when they are not — that is a misrepresentation to
 *   someone about to spend real money. Product cards keep their placeholders
 *   until a real photograph is uploaded.
 *
 * The PNG encoder below is hand-rolled on node:zlib, so there is no native
 * image dependency to install or to break on a different platform.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media';

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/* ==========================================================================
   Minimal PNG encoder (RGB, 8-bit)
   ========================================================================== */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);

  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const stride = width * 3;

  // PNG requires a filter byte at the start of every scanline. 0 = none.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (RGB)
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ==========================================================================
   Artwork
   ==========================================================================
   The site's palette: Console Charcoal #0b1220, Panel Slate #111c33,
   Signal Blue #1e3a8a / #2563eb.
   ========================================================================== */

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** 4x4 ordered-dither matrix. Compresses far better than random noise. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Deterministic value noise. No Math.random, so re-running this produces the
 * same artwork rather than silently changing the site's look on every run.
 */
function noise(x, y, seed) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, y, seed, scale) {
  const xs = x / scale;
  const ys = y / scale;
  const x0 = Math.floor(xs);
  const y0 = Math.floor(ys);
  const fx = xs - x0;
  const fy = ys - y0;

  // Smoothstep, so the field has no visible grid seams.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = noise(x0, y0, seed);
  const n10 = noise(x0 + 1, y0, seed);
  const n01 = noise(x0, y0 + 1, seed);
  const n11 = noise(x0 + 1, y0 + 1, seed);

  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

/**
 * A dark, angular backdrop: diagonal light sweep + soft noise + faint
 * engineering-drawing hairlines. Reads as "purpose-built machinery", not as a
 * photograph of anything.
 */
function render(width, height, { seed, hueShift = 0, lines = true, vignette = true }) {
  const buf = Buffer.alloc(width * height * 3);

  // Palette anchors — Forge Vault. Deliberately LIGHTER than the page
  // background (#131313) so an image tile reads as an image on the dark theme,
  // not an empty panel. Machined steel-charcoal ramping into orange.
  const dark = [0x26, 0x25, 0x24]; // steel charcoal — already above page bg
  const mid = [0x3b, 0x35, 0x30]; // warm graphite
  const accent = [0xff, 0x5f, 0x00]; // machined orange

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;

      // Diagonal gradient, so the light appears to rake across the frame.
      const d = (u * 0.72 + v * 0.28 + hueShift) % 1;

      // Two-stop ramp: charcoal -> slate -> blue, weighted towards the dark end
      // so white overlay text stays legible.
      let base;
      if (d < 0.62) {
        const t = d / 0.62;
        base = [lerp(dark[0], mid[0], t), lerp(dark[1], mid[1], t), lerp(dark[2], mid[2], t)];
      } else {
        const t = (d - 0.62) / 0.38;
        base = [lerp(mid[0], accent[0], t), lerp(mid[1], accent[1], t), lerp(mid[2], accent[2], t)];
      }

      // Broad, soft variation so the gradient does not band.
      const n = smoothNoise(x, y, seed, Math.max(width, height) / 6) - 0.5;

      // A little dither to break up banding — but ORDERED, not random.
      // Per-pixel random noise is incompressible: it defeats PNG's filters and
      // turned a hero into a 1.8 MB file. A 4x4 Bayer matrix does the same job
      // for the eye while staying highly compressible (~10x smaller).
      const bayer = BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5;
      const grain = bayer * 2.2;

      let r = base[0] + n * 26 + grain;
      let g = base[1] + n * 30 + grain;
      let b = base[2] + n * 44 + grain;

      // Faint technical hairlines on a diagonal — a nod to an exploded-view
      // engineering drawing.
      if (lines) {
        const stripe = (x * 0.5 + y) % 96;
        if (stripe < 1.4) {
          // Warm machined hairline (orange-tinted), matching the theme.
          const strength = 12 + 30 * (1 - v);
          r += strength;
          g += strength * 0.62;
          b += strength * 0.28;
        }
      }

      // Darken the edges so centred white text always has contrast behind it.
      if (vignette) {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const falloff = 1 - Math.min(1, (dx * dx + dy * dy) * 1.5);
        const k = 0.72 + 0.28 * falloff;
        r *= k;
        g *= k;
        b *= k;
      }

      // Posterise to 6 bits per channel. PNG's deflate compresses runs of
      // identical bytes; a smooth 8-bit gradient gives it almost none. Dropping
      // the two lowest bits collapses the palette ~4x with no visible change on
      // a dark gradient (especially the heroes, which sit under a 70% black
      // overlay), and roughly halves the file. The Bayer dither above is what
      // keeps the reduced palette from banding.
      const q = (v) => (clamp(v) >> 2) << 2;

      const i = (y * width + x) * 3;
      buf[i] = q(r);
      buf[i + 1] = q(g);
      buf[i + 2] = q(b);
    }
  }

  return encodePng(width, height, buf);
}

/* ==========================================================================
   Upload
   ========================================================================== */

/** `--dry-run` renders and reports sizes without uploading or touching the DB. */
const DRY_RUN = process.argv.includes('--dry-run');

/** Per-run version stamped onto stored URLs to defeat the CDN's 1-year cache. */
const ART_VERSION = Date.now();

// A hero is above the fold. Anything much over this is a broken page on a phone
// and burns the free tier's 5 GB egress allowance fast.
const BUDGET_KB = { hero: 400, tile: 150, partner: 80 };

let oversize = 0;

async function upload(name, png, budgetKb) {
  const kb = png.length / 1024;
  const over = budgetKb && kb > budgetKb;
  if (over) oversize++;

  const flag = over ? `\x1b[31m OVER ${budgetKb} KB\x1b[0m` : '';

  if (DRY_RUN) {
    console.log(`  ${name.padEnd(22)} ${kb.toFixed(0).padStart(4)} KB${flag}`);
    return null;
  }

  const key = `generated/${name}.png`;

  const { error } = await db.storage.from(bucket).upload(key, png, {
    contentType: 'image/png',
    cacheControl: '31536000',
    upsert: true, // re-running replaces the art rather than piling up duplicates
  });

  if (error) throw new Error(`${name}: ${error.message}`);

  // Cache-bust: the object key is stable (so re-runs overwrite, no orphans), but
  // the public URL is served with a 1-year cache. Appending a per-run version
  // to the URL we store makes browsers and the CDN treat regenerated art as new,
  // instead of showing the previous version until the cache expires.
  const publicUrl = `${url.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${key}?v=${ART_VERSION}`;
  console.log(`  ${name.padEnd(22)} ${kb.toFixed(0).padStart(4)} KB${flag}  ${publicUrl}`);
  return publicUrl;
}

const HEROES = [
  { key: 'hero-1', seed: 3, hueShift: 0.0 },
  { key: 'hero-2', seed: 17, hueShift: 0.18 },
  { key: 'hero-3', seed: 29, hueShift: 0.36 },
  { key: 'hero-4', seed: 41, hueShift: 0.54 },
];

const CATEGORIES = [
  { slug: 'body', seed: 5 },
  { slug: 'brakes', seed: 13 },
  { slug: 'bumpers', seed: 23 },
  { slug: 'electricals', seed: 31 },
  { slug: 'engines', seed: 43 },
  { slug: 'exhaust', seed: 53 },
];

async function main() {
  if (DRY_RUN) console.log('\n(dry run — rendering only, nothing is uploaded)');

  console.log('\nHero banners (1600x800)…');
  for (const hero of HEROES) {
    const png = render(1280, 640, { seed: hero.seed, hueShift: hero.hueShift });
    const publicUrl = await upload(hero.key, png, BUDGET_KB.hero);

    if (publicUrl) {
      const { error } = await db.from('site_images').update({ url: publicUrl }).eq('key', hero.key);
      if (error) throw error;
    }
  }

  console.log('\nCategory tiles (800x600)…');
  for (const cat of CATEGORIES) {
    const png = render(640, 480, { seed: cat.seed, hueShift: (cat.seed % 7) / 10, lines: true });
    const publicUrl = await upload(`category-${cat.slug}`, png, BUDGET_KB.tile);

    if (publicUrl) {
      const { error } = await db.from('categories').update({ image_path: publicUrl }).eq('slug', cat.slug);
      if (error) throw error;
    }
  }

  console.log('\nPartner backdrop (400x400)…');
  const partner = render(320, 320, { seed: 61, hueShift: 0.25, lines: false, vignette: false });
  const partnerUrl = await upload('partner-scrappers', partner, BUDGET_KB.partner);

  if (partnerUrl) {
    await db.from('site_images').update({ url: partnerUrl }).eq('key', 'partner-scrappers');
  }

  if (oversize > 0) {
    console.error(`\n\x1b[31m${oversize} image(s) over budget. Not shipping these — tune the render and retry.\x1b[0m`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\nAll within budget. Re-run without --dry-run to upload.\n');
    return;
  }

  console.log(`
Done. The hero banners, the six category tiles, and the partner slot now have artwork.

Product photos are deliberately NOT generated: a synthetic image on a listing for a
specific part number would tell a buyer they are looking at that part when they are
not. Upload real photographs at /admin/products.html.
`);
}

main().catch((error) => {
  console.error('\nFailed:', error.message);
  process.exit(1);
});
