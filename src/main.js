import './style.css';
import { get, post } from './lib/api.js';
import { addToCart, cartCount, onCartChange } from './lib/cart.js';
import { esc, money } from './lib/format.js';
import { applySiteImages, hydrateStaticImages, imageTag, installImageFallback } from './lib/images.js';
import { initHeader, initSliders, initSmoothScroll, updateCartBadge } from './lib/ui.js';
import { mountChrome } from './partials.js';

/* =========================================================================
   ForgeVault — storefront (index / about / contact)
   Every block below no-ops when its markup is absent, so one bundle serves
   all three pages.
   ========================================================================= */

installImageFallback();

const ICONS = {
  part: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-12 w-12" aria-hidden="true"><path d="M14 4h-4a2 2 0 0 0-2 2v2H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2V6a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  car: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-12 w-12" aria-hidden="true"><path d="M5 17h14M3 13l1.6-4.5A3 3 0 0 1 7.4 6.5h9.2a3 3 0 0 1 2.8 2L21 13v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/></svg>`,
};

/* -------------------------------------------------------------------------
   Product + category cards
   ---------------------------------------------------------------------- */

function productCard(product, index) {
  const tone = `ph-${(index % 4) + 1}`;
  const discounted = Boolean(product.discountPercent && product.oldPriceCents);
  const soldOut = product.stock < 1;

  const badge = discounted
    ? `<span class="absolute left-3 top-3 z-10 rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white shadow-sm">-${product.discountPercent}%</span>`
    : '';

  const oldPrice = discounted
    ? `<span class="text-sm font-medium text-slate-400 line-through">${money(product.oldPriceCents)}</span>`
    : '';

  const title = esc(product.title);

  return `
    <article class="group card flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
      <a href="/product.html?slug=${encodeURIComponent(product.slug)}" class="block focus:outline-none">
        <div class="ph ${tone} h-52">
          ${badge}
          <span class="ph-icon">${ICONS.part}</span>
          ${imageTag(product.imagePath, {
            alt: title,
            className: 'absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]',
          })}
        </div>
      </a>

      <div class="flex flex-1 flex-col p-4">
        <p class="text-xs ${soldOut ? 'font-semibold text-red-600' : 'text-slate-500'}">
          ${soldOut ? 'Out of stock' : `${product.stock} in stock`}
        </p>

        <h3 class="mt-1 min-h-[3.75rem] text-sm font-bold leading-snug text-slate-900">
          <a href="/product.html?slug=${encodeURIComponent(product.slug)}" class="line-clamp-3 hover:text-blue-600">${title}</a>
        </h3>

        <p class="mt-1.5 text-xs text-slate-500">${esc(product.brand)} &bull; ${esc(product.category ?? '')}</p>

        <div class="mt-3 flex flex-wrap items-baseline gap-2">
          <span class="text-lg font-extrabold text-slate-900">${money(product.priceCents)}</span>
          ${oldPrice}
        </div>

        <button
          type="button"
          data-add-to-cart="${product.id}"
          ${soldOut ? 'disabled' : ''}
          class="btn mt-4 w-full ${
            soldOut
              ? 'cursor-not-allowed bg-slate-100 text-slate-400'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }">
          ${soldOut ? 'Out of stock' : 'Add to cart'}
        </button>
      </div>
    </article>`;
}

const categoryTile = (category, index) => `
  <a href="/products.html?category=${encodeURIComponent(category.slug)}"
     class="group card block overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">
    <div class="ph ph-${(index % 4) + 1} h-44 sm:h-52">
      <span class="ph-icon">${ICONS.car}</span>
      ${imageTag(category.imagePath, {
        alt: `${esc(category.name)} parts`,
        className: 'absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]',
      })}
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent px-4 pb-3 pt-10">
        <span class="text-base font-extrabold text-white">${esc(category.name)}</span>
      </div>
    </div>
  </a>`;

/* -------------------------------------------------------------------------
   Grids — now fed by the API rather than a hardcoded array
   ---------------------------------------------------------------------- */

const skeleton = (count, height) =>
  Array.from(
    { length: count },
    () => `<div class="card ${height} animate-pulse bg-slate-200/60 ring-0"></div>`,
  ).join('');

const errorState = (message) => `
  <div class="col-span-full rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
    <p class="text-sm font-semibold text-amber-900">${esc(message)}</p>
    <button type="button" data-retry class="link-all mt-2">Try again</button>
  </div>`;

async function fillGrid(mount, fetcher, template, { skeletonHeight = 'h-80', empty = 'Nothing here yet.' } = {}) {
  if (!mount) return;

  const columns = Number(mount.dataset.count ?? 6);
  mount.innerHTML = skeleton(columns, skeletonHeight);

  try {
    const items = await fetcher();

    mount.innerHTML = items.length
      ? items.map(template).join('')
      : `<p class="col-span-full py-8 text-center text-sm text-slate-500">${esc(empty)}</p>`;
  } catch (error) {
    mount.innerHTML = errorState(
      error.status === 0
        ? 'We could not load these parts — check your connection.'
        : 'We could not load these parts right now.',
    );

    mount.querySelector('[data-retry]')?.addEventListener('click', () => {
      fillGrid(mount, fetcher, template, { skeletonHeight, empty });
    });
  }
}

function renderGrids() {
  fillGrid(
    document.querySelector('[data-grid="recommended"]'),
    async () => (await get('/api/products?featured=1&limit=6')).products,
    productCard,
  );

  fillGrid(
    document.querySelector('[data-grid="deals"]'),
    async () => (await get('/api/products?deals=1&limit=6')).products,
    productCard,
  );

  fillGrid(
    document.querySelector('[data-grid="categories"]'),
    // tiles=1 → the six categories that have artwork. Seats/Lights/Tires/
    // Transmission are real categories but were never home-page tiles.
    async () => (await get('/api/categories?tiles=1')).categories,
    categoryTile,
    { skeletonHeight: 'h-44 sm:h-52' },
  );
}

/* -------------------------------------------------------------------------
   Add to cart (delegated — the grids are replaced asynchronously)
   ---------------------------------------------------------------------- */

function initAddToCart() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-to-cart]');
    if (!button || button.disabled) return;

    addToCart(button.dataset.addToCart, 1);

    // Confirm in place. A silent cart is a cart people click three times.
    const original = button.textContent;
    button.textContent = 'Added ✓';
    button.classList.add('bg-green-600', 'hover:bg-green-700');
    button.classList.remove('bg-blue-600', 'hover:bg-blue-700');

    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('bg-green-600', 'hover:bg-green-700');
      button.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }, 1400);
  });
}

/* -------------------------------------------------------------------------
   Contact form — live character counters and client-side validation.
   Spam protection is server-side (rate limit + honeypot), so there is no
   challenge widget to wait on and the submit button is enabled from the start.
   ---------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function paintCharCounters(form) {
  form.querySelectorAll('[data-counter-for]').forEach((counter) => {
    const field = form.elements[counter.dataset.counterFor];
    if (field) counter.textContent = `${field.value.length}/${field.getAttribute('maxlength')}`;
  });
}

function initContactForm() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  const status = form.querySelector('[data-form-status]');
  const submit = form.querySelector('[data-submit]');
  const submitLabel = form.querySelector('[data-submit-label]');

  form.querySelectorAll('[data-counter-for]').forEach((counter) => {
    form.elements[counter.dataset.counterFor]?.addEventListener('input', () => paintCharCounters(form));
  });
  paintCharCounters(form);

  const showError = (name, message) => {
    const field = form.elements[name];
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (!field || !slot) return;

    field.setAttribute('aria-invalid', String(Boolean(message)));
    slot.dataset.visible = String(Boolean(message));
    slot.textContent = message ?? '';
  };

  const validate = () => {
    const errors = {};
    const read = (name) => String(form.elements[name]?.value ?? '').trim();

    if (!read('name')) errors.name = 'Please enter your name.';
    if (!read('email')) errors.email = 'Please enter your email address.';
    else if (!EMAIL_RE.test(read('email'))) errors.email = 'Enter a valid email address.';
    if (!read('subject')) errors.subject = 'Please enter a subject.';
    if (!read('message')) errors.message = 'Please enter a message.';

    ['name', 'email', 'subject', 'message'].forEach((name) => showError(name, errors[name]));
    return errors;
  };

  ['name', 'email', 'subject', 'message'].forEach((name) => {
    form.elements[name]?.addEventListener('blur', validate);
  });

  const setStatus = (tone, message) => {
    status.textContent = message;
    status.className =
      tone === 'success'
        ? 'mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800'
        : tone === 'error'
          ? 'mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800'
          : 'sr-only';
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('idle', '');

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setStatus('error', 'Please correct the highlighted fields and try again.');
      form.elements[Object.keys(errors)[0]]?.focus();
      return;
    }

    submit.disabled = true;
    submitLabel.textContent = 'Sending…';

    try {
      const result = await post('/api/contact', {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        subject: form.elements.subject.value.trim(),
        location: form.elements.location.value,
        message: form.elements.message.value.trim(),
        // Honeypot — always empty for a real person.
        website: form.elements.website?.value ?? '',
      });

      form.reset();
      paintCharCounters(form);
      setStatus('success', result.message ?? 'Thanks — your message has been sent.');
    } catch (error) {
      setStatus('error', error.message);
    } finally {
      submit.disabled = false;
      submitLabel.textContent = 'Send message';
    }
  });
}

/* -------------------------------------------------------------------------
   Boot
   ---------------------------------------------------------------------- */

function boot() {
  mountChrome(); // must run before initHeader — it creates the nav it wires up
  hydrateStaticImages();
  applySiteImages(get); // hero + partner artwork, from the database
  initHeader();
  initSliders();
  initSmoothScroll();
  initAddToCart();
  initContactForm();
  renderGrids();

  updateCartBadge(cartCount());
  onCartChange(() => updateCartBadge(cartCount()));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
