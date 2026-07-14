import { del, get, setCsrfToken } from './api.js';

/**
 * Customer session, client side.
 *
 * The session itself lives in an HttpOnly cookie the JavaScript cannot read —
 * which is the point: an XSS bug cannot steal it. What we keep here is only the
 * *display* state (are we signed in, what is the name) plus the CSRF token,
 * held in memory and never in localStorage where injected script could read it.
 */

let current = null;
let loaded = null;

/** Fetches the session once per page load; subsequent calls reuse it. */
export function loadSession({ force = false } = {}) {
  if (!force && loaded) return loaded;

  loaded = get('/api/auth/session')
    .then(({ customer, csrfToken }) => {
      current = customer;
      if (csrfToken) setCsrfToken(csrfToken);
      return customer;
    })
    .catch(() => {
      current = null;
      return null;
    });

  return loaded;
}

export const currentCustomer = () => current;

export const isSignedIn = () => Boolean(current);

/** Called by login/verify, which return the session in their response body. */
export function adoptSession(customer, csrfToken) {
  current = customer;
  loaded = Promise.resolve(customer);
  if (csrfToken) setCsrfToken(csrfToken);
}

export async function signOut() {
  try {
    await del('/api/auth/session');
  } finally {
    current = null;
    loaded = null;
    setCsrfToken(null);
  }
}

/**
 * Sends the visitor to sign in, remembering where they were headed.
 * `next` is echoed back after login — only same-origin paths are honoured, so
 * this cannot be turned into an open redirect.
 */
export function redirectToSignIn(next = location.pathname + location.search) {
  location.href = `/account.html?next=${encodeURIComponent(next)}`;
}
