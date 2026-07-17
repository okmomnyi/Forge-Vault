/**
 * Header and footer markup, shared by every page.
 *
 * These are injected at runtime rather than duplicated across nine HTML files.
 * The chrome is identical everywhere, so one copy means the cart badge, the nav
 * and the footer links cannot drift apart between pages.
 */

const LOGO_GEAR = `
  <svg viewBox="0 0 100 100" class="h-5 w-5" aria-hidden="true" focusable="false">
    <g fill="currentColor">
      <rect x="44" y="2" width="12" height="20" rx="2" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(45 50 50)" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(90 50 50)" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(135 50 50)" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(180 50 50)" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(225 50 50)" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(270 50 50)" />
      <rect x="44" y="2" width="12" height="20" rx="2" transform="rotate(315 50 50)" />
      <circle cx="50" cy="50" r="32" />
    </g>
    <circle cx="50" cy="50" r="12" fill="#ff5f00" />
  </svg>`;

/**
 * The Forge Vault wordmark — condensed Archivo Narrow, uppercase, an orange
 * machined square holding the gear. `mark` = mark colour, `text` = wordmark ink.
 */
const wordmark = ({ text = 'text-forge-ink', size = 'text-lg' } = {}) => `
  <span class="grid h-9 w-9 shrink-0 place-items-center bg-forge-orange text-black">${LOGO_GEAR}</span>
  <span class="font-display ${size} font-bold uppercase leading-none tracking-tight ${text}">
    <span class="text-forge-orange">FORGE</span> VAULT
  </span>`;

const navLink = (href, label, current) =>
  `<a href="${href}" class="nav-link${current ? ' text-forge-orange' : ''}"${current ? ' aria-current="page"' : ''}>${label}</a>`;

const mobileLink = (href, label, current) =>
  `<a href="${href}" class="rounded-none px-2 py-3 text-sm font-semibold ${current ? 'text-forge-orange' : 'text-forge-muted'} hover:bg-forge-low"${current ? ' aria-current="page"' : ''}>${label}</a>`;

const languageSelect = (id) => `
  <label for="${id}" class="text-xs font-semibold uppercase tracking-wide text-forge-outline">Language</label>
  <select id="${id}" name="${id}"
          class="rounded-none border border-forge-line bg-forge-panel py-1.5 pl-2 pr-7 text-sm font-medium text-forge-muted focus:border-forge-orange focus:outline-none focus:ring-2 focus:ring-forge-orange">
    <option>English</option>
    <option>Swahili</option>
    <option>Nederlands</option>
    <option>Deutsch</option>
  </select>`;

export function header(page = '') {
  return `
  <div class="container-page">
    <div class="flex h-16 items-center justify-between gap-4 lg:h-[4.5rem]">
      <a href="/index.html" class="flex shrink-0 items-center gap-2.5" aria-label="Forge Vault — home">
        ${wordmark()}
      </a>

      <nav class="hidden md:flex md:items-center md:gap-8" aria-label="Primary">
        ${navLink('/products.html', 'Products', page === 'products')}
        ${navLink('/about.html', 'About', page === 'about')}
        ${navLink('/contact.html', 'Contact', page === 'contact')}
      </nav>

      <div class="flex items-center gap-3 sm:gap-4">
        <div class="hidden items-center gap-2 lg:flex">${languageSelect('language')}</div>

        <!-- Account. Starts as a sign-in link; paintAccountState swaps it for the
             signed-in menu once the session has been resolved. -->
        <div data-account class="hidden sm:block">
          <a href="/account.html" data-account-signin
             class="flex items-center gap-1.5 rounded-none px-2 py-1.5 text-sm font-semibold text-forge-muted transition hover:text-forge-orange">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>
            </svg>
            <span>Sign in</span>
          </a>

          <div data-account-menu class="hidden items-center gap-3">
            <a href="/account.html"
               class="flex items-center gap-1.5 px-2 py-1.5 font-display text-sm font-semibold uppercase tracking-wide text-forge-muted transition hover:text-forge-orange">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>
              </svg>
              <span data-account-name>Profile</span>
            </a>
            <button type="button" data-signout class="font-mono text-[11px] uppercase tracking-widest text-forge-outline transition hover:text-forge-error">
              Sign out
            </button>
          </div>
        </div>

        <a href="/cart.html"
           class="relative flex items-center gap-1.5 rounded-none px-2 py-1.5 text-sm font-semibold text-forge-muted transition hover:text-forge-orange">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5" aria-hidden="true">
            <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" />
            <path d="M2 3h2.5l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.9a1.5 1.5 0 0 0 1.5-1.2L21 7H5.4" />
          </svg>
          <span>Cart</span>
          <span data-cart-count
                class="hidden absolute -right-1 -top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-forge-orange px-1 text-[11px] font-bold text-white">0</span>
        </a>

        <button type="button" data-menu-toggle aria-expanded="false" aria-controls="mobile-nav"
                aria-label="Toggle navigation menu"
                class="grid h-10 w-10 place-items-center rounded-none text-forge-muted transition hover:bg-forge-high md:hidden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" class="h-6 w-6" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <div id="mobile-nav" data-menu-panel class="hidden border-t border-forge-line bg-forge-panel md:hidden">
    <nav class="container-page flex flex-col py-3" aria-label="Mobile">
      ${mobileLink('/products.html', 'Products', page === 'products')}
      ${mobileLink('/about.html', 'About', page === 'about')}
      ${mobileLink('/contact.html', 'Contact', page === 'contact')}

      <div class="mt-2 border-t border-forge-line pt-2" data-account-mobile>
        ${mobileLink('/account.html', 'Sign in', false)}
      </div>

      <div class="mt-2 flex items-center gap-2 border-t border-forge-line px-2 pt-4">
        ${languageSelect('language-mobile')}
      </div>
    </nav>
  </div>`;
}

const footerColumn = (title, links) => `
  <nav aria-label="${title}">
    <h2 class="text-sm font-bold uppercase tracking-wide text-white">${title}</h2>
    <ul class="mt-4 space-y-3">
      ${links.map(([href, label]) => `<li><a href="${href}" class="footer-link">${label}</a></li>`).join('')}
    </ul>
  </nav>`;

export function footer() {
  return `
  <div class="container-page py-14 sm:py-16">
    <div class="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
      <div class="lg:pr-8">
        <span class="inline-flex items-center gap-2.5">${wordmark({ text: 'text-white' })}</span>
        <p class="mt-5 text-sm leading-relaxed text-forge-outline">
          Your ultimate destination for premium automotive and motor parts. Fast shipping, authentic products, and
          expert support for all your vehicle needs.
        </p>
      </div>

      ${footerColumn('Browse', [
        ['/products.html', 'All Products'],
        ['#', 'HTML Sitemap'],
      ])}

      ${footerColumn('Support', [
        ['#', 'Help Center'],
        ['#', 'FAQ'],
        ['/contact.html', 'Contact Us'],
        ['#', 'Shipping Info'],
        ['#', 'Returns'],
      ])}

      ${footerColumn('Legal', [
        ['#', 'Privacy Policy'],
        ['#', 'Terms of Service'],
        ['#', 'Cookie Policy'],
        ['#', 'Accessibility'],
      ])}
    </div>

    <div class="mt-12 flex flex-col items-center gap-4 border-t border-forge-line pt-8">
      <p class="text-sm text-forge-outline">&copy; 2026 ForgeVault. All rights reserved.</p>

      <ul class="flex items-center gap-6">
        <li><a href="#" class="footer-link">Twitter</a></li>
        <li><a href="#" class="footer-link">Facebook</a></li>
        <li><a href="#" class="footer-link">Instagram</a></li>
      </ul>

      <!-- Staff sign-in. Deliberately understated — it is for the shop's own
           people, not customers. Safe to expose: /admin is noindex'd and the
           panel needs a password AND an emailed 2FA code, with lockout after
           repeated failures. Hiding the link was never the control.
           rel=nofollow keeps it out of crawlers' link graphs. -->
      <a href="/admin/login.html" rel="nofollow"
         class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-forge-muted transition hover:text-forge-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5" aria-hidden="true">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Staff sign-in
      </a>
    </div>
  </div>`;
}

/** Fills the <header data-header> and <footer data-footer> shells on the page. */
export function mountChrome() {
  const head = document.querySelector('[data-header]');
  if (head) head.innerHTML = header(head.dataset.header);

  const foot = document.querySelector('[data-footer]');
  if (foot) foot.innerHTML = footer();
}
