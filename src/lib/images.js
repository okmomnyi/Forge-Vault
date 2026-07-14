import { ASSETS } from 'virtual:asset-manifest';

/**
 * Image handling.
 * ============================================================================
 * An image reference is one of three things:
 *
 *   1. An absolute https:// URL  — hosted on ImgBB, uploaded from the admin.
 *   2. A local /assets/... path  — bundled with the site.
 *   3. Nothing                   — show the gradient placeholder.
 *
 * Case 2 is checked against a build-time manifest of files that actually exist
 * in public/assets. Without that check the browser would request every expected
 * filename and log a 404 for each one that has not been supplied yet — so a
 * half-populated assets folder would fill the console with errors. Instead the
 * placeholder simply shows through, and the console stays clean.
 *
 * Case 1 cannot be checked at build time (the file lives on someone else's
 * server), so it is rendered optimistically. If it 404s at runtime, the error
 * handler in installImageFallback hides the <img> and the placeholder underneath
 * becomes visible again — which is the honest degradation for a third-party host
 * that can delete your images.
 */

const AVAILABLE = new Set(ASSETS);

export const isRemote = (path) => typeof path === 'string' && /^https?:\/\//i.test(path);

/** Would this reference actually render something? */
export function hasImage(path) {
  if (!path) return false;
  if (isRemote(path)) return true;
  return AVAILABLE.has(path);
}

/** Kept for older call sites. */
export const hasAsset = hasImage;

const escapeAttr = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** An <img> tag for `path`, or '' when there is no image to show. */
export function imageTag(path, { alt, className, lazy = true }) {
  if (!hasImage(path)) return '';

  // referrerpolicy: don't leak our customers' browsing to the image host.
  return (
    `<img src="${escapeAttr(path)}" alt="${escapeAttr(alt)}" ` +
    `loading="${lazy ? 'lazy' : 'eager'}" decoding="async" referrerpolicy="no-referrer" ` +
    `class="${className}">`
  );
}

/**
 * Static markup declares images as `data-src` so the browser never requests
 * them on parse. Promote to `src` only for images that exist; remove the rest.
 */
export function hydrateStaticImages() {
  document.querySelectorAll('img[data-src]').forEach((img) => {
    const path = img.dataset.src;
    if (hasImage(path)) {
      img.src = path;
      img.removeAttribute('data-src');
    } else {
      img.remove();
    }
  });
}

/**
 * Safety net for an image that is referenced but fails to load — a deleted
 * ImgBB upload, a truncated file, a blocked host. Hide it so the gradient
 * placeholder shows rather than a broken-image icon.
 *
 * Capture phase, because `error` on <img> does not bubble.
 */
export function installImageFallback() {
  document.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLImageElement) event.target.classList.add('is-missing');
    },
    true,
  );
}

/**
 * Fetches the hero / partner artwork and swaps it into the slots that have it.
 *
 * Slots are marked in the HTML with `data-site-image="hero-1"`. A slot with no
 * image in the database is simply left alone, showing its placeholder.
 */
export async function applySiteImages(get) {
  const slots = document.querySelectorAll('[data-site-image]');
  if (slots.length === 0) return;

  let images;
  try {
    ({ images } = await get('/api/site-images'));
  } catch {
    // The site must still render if this call fails; placeholders are fine.
    return;
  }

  slots.forEach((slot) => {
    const entry = images[slot.dataset.siteImage];
    if (!entry?.url) return;

    const img = document.createElement('img');
    img.src = entry.url;
    img.alt = entry.alt ?? '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.className = 'absolute inset-0 h-full w-full object-cover';

    // Hero images are above the fold; everything else can wait.
    img.loading = slot.dataset.siteImage === 'hero-1' ? 'eager' : 'lazy';

    slot.append(img);
  });
}
