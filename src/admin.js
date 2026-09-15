import './style.css';
import { del, get, patch, post, put, setCsrfToken } from './lib/api.js';
import { esc, formatDate, formatDateTime, money, statusBadge } from './lib/format.js';
import { setStatus, showFieldErrors } from './lib/ui.js';
import { uploadImage } from './lib/upload.js';

/* =========================================================================
   Forge Vault — admin panel
   Pages: login, dashboard, products, orders, refunds.
   ========================================================================= */

const params = new URLSearchParams(location.search);

/* -------------------------------------------------------------------------
   Session
   -------------------------------------------------------------------------
   The CSRF token is held in memory only — never in localStorage, where any
   injected script could read it. Every page load re-fetches it from the
   session endpoint, which is also our "am I still signed in?" check.
   ---------------------------------------------------------------------- */

let currentAdmin = null;

async function requireSession() {
  try {
    const { admin, csrfToken } = await get('/api/admin/auth/session');
    setCsrfToken(csrfToken);
    currentAdmin = admin;
    return admin;
  } catch {
    location.href = `/admin/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
}

function mountShell(active) {
  const shell = document.querySelector('[data-admin-shell]');
  if (!shell) return;

  const link = (href, label, key) => `
    <a href="${href}"
       class="rounded-lg px-3 py-2 text-sm font-semibold transition ${
         active === key ? 'bg-moto-accent text-moto-on-accent' : 'text-moto-muted hover:bg-moto-high/10 hover:text-white'
       }">${label}</a>`;

  shell.innerHTML = `
    <div class="container-page flex h-16 items-center justify-between gap-4">
      <div class="flex items-center gap-6">
        <a href="/admin/index.html" class="flex items-center gap-2 text-white">
          <span class="text-base font-bold uppercase tracking-[0.04em]">
            FORGE <span class="font-medium text-moto-muted">VAULT</span>
          </span>
          <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-moto-muted">Admin</span>
        </a>

        <nav class="hidden items-center gap-1 md:flex" aria-label="Admin">
          ${link('/admin/index.html', 'Dashboard', 'dashboard')}
          ${link('/admin/orders.html', 'Orders', 'orders')}
          ${link('/admin/products.html', 'Products', 'products')}
          ${link('/admin/refunds.html', 'Refunds', 'refunds')}
          ${link('/admin/media.html', 'Media', 'media')}
        </nav>
      </div>

      <div class="flex items-center gap-4">
        <span class="hidden text-sm text-moto-outline sm:block">
          ${esc(currentAdmin?.name ?? '')}
          <span class="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-moto-muted">${esc(currentAdmin?.role ?? '')}</span>
        </span>
        <button type="button" data-signout class="text-sm font-semibold text-moto-muted hover:text-white">Sign out</button>
      </div>
    </div>

    <nav class="container-page flex gap-1 overflow-x-auto pb-3 md:hidden" aria-label="Admin mobile">
      ${link('/admin/index.html', 'Dashboard', 'dashboard')}
      ${link('/admin/orders.html', 'Orders', 'orders')}
      ${link('/admin/products.html', 'Products', 'products')}
      ${link('/admin/refunds.html', 'Refunds', 'refunds')}
      ${link('/admin/media.html', 'Media', 'media')}
    </nav>`;

  shell.querySelector('[data-signout]')?.addEventListener('click', async () => {
    try {
      await del('/api/admin/auth/session');
    } finally {
      // Even if revocation failed, get them off the page.
      location.href = '/admin/login.html';
    }
  });
}

/* =========================================================================
   LOGIN  (admin/login.html)
   =========================================================================
   Two steps. A correct password does not sign you in — it emails a code.
   ========================================================================= */

function initLogin() {
  const form = document.querySelector('[data-login-form]');
  if (!form) return;

  const twofaForm = document.querySelector('[data-2fa-form]');
  const stepPassword = document.querySelector('[data-step="password"]');
  const step2fa = document.querySelector('[data-step="2fa"]');
  const status = document.querySelector('[data-login-status]');
  const status2fa = document.querySelector('[data-2fa-status]');

  let email = '';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(status, 'idle', '');

    const submit = form.querySelector('[data-submit]');
    submit.disabled = true;
    submit.textContent = 'Checking…';

    try {
      const result = await post('/api/admin/auth/login', {
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      });

      email = result.email;
      document.querySelector('[data-2fa-email]').textContent = email;

      stepPassword.classList.add('hidden');
      step2fa.classList.remove('hidden');
      twofaForm.elements.code.focus();
    } catch (error) {
      setStatus(status, 'error', error.message);
      form.elements.password.value = '';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Continue';
    }
  });

  twofaForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(status2fa, 'idle', '');

    const submit = twofaForm.querySelector('[data-submit]');
    submit.disabled = true;
    submit.textContent = 'Verifying…';

    try {
      const { csrfToken } = await post('/api/admin/auth/verify', {
        email,
        code: twofaForm.elements.code.value.trim(),
      });

      setCsrfToken(csrfToken);

      // Only same-origin paths — an open redirect here would be a phishing gift.
      const next = params.get('next');
      location.href = next?.startsWith('/admin/') ? next : '/admin/index.html';
    } catch (error) {
      setStatus(status2fa, 'error', error.message);
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
}

/* =========================================================================
   DASHBOARD  (admin/index.html)
   ========================================================================= */

async function initDashboard() {
  const mount = document.querySelector('[data-dashboard]');
  if (!mount) return;

  if (!(await requireSession())) return;
  mountShell('dashboard');

  try {
    const stats = await get('/api/admin/stats');

    const tile = (label, value, hint, tone = 'slate') => `
      <div class="card p-5">
        <p class="text-xs font-bold uppercase tracking-wide text-moto-outline">${esc(label)}</p>
        <p class="mt-2 text-3xl font-extrabold tabular-nums text-moto-ink">${value}</p>
        ${hint ? `<p class="mt-1 text-xs ${tone === 'warn' ? 'font-semibold text-moto-accent-soft' : 'text-moto-outline'}">${esc(hint)}</p>` : ''}
      </div>`;

    mount.innerHTML = `
      <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        ${tile('Revenue (30d)', money(stats.revenueCents), 'Net of refunds')}
        ${tile('Orders (30d)', stats.orderCount, `Avg ${money(stats.averageOrderCents)}`)}
        ${tile('Awaiting fulfilment', stats.awaitingFulfilment, stats.awaitingFulfilment ? 'Needs shipping' : 'All clear', stats.awaitingFulfilment ? 'warn' : 'slate')}
        ${tile('Open refunds', stats.openRefunds.length, stats.openRefunds.length ? 'Needs review' : 'None pending', stats.openRefunds.length ? 'warn' : 'slate')}
      </div>

      ${
        stats.failedEmails
          ? `<div class="mt-6 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm font-semibold text-red-300">
               ${stats.failedEmails} email${stats.failedEmails === 1 ? '' : 's'} failed to send in the last 30 days.
               Customers may not have received receipts — check your Brevo configuration.
             </div>`
          : ''
      }

      <div class="mt-8 grid gap-6 lg:grid-cols-2">
        <section class="card p-6">
          <h2 class="text-lg font-extrabold text-moto-ink">Low stock</h2>
          ${
            stats.lowStock.length
              ? `<ul class="mt-4 divide-y divide-slate-200">
                   ${stats.lowStock
                     .map(
                       (product) => `
                     <li class="flex items-center justify-between gap-4 py-3">
                       <span class="line-clamp-1 text-sm text-moto-muted">${esc(product.title)}</span>
                       <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                         product.stock === 0 ? 'bg-red-100 text-moto-error' : 'bg-moto-high text-moto-accent-soft'
                       }">${product.stock} left</span>
                     </li>`,
                     )
                     .join('')}
                 </ul>`
              : '<p class="mt-4 text-sm text-moto-outline">Nothing is running low.</p>'
          }
        </section>

        <section class="card p-6">
          <h2 class="text-lg font-extrabold text-moto-ink">Orders by status (30d)</h2>
          <ul class="mt-4 space-y-2">
            ${
              Object.entries(stats.byStatus).length
                ? Object.entries(stats.byStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(
                      ([status, count]) => `
                  <li class="flex items-center justify-between gap-4">
                    ${statusBadge(status)}
                    <span class="text-sm font-bold tabular-nums text-moto-ink">${count}</span>
                  </li>`,
                    )
                    .join('')
                : '<li class="text-sm text-moto-outline">No orders yet.</li>'
            }
          </ul>
        </section>
      </div>`;
  } catch (error) {
    mount.innerHTML = `<div class="card p-8 text-center text-sm font-semibold text-moto-error">${esc(error.message)}</div>`;
  }
}

/* =========================================================================
   ORDERS  (admin/orders.html)
   ========================================================================= */

async function initOrders() {
  const mount = document.querySelector('[data-orders]');
  if (!mount) return;

  if (!(await requireSession())) return;
  mountShell('orders');

  const filter = document.querySelector('[data-status-filter]');
  const detail = document.querySelector('[data-order-detail]');

  async function load() {
    mount.innerHTML = '<div class="card h-64 animate-pulse bg-moto-high/60"></div>';

    try {
      const query = new URLSearchParams();
      if (filter?.value && filter.value !== 'all') query.set('status', filter.value);

      const { orders } = await get(`/api/admin/orders?${query}`);

      mount.innerHTML = orders.length
        ? `<div class="card overflow-hidden">
             <div class="overflow-x-auto">
               <table class="w-full text-left text-sm">
                 <thead class="border-b border-moto-line bg-moto-low text-xs uppercase tracking-wide text-moto-outline">
                   <tr>
                     <th scope="col" class="px-4 py-3 font-bold">Order</th>
                     <th scope="col" class="px-4 py-3 font-bold">Customer</th>
                     <th scope="col" class="px-4 py-3 font-bold">Status</th>
                     <th scope="col" class="px-4 py-3 text-right font-bold">Total</th>
                     <th scope="col" class="px-4 py-3 font-bold">Placed</th>
                     <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
                   </tr>
                 </thead>
                 <tbody class="divide-y divide-slate-100">
                   ${orders.map(orderRow).join('')}
                 </tbody>
               </table>
             </div>
           </div>`
        : '<div class="card p-12 text-center text-moto-outline">No orders match this filter.</div>';
    } catch (error) {
      mount.innerHTML = `<div class="card p-8 text-center text-sm font-semibold text-moto-error">${esc(error.message)}</div>`;
    }
  }

  const orderRow = (order) => `
    <tr class="hover:bg-moto-low">
      <td class="px-4 py-3 font-mono font-semibold text-moto-ink">
        ${esc(order.order_number)}
        ${order.kind === 'gift_card' ? '<span class="ml-2 rounded-full border border-moto-line-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-moto-accent-soft">Gift card</span>' : ''}
      </td>
      <td class="px-4 py-3 text-moto-muted">${esc(order.email)}</td>
      <td class="px-4 py-3">${statusBadge(order.status)}</td>
      <td class="px-4 py-3 text-right font-bold tabular-nums text-moto-ink">
        ${money(order.total_cents, order.currency)}
        ${order.refunded_cents ? `<span class="block text-xs font-medium text-moto-accent-soft">−${money(order.refunded_cents, order.currency)}</span>` : ''}
      </td>
      <td class="px-4 py-3 text-moto-outline">${formatDate(order.created_at)}</td>
      <td class="px-4 py-3 text-right">
        <button type="button" data-open="${order.id}" class="link-all">Open</button>
      </td>
    </tr>`;

  filter?.addEventListener('change', load);

  // Paystack sends no webhook for a declined or abandoned payment, so those
  // orders only leave "Awaiting payment" when someone asks it. The daily cron
  // does this too; this is the same check, on demand.
  const reconcileAll = document.querySelector('[data-reconcile-all]');
  const reconcileStatus = document.querySelector('[data-reconcile-status]');

  reconcileAll?.addEventListener('click', async () => {
    reconcileAll.disabled = true;
    reconcileAll.textContent = 'Checking with Paystack…';
    setStatus(reconcileStatus, 'idle', '');

    try {
      const result = await post('/api/admin/orders/reconcile', {});
      setStatus(reconcileStatus, 'success', result.message);
      await load();
    } catch (error) {
      setStatus(reconcileStatus, 'error', error.message);
    } finally {
      reconcileAll.disabled = false;
      reconcileAll.textContent = 'Check pending payments';
    }
  });

  mount.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-open]');
    if (button) await openOrder(button.dataset.open);
  });

  /* ---- Detail drawer ---- */
  async function openOrder(id) {
    detail.classList.remove('hidden');
    detail.innerHTML = '<div class="card h-64 animate-pulse bg-moto-high/60"></div>';

    const { order, items, payments, refunds, emails, giftCard, giftCardTransactions } = await get(
      `/api/admin/orders/${id}`,
    );

    const isGiftCard = order.kind === 'gift_card';
    const isManager = ['owner', 'manager'].includes(currentAdmin.role);

    // The state machine, mirrored from the server. The server is the authority;
    // this only decides which buttons are worth showing. Gift cards have nothing
    // to ship, and a paid one is refunded rather than cancelled.
    const actions = [];
    if (!isGiftCard) {
      if (order.status === 'paid') actions.push(['mark_processing', 'Mark processing', 'btn-outline']);
      if (['paid', 'processing'].includes(order.status)) actions.push(['mark_shipped', 'Mark shipped', 'btn-primary']);
      if (order.status === 'shipped') actions.push(['mark_delivered', 'Mark delivered', 'btn-primary']);
    }
    if (
      ['awaiting_verification', 'pending_payment', 'payment_failed', 'paid', 'processing'].includes(order.status) &&
      !(isGiftCard && order.paid_at)
    ) {
      actions.push(['cancel', 'Cancel order', 'btn-outline']);
    }

    // A gift card purchase can only give back what has not been spent.
    const unspent = isGiftCard && giftCard?.status === 'active' ? giftCard.balance_cents : isGiftCard ? 0 : null;
    const refundable =
      unspent === null ? order.total_cents - order.refunded_cents : Math.min(order.total_cents - order.refunded_cents, unspent);
    const canRefund = order.paid_at && refundable > 0 && isManager;
    const canReissue = isGiftCard && giftCard?.status === 'active' && isManager;

    detail.innerHTML = `
      <div class="card p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="font-mono text-lg font-extrabold text-moto-ink">${esc(order.order_number)}</p>
            <p class="mt-1 text-sm text-moto-outline">${esc(order.email)} &bull; ${formatDateTime(order.created_at)}</p>
          </div>
          <div class="flex items-center gap-3">
            ${statusBadge(order.status)}
            <button type="button" data-close class="text-moto-outline hover:text-moto-ink" aria-label="Close">✕</button>
          </div>
        </div>

        ${
          order.notes
            ? `<div class="mt-4 rounded-lg border border-moto-line bg-moto-high p-3 text-sm font-semibold text-moto-accent-soft">${esc(order.notes)}</div>`
            : ''
        }

        <div class="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="text-xs font-bold uppercase tracking-wide text-moto-outline">Items</h3>
            <ul class="mt-3 divide-y divide-slate-200">
              ${items
                .map(
                  (item) => `
                <li class="flex justify-between gap-4 py-2.5 text-sm">
                  <span class="text-moto-muted">${esc(item.title)} <span class="text-moto-outline">× ${item.quantity}</span></span>
                  <span class="shrink-0 font-semibold">${money(item.line_total_cents, order.currency)}</span>
                </li>`,
                )
                .join('')}
            </ul>
            <div class="mt-3 flex justify-between border-t-2 border-moto-accent pt-3 font-extrabold">
              <span>Total</span><span>${money(order.total_cents, order.currency)}</span>
            </div>
            ${order.refunded_cents ? `<p class="mt-1 text-right text-sm font-semibold text-moto-accent-soft">Refunded ${money(order.refunded_cents, order.currency)}</p>` : ''}
            ${
              order.gift_card_cents
                ? `<p class="mt-1 text-right text-sm text-moto-muted">
                     Gift card <span class="font-semibold">…${esc(giftCard?.code_last4 ?? '????')}</span> paid ${money(order.gift_card_cents, order.currency)}
                     &bull; card paid ${money(order.total_cents - order.gift_card_cents, order.currency)}
                   </p>
                   ${order.gift_card_released_at && !order.paid_at ? '<p class="mt-1 text-right text-xs text-moto-outline">Gift card hold released (order never paid)</p>' : ''}
                   ${order.gift_card_refunded_cents ? `<p class="mt-1 text-right text-xs text-moto-accent-soft">${money(order.gift_card_refunded_cents, order.currency)} returned to the gift card</p>` : ''}`
                : ''
            }
          </div>

          <div>
            ${
              isGiftCard
                ? giftCardPanel(order, giftCard)
                : `<h3 class="text-xs font-bold uppercase tracking-wide text-moto-outline">Shipping</h3>
            <address class="mt-3 text-sm not-italic leading-relaxed text-moto-muted">
              ${[order.ship_name, order.ship_line1, order.ship_line2, `${order.ship_postal_code ?? ''} ${order.ship_city ?? ''}`.trim(), order.ship_country]
                .filter(Boolean)
                .map(esc)
                .join('<br>')}
            </address>`
            }

            <h3 class="mt-5 text-xs font-bold uppercase tracking-wide text-moto-outline">Payments</h3>
            <ul class="mt-2 space-y-1 text-sm text-moto-muted">
              ${payments.map((p) => `<li>${esc(p.provider)} — ${esc(p.status)} — ${money(p.amount_cents, p.currency ?? order.currency)}${p.failure_reason ? `<span class="block text-xs text-moto-outline">${esc(p.failure_reason)}</span>` : ''}</li>`).join('') || '<li class="text-moto-outline">None</li>'}
            </ul>

            ${
              giftCardTransactions?.length
                ? `<h3 class="mt-5 text-xs font-bold uppercase tracking-wide text-moto-outline">Gift card ledger <span class="normal-case">…${esc(giftCard?.code_last4 ?? '')}</span></h3>
                   <ul class="mt-2 space-y-1 text-xs text-moto-muted">
                     ${giftCardTransactions
                       .map(
                         (t) => `<li class="flex justify-between gap-3">
                           <span>${esc(t.kind.replaceAll('_', ' '))} <span class="text-moto-outline">${formatDate(t.created_at)}</span>${t.order_id && t.order_id !== order.id ? ` <a href="/admin/orders.html?order=${esc(t.order_id)}" class="text-moto-accent hover:underline">order</a>` : ''}</span>
                           <span class="tabular-nums">${t.amount_cents > 0 ? '+' : ''}${money(t.amount_cents, order.currency)} → ${money(t.balance_after_cents, order.currency)}</span>
                         </li>`,
                       )
                       .join('')}
                   </ul>`
                : ''
            }

            <h3 class="mt-5 text-xs font-bold uppercase tracking-wide text-moto-outline">Emails sent</h3>
            <ul class="mt-2 space-y-1 text-xs text-moto-outline">
              ${
                emails
                  .map(
                    (e) =>
                      `<li class="${e.status === 'failed' ? 'font-semibold text-red-600' : ''}">${esc(e.template)} — ${e.status} — ${formatDate(e.created_at)}</li>`,
                  )
                  .join('') || '<li class="text-moto-outline">None</li>'
              }
            </ul>
          </div>
        </div>

        ${
          ['paid', 'processing'].includes(order.status) && !isGiftCard
            ? `<div class="mt-6 grid gap-3 sm:grid-cols-3">
                 <input type="text" data-tracking placeholder="Tracking number" class="field-input" maxlength="120" />
                 <input type="text" data-carrier placeholder="Carrier (e.g. DHL)" class="field-input" maxlength="80" />
                 <input type="url" data-tracking-url placeholder="Tracking URL (optional)" class="field-input" maxlength="500" />
               </div>`
            : ''
        }

        <div class="mt-6 flex flex-wrap gap-3">
          ${actions.map(([action, label, cls]) => `<button type="button" data-action="${action}" class="${cls}">${label}</button>`).join('')}
          ${['awaiting_verification', 'pending_payment'].includes(order.status) ? '<button type="button" data-reconcile class="btn-outline">Check payment status</button>' : ''}
          ${canReissue ? '<button type="button" data-reissue class="btn-outline">Reissue code</button>' : ''}
          ${canRefund ? `<button type="button" data-refund class="btn border border-red-300 bg-moto-panel text-moto-error hover:bg-moto-high">Refund (up to ${money(refundable, order.currency)})</button>` : ''}
        </div>

        <p data-action-status role="status" aria-live="polite" class="sr-only"></p>
      </div>`;

    const actionStatus = detail.querySelector('[data-action-status]');

    detail.querySelector('[data-close]')?.addEventListener('click', () => detail.classList.add('hidden'));

    detail.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;

        if (action === 'cancel' && !confirm('Cancel this order? If it was paid, the stock goes back on the shelf and you will still need to refund the customer separately.')) {
          return;
        }

        button.disabled = true;

        try {
          await patch(`/api/admin/orders/${id}`, {
            action,
            trackingNumber: detail.querySelector('[data-tracking]')?.value.trim() || undefined,
            carrier: detail.querySelector('[data-carrier]')?.value.trim() || undefined,
            trackingUrl: detail.querySelector('[data-tracking-url]')?.value.trim() || undefined,
          });

          await openOrder(id);
          load();
        } catch (error) {
          setStatus(actionStatus, 'error', error.message);
          button.disabled = false;
        }
      });
    });

    detail.querySelector('[data-reconcile]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Checking…';

      try {
        const result = await post('/api/admin/orders/reconcile', { orderId: id });
        await openOrder(id);
        setStatus(detail.querySelector('[data-action-status]'), 'success', result.message);
        load();
      } catch (error) {
        setStatus(actionStatus, 'error', error.message);
        button.disabled = false;
        button.textContent = 'Check payment status';
      }
    });

    detail.querySelector('[data-reissue]')?.addEventListener('click', async () => {
      const email = prompt(
        `Send a new code to which address? The old code stops working immediately.\n\nKeep it as-is to resend to the same person.`,
        giftCard.recipient_email,
      );
      if (email === null) return;

      const trimmed = email.trim();
      const changed = Boolean(trimmed) && trimmed.toLowerCase() !== giftCard.recipient_email.toLowerCase();

      if (
        changed &&
        !confirm(`Send this gift card (balance ${money(giftCard.balance_cents, order.currency)}) to ${trimmed} instead of ${giftCard.recipient_email}?`)
      ) {
        return;
      }

      try {
        const result = await post(`/api/admin/gift-cards/${giftCard.id}/reissue`, {
          recipientEmail: changed ? trimmed : undefined,
        });
        await openOrder(id);
        setStatus(detail.querySelector('[data-action-status]'), result.emailSent ? 'success' : 'error', result.message);
        load();
      } catch (error) {
        setStatus(actionStatus, 'error', error.message);
      }
    });

    detail.querySelector('[data-refund]')?.addEventListener('click', async () => {
      const input = prompt(
        `Refund how much? Enter an amount in ${order.currency}, or leave blank for the full refundable balance of ${(refundable / 100).toFixed(2)}.`,
      );
      if (input === null) return;

      const reason = prompt('Reason for the refund (shown to the customer):') ?? '';

      const amountCents = input.trim() ? Math.round(Number.parseFloat(input) * 100) : undefined;

      if (amountCents !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) {
        alert('That is not a valid amount.');
        return;
      }

      if (!confirm(`Refund ${money(amountCents ?? refundable, order.currency)} to ${order.email}? This moves real money and cannot be undone.`)) {
        return;
      }

      try {
        await post('/api/admin/refunds/create', { orderId: id, amountCents, reason, restock: true });
        await openOrder(id);
        load();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  await load();

  const focusOrder = params.get('order');
  if (focusOrder) await openOrder(focusOrder);
}

/** The gift card an order bought: who it went to, what is left, its state. Never the code. */
function giftCardPanel(order, card) {
  if (!card) {
    return '<p class="text-sm font-semibold text-moto-error">No gift card record found for this order.</p>';
  }

  const tone = { pending: 'text-moto-outline', active: 'text-moto-accent-soft', disabled: 'text-moto-error' }[card.status];
  const undelivered = card.status === 'active' && order.status === 'paid';

  return `
    <h3 class="text-xs font-bold uppercase tracking-wide text-moto-outline">Gift card</h3>
    <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt class="text-moto-outline">Status</dt>
      <dd class="font-semibold ${tone}">${esc(card.status)}${undelivered ? ' <span class="font-normal text-moto-error">(delivery email not sent: reissue)</span>' : ''}</dd>
      <dt class="text-moto-outline">Balance</dt>
      <dd class="font-display font-semibold tabular-nums text-moto-ink">${money(card.balance_cents, card.currency)} <span class="text-moto-outline">of ${money(card.initial_cents, card.currency)}</span></dd>
      <dt class="text-moto-outline">Code</dt>
      <dd class="font-display text-moto-muted">${card.code_last4 ? `…${esc(card.code_last4)}` : 'Not issued (unpaid)'}</dd>
      <dt class="text-moto-outline">To</dt>
      <dd class="break-all text-moto-muted">${esc(card.recipient_name ? `${card.recipient_name} <${card.recipient_email}>` : card.recipient_email)}</dd>
      <dt class="text-moto-outline">From</dt>
      <dd class="text-moto-muted">${esc(card.sender_name ?? '')}</dd>
    </dl>
    ${card.message ? `<p class="mt-3 whitespace-pre-line border-l-2 border-moto-line-2 pl-3 text-sm italic text-moto-muted">${esc(card.message)}</p>` : ''}`;
}

/* =========================================================================
   PRODUCTS  (admin/products.html)
   ========================================================================= */

async function initProducts() {
  const mount = document.querySelector('[data-admin-products]');
  if (!mount) return;

  if (!(await requireSession())) return;
  mountShell('products');

  const dialog = document.querySelector('[data-product-dialog]');
  const form = document.querySelector('[data-product-form]');
  const status = form.querySelector('[data-product-status]');
  let editingId = null;

  async function load() {
    mount.innerHTML = '<div class="card h-64 animate-pulse bg-moto-high/60"></div>';

    try {
      const { products } = await get('/api/admin/products');

      mount.innerHTML = `
        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-moto-line bg-moto-low text-xs uppercase tracking-wide text-moto-outline">
                <tr>
                  <th scope="col" class="px-4 py-3 font-bold">Part</th>
                  <th scope="col" class="px-4 py-3 font-bold">Brand</th>
                  <th scope="col" class="px-4 py-3 text-right font-bold">Price</th>
                  <th scope="col" class="px-4 py-3 text-right font-bold">Stock</th>
                  <th scope="col" class="px-4 py-3 font-bold">Flags</th>
                  <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${products.map(productRow).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } catch (error) {
      mount.innerHTML = `<div class="card p-8 text-center text-sm font-semibold text-moto-error">${esc(error.message)}</div>`;
    }
  }

  const flag = (on, label) =>
    on ? `<span class="rounded bg-moto-high px-1.5 py-0.5 text-[10px] font-bold uppercase text-moto-accent-soft">${label}</span>` : '';

  const productRow = (product) => `
    <tr class="hover:bg-moto-low ${product.is_active ? '' : 'opacity-50'}">
      <td class="px-4 py-3">
        <span class="line-clamp-1 font-semibold text-moto-ink">${esc(product.title)}</span>
        <span class="text-xs text-moto-outline">${esc(product.slug)}</span>
      </td>
      <td class="px-4 py-3 text-moto-muted">${esc(product.brand)}</td>
      <td class="px-4 py-3 text-right font-bold tabular-nums">
        ${money(product.price_cents)}
        ${product.discount_percent ? `<span class="block text-xs font-semibold text-red-600">−${product.discount_percent}%</span>` : ''}
      </td>
      <td class="px-4 py-3 text-right">
        <span class="font-bold tabular-nums ${product.stock === 0 ? 'text-red-600' : product.stock <= 2 ? 'text-amber-600' : 'text-moto-ink'}">${product.stock}</span>
      </td>
      <td class="px-4 py-3">
        <div class="flex flex-wrap gap-1">
          ${flag(product.is_featured, 'Featured')}
          ${flag(product.is_deal, 'Deal')}
          ${flag(!product.is_active, 'Hidden')}
        </div>
      </td>
      <td class="px-4 py-3 text-right">
        <button type="button" data-edit='${esc(JSON.stringify(product))}' class="link-all">Edit</button>
        <button type="button" data-delete="${product.id}" class="ml-3 text-sm font-semibold text-red-600 hover:text-moto-error">Delete</button>
      </td>
    </tr>`;

  function openDialog(product = null) {
    editingId = product?.id ?? null;
    setStatus(status, 'idle', '');
    showFieldErrors(form, {});
    form.reset();

    document.querySelector('[data-dialog-title]').textContent = product ? 'Edit part' : 'New part';

    if (product) {
      form.elements.title.value = product.title;
      form.elements.slug.value = product.slug;
      form.elements.brand.value = product.brand;
      form.elements.categorySlug.value = product.category?.slug ?? '';
      form.elements.partNumber.value = product.part_number ?? '';
      form.elements.description.value = product.description ?? '';
      form.elements.price.value = (product.price_cents / 100).toFixed(2);
      form.elements.oldPrice.value = product.old_price_cents ? (product.old_price_cents / 100).toFixed(2) : '';
      form.elements.stock.value = product.stock;
      form.elements.imagePath.value = product.image_path ?? '';
      paintPreview(product.image_path);
      form.elements.isActive.checked = product.is_active;
      form.elements.isFeatured.checked = product.is_featured;
      form.elements.isDeal.checked = product.is_deal;
    } else {
      form.elements.isActive.checked = true;
      paintPreview(null);
    }

    dialog.showModal();
  }

  document.querySelector('[data-new-product]')?.addEventListener('click', () => openDialog());
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());

  /* ---- Photo upload ---------------------------------------------------- */

  const preview = dialog.querySelector('[data-image-preview]');
  const uploadStatus = dialog.querySelector('[data-upload-status]');

  const paintPreview = (url) => {
    preview.innerHTML = url
      ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" class="absolute inset-0 h-full w-full object-cover">`
      : '';
  };

  // Typing or pasting a URL updates the preview too.
  form.elements.imagePath.addEventListener('input', () => paintPreview(form.elements.imagePath.value.trim()));

  dialog.querySelector('[data-product-file]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    uploadStatus.textContent = 'Preparing…';
    uploadStatus.className = 'mt-1 text-xs text-moto-outline';

    try {
      const { url, originalBytes, uploadedBytes } = await uploadImage(file, (message) => {
        uploadStatus.textContent = message;
      });

      // The URL lands in the field, so saving the product persists it. The photo
      // is NOT attached until the form is saved — which means an accidental
      // upload can still be abandoned by cancelling the dialog.
      form.elements.imagePath.value = url;
      paintPreview(url);

      uploadStatus.textContent = `Uploaded (${(originalBytes / 1048576).toFixed(1)} MB → ${(uploadedBytes / 1024).toFixed(0)} KB). Save to attach it.`;
      uploadStatus.className = 'mt-1 text-xs font-semibold text-moto-accent-soft';
    } catch (error) {
      uploadStatus.textContent = error.message;
      uploadStatus.className = 'mt-1 text-xs font-semibold text-red-600';
    } finally {
      event.target.value = '';
    }
  });

  // Auto-slug from the title, but only while creating and only if untouched.
  form.elements.title.addEventListener('input', () => {
    if (editingId || form.elements.slug.dataset.touched) return;

    form.elements.slug.value = form.elements.title.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 200);
  });

  form.elements.slug.addEventListener('input', () => {
    form.elements.slug.dataset.touched = '1';
  });

  mount.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      openDialog(JSON.parse(edit.dataset.edit));
      return;
    }

    const remove = event.target.closest('[data-delete]');
    if (remove) {
      if (!confirm('Delete this part? If it appears on a past order it will be hidden instead, so invoices stay intact.')) return;

      try {
        const result = await del(`/api/admin/products/${remove.dataset.delete}`);
        if (result.deactivated) alert(result.message);
        load();
      } catch (error) {
        alert(error.message);
      }
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(status, 'idle', '');
    showFieldErrors(form, {});

    const submit = form.querySelector('[data-submit]');
    submit.disabled = true;

    // Money is entered in whole currency units and converted to cents here —
    // the API never sees a decimal.
    const toCents = (value) => (value.trim() ? Math.round(Number.parseFloat(value) * 100) : null);

    const payload = {
      title: form.elements.title.value.trim(),
      slug: form.elements.slug.value.trim(),
      brand: form.elements.brand.value.trim(),
      categorySlug: form.elements.categorySlug.value.trim(),
      partNumber: form.elements.partNumber.value.trim(),
      description: form.elements.description.value.trim(),
      priceCents: toCents(form.elements.price.value) ?? 0,
      oldPriceCents: toCents(form.elements.oldPrice.value),
      stock: Number.parseInt(form.elements.stock.value, 10) || 0,
      imagePath: form.elements.imagePath.value.trim(),
      isActive: form.elements.isActive.checked,
      isFeatured: form.elements.isFeatured.checked,
      isDeal: form.elements.isDeal.checked,
    };

    try {
      if (editingId) {
        await put(`/api/admin/products/${editingId}`, payload);
      } else {
        await post('/api/admin/products', payload);
      }

      dialog.close();
      load();
    } catch (error) {
      showFieldErrors(form, error.errors ?? {});
      setStatus(status, 'error', error.message);
    } finally {
      submit.disabled = false;
    }
  });

  await load();
}

/* =========================================================================
   REFUNDS  (admin/refunds.html)
   ========================================================================= */

async function initRefunds() {
  const mount = document.querySelector('[data-refunds]');
  if (!mount) return;

  if (!(await requireSession())) return;
  mountShell('refunds');

  const filter = document.querySelector('[data-refund-filter]');

  async function load() {
    mount.innerHTML = '<div class="card h-64 animate-pulse bg-moto-high/60"></div>';

    try {
      const query = new URLSearchParams();
      if (filter?.value && filter.value !== 'all') query.set('status', filter.value);

      const { refunds } = await get(`/api/admin/refunds?${query}`);

      mount.innerHTML = refunds.length
        ? `<div class="space-y-4">${refunds.map(refundCard).join('')}</div>`
        : '<div class="card p-12 text-center text-moto-outline">No refunds match this filter.</div>';
    } catch (error) {
      mount.innerHTML = `<div class="card p-8 text-center text-sm font-semibold text-moto-error">${esc(error.message)}</div>`;
    }
  }

  const TONE = {
    requested: 'bg-moto-high text-moto-accent-soft ring-moto-line-2',
    processing: 'bg-moto-high text-moto-accent-soft ring-blue-200',
    succeeded: 'bg-moto-high text-moto-accent-soft ring-green-200',
    failed: 'bg-moto-high text-moto-error ring-red-500/40',
    rejected: 'bg-moto-bg text-moto-muted ring-moto-line',
    approved: 'bg-moto-high text-moto-accent-soft ring-blue-200',
  };

  const canApprove = () => ['owner', 'manager'].includes(currentAdmin.role);

  const refundCard = (refund) => `
    <article class="card p-6">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="font-mono text-sm font-bold text-moto-ink">${esc(refund.order?.order_number ?? '—')}</p>
          <p class="mt-1 text-sm text-moto-outline">${esc(refund.order?.email ?? '')} &bull; ${formatDateTime(refund.created_at)}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xl font-extrabold text-moto-ink">${money(refund.amount_cents, refund.order?.currency)}</span>
          <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${TONE[refund.status] ?? TONE.rejected}">${esc(refund.status)}</span>
        </div>
      </div>

      ${refund.reason ? `<p class="mt-4 rounded-lg bg-moto-low p-3 text-sm text-moto-muted">${esc(refund.reason)}</p>` : ''}
      ${refund.failure_reason ? `<p class="mt-3 rounded-xl bg-moto-high p-3 text-sm font-semibold text-red-300">${esc(refund.failure_reason)}</p>` : ''}

      ${
        refund.status === 'requested' && canApprove()
          ? `<div class="mt-5 flex gap-3">
               <button type="button" data-approve="${refund.id}" data-order="${refund.order_id}" data-amount="${refund.amount_cents}"
                       class="btn bg-red-600 text-white hover:bg-red-700">Approve &amp; refund</button>
               <button type="button" data-reject="${refund.id}" class="btn-outline">Reject</button>
             </div>
             <p class="mt-3 text-xs text-moto-outline">
               Approving moves real money back to the customer immediately. It cannot be undone.
             </p>`
          : refund.status === 'requested'
            ? '<p class="mt-4 text-xs font-semibold text-moto-outline">Only an owner or manager can approve a refund.</p>'
            : ''
      }

      <a href="/admin/orders.html?order=${refund.order_id}" class="link-all mt-4 inline-block">View order</a>
    </article>`;

  filter?.addEventListener('change', load);

  mount.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-approve]');

    if (approve) {
      const amount = money(Number(approve.dataset.amount));
      if (!confirm(`Refund ${amount} to this customer now? This moves real money and cannot be undone.`)) return;

      approve.disabled = true;

      try {
        await post('/api/admin/refunds/create', {
          orderId: approve.dataset.order,
          amountCents: Number(approve.dataset.amount),
          reason: 'Approved from a customer refund request',
          restock: true,
        });
        load();
      } catch (error) {
        alert(error.message);
        approve.disabled = false;
      }
      return;
    }

    const reject = event.target.closest('[data-reject]');
    if (reject) {
      // The reason is mandatory and is sent to the customer verbatim, so a
      // request is never closed without telling them why.
      const reason = prompt('Why are you declining this? The customer receives this text word for word.');
      if (reason === null) return;

      if (reason.trim().length < 5) {
        alert('Please give the customer a real reason.');
        return;
      }

      reject.disabled = true;

      try {
        await patch(`/api/admin/refunds/${reject.dataset.reject}`, { action: 'reject', reason: reason.trim() });
        load();
      } catch (error) {
        alert(error.message);
        reject.disabled = false;
      }
    }
  });

  await load();
}

/* =========================================================================
   Boot
   ========================================================================= */

/* =========================================================================
   MEDIA  (admin/media.html)
   =========================================================================
   Hero slides, category tiles, and partner logos. One reusable slot component
   drives all three — they differ only in which endpoint persists the URL.
   ========================================================================= */

/**
 * Renders one image slot: a preview (or placeholder), an upload button, and a
 * remove button. `onSave(url | null)` persists it.
 */
function imageSlot({ id, label, hint, url, aspect = 'aspect-[16/9]' }, onSave) {
  return `
    <div class="card p-4" data-slot="${esc(id)}">
      <div class="ph ph-2 ${aspect} overflow-hidden rounded-lg">
        ${
          url
            ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" class="absolute inset-0 h-full w-full object-cover">`
            : `<span class="ph-icon">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" class="h-10 w-10" aria-hidden="true">
                   <rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>
                 </svg>
               </span>`
        }
      </div>

      <p class="mt-3 text-sm font-bold text-moto-ink">${esc(label)}</p>
      ${hint ? `<p class="mt-0.5 text-xs text-moto-outline">${esc(hint)}</p>` : ''}

      <div class="mt-3 flex items-center gap-2">
        <label class="btn-outline flex-1 cursor-pointer justify-center text-xs">
          <input type="file" accept="image/*" class="sr-only" data-file>
          ${url ? 'Replace' : 'Upload'}
        </label>
        ${url ? '<button type="button" data-clear class="btn text-xs text-red-600 hover:bg-moto-high">Remove</button>' : ''}
      </div>

      <p data-slot-status role="status" aria-live="polite" class="mt-2 text-xs text-moto-outline"></p>
    </div>`;
}

/** Wires the file input and remove button inside a rendered slot. */
function bindSlot(root, id, onSave, reload) {
  const slot = root.querySelector(`[data-slot="${CSS.escape(id)}"]`);
  if (!slot) return;

  const status = slot.querySelector('[data-slot-status]');

  slot.querySelector('[data-file]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    status.textContent = 'Preparing…';
    status.className = 'mt-2 text-xs text-moto-outline';

    try {
      const { url, originalBytes, uploadedBytes } = await uploadImage(file, (message) => {
        status.textContent = message;
      });

      await onSave(url);

      status.textContent = `Uploaded (${(originalBytes / 1048576).toFixed(1)} MB → ${(uploadedBytes / 1024).toFixed(0)} KB)`;
      status.className = 'mt-2 text-xs font-semibold text-moto-accent-soft';

      await reload();
    } catch (error) {
      status.textContent = error.message;
      status.className = 'mt-2 text-xs font-semibold text-red-600';
    } finally {
      event.target.value = ''; // let the same file be picked again after a failure
    }
  });

  slot.querySelector('[data-clear]')?.addEventListener('click', async () => {
    if (!confirm('Remove this image? The slot falls back to its gradient placeholder.')) return;

    try {
      await onSave(null);
      await reload();
    } catch (error) {
      status.textContent = error.message;
      status.className = 'mt-2 text-xs font-semibold text-red-600';
    }
  });
}

async function initMedia() {
  const heroMount = document.querySelector('[data-hero-slots]');
  if (!heroMount) return;

  if (!(await requireSession())) return;
  mountShell('media');

  const catMount = document.querySelector('[data-category-slots]');
  const partnerMount = document.querySelector('[data-partner-slots]');
  const warning = document.querySelector('[data-imgbb-warning]');

  const HERO_HINTS = {
    'hero-1': 'Find The Right Part First Time',
    'hero-2': 'Genuine European Parts, Verified Stock',
    'hero-3': 'Fitment Confidence Starts Here (also the About hero)',
    'hero-4': 'Clear Returns, Warranty, and Shipping',
  };

  async function load() {
    const [{ images }, { categories }] = await Promise.all([
      get('/api/admin/site-images'),
      get('/api/admin/categories'),
    ]);

    const heroes = images.filter((i) => i.key.startsWith('hero-'));
    const partners = images.filter((i) => i.key.startsWith('partner-'));

    const saveSite = (key) => (url) => put('/api/admin/site-images', { key, url });
    const saveCat = (slug) => (url) => put('/api/admin/categories', { slug, imagePath: url });

    heroMount.innerHTML = heroes
      .map((h) => imageSlot({ id: h.key, label: h.key, hint: HERO_HINTS[h.key] ?? h.alt, url: h.url }))
      .join('');
    heroes.forEach((h) => bindSlot(heroMount, h.key, saveSite(h.key), load));

    catMount.innerHTML = categories
      .map((c) =>
        imageSlot({
          id: `cat-${c.slug}`,
          label: c.name,
          hint: c.image_path ? 'Shown on the home page' : 'Not on the home page — upload to add it',
          url: c.image_path,
          aspect: 'aspect-[4/3]',
        }),
      )
      .join('');
    categories.forEach((c) => bindSlot(catMount, `cat-${c.slug}`, saveCat(c.slug), load));

    partnerMount.innerHTML = partners
      .map((p) => imageSlot({ id: p.key, label: p.alt ?? p.key, url: p.url, aspect: 'aspect-square' }))
      .join('');
    partners.forEach((p) => bindSlot(partnerMount, p.key, saveSite(p.key), load));
  }

  try {
    await load();
  } catch (error) {
    heroMount.innerHTML = `<div class="card p-6 text-sm font-semibold text-moto-error">${esc(error.message)}</div>`;
    return;
  }

  // Probe whether uploading is actually configured, rather than letting the
  // first upload fail with a confusing error.
  try {
    await post('/api/admin/upload', { image: '', filename: 'probe' });
  } catch (error) {
    if (/not configured/i.test(error.message)) {
      warning.textContent =
        'IMGBB_API_KEY is not set, so uploads are disabled. Add it to your environment and redeploy.';
      warning.classList.remove('hidden');
    }
    // Any other error (e.g. "No image data received") means it IS configured.
  }
}

function boot() {
  initLogin();
  initDashboard();
  initOrders();
  initProducts();
  initRefunds();
  initMedia();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
