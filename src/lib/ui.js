/** Shared chrome: header, mobile nav, sliders, smooth scroll, cart badge. */

/* -------------------------------------------------------------------------
   Header
   ---------------------------------------------------------------------- */

export function initHeader() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const panel = document.querySelector('[data-menu-panel]');
  if (!toggle || !panel) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('hidden', !open);
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));

  panel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // Desktop breakpoint takes over; never leave the panel stranded open.
  window.matchMedia('(min-width: 768px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

/** Shows the number of items in the cart next to the header cart icon. */
export function updateCartBadge(count) {
  document.querySelectorAll('[data-cart-count]').forEach((badge) => {
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  });
}

/**
 * Swaps the header's "Sign in" link for the signed-in menu.
 *
 * The header renders signed-out first and is corrected once the session
 * resolves, rather than blocking the whole page on a network call. The brief
 * flicker is worth it; a header that waits is a page that feels broken.
 */
export async function paintAccountState(loadSession) {
  const root = document.querySelector('[data-account]');
  if (!root) return;

  const signinLink = root.querySelector('[data-account-signin]');
  const menu = root.querySelector('[data-account-menu]');
  const mobile = document.querySelector('[data-account-mobile]');

  const customer = await loadSession();

  if (!customer) return; // already showing the signed-out state

  signinLink.classList.add('hidden');
  menu.classList.remove('hidden');
  menu.classList.add('flex');

  // Labelled "Profile" (not "Sign in", and not just a bare name) so a signed-in
  // visitor sees a clear account tab. First name in the title for a light touch.
  const nameEl = root.querySelector('[data-account-name]');
  if (nameEl) {
    nameEl.textContent = 'Profile';
    nameEl.closest('a')?.setAttribute('title', `Signed in as ${customer.name ?? customer.email}`);
  }

  if (mobile) {
    mobile.innerHTML = `
      <a href="/account.html" class="block rounded-none px-2 py-3 text-sm font-semibold text-forge-muted hover:bg-forge-low">
        Profile
      </a>
      <a href="/orders.html" class="block rounded-none px-2 py-3 text-sm font-semibold text-forge-muted hover:bg-forge-low">
        Your orders
      </a>
      <button type="button" data-signout
              class="block w-full rounded-none px-2 py-3 text-left text-sm font-semibold text-forge-outline hover:bg-forge-low">
        Sign out
      </button>`;
  }

  // Delegated: covers both the desktop and mobile buttons.
  document.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-signout]')) return;

    const { signOut } = await import('./auth.js');
    await signOut();
    location.href = '/index.html';
  });
}

/* -------------------------------------------------------------------------
   Slider — the home hero (4 slides, autoplay) and the promo banners
   ---------------------------------------------------------------------- */

function initSlider(root) {
  const slides = [...root.querySelectorAll('[data-slide]')];
  if (slides.length === 0) return;

  const dots = [...root.querySelectorAll('[data-dot]')];
  const counter = root.querySelector('[data-counter]');
  const interval = Number(root.dataset.autoplay ?? 0);

  let current = 0;
  let timer = null;

  const paint = () => {
    slides.forEach((slide, i) => {
      const active = i === current;
      slide.dataset.active = String(active);
      slide.setAttribute('aria-hidden', String(!active));

      // Keep focusable children of hidden slides out of the tab order.
      slide.querySelectorAll('a, button').forEach((el) => {
        el.tabIndex = active ? 0 : -1;
      });
    });

    dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
    if (counter) counter.textContent = `${current + 1} / ${slides.length}`;
  };

  const goTo = (index) => {
    current = (index + slides.length) % slides.length;
    paint();
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const start = () => {
    if (!interval || slides.length < 2) return;
    stop();
    timer = setInterval(() => goTo(current + 1), interval);
  };

  // Any deliberate interaction pauses autoplay for good.
  const interact = (fn) => (event) => {
    event?.preventDefault?.();
    stop();
    fn();
  };

  root.querySelector('[data-prev]')?.addEventListener('click', interact(() => goTo(current - 1)));
  root.querySelector('[data-next]')?.addEventListener('click', interact(() => goTo(current + 1)));
  dots.forEach((dot, i) => dot.addEventListener('click', interact(() => goTo(i))));

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') interact(() => goTo(current - 1))(event);
    if (event.key === 'ArrowRight') interact(() => goTo(current + 1))(event);
  });

  root.addEventListener('mouseenter', stop);
  root.addEventListener('focusin', stop);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });

  paint();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) start();
}

export const initSliders = () => document.querySelectorAll('[data-slider]').forEach(initSlider);

/* -------------------------------------------------------------------------
   Smooth scroll for same-page anchors
   ---------------------------------------------------------------------- */

export function initSmoothScroll() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute('href');
    if (!id || id === '#') return;

    const target = document.querySelector(id);
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ block: 'start' });

    // Keep the keyboard where the eye went.
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    history.replaceState(null, '', id);
  });
}

/* -------------------------------------------------------------------------
   Form helpers
   ---------------------------------------------------------------------- */

/** Paints a { field: message } error map onto a form. */
export function showFieldErrors(form, errors = {}) {
  form.querySelectorAll('[data-error-for]').forEach((slot) => {
    const name = slot.dataset.errorFor;
    const message = errors[name];
    const field = form.elements[name];

    slot.textContent = message ?? '';
    slot.dataset.visible = String(Boolean(message));
    field?.setAttribute('aria-invalid', String(Boolean(message)));
  });
}

/** A status banner that also announces to screen readers. */
export function setStatus(el, tone, message) {
  if (!el) return;

  el.textContent = message ?? '';

  const classes = {
    success: 'mt-4 rounded-none border border-forge-line bg-forge-high px-4 py-3 text-sm font-medium text-forge-salmon',
    error: 'mt-4 rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800',
    info: 'mt-4 rounded-none border border-forge-line bg-forge-high px-4 py-3 text-sm font-medium text-forge-salmon',
    idle: 'sr-only',
  };

  el.className = classes[tone] ?? classes.idle;
}
