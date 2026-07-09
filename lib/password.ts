import bcrypt from 'bcryptjs';

/**
 * Password hashing — kept separate from lib/auth.ts so that the Edge middleware
 * (which imports session/JWT helpers from auth.ts) never bundles bcryptjs. Only
 * the Node-runtime login route and the create-admin script touch this.
 */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
