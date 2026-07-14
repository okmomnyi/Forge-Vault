import {
  clearSessionCookie,
  getCustomer,
  publicCustomer,
  requireCustomer,
  revokeSession,
} from '../../_lib/customer-auth.js';
import { handler, ok } from '../../_lib/http.js';

/**
 * GET    /api/auth/session  — who am I? (also hands back the CSRF token)
 * DELETE /api/auth/session  — sign out
 *
 * GET answers 200 with `customer: null` when signed out rather than 401: the
 * header calls it on every page load, and a 401 there would be noise, not an
 * error. Endpoints that actually need an identity use requireCustomer.
 */

async function current(req, res) {
  const result = await getCustomer(req);

  if (!result) return ok(res, { customer: null });

  return ok(res, {
    customer: publicCustomer(result.customer),
    csrfToken: result.session.csrf_token,
    expiresAt: result.session.expires_at,
  });
}

async function signOut(req, res) {
  const { token } = await requireCustomer(req);

  // Revoke server-side as well as clearing the cookie — clearing the cookie
  // alone leaves a valid session behind for anyone holding a copy of it.
  await revokeSession(token);
  clearSessionCookie(res);

  return ok(res, { signedOut: true });
}

export default handler({ GET: current, DELETE: signOut });
