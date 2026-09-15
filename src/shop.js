import './style.css';
import { get, post } from './lib/api.js';
import { adoptSession, loadSession, redirectToSignIn } from './lib/auth.js';
import { addToCart, cartCount, clearCart, getCart, onCartChange, removeFromCart, setQuantity } from './lib/cart.js';
import { esc, formatDate, money, statusBadge } from './lib/format.js';
import { applySiteImages, hydrateStaticImages, imageTag, installImageFallback, isIllustrativeArt } from './lib/images.js';
import { initHeader, paintAccountState, setStatus, showFieldErrors, updateCartBadge } from './lib/ui.js';
import { initGiftCardsPage } from './gift-cards.js';
import { mountChrome } from './partials.js';

/* =========================================================================
   Forge Vault — shop pages (products, product, cart, checkout, order)
   One bundle; each section below activates only if its mount point exists.
   ========================================================================= */

installImageFallback();

const PART_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-12 w-12" aria-hidden="true"><path d="M14 4h-4a2 2 0 0 0-2 2v2H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-2V6a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="2.5"/></svg>`;

const params = new URLSearchParams(location.search);

/* =========================================================================
   PRODUCTS LISTING  (products.html)
   ========================================================================= */

async function initProductsPage() {
  const grid = document.querySelector('[data-products-grid]');
  if (!grid) return;

  const heading = document.querySelector('[data-products-heading]');
  const countLabel = document.querySelector('[data-products-count]');
  const resultsLabel = document.querySelector('[data-results-count]');
  const sortSelect = document.querySelector('[data-sort]');
  const category = params.get('category');
  const search = params.get('q');

  if (heading) {
    heading.textContent = search ? `Results for “${search}”` : category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Marketplace';
  }
  if (countLabel) countLabel.textContent = 'Verified parts ready to ship worldwide.';

  const searchInput = document.querySelector('[data-search-input]');
  if (searchInput && search) searchInput.value = search;

  document.querySelector('[data-search-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = searchInput.value.trim();
    location.href = value ? `/products.html?q=${encodeURIComponent(value)}` : '/products.html';
  });

  /* ---- Category sidebar — real catalogue data, driving ?category= ---- */
  const categoryMount = document.querySelector('[data-category-filters]');
  if (categoryMount) {
    try {
      const { categories } = await get('/api/categories');
      const filterLink = (label, slug) => `
        <a href="${slug ? `/products.html?category=${encodeURIComponent(slug)}` : '/products.html'}"
           class="rounded-lg px-3 py-2 text-sm ${
             category === slug ? 'bg-white/[0.06] font-semibold text-moto-ink' : 'text-moto-muted hover:text-moto-ink'
           }">${esc(label)}</a>`;

      categoryMount.innerHTML =
        filterLink('All categories', null) + categories.map((c) => filterLink(c.name, c.slug)).join('');
    } catch {
      categoryMount.innerHTML = '';
    }
  }

  const loadProducts = async () => {
    grid.innerHTML = Array.from({ length: 6 }, () => '<div class="card h-80 animate-pulse bg-moto-high/60"></div>').join('');

    const query = new URLSearchParams({ limit: '48' });
    if (category) query.set('category', category);
    if (search) query.set('q', search);
    query.set('sort', sortSelect?.value ?? 'newest');

    try {
      const { products } = await get(`/api/products?${query}`);

      if (resultsLabel) resultsLabel.textContent = `${products.length} result${products.length === 1 ? '' : 's'}`;

      grid.innerHTML = products.length
        ? products.map(productCard).join('')
        : `<p class="col-span-full rounded-[18px] bg-moto-panel p-10 text-center text-moto-outline">
             No parts matched. <a href="/products.html" class="link-all">Browse everything</a>
           </p>`;
    } catch (error) {
      if (resultsLabel) resultsLabel.textContent = '';
      grid.innerHTML = `<p class="col-span-full rounded-[18px] border border-amber-500/40 bg-amber-500/10 p-6 text-center text-sm font-semibold text-amber-300">${esc(error.message)}</p>`;
    }
  };

  sortSelect?.addEventListener('change', loadProducts);
  loadProducts();
}

function productCard(product, index) {
  const discounted = Boolean(product.discountPercent && product.oldPriceCents);
  const soldOut = product.stock < 1;

  return `
    <article class="group card flex flex-col overflow-hidden transition hover:-translate-y-0.5">
      <a href="/product.html?slug=${encodeURIComponent(product.slug)}">
        <div class="ph ph-${(index % 4) + 1} h-52 rounded-none">
          <span class="absolute left-3 top-3 z-10 rounded-full bg-moto-accent/90 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-moto-on-accent">✓ VERIFIED</span>
          ${discounted ? `<span class="absolute right-3 top-3 z-10 rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">-${product.discountPercent}%</span>` : ''}
          <span class="ph-icon">${PART_ICON}</span>
          ${imageTag(product.imagePath, { alt: esc(product.title), className: 'absolute inset-0 h-full w-full object-cover' })}
          ${isIllustrativeArt(product.imagePath) ? `<span class="absolute bottom-2 left-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-moto-warm backdrop-blur-sm">Illustrative artwork</span>` : ''}
        </div>
      </a>
      <div class="flex flex-1 flex-col p-[18px]">
        <p class="text-xs text-moto-outline">${esc(product.category ?? 'Parts')}</p>
        <h3 class="mt-1.5 min-h-[42px] font-display text-base font-semibold leading-snug text-moto-ink">
          <a href="/product.html?slug=${encodeURIComponent(product.slug)}" class="line-clamp-2 hover:text-moto-accent">${esc(product.title)}</a>
        </h3>
        <p class="mt-1 text-xs text-moto-outline">${esc(product.brand)}${soldOut ? ' &bull; Out of stock' : ` &bull; ${product.stock} in stock`}</p>
        <div class="mt-auto flex items-end justify-between pt-4">
          <div>
            <div class="font-display text-xl font-bold text-moto-ink">${money(product.priceCents)}</div>
            ${discounted ? `<div class="text-xs text-moto-outline line-through">${money(product.oldPriceCents)}</div>` : ''}
          </div>
          <button type="button" data-add-to-cart="${product.id}" ${soldOut ? 'disabled' : ''}
                  class="rounded-full border border-moto-line-2 px-4 py-2 text-[13px] font-semibold transition ${soldOut ? 'cursor-not-allowed text-moto-outline' : 'text-moto-ink hover:bg-white/[0.06]'}">
            ${soldOut ? 'Out of stock' : 'Add'}
          </button>
        </div>
      </div>
    </article>`;
}

/* =========================================================================
   PRODUCT DETAIL  (product.html)
   ========================================================================= */

async function initProductPage() {
  const mount = document.querySelector('[data-product-detail]');
  if (!mount) return;

  // Every render path below emits exactly one <h1> — including the failure
  // paths, so the page is never left headless for a screen reader.
  const fallback = (title, body) => `
    <div class="card p-10 text-center">
      <h1 class="text-xl font-extrabold text-moto-ink">${esc(title)}</h1>
      <p class="mt-2 text-sm text-moto-outline">${esc(body)}</p>
      <a href="/products.html" class="btn-primary mt-6">Browse all parts</a>
    </div>`;

  const slug = params.get('slug');
  if (!slug) {
    mount.innerHTML = fallback('No part selected', 'Pick a part from the catalogue to see its details.');
    return;
  }

  try {
    const { product } = await get(`/api/products/${encodeURIComponent(slug)}`);

    document.title = `${product.title} — Forge Vault`;

    const discounted = Boolean(product.discountPercent && product.oldPriceCents);
    const soldOut = product.stock < 1;

    // Real fields only — the design concept shows fabricated fitment/warranty/
    // rating data that this catalogue does not actually track.
    const specs = [
      ['Brand', product.brand],
      ['Category', product.category ?? '—'],
      ['Part number', product.partNumber],
      ['Availability', soldOut ? 'Out of stock' : `${product.stock} in stock`],
    ].filter(([, value]) => Boolean(value));

    mount.innerHTML = `
      <p class="text-[13px] text-moto-outline">
        <a href="/index.html" class="hover:text-moto-ink">Home</a> /
        <a href="/products.html" class="hover:text-moto-ink">Marketplace</a>
        ${product.categorySlug ? `/ <a href="/products.html?category=${encodeURIComponent(product.categorySlug)}" class="hover:text-moto-ink">${esc(product.category)}</a>` : ''}
      </p>

      <div class="mt-6 grid gap-12 lg:grid-cols-2 lg:items-start">
        <div>
          <div class="ph ph-2 aspect-[4/3] rounded-[20px]">
            ${discounted ? `<span class="absolute left-4 top-4 z-10 rounded-full bg-red-600 px-2.5 py-1 text-sm font-bold text-white">-${product.discountPercent}%</span>` : ''}
            <span class="ph-icon">${PART_ICON}</span>
            ${imageTag(product.imagePath, { alt: esc(product.title), className: 'absolute inset-0 h-full w-full rounded-[20px] object-cover', lazy: false })}
          </div>
          ${
            isIllustrativeArt(product.imagePath)
              ? `<p class="mt-3 text-center text-xs text-moto-outline">Illustrative artwork, not a photo of the actual item — ask us for real photos before you buy.</p>`
              : ''
          }
        </div>

        <div class="lg:sticky lg:top-24">
          <span class="eyebrow inline-flex items-center gap-1.5 rounded-full bg-moto-accent/15 px-3 py-1.5">✓ Verified listing</span>

          <p class="mt-4 text-[13px] text-moto-outline">${esc(product.category ?? 'Parts')}</p>
          <h1 class="mt-1.5 text-[34px] font-bold leading-[1.15] tracking-tight text-moto-ink">${esc(product.title)}</h1>
          <p class="mt-2.5 text-sm text-moto-muted">${esc(product.brand)}</p>

          <div class="mt-6 font-display text-4xl font-bold text-moto-ink">${money(product.priceCents)}</div>
          ${discounted ? `<div class="mt-1 text-lg text-moto-outline line-through">${money(product.oldPriceCents)}</div>` : ''}

          <p class="mt-2 text-sm ${soldOut ? 'font-semibold text-moto-error' : 'text-moto-accent-soft'}">
            ${soldOut ? 'Out of stock' : `${product.stock} in stock — ready to ship`}
          </p>

          <div class="mt-7 flex flex-col gap-3 sm:flex-row">
            <button type="button" data-add-to-cart="${product.id}" ${soldOut ? 'disabled' : ''}
                    class="btn flex-1 ${soldOut ? 'cursor-not-allowed bg-moto-bg text-moto-outline' : 'bg-moto-accent text-moto-on-accent hover:bg-moto-accent-soft'}">
              ${soldOut ? 'Out of stock' : 'Add to cart'}
            </button>
            <a href="/contact.html" class="btn-outline flex-1">Ask about fitment</a>
          </div>

          <div class="mt-7 flex items-center gap-2.5 rounded-2xl border border-moto-line bg-moto-panel px-4 py-3.5 text-[13px] leading-relaxed text-moto-muted">
            <span class="h-4 w-4 shrink-0 rounded-full border-2 border-moto-accent"></span>
            Payment protected — funds are only released once your order has shipped, and wrong-part returns are open
            for 14 days on anything that hasn't been fitted.
          </div>

          ${product.description ? `<p class="mt-6 leading-relaxed text-moto-muted">${esc(product.description)}</p>` : ''}

          ${
            specs.length
              ? `<div class="mt-7 border-t border-moto-line pt-5">
                   <p class="font-display text-base font-semibold text-moto-ink">Specifications</p>
                   ${specs
                     .map(
                       ([label, value]) => `
                     <div class="flex justify-between border-b border-moto-line py-2.5 text-sm">
                       <span class="text-moto-outline">${esc(label)}</span>
                       <span class="font-medium text-moto-ink">${esc(value)}</span>
                     </div>`,
                     )
                     .join('')}
                 </div>`
              : ''
          }
        </div>
      </div>`;
  } catch (error) {
    mount.innerHTML = fallback('We could not load this part', error.message);
  }
}

/* =========================================================================
   CART  (cart.html)
   =========================================================================
   Totals are never computed here. The page posts the cart's product ids to
   /api/checkout/quote and renders whatever the server says — so the number on
   screen is always the number that will be charged.
   ========================================================================= */

let quoted = null;

async function renderCart() {
  const mount = document.querySelector('[data-cart]');
  if (!mount) return;

  const summary = document.querySelector('[data-cart-summary]');
  const lines = getCart();

  if (lines.length === 0) {
    mount.innerHTML = `
      <div class="card p-12 text-center">
        <p class="text-lg font-bold text-moto-ink">Your cart is empty</p>
        <p class="mt-2 text-moto-outline">Find the part you need and it will show up here.</p>
        <a href="/products.html" class="btn-primary mt-6">Browse parts</a>
      </div>`;
    if (summary) summary.innerHTML = '';
    return;
  }

  mount.innerHTML = '<div class="card h-64 animate-pulse bg-moto-high/60"></div>';

  try {
    quoted = await post('/api/checkout/quote', { items: lines });

    mount.innerHTML = `
      <div class="card divide-y divide-slate-200">
        ${quoted.items.map(cartRow).join('')}
      </div>`;

    if (summary) summary.innerHTML = cartSummary(quoted);
  } catch (error) {
    // A 409 means stock moved under the customer. Say exactly which line, and
    // give them a one-click way to fix it rather than a dead end.
    if (error.status === 409 && error.problems) {
      mount.innerHTML = `
        <div class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6">
          <p class="font-bold text-amber-300">Some parts are no longer available</p>
          <ul class="mt-3 space-y-2 text-sm text-amber-200">
            ${error.problems
              .map(
                (problem) => `
                <li class="flex items-start justify-between gap-4">
                  <span>${esc(problem.title ?? 'An item in your cart')} — ${esc(problem.reason)}</span>
                  <button type="button" data-drop="${esc(problem.productId)}"
                          class="shrink-0 font-semibold underline hover:no-underline">Remove</button>
                </li>`,
              )
              .join('')}
          </ul>
          <button type="button" data-drop-all class="btn-primary mt-5">Remove unavailable items</button>
        </div>`;

      mount.querySelector('[data-drop-all]')?.addEventListener('click', () => {
        error.problems.forEach((problem) => removeFromCart(problem.productId));
        renderCart();
      });

      mount.querySelectorAll('[data-drop]').forEach((button) => {
        button.addEventListener('click', () => {
          removeFromCart(button.dataset.drop);
          renderCart();
        });
      });

      if (summary) summary.innerHTML = '';
      return;
    }

    mount.innerHTML = `<div class="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-sm font-semibold text-red-300">${esc(error.message)}</div>`;
  }
}

const cartRow = (item, index) => `
  <div class="flex gap-4 p-4">
    <div class="ph ph-${(index % 4) + 1} h-24 w-24 shrink-0 rounded-2xl">
      <span class="ph-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-8 w-8" aria-hidden="true"><circle cx="12" cy="12" r="3"/></svg></span>
      ${imageTag(item.imagePath, { alt: esc(item.title), className: 'absolute inset-0 h-full w-full rounded-2xl object-cover' })}
    </div>

    <div class="min-w-0 flex-1">
      <h3 class="line-clamp-2 text-sm font-bold text-moto-ink">${esc(item.title)}</h3>
      <p class="mt-1 text-xs text-moto-outline">${esc(item.brand ?? '')}</p>
      <p class="mt-1 text-sm text-moto-muted">${money(item.unitPriceCents)} each</p>

      <div class="mt-3 flex items-center gap-3">
        <div class="inline-flex items-center rounded-full border border-moto-line">
          <button type="button" data-qty="${item.productId}" data-delta="-1" aria-label="Decrease quantity"
                  class="grid h-8 w-8 place-items-center text-moto-muted hover:bg-moto-low">−</button>
          <span class="w-9 text-center text-sm font-semibold tabular-nums">${item.quantity}</span>
          <button type="button" data-qty="${item.productId}" data-delta="1" aria-label="Increase quantity"
                  class="grid h-8 w-8 place-items-center text-moto-muted hover:bg-moto-low">+</button>
        </div>

        <button type="button" data-remove="${item.productId}" class="text-xs font-semibold text-moto-outline hover:text-moto-error">
          Remove
        </button>
      </div>
    </div>

    <p class="shrink-0 text-base font-extrabold text-moto-ink">${money(item.lineTotalCents)}</p>
  </div>`;

const cartSummary = (quote) => `
  <div class="card sticky top-24 p-6">
    <h2 class="text-lg font-extrabold text-moto-ink">Order summary</h2>

    <dl class="mt-5 space-y-3 text-sm">
      <div class="flex justify-between"><dt class="text-moto-muted">Subtotal</dt><dd class="font-semibold text-moto-ink">${money(quote.subtotalCents)}</dd></div>
      <div class="flex justify-between">
        <dt class="text-moto-muted">Shipping</dt>
        <dd class="font-semibold ${quote.shippingCents === 0 ? 'text-moto-accent-soft' : 'text-moto-ink'}">
          ${quote.shippingCents === 0 ? 'Free' : money(quote.shippingCents)}
        </dd>
      </div>
      ${quote.taxCents ? `<div class="flex justify-between"><dt class="text-moto-muted">Tax</dt><dd class="font-semibold text-moto-ink">${money(quote.taxCents)}</dd></div>` : ''}
    </dl>

    <div class="mt-4 flex items-baseline justify-between border-t-2 border-moto-accent pt-4">
      <span class="text-base font-extrabold text-moto-ink">Total</span>
      <span class="text-2xl font-extrabold text-moto-ink">${money(quote.totalCents)}</span>
    </div>

    <a href="/checkout.html" class="btn-primary mt-6 w-full">Checkout</a>
    <a href="/products.html" class="link-all mt-4 block text-center">Continue shopping</a>
  </div>`;

function initCartPage() {
  const mount = document.querySelector('[data-cart]');
  if (!mount) return;

  mount.addEventListener('click', (event) => {
    const qty = event.target.closest('[data-qty]');
    if (qty) {
      const current = getCart().find((line) => line.productId === qty.dataset.qty);
      setQuantity(qty.dataset.qty, (current?.quantity ?? 1) + Number(qty.dataset.delta));
      renderCart();
      return;
    }

    const remove = event.target.closest('[data-remove]');
    if (remove) {
      removeFromCart(remove.dataset.remove);
      renderCart();
    }
  });

  renderCart();
}

/* =========================================================================
   ACCOUNT  (account.html)
   =========================================================================
   Sign in, register, verify. Three panels, one page.
   ========================================================================= */

function initAccountPage() {
  const tabs = document.querySelector('[data-tabs]');
  if (!tabs) return;

  const panels = {
    signin: document.querySelector('[data-panel="signin"]'),
    register: document.querySelector('[data-panel="register"]'),
    verify: document.querySelector('[data-panel="verify"]'),
  };

  const signinForm = document.querySelector('[data-signin-form]');
  const registerForm = document.querySelector('[data-register-form]');
  const verifyForm = document.querySelector('[data-verify-form]');

  const signinStatus = document.querySelector('[data-signin-status]');
  const registerStatus = document.querySelector('[data-register-status]');
  const verifyStatus = document.querySelector('[data-verify-status]');

  let pendingEmail = '';

  /**
   * Where to go after signing in. Only same-origin PATHS are honoured — an
   * absolute URL here would turn this into an open redirect, which is a
   * ready-made phishing primitive.
   */
  const nextPath = () => {
    const raw = params.get('next');
    return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/index.html';
  };

  const show = (name) => {
    Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('hidden', key !== name));

    tabs.classList.toggle('hidden', name === 'verify');
    tabs.querySelectorAll('[data-tab]').forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('bg-moto-panel', active);
      tab.classList.toggle('text-moto-ink', active);
      tab.classList.toggle('shadow-sm', active);
      tab.classList.toggle('text-moto-muted', !active);
    });
  };

  tabs.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => show(tab.dataset.tab));
  });

  show(params.get('mode') === 'register' ? 'register' : 'signin');

  /**
   * If already signed in:
   *   - Came here with a `next` (routed here to authenticate for checkout, an
   *     order, etc.)? Complete that — send them on.
   *   - Otherwise they navigated to the account page directly. Do NOT bounce
   *     them to the home page (that reads as the page "refreshing itself").
   *     Show a signed-in panel instead, with a way to sign out and switch.
   */
  loadSession().then((customer) => {
    if (!customer) return;

    if (params.get('next')) {
      location.href = nextPath();
      return;
    }

    const intro = document.querySelector('[data-account-intro]');
    const signedInPanel = document.querySelector('[data-panel="signedin"]');
    if (!signedInPanel) {
      // No panel to fall back to — keep the old behaviour rather than get stuck.
      location.href = nextPath();
      return;
    }

    tabs.classList.add('hidden');
    Object.values(panels).forEach((panel) => panel.classList.add('hidden'));
    signedInPanel.classList.remove('hidden');
    if (intro) intro.textContent = 'You are already signed in.';
    document.querySelector('[data-signedin-name]').textContent = customer.name?.split(' ')[0] ?? 'there';

    signedInPanel.querySelector('[data-signedin-signout]')?.addEventListener('click', async () => {
      const { signOut } = await import('./lib/auth.js');
      await signOut();
      location.reload(); // back to the sign-in / register forms, now signed out
    });
  });

  const toVerify = (email) => {
    pendingEmail = email;
    document.querySelector('[data-verify-email]').textContent = email;
    show('verify');
    verifyForm.elements.code.focus();
  };

  /* ---- Sign in ---- */
  signinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(signinStatus, 'idle', '');
    showFieldErrors(signinForm, {});

    const submit = signinForm.querySelector('[data-submit]');
    submit.disabled = true;
    submit.textContent = 'Signing in…';

    try {
      const result = await post('/api/auth/login', {
        email: signinForm.elements.email.value.trim(),
        password: signinForm.elements.password.value,
      });

      // Right password, but the email was never confirmed.
      if (result.next === 'verify') {
        toVerify(result.email);
        setStatus(verifyStatus, 'info', 'Confirm your email to finish signing in.');
        return;
      }

      adoptSession(result.customer, result.csrfToken);
      location.href = nextPath();
    } catch (error) {
      showFieldErrors(signinForm, error.errors ?? {});
      setStatus(signinStatus, 'error', error.message);
      signinForm.elements.password.value = '';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });

  /* ---- Register ---- */
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(registerStatus, 'idle', '');
    showFieldErrors(registerForm, {});

    const submit = registerForm.querySelector('[data-submit]');
    submit.disabled = true;
    submit.textContent = 'Creating…';

    try {
      const result = await post('/api/auth/register', {
        name: registerForm.elements.name.value.trim(),
        email: registerForm.elements.email.value.trim(),
        password: registerForm.elements.password.value,
      });

      toVerify(result.email);
    } catch (error) {
      showFieldErrors(registerForm, error.errors ?? {});
      setStatus(registerStatus, 'error', error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create account';
    }
  });

  /* ---- Verify ---- */
  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(verifyStatus, 'idle', '');

    const submit = verifyForm.querySelector('[data-submit]');
    submit.disabled = true;
    submit.textContent = 'Verifying…';

    try {
      const result = await post('/api/auth/verify', {
        email: pendingEmail,
        code: verifyForm.elements.code.value.trim(),
      });

      adoptSession(result.customer, result.csrfToken);
      location.href = nextPath();
    } catch (error) {
      setStatus(verifyStatus, 'error', error.message);
      submit.disabled = false;
      submit.textContent = 'Verify and continue';
    }
  });

  document.querySelector('[data-resend]')?.addEventListener('click', async () => {
    setStatus(verifyStatus, 'idle', '');

    try {
      const result = await post('/api/auth/resend', { email: pendingEmail });
      setStatus(verifyStatus, 'info', result.message);
    } catch (error) {
      setStatus(verifyStatus, 'error', error.message);
    }
  });
}

/* =========================================================================
   CHECKOUT  (checkout.html)
   =========================================================================
   Requires a signed-in, verified account. There is no guest checkout: the
   order's email comes from the session, so a buyer cannot place an order
   against an address they do not control.
   ========================================================================= */

async function initCheckoutPage() {
  const form = document.querySelector('[data-checkout-form]');
  if (!form) return;

  const totalsMount = document.querySelector('[data-checkout-totals]');
  const status = document.querySelector('[data-checkout-status]');
  const gate = document.querySelector('[data-checkout-gate]');
  const body = document.querySelector('[data-checkout-body]');

  /* ---- The gate ---- */
  const customer = await loadSession();

  if (!customer) {
    // Show the reason rather than bouncing silently — a page that teleports you
    // elsewhere with no explanation feels broken.
    gate.classList.remove('hidden');
    body.classList.add('hidden');

    gate.querySelector('[data-signin]').href = `/account.html?next=${encodeURIComponent('/checkout.html')}`;
    gate.querySelector('[data-register]').href = `/account.html?mode=register&next=${encodeURIComponent('/checkout.html')}`;
    return;
  }

  gate.classList.add('hidden');
  body.classList.remove('hidden');

  // The buyer's identity is fixed by the session. Shown, not editable — the
  // server would ignore any change anyway.
  document.querySelector('[data-buyer-name]').textContent = customer.name;
  document.querySelector('[data-buyer-email]').textContent = customer.email;

  /* ---- Live totals, priced by the server ---- */
  const lines = getCart();

  if (lines.length === 0) {
    totalsMount.innerHTML = `
      <p class="text-center text-moto-muted">
        Your cart is empty. <a href="/products.html" class="link-all">Find a part</a>
      </p>`;
    form.querySelector('[data-submit]').disabled = true;
    return;
  }

  const submitButton = form.querySelector('[data-submit]');
  const paymentSection = document.querySelector('[data-payment-section]');
  const paymentNote = document.querySelector('[data-payment-note]');
  const giftForm = document.querySelector('[data-gift-code-form]');
  const giftEntry = giftForm.querySelector('[data-gift-code-entry]');
  const giftApplied = giftForm.querySelector('[data-gift-code-applied]');

  // The code the server last accepted. Sent with the order; the server re-checks
  // it and holds the credit, so this is a convenience, not a promise.
  let giftCode = '';
  let dueCents = null;

  function renderTotals(quote) {
    totalsMount.innerHTML = `
      <ul class="space-y-3">
        ${quote.items
          .map(
            (item) => `
          <li class="flex justify-between gap-4 text-sm">
            <span class="text-moto-ink">${esc(item.title)} <span class="text-moto-muted">× ${item.quantity}</span></span>
            <span class="shrink-0 font-semibold text-moto-ink">${money(item.lineTotalCents)}</span>
          </li>`,
          )
          .join('')}
      </ul>
      <dl class="mt-5 space-y-2 border-t border-moto-line pt-4 text-sm">
        <div class="flex justify-between"><dt class="text-moto-muted">Subtotal</dt><dd class="font-semibold text-moto-ink">${money(quote.subtotalCents)}</dd></div>
        <div class="flex justify-between"><dt class="text-moto-muted">Shipping</dt><dd class="font-semibold text-moto-ink">${quote.shippingCents === 0 ? 'Free' : money(quote.shippingCents)}</dd></div>
        ${quote.taxCents ? `<div class="flex justify-between"><dt class="text-moto-muted">Tax</dt><dd class="font-semibold text-moto-ink">${money(quote.taxCents)}</dd></div>` : ''}
        ${
          quote.giftCard
            ? `<div class="flex justify-between border-t border-moto-line pt-2"><dt class="text-moto-muted">Order total</dt><dd class="font-semibold text-moto-ink">${money(quote.totalCents)}</dd></div>
               <div class="flex justify-between text-moto-accent"><dt>Gift card <span class="font-display font-semibold">…${esc(quote.giftCard.last4)}</span></dt><dd class="font-semibold">−${money(quote.giftCard.appliedCents)}</dd></div>`
            : ''
        }
      </dl>
      <div class="mt-4 flex items-baseline justify-between border-t border-moto-line pt-4">
        <span class="font-display font-bold text-moto-ink">${quote.giftCard ? 'To pay' : 'Total'}</span>
        <span class="font-display text-2xl font-bold text-moto-ink">${money(quote.dueCents)}</span>
      </div>
      ${
        quote.giftCard
          ? `<p class="mt-2 text-right text-xs text-moto-outline">
               ${quote.giftCard.balanceCents - quote.giftCard.appliedCents > 0 ? `${money(quote.giftCard.balanceCents - quote.giftCard.appliedCents)} stays on the card` : 'Uses the full card balance'}
             </p>`
          : ''
      }
      ${
        quote.charge
          ? `<p class="mt-3 rounded-xl border border-moto-line bg-moto-high px-3 py-2 text-[11px] leading-relaxed text-moto-warm">
               Billed in ${esc(quote.charge.currency)}. You will be charged
               <span class="font-semibold text-moto-ink">${money(quote.charge.amountCents, quote.charge.currency)}</span>
               at today's rate on the secure payment page.
             </p>`
          : ''
      }`;

    dueCents = quote.dueCents;

    // Paid in full by gift card: no provider, so no method to pick.
    const covered = quote.dueCents === 0;
    paymentSection.classList.toggle('hidden', covered);
    paymentNote.textContent = covered
      ? 'Your gift card covers this order, so there is no card payment. The order is confirmed straight away.'
      : 'You will be taken to our payment provider to complete the payment securely. Card details never touch our servers.';

    giftEntry.classList.toggle('hidden', Boolean(quote.giftCard));
    giftApplied.classList.toggle('hidden', !quote.giftCard);
    giftApplied.classList.toggle('flex', Boolean(quote.giftCard));
    if (quote.giftCard) giftForm.querySelector('[data-gift-code-last4]').textContent = `…${quote.giftCard.last4}`;

    // Only offer the methods the server says are actually configured. Rendered
    // once: re-quoting after a gift card change must not reset their choice.
    if (!methods.childElementCount) {
      methods.innerHTML = quote.paymentMethods.length
      ? quote.paymentMethods
          .map(
            (method, index) => `
        <label class="flex cursor-pointer items-center gap-3 rounded-2xl border border-moto-line-2 bg-moto-panel p-4 transition has-[:checked]:border-moto-accent has-[:checked]:bg-moto-high">
          <input type="radio" name="paymentMethod" value="${esc(method.id)}" ${index === 0 ? 'checked' : ''}
                 class="h-4 w-4 accent-moto-accent">
          <span class="text-sm font-semibold text-moto-ink">${esc(method.label)}</span>
        </label>`,
          )
          .join('')
      : `<p class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm font-semibold text-amber-300">
           No payment method is configured on this deployment yet.
         </p>`;
    }

    submitButton.disabled = !covered && !quote.paymentMethods.length;
  }

  /**
   * Back to "no card applied", re-priced. `code` and `error` put a rejected code
   * back in the box with the reason under it, so the customer can fix or remove it.
   */
  async function clearGiftCard({ code = '', error = null } = {}) {
    giftCode = '';
    giftForm.elements.giftCode.value = code;

    try {
      renderTotals(await post('/api/checkout/quote', { items: getCart() }));
    } catch (quoteError) {
      totalsMount.innerHTML = `<p class="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm font-semibold text-red-300">${esc(quoteError.message)}</p>`;
    }

    showFieldErrors(giftForm, error ? { giftCode: error } : {});
    giftForm.elements.giftCode.focus();
  }

  const methods = document.querySelector('[data-payment-methods]');

  try {
    renderTotals(await post('/api/checkout/quote', { items: lines }));
  } catch (error) {
    totalsMount.innerHTML = `<p class="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm font-semibold text-red-300">${esc(error.message)}</p>`;
  }

  /* ---- Gift card ---- */
  giftForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldErrors(giftForm, {});

    const code = giftForm.elements.giftCode.value.trim();
    if (!code) {
      showFieldErrors(giftForm, { giftCode: 'Enter the code from your gift card email.' });
      giftForm.elements.giftCode.focus();
      return;
    }

    const apply = giftForm.querySelector('[data-gift-code-apply]');
    apply.disabled = true;
    apply.textContent = 'Checking…';

    try {
      renderTotals(await post('/api/checkout/quote', { items: getCart(), giftCode: code }));
      giftCode = code;
      giftForm.querySelector('[data-gift-code-remove]').focus();
    } catch (error) {
      if (error.status === 401) {
        redirectToSignIn('/checkout.html');
        return;
      }
      showFieldErrors(giftForm, { giftCode: error.errors?.giftCode ?? error.message });
      giftForm.elements.giftCode.focus();
    } finally {
      apply.disabled = false;
      apply.textContent = 'Apply';
    }
  });

  giftForm.querySelector('[data-gift-code-remove]').addEventListener('click', () => clearGiftCard());

  /* ---- Place the order ---- */
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(status, 'idle', '');
    showFieldErrors(form, {});

    const submit = submitButton;
    submit.disabled = true;
    submit.textContent = 'Placing order…';

    const data = new FormData(form);

    try {
      // No email, no name — the server takes those from the session.
      const result = await post('/api/checkout/create', {
        items: getCart(),
        phone: data.get('phone'),
        shipping: {
          line1: data.get('line1'),
          line2: data.get('line2'),
          city: data.get('city'),
          postalCode: data.get('postalCode'),
          country: data.get('country'),
        },
        paymentMethod: dueCents === 0 ? undefined : (data.get('paymentMethod') ?? undefined),
        giftCode: giftCode || undefined,
      });

      clearCart();

      setStatus(
        status,
        'info',
        result.paidWithGiftCard ? 'Paid with your gift card. Opening your order…' : 'Redirecting you to complete payment…',
      );
      location.href = result.redirectUrl;
    } catch (error) {
      // The session lapsed between page load and submit.
      if (error.status === 401) {
        redirectToSignIn('/checkout.html');
        return;
      }

      // Zod paths come back as "shipping.line1"; the inputs are named "line1".
      const flat = {};
      for (const [key, message] of Object.entries(error.errors ?? {})) {
        flat[key.replace(/^shipping\./, '')] = message;
      }
      showFieldErrors(form, flat);
      setStatus(status, 'error', error.message);

      // The card's balance moved, or the code stopped working, between applying
      // it and placing the order. Nothing was charged. Re-price without it and
      // show why next to the code.
      if (error.errors?.giftCode) {
        await clearGiftCard({ code: giftCode, error: error.message });
      }

      submit.disabled = false;
      submit.textContent = 'Place order';
    }
  });
}

/* =========================================================================
   ORDER HISTORY  (orders.html)
   ========================================================================= */

async function initMyOrders() {
  const mount = document.querySelector('[data-my-orders]');
  if (!mount) return;

  const customer = await loadSession();
  if (!customer) {
    redirectToSignIn('/orders.html');
    return;
  }

  mount.innerHTML = '<div class="card h-40 animate-pulse bg-moto-high/60"></div>';

  try {
    const { orders } = await get('/api/orders');

    mount.innerHTML = orders.length
      ? orders
          .map(
            (order) => `
        <a href="/order.html?id=${order.id}&token=${encodeURIComponent(order.accessToken)}"
           class="card mb-4 block p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-mono text-sm font-bold text-moto-ink">${esc(order.orderNumber)}</p>
              <p class="mt-1 text-xs text-moto-outline">${formatDate(order.createdAt)} &bull; ${order.items.length} item${order.items.length === 1 ? '' : 's'}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-lg font-extrabold text-moto-ink">${money(order.totalCents, order.currency)}</span>
              ${statusBadge(order.status)}
            </div>
          </div>
          <p class="mt-3 line-clamp-1 text-sm text-moto-muted">
            ${order.items.map((i) => esc(i.title)).join(', ')}
          </p>
        </a>`,
          )
          .join('')
      : `<div class="card p-12 text-center">
           <p class="text-lg font-bold text-moto-ink">No orders yet</p>
           <p class="mt-2 text-moto-outline">When you buy a part, it will show up here.</p>
           <a href="/products.html" class="btn-primary mt-6">Browse parts</a>
         </div>`;
  } catch (error) {
    mount.innerHTML = `<div class="card p-8 text-center text-sm font-semibold text-red-700">${esc(error.message)}</div>`;
  }
}

/* =========================================================================
   ORDER STATUS  (order.html)
   ========================================================================= */

async function initOrderPage() {
  const mount = document.querySelector('[data-order]');
  if (!mount) return;

  const id = params.get('id');
  const token = params.get('token');

  // Failure paths carry the page's <h1> too, so order.html is never headless.
  const fallback = (title, body) => `
    <div class="card p-10 text-center">
      <h1 class="h-display text-xl">${esc(title)}</h1>
      <p class="mt-2 text-sm text-moto-muted">${esc(body)}</p>
      <a href="/index.html" class="link-all mt-4 inline-block">Back to the shop</a>
    </div>`;

  if (!id || !token) {
    mount.innerHTML = fallback(
      'This order link is incomplete',
      'Use the link from your confirmation email — it carries the token that unlocks your order.',
    );
    return;
  }

  try {
    const { order } = await get(`/api/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);

    const paid = Boolean(order.paidAt);
    const isGiftCard = order.kind === 'gift_card';

    const heading = isGiftCard
      ? paid
        ? 'Gift card paid for.'
        : 'Your gift card is not paid for yet'
      : paid
        ? 'Order confirmed.'
        : 'Your order is not paid yet';

    // The design concept's confirmation checkmark badge — shown only once the
    // order is actually paid. A not-yet-paid order gets a plain heading; there
    // is nothing to celebrate yet.
    const confirmBadge = paid
      ? `<div class="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-moto-accent/15">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-7 w-7 text-moto-accent" aria-hidden="true">
             <path d="M5 13l4 4L19 7" />
           </svg>
         </div>`
      : '';

    mount.innerHTML = `
      <div class="text-center">
        ${confirmBadge}
        <p class="eyebrow">Order ${esc(order.orderNumber)}</p>
        <h1 class="h-display text-3xl mt-2">
          ${esc(heading)}
        </h1>
        <p class="mt-2 text-sm text-moto-muted">Placed ${formatDate(order.createdAt)}</p>
        ${isGiftCard ? '' : `<div class="mt-3 flex justify-center">${statusBadge(order.status)}</div>`}
      </div>

      <div class="card mt-8 p-6 sm:p-8 text-left">
        ${
          order.trackingNumber
            ? `<div class="mb-6 rounded-2xl border border-moto-line bg-moto-high p-4">
                 <p class="text-xs font-semibold uppercase tracking-wide text-moto-accent">Tracking</p>
                 <p class="mt-1 font-mono text-sm font-semibold text-moto-ink">${esc(order.trackingNumber)}</p>
                 ${order.carrier ? `<p class="mt-1 text-xs text-moto-muted">via ${esc(order.carrier)}</p>` : ''}
               </div>`
            : ''
        }

        <div class="divide-y divide-moto-line border-y border-moto-line">
          ${order.items
            .map(
              (item) => `
            <div class="flex justify-between gap-4 py-4">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-moto-ink">${esc(item.title)}</p>
                ${
                  isGiftCard
                    ? ''
                    : `<p class="mt-0.5 text-xs text-moto-muted">
                  ${esc(item.brand ?? '')}${item.partNumber ? ` &bull; ${esc(item.partNumber)}` : ''} &bull; Qty ${item.quantity}
                </p>`
                }
              </div>
              <p class="shrink-0 text-sm font-semibold text-moto-ink">${money(item.lineTotalCents, order.currency)}</p>
            </div>`,
            )
            .join('')}
        </div>

        <dl class="mt-5 space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-moto-muted">Subtotal</dt><dd class="font-semibold text-moto-ink">${money(order.subtotalCents, order.currency)}</dd></div>
          ${isGiftCard ? '' : `<div class="flex justify-between"><dt class="text-moto-muted">Shipping</dt><dd class="font-semibold text-moto-ink">${order.shippingCents ? money(order.shippingCents, order.currency) : 'Free'}</dd></div>`}
          ${order.taxCents ? `<div class="flex justify-between"><dt class="text-moto-muted">Tax</dt><dd class="font-semibold text-moto-ink">${money(order.taxCents, order.currency)}</dd></div>` : ''}
          ${order.refundedCents ? `<div class="flex justify-between text-moto-accent"><dt>Refunded</dt><dd class="font-semibold">−${money(order.refundedCents, order.currency)}</dd></div>` : ''}
          <div class="flex justify-between border-t border-moto-line pt-3 text-base">
            <dt class="font-display font-bold text-moto-ink">Total</dt>
            <dd class="font-display font-bold text-moto-ink">${money(order.totalCents, order.currency)}</dd>
          </div>
          ${
            order.giftCardCents
              ? `<div class="flex justify-between text-moto-muted"><dt>Paid by gift card</dt><dd class="font-semibold">−${money(order.giftCardCents, order.currency)}</dd></div>
                 <div class="flex justify-between text-moto-muted"><dt>Paid by card</dt><dd class="font-semibold">${money(order.totalCents - order.giftCardCents, order.currency)}</dd></div>`
              : ''
          }
        </dl>

        ${isGiftCard ? giftCardDeliveryPanel(order) : shippingPanel(order)}
      </div>

      ${paid ? `<div class="mt-8 flex flex-wrap justify-center gap-3">
        <a href="/products.html" class="btn-primary">Keep shopping</a>
        <a href="/index.html" class="btn-outline">Back to home</a>
      </div>` : ''}

      ${paid && order.refundedCents < order.totalCents ? refundPanel(order) : ''}`;

    if (paid) initRefundForm(order, id, token);
  } catch (error) {
    mount.innerHTML = fallback('We could not load this order', error.message);
  }
}

const shippingPanel = (order) => `
  <div class="mt-6 rounded-2xl bg-moto-high p-4 text-sm leading-relaxed text-moto-warm">
    <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-moto-ink">Shipping to</p>
    ${[order.shipping.name, order.shipping.line1, order.shipping.line2, `${order.shipping.postalCode ?? ''} ${order.shipping.city ?? ''}`.trim(), order.shipping.country]
      .filter(Boolean)
      .map(esc)
      .join('<br>')}
  </div>`;

/**
 * Where a gift card went, and whether it has. Says plainly when payment has not
 * been confirmed yet, because the webhook can land a few seconds after the
 * customer is sent back here.
 */
function giftCardDeliveryPanel(order) {
  const card = order.giftCard;
  if (!card) return '';

  const to = card.recipientName ? `${esc(card.recipientName)} (${esc(card.recipientEmail)})` : esc(card.recipientEmail);

  const state = {
    pending: order.paidAt
      ? 'Payment received. The code is being created.'
      : 'Waiting for payment confirmation. If you have just paid, this page updates within a minute: refresh to check.',
    active:
      order.status === 'delivered'
        ? `Code emailed to ${to}.`
        : `Code created for ${to}. If it has not arrived, reply to your receipt email and we will send a new one.`,
    disabled: 'This gift card was refunded, so its code no longer works.',
  }[card.status];

  return `
    <div class="mt-6 rounded-2xl bg-moto-high p-4 text-sm leading-relaxed text-moto-warm">
      <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-moto-ink">Gift card for</p>
      <p>${to}</p>
      <p class="mt-3 ${card.status === 'disabled' ? 'text-moto-error' : 'text-moto-accent'}">${state}</p>
      <p class="mt-3 text-xs text-moto-outline">
        For security the code is only sent to the recipient, never shown here or on your receipt.
      </p>
    </div>`;
}

const refundPanel = (order) => `
  <details class="card mt-6 p-6">
    <summary class="cursor-pointer font-display text-sm font-semibold text-moto-ink">Something wrong? Request a refund</summary>
    <form data-refund-form class="mt-5">
      <label for="refund-reason" class="field-label">What went wrong?</label>
      <textarea id="refund-reason" name="reason" rows="3" required maxlength="500"
                placeholder="e.g. the part does not match my VIN, or it arrived damaged"
                class="field-input resize-y"></textarea>
      <p class="mt-2 text-xs text-moto-muted">
        This files a request — it does not refund you automatically. We review every one and email you back.
        Refundable balance: <strong class="text-moto-ink">${money(order.totalCents - order.refundedCents, order.currency)}</strong>.
      </p>
      <button type="submit" data-refund-submit class="btn-primary mt-4">Request refund</button>
      <p data-refund-status role="status" aria-live="polite" class="sr-only"></p>
    </form>
  </details>`;

function initRefundForm(order, id, token) {
  const form = document.querySelector('[data-refund-form]');
  if (!form) return;

  const status = form.querySelector('[data-refund-status]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submit = form.querySelector('[data-refund-submit]');
    submit.disabled = true;
    submit.textContent = 'Sending…';

    try {
      const result = await post('/api/refunds/request', {
        orderId: id,
        accessToken: token,
        reason: form.elements.reason.value.trim(),
      });

      form.innerHTML = '';
      setStatus(status, 'success', result.message);
      form.append(status);
    } catch (error) {
      setStatus(status, 'error', error.message);
      submit.disabled = false;
      submit.textContent = 'Request refund';
    }
  });
}

/* =========================================================================
   Boot
   ========================================================================= */

function boot() {
  mountChrome();
  hydrateStaticImages();
  applySiteImages(get);
  initHeader();

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-to-cart]');
    if (!button || button.disabled) return;

    addToCart(button.dataset.addToCart, 1);

    const original = button.textContent;
    button.textContent = 'Added ✓';
    button.classList.add('bg-moto-accent');
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('bg-moto-accent');
    }, 1400);
  });

  updateCartBadge(cartCount());
  onCartChange(() => updateCartBadge(cartCount()));

  // Swaps the header's "Sign in" link for the account menu once we know who
  // (if anyone) is signed in.
  paintAccountState(loadSession);

  initAccountPage();
  initProductsPage();
  initProductPage();
  initCartPage();
  initCheckoutPage();
  initGiftCardsPage();
  initMyOrders();
  initOrderPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
