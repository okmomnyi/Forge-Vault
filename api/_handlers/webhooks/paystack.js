import { applySecurityHeaders, clientIp, fail, ok, readRaw } from '../../_lib/http.js';
import { WebhookSignatureError, providerById } from '../../_lib/payments/index.js';
import { processWebhook } from '../../_lib/webhooks.js';

/**
 * POST /api/webhooks/paystack
 *
 * bodyParser is disabled: the HMAC is computed over the exact bytes Paystack
 * sent. Letting Vercel parse and re-serialise the JSON would change the
 * whitespace and break every signature.
 */
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  applySecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed.');
  }

  const raw = await readRaw(req);

  try {
    const result = await processWebhook(providerById('paystack'), raw, req.headers);
    return ok(res, result);
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      // Not a payment. Someone is trying to mark orders paid for free.
      console.error('[webhook] REJECTED unsigned paystack request', { ip: clientIp(req) });
      return fail(res, 401, 'Invalid signature.');
    }

    // 500 so Paystack retries — the event has been released for reprocessing.
    console.error('[webhook] paystack processing failed', { message: error.message, stack: error.stack });
    return fail(res, 500, 'Processing failed.');
  }
}
