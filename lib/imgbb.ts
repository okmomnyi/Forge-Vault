/**
 * imgbb image hosting (build spec §8, revised).
 *
 * Uploads go through the server (lib is called only from the auth-guarded
 * /api/admin/upload route) so the API key never reaches the browser. imgbb has
 * no delete API — the upload response includes a `delete_url` web page instead,
 * which we persist so the admin can remove images manually.
 */

export interface ImgbbUploaded {
  url: string; // direct image URL (i.ibb.co/…)
  deleteUrl: string; // imgbb delete-page URL (ibb.co/…/…)
  id: string;
}

interface ImgbbResponse {
  data?: { id: string; url: string; display_url: string; delete_url: string };
  success?: boolean;
  error?: { message?: string };
}

/**
 * Uploads a base64-encoded image (no `data:` prefix) to imgbb.
 * Throws if the key is missing or imgbb rejects the upload.
 */
export async function uploadToImgbb(base64: string, name?: string): Promise<ImgbbUploaded> {
  const key = process.env.IMGBB_API_KEY;
  if (!key) throw new Error('IMGBB_API_KEY is not set.');

  const form = new FormData();
  form.append('image', base64);
  if (name) form.append('name', name);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    body: form,
  });

  const json = (await res.json().catch(() => null)) as ImgbbResponse | null;
  if (!res.ok || !json?.data) {
    throw new Error(json?.error?.message || `imgbb upload failed (${res.status})`);
  }

  return {
    url: json.data.display_url || json.data.url,
    deleteUrl: json.data.delete_url,
    id: json.data.id,
  };
}
