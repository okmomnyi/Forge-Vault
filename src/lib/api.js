/**
 * Thin fetch wrapper.
 *
 * Every endpoint answers { ok: true, ... } or { ok: false, error, errors? }, so
 * error handling is uniform: a failed call throws an ApiError carrying the
 * server's message and, for form submissions, its per-field errors.
 */

export class ApiError extends Error {
  constructor(message, { status, errors, ...rest } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors ?? null;
    Object.assign(this, rest);
  }
}

/**
 * The admin CSRF token. Held in memory only — never in localStorage, where any
 * injected script could read it, and never in a cookie, where the browser would
 * attach it automatically and defeat the point.
 */
let csrfToken = null;

export const setCsrfToken = (token) => {
  csrfToken = token;
};

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // Attach the CSRF token on state-changing admin calls.
  if (csrfToken && method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = csrfToken;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server. Check your connection and try again.', { status: 0 });
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body means something upstream broke (a proxy error page, say).
    throw new ApiError('The server returned an unexpected response.', { status: response.status });
  }

  if (!response.ok || payload.ok === false) {
    throw new ApiError(payload.error ?? 'Something went wrong.', {
      status: response.status,
      errors: payload.errors,
      problems: payload.problems,
      retryAfter: payload.retryAfter,
      refundableCents: payload.refundableCents,
    });
  }

  return payload;
}

export const get = (path, options) => api(path, { ...options, method: 'GET' });
export const post = (path, body, options) => api(path, { ...options, method: 'POST', body });
export const put = (path, body, options) => api(path, { ...options, method: 'PUT', body });
export const patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const del = (path, options) => api(path, { ...options, method: 'DELETE' });
