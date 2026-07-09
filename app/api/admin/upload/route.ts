import { NextResponse } from 'next/server';
import { uploadToImgbb } from '@/lib/imgbb';
import { requireAdmin, UnauthorizedError } from '@/lib/session';

/**
 * Uploads a part image to imgbb. The admin browser resizes the image and sends
 * it as base64 JSON ({ image, name }); we forward it to imgbb server-side (so
 * the API key stays secret) and return the direct URL + imgbb delete-page URL.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw err;
  }

  let image: unknown;
  let name: unknown;
  try {
    const body = await request.json();
    image = body.image;
    name = body.name;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof image !== 'string' || image.length === 0) {
    return NextResponse.json({ error: 'No image provided.' }, { status: 400 });
  }

  try {
    const result = await uploadToImgbb(image, typeof name === 'string' ? name : undefined);
    return NextResponse.json({ url: result.url, delete_url: result.deleteUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
