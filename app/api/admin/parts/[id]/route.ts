import { NextResponse } from 'next/server';
import { deletePart, setStockStatus, updatePart } from '@/lib/parts';
import { parsePartInput } from '@/lib/validation';
import { requireAdmin, UnauthorizedError } from '@/lib/session';
import { STOCK_STATUSES, type StockStatus } from '@/lib/types';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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

  // Quick stock-status toggle: a partial PATCH carrying only stock_status.
  const partial = body as Record<string, unknown>;
  const keys = Object.keys(partial);
  if (keys.length === 1 && keys[0] === 'stock_status') {
    const status = String(partial.stock_status);
    if (!STOCK_STATUSES.includes(status as StockStatus)) {
      return NextResponse.json({ error: 'Invalid stock status.' }, { status: 400 });
    }
    const ok = await setStockStatus(params.id, status as StockStatus);
    if (!ok) return NextResponse.json({ error: 'Part not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, stock_status: status });
  }

  // Full update from the edit form.
  const parsed = parsePartInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const updated = await updatePart(params.id, parsed.input);
  if (!updated) return NextResponse.json({ error: 'Part not found.' }, { status: 404 });
  return NextResponse.json({ part: updated });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    throw err;
  }
  const { deleted, deleteUrls } = await deletePart(params.id);
  if (!deleted) return NextResponse.json({ error: 'Part not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, deleteUrls });
}
