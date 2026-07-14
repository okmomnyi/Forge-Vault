import { post } from './api.js';

/**
 * Client-side image preparation + upload.
 *
 * Photos straight off a phone are routinely 6–12 MB. Vercel caps a request body
 * at 4.5 MB, so an unprocessed upload would simply fail with an opaque 413.
 * Rather than telling the shop owner to go and resize their photos, we do it
 * here: downscale to a sane maximum and re-encode as JPEG. A 12 MB photo becomes
 * roughly 300 KB with no visible loss at the sizes this site displays.
 *
 * This is a convenience, not a security control — the server re-validates the
 * bytes it receives (magic-number sniff + size cap) and does not trust anything
 * decided here.
 */

const MAX_EDGE = 1600; // px on the long side — plenty for a full-bleed hero
const QUALITY = 0.85;

/** Reads a File into an <img>, resizes it via canvas, returns a JPEG data URL. */
export function prepareImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That file is not an image.'));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');

      // A transparent PNG would go black when flattened to JPEG. White is the
      // right background for a product shot on this site.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', QUALITY),
        width,
        height,
        originalBytes: file.size,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read — it may be corrupt.'));
    };

    img.src = url;
  });
}

/**
 * Prepares and uploads a file. Returns the hosted URL.
 * `onProgress` is called with a short human-readable status.
 */
export async function uploadImage(file, onProgress = () => {}) {
  onProgress('Resizing…');
  const { dataUrl, width, height, originalBytes } = await prepareImage(file);

  const sentBytes = Math.round((dataUrl.length * 3) / 4);
  onProgress(`Uploading ${(sentBytes / 1024).toFixed(0)} KB…`);

  const result = await post('/api/admin/upload', {
    image: dataUrl,
    filename: file.name,
  });

  onProgress('Done');

  return {
    url: result.url,
    deleteUrl: result.deleteUrl,
    width,
    height,
    originalBytes,
    uploadedBytes: sentBytes,
  };
}
