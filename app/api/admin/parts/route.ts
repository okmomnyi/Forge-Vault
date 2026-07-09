import { NextResponse } from 'next/server';
import { createPart, listPartsForAdmin } from '@/lib/parts';
import { parsePartInput } from '@/lib/validation';
import { requireAdmin, UnauthorizedError } from '@/lib/session';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    throw err;
  }
  const parts = await listPartsForAdmin();
  return NextResponse.json({ parts });
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = parsePartInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const part = await createPart(parsed.input);
  return NextResponse.json({ part }, { status: 201 });
}
