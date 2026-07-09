import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
}

export async function POST(request: Request) {
  let email: unknown;
  let password: unknown;
  try {
    const body = await request.json();
    email = body.email;
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
  }

  const rows = await query<AdminRow>(
    'SELECT id, email, password_hash FROM admins WHERE email = $1 LIMIT 1',
    [email.trim().toLowerCase()],
  );
  const admin = rows[0];

  // Generic message either way — don't reveal whether the email exists.
  const invalid = NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
  if (!admin) return invalid;

  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) return invalid;

  const token = await createSessionToken({ adminId: String(admin.id), email: admin.email });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
