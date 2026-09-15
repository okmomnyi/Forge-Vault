import { get, post } from './lib/api.js';
import { loadSession, redirectToSignIn } from './lib/auth.js';
import { esc, money } from './lib/format.js';
import { setStatus, showFieldErrors } from './lib/ui.js';

/* =========================================================================
   GIFT CARDS  (gift-cards.html)
   =========================================================================
   Buying needs a session (the receipt goes to a verified inbox). Checking a
   balance does not: whoever received a card may never have shopped here.

   Every limit shown on this page comes from GET /api/gift-cards/purchase, the
   same constants the POST validates against, so the form cannot offer an
   amount the server will refuse.
   ========================================================================= */

const dollars = (cents) => `$${Math.round(cents / 100)}`;

/** Mirrors toChargeAmount on the server: convert, then round to a whole unit. */
const chargeFor = (cents, charge) => Math.round((cents * charge.rate) / 100) * 100;

export async function initGiftCardsPage() {
  const form = document.querySelector('[data-gift-form]');
  if (!form) return;

  initBalanceCheck();

  const gate = document.querySelector('[data-gift-gate]');
  const loading = document.querySelector('[data-gift-loading]');
  const status = form.querySelector('[data-gift-status]');
  const submit = form.querySelector('[data-submit]');

  const [customer, options] = await Promise.all([
    loadSession(),
    get('/api/gift-cards/purchase').catch((error) => ({ error })),
  ]);

  loading.remove();

  if (!customer) {
    const next = encodeURIComponent('/gift-cards.html');
    gate.querySelector('[data-signin]').href = `/account.html?next=${next}`;
    gate.querySelector('[data-register]').href = `/account.html?mode=register&next=${next}`;
    gate.classList.remove('hidden');
    return;
  }

  if (options.error) {
    gate.outerHTML = `
      <div class="card p-8 text-center">
        <p class="h-display text-lg">Gift cards are unavailable right now</p>
        <p class="mt-2 text-sm text-moto-muted">${esc(options.error.message)}</p>
      </div>`;
    return;
  }

  form.classList.remove('hidden');

  /* ---- Amount ---- */
  const amounts = form.querySelector('[data-amounts]');
  const customWrap = form.querySelector('[data-custom-amount]');
  const customInput = form.elements.customAmount;

  const tile = (value, label, checked) => `
    <label class="flex cursor-pointer items-center justify-center rounded-xl border border-moto-line-2 bg-moto-panel px-3 py-3 font-display text-base font-bold text-moto-ink transition hover:bg-moto-high has-[:checked]:border-moto-accent has-[:checked]:bg-moto-high has-[:checked]:text-moto-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-moto-accent">
      <input type="radio" name="amount" value="${value}" class="sr-only" ${checked ? 'checked' : ''} />
      ${label}
    </label>`;

  const defaultPreset = options.presetsCents.includes(5000) ? 5000 : options.presetsCents[0];

  amounts.innerHTML =
    options.presetsCents.map((cents) => tile(cents, dollars(cents), cents === defaultPreset)).join('') +
    tile('custom', 'Other', false);

  customInput.min = String(options.minCents / 100);
  customInput.max = String(options.maxCents / 100);
  customInput.placeholder = `${options.minCents / 100} to ${options.maxCents / 100}`;
  form.querySelector('[data-amount-hint]').textContent =
    `Whole dollars, ${dollars(options.minCents)} to ${dollars(options.maxCents)}.`;

  /** The chosen amount in cents, or null when "Other" is empty or not a number. */
  const selectedCents = () => {
    const choice = form.elements.amount.value;
    if (choice !== 'custom') return Number(choice);

    const raw = customInput.value.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  };

  /* ---- Names, message ---- */
  form.elements.senderName.value = customer.name ?? '';

  form.querySelector('[data-send-to-me]').addEventListener('click', () => {
    form.elements.recipientEmail.value = customer.email;
    if (!form.elements.recipientName.value) form.elements.recipientName.value = customer.name ?? '';
    paint();
    form.elements.recipientEmail.focus();
  });

  const counter = form.querySelector('[data-message-count]');
  form.elements.message.maxLength = options.messageMax;

  /* ---- Payment methods ---- */
  const methods = form.querySelector('[data-payment-methods]');
  methods.innerHTML = options.paymentMethods.length
    ? options.paymentMethods
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

  if (!options.paymentMethods.length) submit.disabled = true;

  const chargeNote = form.querySelector('[data-charge-note]');

  /* ---- Live preview + button label ---- */
  const preview = {
    amount: document.querySelector('[data-preview-amount]'),
    to: document.querySelector('[data-preview-to]'),
    from: document.querySelector('[data-preview-from]'),
  };

  function paint() {
    const cents = selectedCents();
    const isCustom = form.elements.amount.value === 'custom';
    const valid = cents !== null && cents >= options.minCents && cents <= options.maxCents && cents % 100 === 0;

    customWrap.classList.toggle('hidden', !isCustom);

    preview.amount.textContent = valid ? dollars(cents) : '$--';
    preview.to.textContent =
      form.elements.recipientName.value.trim() || form.elements.recipientEmail.value.trim() || 'Someone with a project car';
    preview.from.textContent = form.elements.senderName.value.trim() || 'You';

    counter.textContent = `${form.elements.message.value.length} / ${options.messageMax}`;

    submit.textContent = valid ? `Pay ${money(cents, options.currency)} for gift card` : 'Pay for gift card';

    if (options.charge && valid) {
      chargeNote.innerHTML = `Billed in ${esc(options.charge.currency)}. You will be charged
        <span class="font-semibold text-moto-ink">${money(chargeFor(cents, options.charge), options.charge.currency)}</span>
        on the secure payment page. The card itself is worth ${money(cents, options.currency)}.`;
      chargeNote.classList.remove('hidden');
    } else {
      chargeNote.classList.add('hidden');
    }
  }

  form.addEventListener('input', paint);
  form.addEventListener('change', (event) => {
    if (event.target.name === 'amount' && event.target.value === 'custom') customInput.focus();
    paint();
  });
  paint();

  /* ---- Submit ---- */
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(status, 'idle', '');

    const cents = selectedCents();
    const clientErrors = {};

    if (cents === null) {
      clientErrors.amountCents = 'Enter an amount.';
    } else if (cents % 100 !== 0) {
      clientErrors.amountCents = 'Choose a whole-dollar amount.';
    } else if (cents < options.minCents || cents > options.maxCents) {
      clientErrors.amountCents = `Choose between ${dollars(options.minCents)} and ${dollars(options.maxCents)}.`;
    }

    if (!form.elements.recipientEmail.value.trim()) {
      clientErrors.recipientEmail = 'Enter the email address the code should go to.';
    } else if (!form.elements.recipientEmail.checkValidity()) {
      clientErrors.recipientEmail = 'That email address does not look right.';
    }

    showFieldErrors(form, clientErrors);
    if (Object.keys(clientErrors).length) {
      const first = clientErrors.amountCents
        ? form.elements.amount.value === 'custom'
          ? customInput
          : form.querySelector('input[name="amount"]:checked')
        : form.elements.recipientEmail;
      first?.focus();
      return;
    }

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Starting payment…';

    try {
      const result = await post('/api/gift-cards/purchase', {
        amountCents: cents,
        recipientEmail: form.elements.recipientEmail.value.trim(),
        recipientName: form.elements.recipientName.value.trim(),
        senderName: form.elements.senderName.value.trim(),
        message: form.elements.message.value.trim(),
        paymentMethod: form.elements.paymentMethod?.value,
      });

      setStatus(status, 'info', 'Taking you to the secure payment page…');
      location.href = result.redirectUrl;
    } catch (error) {
      if (error.status === 401) {
        redirectToSignIn('/gift-cards.html');
        return;
      }

      showFieldErrors(form, error.errors ?? {});
      setStatus(status, 'error', error.message);
      submit.disabled = false;
      submit.textContent = label;
    }
  });
}

/* -------------------------------------------------------------------------
   Balance check
   ---------------------------------------------------------------------- */

function initBalanceCheck() {
  const form = document.querySelector('[data-balance-form]');
  if (!form) return;

  const result = document.querySelector('[data-balance-result]');
  const button = form.querySelector('[data-balance-submit]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldErrors(form, {});
    result.classList.add('hidden');

    const code = form.elements.code.value.trim();
    if (!code) {
      showFieldErrors(form, { code: 'Enter the code from your gift card email.' });
      form.elements.code.focus();
      return;
    }

    button.disabled = true;
    button.textContent = 'Checking…';

    try {
      const { giftCard } = await post('/api/gift-cards/balance', { code });
      const active = giftCard.status === 'active';

      result.innerHTML = active
        ? `<div class="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl border border-moto-line bg-moto-high p-4">
             <p class="text-xs font-semibold uppercase tracking-widest text-moto-outline">Card ending ${esc(giftCard.last4)}</p>
             <p class="font-display text-2xl font-bold tabular-nums text-moto-ink">${money(giftCard.balanceCents, giftCard.currency)}</p>
           </div>
           <p class="mt-3 text-sm text-moto-muted">
             ${giftCard.balanceCents > 0 ? 'Enter the code at checkout to spend it.' : 'This card has been fully spent.'}
             ${giftCard.balanceCents > 0 ? '<a href="/products.html" class="link-all ml-2">Find a part</a>' : ''}
           </p>`
        : `<p class="rounded-2xl border border-moto-line bg-moto-high p-4 text-sm text-moto-muted">
             The card ending ${esc(giftCard.last4)} is no longer active: it was refunded to the person who bought it.
           </p>`;
      result.classList.remove('hidden');
    } catch (error) {
      showFieldErrors(form, error.errors ?? { code: error.message });
      form.elements.code.focus();
    } finally {
      button.disabled = false;
      button.textContent = 'Check balance';
    }
  });
}
