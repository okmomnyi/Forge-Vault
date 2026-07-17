import './style.css';
import { get, post } from './lib/api.js';
import { adoptSession, loadSession, redirectToSignIn } from './lib/auth.js';
import { addToCart, cartCount, clearCart, getCart, onCartChange, removeFromCart, setQuantity } from './lib/cart.js';
import { esc, formatDate, money, statusBadge } from './lib/format.js';
import { applySiteImages, hydrateStaticImages, imageTag, installImageFallback } from './lib/images.js';
import { initHeader, paintAccountState, setStatus, showFieldErrors, updateCartBadge } from './lib/ui.js';
import { mountChrome } from './partials.js';

/* =========================================================================
   ForgeVault — shop pages (products, product, cart, checkout, order)
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
  const category = params.get('category');
  const search = params.get('q');

  const query = new URLSearchParams({ limit: '48' });
  if (category) query.set('category', category);
  if (search) query.set('q', search);

  if (heading) {
    heading.textContent = search
      ? `Results for “${search}”`
      : category
        ? `${category.charAt(0).toUpperCase()}${category.slice(1)}`
        : 'All Parts';
  }

  const searchInput = document.querySelector('[data-search-input]');
  if (searchInput && search) searchInput.value = search;

  document.querySelector('[data-search-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = searchInput.value.trim();
    location.href = value ? `/products.html?q=${encodeURIComponent(value)}` : '/products.html';
  });

  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="card h-80 animate-pulse bg-forge-high/60"></div>').join('');

  try {
    const { products } = await get(`/api/products?${query}`);

    grid.innerHTML = products.length
      ? products.map(productCard).join('')
      : `<p class="col-span-full rounded-none bg-forge-panel p-10 text-center text-forge-outline">
           No parts matched. <a href="/products.html" class="link-all">Browse everything</a>
         </p>`;
  } catch (error) {
    grid.innerHTML = `<p class="col-span-full rounded-none border border-amber-200 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-900">${esc(error.message)}</p>`;
  }
}

function productCard(product, index) {
  const discounted = Boolean(product.discountPercent && product.oldPriceCents);
  const soldOut = product.stock < 1;

  return `
    <article class="group card flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <a href="/product.html?slug=${encodeURIComponent(product.slug)}">
        <div class="ph ph-${(index % 4) + 1} h-52">
          ${discounted ? `<span class="absolute left-3 top-3 z-10 rounded-none bg-red-600 px-2 py-1 text-xs font-bold text-white">-${product.discountPercent}%</span>` : ''}
          <span class="ph-icon">${PART_ICON}</span>
          ${imageTag(product.imagePath, { alt: esc(product.title), className: 'absolute inset-0 h-full w-full object-cover' })}
        </div>
      </a>
      <div class="flex flex-1 flex-col p-4">
        <p class="text-xs ${soldOut ? 'font-semibold text-red-600' : 'text-forge-outline'}">${soldOut ? 'Out of stock' : `${product.stock} in stock`}</p>
        <h3 class="mt-1 min-h-[3.75rem] text-sm font-bold leading-snug text-forge-ink">
          <a href="/product.html?slug=${encodeURIComponent(product.slug)}" class="line-clamp-3 hover:text-forge-orange">${esc(product.title)}</a>
        </h3>
        <p class="mt-1.5 text-xs text-forge-outline">${esc(product.brand)} &bull; ${esc(product.category ?? '')}</p>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-lg font-extrabold text-forge-ink">${money(product.priceCents)}</span>
          ${discounted ? `<span class="text-sm text-forge-outline line-through">${money(product.oldPriceCents)}</span>` : ''}
        </div>
        <button type="button" data-add-to-cart="${product.id}" ${soldOut ? 'disabled' : ''}
                class="btn mt-4 w-full ${soldOut ? 'cursor-not-allowed bg-forge-bg text-forge-outline' : 'bg-forge-orange text-white hover:brightness-110'}">
          ${soldOut ? 'Out of stock' : 'Add to cart'}
        </button>
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
      <h1 class="text-xl font-extrabold text-forge-ink">${esc(title)}</h1>
      <p class="mt-2 text-sm text-forge-outline">${esc(body)}</p>
      <a href="/products.html" class="btn-primary mt-6">Browse all parts</a>
    </div>`;

  const slug = params.get('slug');
  if (!slug) {
    mount.innerHTML = fallback('No part selected', 'Pick a part from the catalogue to see its details.');
    return;
  }

  try {
    const { product } = await get(`/api/products/${encodeURIComponent(slug)}`);

    document.title = `${product.title} — ForgeVault`;

    const discounted = Boolean(product.discountPercent && product.oldPriceCents);
    const soldOut = product.stock < 1;

    mount.innerHTML = `
      <nav class="mb-6 text-sm text-forge-outline" aria-label="Breadcrumb">
        <a href="/products.html" class="hover:text-forge-orange">Parts</a>
        ${product.categorySlug ? ` / <a href="/products.html?category=${encodeURIComponent(product.categorySlug)}" class="hover:text-forge-orange">${esc(product.category)}</a>` : ''}
      </nav>

      <div class="grid gap-8 lg:grid-cols-2">
        <div class="ph ph-2 aspect-[4/3] rounded-none">
          ${discounted ? `<span class="absolute left-4 top-4 z-10 rounded-none bg-red-600 px-2.5 py-1 text-sm font-bold text-white">-${product.discountPercent}%</span>` : ''}
          <span class="ph-icon">${PART_ICON}</span>
          ${imageTag(product.imagePath, { alt: esc(product.title), className: 'absolute inset-0 h-full w-full rounded-none object-cover', lazy: false })}
        </div>

        <div>
          <p class="eyebrow">${esc(product.brand)} &bull; ${esc(product.category ?? 'Parts')}</p>
          <h1 class="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-forge-ink sm:text-3xl">${esc(product.title)}</h1>

          ${product.partNumber ? `<p class="mt-3 text-sm text-forge-outline">Part number <span class="font-mono font-semibold text-forge-muted">${esc(product.partNumber)}</span></p>` : ''}

          <div class="mt-5 flex items-baseline gap-3">
            <span class="text-3xl font-extrabold text-forge-ink">${money(product.priceCents)}</span>
            ${discounted ? `<span class="text-lg text-forge-outline line-through">${money(product.oldPriceCents)}</span>` : ''}
          </div>

          <p class="mt-2 text-sm ${soldOut ? 'font-semibold text-red-600' : 'text-forge-salmon'}">
            ${soldOut ? 'Out of stock' : `${product.stock} in stock — ready to ship`}
          </p>

          ${product.description ? `<p class="mt-5 leading-relaxed text-forge-muted">${esc(product.description)}</p>` : ''}

          <div class="mt-7 flex flex-col gap-3 sm:flex-row">
            <button type="button" data-add-to-cart="${product.id}" ${soldOut ? 'disabled' : ''}
                    class="btn flex-1 ${soldOut ? 'cursor-not-allowed bg-forge-bg text-forge-outline' : 'bg-forge-orange text-white hover:brightness-110'}">
              ${soldOut ? 'Out of stock' : 'Add to cart'}
            </button>
            <a href="/contact.html" class="btn-outline flex-1">Ask about fitment</a>
          </div>

          <div class="mt-6 rounded-none border border-forge-line bg-forge-low p-4 text-sm leading-relaxed text-forge-muted">
            <strong class="text-forge-ink">Not sure it fits?</strong>
            Send us your VIN before you order and we will confirm compatibility. Wrong-part returns are open for 14 days —
            but only on parts that have not been fitted.
          </div>
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
        <p class="text-lg font-bold text-forge-ink">Your cart is empty</p>
        <p class="mt-2 text-forge-outline">Find the part you need and it will show up here.</p>
        <a href="/products.html" class="btn-primary mt-6">Browse parts</a>
      </div>`;
    if (summary) summary.innerHTML = '';
    return;
  }

  mount.innerHTML = '<div class="card h-64 animate-pulse bg-forge-high/60"></div>';

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
        <div class="rounded-none border border-amber-200 bg-amber-50 p-6">
          <p class="font-bold text-amber-900">Some parts are no longer available</p>
          <ul class="mt-3 space-y-2 text-sm text-amber-900">
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

    mount.innerHTML = `<div class="rounded-none border border-red-200 bg-red-50 p-6 text-sm font-semibold text-red-800">${esc(error.message)}</div>`;
  }
}

const cartRow = (item, index) => `
  <div class="flex gap-4 p-4">
    <div class="ph ph-${(index % 4) + 1} h-24 w-24 shrink-0 rounded-none">
      <span class="ph-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="h-8 w-8" aria-hidden="true"><circle cx="12" cy="12" r="3"/></svg></span>
      ${imageTag(item.imagePath, { alt: esc(item.title), className: 'absolute inset-0 h-full w-full rounded-none object-cover' })}
    </div>

    <div class="min-w-0 flex-1">
      <h3 class="line-clamp-2 text-sm font-bold text-forge-ink">${esc(item.title)}</h3>
      <p class="mt-1 text-xs text-forge-outline">${esc(item.brand ?? '')}</p>
      <p class="mt-1 text-sm text-forge-muted">${money(item.unitPriceCents)} each</p>

      <div class="mt-3 flex items-center gap-3">
        <div class="inline-flex items-center rounded-none border border-forge-line">
          <button type="button" data-qty="${item.productId}" data-delta="-1" aria-label="Decrease quantity"
                  class="grid h-8 w-8 place-items-center text-forge-muted hover:bg-forge-low">−</button>
          <span class="w-9 text-center text-sm font-semibold tabular-nums">${item.quantity}</span>
          <button type="button" data-qty="${item.productId}" data-delta="1" aria-label="Increase quantity"
                  class="grid h-8 w-8 place-items-center text-forge-muted hover:bg-forge-low">+</button>
        </div>

        <button type="button" data-remove="${item.productId}" class="text-xs font-semibold text-forge-outline hover:text-forge-error">
          Remove
        </button>
      </div>
    </div>

    <p class="shrink-0 text-base font-extrabold text-forge-ink">${money(item.lineTotalCents)}</p>
  </div>`;

const cartSummary = (quote) => `
  <div class="card sticky top-24 p-6">
    <h2 class="text-lg font-extrabold text-forge-ink">Order summary</h2>

    <dl class="mt-5 space-y-3 text-sm">
      <div class="flex justify-between"><dt class="text-forge-muted">Subtotal</dt><dd class="font-semibold text-forge-ink">${money(quote.subtotalCents)}</dd></div>
      <div class="flex justify-between">
        <dt class="text-forge-muted">Shipping</dt>
        <dd class="font-semibold ${quote.shippingCents === 0 ? 'text-forge-salmon' : 'text-forge-ink'}">
          ${quote.shippingCents === 0 ? 'Free' : money(quote.shippingCents)}
        </dd>
      </div>
      ${quote.taxCents ? `<div class="flex justify-between"><dt class="text-forge-muted">Tax</dt><dd class="font-semibold text-forge-ink">${money(quote.taxCents)}</dd></div>` : ''}
    </dl>

    <div class="mt-4 flex items-baseline justify-between border-t-2 border-forge-orange pt-4">
      <span class="text-base font-extrabold text-forge-ink">Total</span>
      <span class="text-2xl font-extrabold text-forge-ink">${money(quote.totalCents)}</span>
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
      tab.classList.toggle('bg-forge-panel', active);
      tab.classList.toggle('text-forge-ink', active);
      tab.classList.toggle('shadow-sm', active);
      tab.classList.toggle('text-forge-muted', !active);
    });
  };

  tabs.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => show(tab.dataset.tab));
  });

  show(params.get('mode') === 'register' ? 'register' : 'signin');

  // Already signed in? Nothing to do here.
  loadSession().then((customer) => {
    if (customer) location.href = nextPath();
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
      <p class="text-center text-forge-outline">
        Your cart is empty. <a href="/products.html" class="link-all">Find a part</a>
      </p>`;
    form.querySelector('[data-submit]').disabled = true;
    return;
  }

  try {
    const quote = await post('/api/checkout/quote', { items: lines });

    totalsMount.innerHTML = `
      <ul class="space-y-3">
        ${quote.items
          .map(
            (item) => `
          <li class="flex justify-between gap-4 text-sm">
            <span class="text-forge-muted">${esc(item.title)} <span class="text-forge-outline">× ${item.quantity}</span></span>
            <span class="shrink-0 font-semibold text-forge-ink">${money(item.lineTotalCents)}</span>
          </li>`,
          )
          .join('')}
      </ul>
      <dl class="mt-5 space-y-2 border-t border-forge-line pt-4 text-sm">
        <div class="flex justify-between"><dt class="text-forge-muted">Subtotal</dt><dd class="font-semibold">${money(quote.subtotalCents)}</dd></div>
        <div class="flex justify-between"><dt class="text-forge-muted">Shipping</dt><dd class="font-semibold">${quote.shippingCents === 0 ? 'Free' : money(quote.shippingCents)}</dd></div>
        ${quote.taxCents ? `<div class="flex justify-between"><dt class="text-forge-muted">Tax</dt><dd class="font-semibold">${money(quote.taxCents)}</dd></div>` : ''}
      </dl>
      <div class="mt-4 flex items-baseline justify-between border-t-2 border-forge-orange pt-4">
        <span class="font-extrabold text-forge-ink">Total</span>
        <span class="text-2xl font-extrabold text-forge-ink">${money(quote.totalCents)}</span>
      </div>`;

    // Only offer the methods the server says are actually configured.
    const methods = document.querySelector('[data-payment-methods]');
    methods.innerHTML = quote.paymentMethods.length
      ? quote.paymentMethods
          .map(
            (method, index) => `
        <label class="flex cursor-pointer items-center gap-3 rounded-none border border-forge-line p-4 transition has-[:checked]:border-forge-orange has-[:checked]:bg-forge-high">
          <input type="radio" name="paymentMethod" value="${esc(method.id)}" ${index === 0 ? 'checked' : ''}
                 class="h-4 w-4 text-forge-orange focus:ring-forge-orange">
          <span class="text-sm font-semibold text-forge-ink">${esc(method.label)}</span>
        </label>`,
          )
          .join('')
      : `<p class="rounded-none border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
           No payment method is configured on this deployment yet.
         </p>`;

    if (!quote.paymentMethods.length) form.querySelector('[data-submit]').disabled = true;
  } catch (error) {
    totalsMount.innerHTML = `<p class="rounded-none bg-red-50 p-4 text-sm font-semibold text-red-800">${esc(error.message)}</p>`;
  }

  /* ---- Place the order ---- */
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(status, 'idle', '');
    showFieldErrors(form, {});

    const submit = form.querySelector('[data-submit]');
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
        paymentMethod: data.get('paymentMethod'),
      });

      clearCart();

      setStatus(status, 'info', 'Redirecting you to complete payment…');
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

  mount.innerHTML = '<div class="card h-40 animate-pulse bg-forge-high/60"></div>';

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
              <p class="font-mono text-sm font-bold text-forge-ink">${esc(order.orderNumber)}</p>
              <p class="mt-1 text-xs text-forge-outline">${formatDate(order.createdAt)} &bull; ${order.items.length} item${order.items.length === 1 ? '' : 's'}</p>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-lg font-extrabold text-forge-ink">${money(order.totalCents, order.currency)}</span>
              ${statusBadge(order.status)}
            </div>
          </div>
          <p class="mt-3 line-clamp-1 text-sm text-forge-muted">
            ${order.items.map((i) => esc(i.title)).join(', ')}
          </p>
        </a>`,
          )
          .join('')
      : `<div class="card p-12 text-center">
           <p class="text-lg font-bold text-forge-ink">No orders yet</p>
           <p class="mt-2 text-forge-outline">When you buy a part, it will show up here.</p>
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
      <h1 class="text-xl font-extrabold text-forge-ink">${esc(title)}</h1>
      <p class="mt-2 text-sm text-forge-outline">${esc(body)}</p>
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

    mount.innerHTML = `
      <div class="card p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="eyebrow">Order ${esc(order.orderNumber)}</p>
            <h1 class="mt-2 text-2xl font-extrabold tracking-tight text-forge-ink sm:text-3xl">
              ${paid ? 'Thank you — your order is confirmed' : 'Your order is not paid yet'}
            </h1>
            <p class="mt-2 text-sm text-forge-outline">Placed ${formatDate(order.createdAt)}</p>
          </div>
          ${statusBadge(order.status)}
        </div>

        ${
          order.trackingNumber
            ? `<div class="mt-6 rounded-none border border-forge-line bg-forge-high p-4">
                 <p class="text-xs font-bold uppercase tracking-wide text-forge-salmon">Tracking</p>
                 <p class="mt-1 font-mono text-sm font-semibold text-forge-salmon">${esc(order.trackingNumber)}</p>
                 ${order.carrier ? `<p class="mt-1 text-xs text-forge-salmon">via ${esc(order.carrier)}</p>` : ''}
               </div>`
            : ''
        }

        <div class="mt-6 divide-y divide-slate-200 border-y border-forge-line">
          ${order.items
            .map(
              (item) => `
            <div class="flex justify-between gap-4 py-4">
              <div class="min-w-0">
                <p class="text-sm font-bold text-forge-ink">${esc(item.title)}</p>
                <p class="mt-0.5 text-xs text-forge-outline">
                  ${esc(item.brand ?? '')}${item.partNumber ? ` &bull; ${esc(item.partNumber)}` : ''} &bull; Qty ${item.quantity}
                </p>
              </div>
              <p class="shrink-0 text-sm font-bold text-forge-ink">${money(item.lineTotalCents, order.currency)}</p>
            </div>`,
            )
            .join('')}
        </div>

        <dl class="mt-5 space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-forge-muted">Subtotal</dt><dd class="font-semibold">${money(order.subtotalCents, order.currency)}</dd></div>
          <div class="flex justify-between"><dt class="text-forge-muted">Shipping</dt><dd class="font-semibold">${order.shippingCents ? money(order.shippingCents, order.currency) : 'Free'}</dd></div>
          ${order.taxCents ? `<div class="flex justify-between"><dt class="text-forge-muted">Tax</dt><dd class="font-semibold">${money(order.taxCents, order.currency)}</dd></div>` : ''}
          ${order.refundedCents ? `<div class="flex justify-between text-forge-salmon"><dt>Refunded</dt><dd class="font-semibold">−${money(order.refundedCents, order.currency)}</dd></div>` : ''}
          <div class="flex justify-between border-t-2 border-forge-orange pt-3 text-base">
            <dt class="font-extrabold text-forge-ink">Total</dt>
            <dd class="font-extrabold text-forge-ink">${money(order.totalCents, order.currency)}</dd>
          </div>
        </dl>

        <div class="mt-6 rounded-none bg-forge-low p-4 text-sm leading-relaxed text-forge-muted">
          <p class="mb-1 text-xs font-bold uppercase tracking-wide text-forge-ink">Shipping to</p>
          ${[order.shipping.name, order.shipping.line1, order.shipping.line2, `${order.shipping.postalCode ?? ''} ${order.shipping.city ?? ''}`.trim(), order.shipping.country]
            .filter(Boolean)
            .map(esc)
            .join('<br>')}
        </div>
      </div>

      ${paid && order.refundedCents < order.totalCents ? refundPanel(order) : ''}`;

    if (paid) initRefundForm(order, id, token);
  } catch (error) {
    mount.innerHTML = fallback('We could not load this order', error.message);
  }
}

const refundPanel = (order) => `
  <details class="card mt-6 p-6">
    <summary class="cursor-pointer text-sm font-bold text-forge-ink">Something wrong? Request a refund</summary>
    <form data-refund-form class="mt-5">
      <label for="refund-reason" class="field-label">What went wrong?</label>
      <textarea id="refund-reason" name="reason" rows="3" required maxlength="500"
                placeholder="e.g. the part does not match my VIN, or it arrived damaged"
                class="field-input resize-y"></textarea>
      <p class="mt-2 text-xs text-forge-outline">
        This files a request — it does not refund you automatically. We review every one and email you back.
        Refundable balance: <strong>${money(order.totalCents - order.refundedCents, order.currency)}</strong>.
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
    button.classList.add('bg-forge-orange');
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('bg-forge-orange');
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
  initMyOrders();
  initOrderPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
