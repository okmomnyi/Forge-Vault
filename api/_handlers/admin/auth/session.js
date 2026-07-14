import { audit, clearSessionCookie, requireAdmin, revokeSession } from '../../../_lib/auth.js';
import { handler, ok } from '../../../_lib/http.js';

/**
 * GET    /api/admin/auth/session  — who am I? (also re-issues the CSRF token)
 * DELETE /api/admin/auth/session  — sign out
 */

async function current(req, res) {
  const { admin, session } = await requireAdmin(req);

  return ok(res, {
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
    csrfToken: session.csrf_token,
    expiresAt: session.expires_at,
  });
}

async function signOut(req, res) {
  // Revoke server-side as well as clearing the cookie. Clearing the cookie
  // alone would leave a valid session behind for anyone holding a copy of it.
  const { admin, token } = await requireAdmin(req);

  await revokeSession(token);
  await audit(req, admin, 'admin.logout', { entity: 'admin_user', entityId: admin.id });

  clearSessionCookie(res);

  return ok(res, { signedOut: true });
}

export default handler({ GET: current, DELETE: signOut });
