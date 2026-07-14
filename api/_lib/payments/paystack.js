import { createHmac, timingSafeEqual } from 'node:crypto';
import { optionalEnv, requireEnv } from '../env.js';
import { PaymentError, WebhookSignatureError } from './provider.js';

/**
 * Paystack — card payments.
 *
 * Amounts are sent in the currency's *subunit* (cents for USD, kobo for NGN),
 * which is exactly how we store them, so there is no float conversion anywhere
 * in this file. That is deliberate: every currency bug in a payment integration
 * starts with someone dividing by 100.
 *
 * Docs: https://paystack.com/docs/api/transaction
 */

const API = 'https://api.paystack.co';

const secretKey = () => requireEnv('PAYSTACK_SECRET_KEY');

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status === false) {
    throw new PaymentError(payload.message || `Paystack ${method} ${path} failed (${response.status})`, {
      provider: 'paystack',
      cause: payload,
    });
  }

  return payload.data;
}

const paystack = {
  id: 'paystack',
  label: 'Card',
  supportsRefund: true,

  get enabled() {
    return Boolean(optionalEnv('PAYSTACK_SECRET_KEY'));
  },

  async initialize({ order, email, amountCents, currency, callbackUrl }) {
    const data = await call('/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: amountCents, // subunit — same unit we store
        currency,
        reference: `fv_${order.id.replace(/-/g, '')}_${Date.now()}`,
        callback_url: callbackUrl,
        channels: ['card'],
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
        },
      },
    });

    return {
      reference: data.reference,
      redirectUrl: data.authorization_url,
      clientData: { accessCode: data.access_code },
    };
  },

  async verify(reference) {
    const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);

    const statusMap = {
      success: 'succeeded',
      failed: 'failed',
      abandoned: 'failed',
      reversed: 'failed',
    };

    return {
      status: statusMap[data.status] ?? 'pending',
      amountCents: data.amount,
      currency: data.currency,
      method: data.channel ?? data.authorization?.channel,
      failureReason: data.gateway_response && data.status !== 'success' ? data.gateway_response : undefined,
      raw: data,
    };
  },

  async refund({ reference, amountCents, reason }) {
    const data = await call('/refund', {
      method: 'POST',
      body: {
        transaction: reference,
        amount: amountCents,
        merchant_note: reason?.slice(0, 200),
      },
    });

    // Paystack settles refunds asynchronously and confirms via the
    // refund.processed webhook. 'processed' here means it already cleared.
    return {
      status: data.status === 'processed' ? 'succeeded' : 'pending',
      reference: String(data.id ?? ''),
    };
  },

  /**
   * Paystack signs the raw body with HMAC-SHA512 keyed on the secret key.
   * The comparison must be timing-safe and must run against the EXACT bytes
   * received — re-serialising the parsed JSON would change the signature.
   */
  async parseWebhook(raw, headers) {
    const signature = headers['x-paystack-signature'];
    if (!signature) throw new WebhookSignatureError('paystack');

    // No key means we CANNOT verify, so we must not act on the event. Fail
    // closed — reject it as unverified rather than throwing a 500, which would
    // make a forged request look like a server crash and, because Paystack
    // retries on 5xx, invite it to be replayed at us indefinitely. The log line
    // is what tells the operator this is really a misconfiguration.
    const secret = optionalEnv('PAYSTACK_SECRET_KEY');
    if (!secret) {
      console.error(
        '[paystack] PAYSTACK_SECRET_KEY is not set — cannot verify webhook signatures. ' +
          'Rejecting this event. Set the key or no order will ever be confirmed.',
      );
      throw new WebhookSignatureError('paystack');
    }

    const expected = createHmac('sha512', secret).update(raw, 'utf8').digest('hex');

    const a = Buffer.from(String(signature), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookSignatureError('paystack');
    }

    const event = JSON.parse(raw);
    const data = event.data ?? {};

    // Paystack does not send a stable event id, so we synthesise one from the
    // event type plus the transaction reference. Two deliveries of the same
    // event therefore collide on the webhook_events unique index, which is
    // exactly the idempotency we want.
    const id = `${event.event}:${data.reference ?? data.id ?? ''}`;

    const kinds = {
      'charge.success': 'payment_succeeded',
      'charge.failed': 'payment_failed',
      'refund.processed': 'refund_succeeded',
      'refund.failed': 'ignored',
    };

    return {
      id,
      type: event.event,
      kind: kinds[event.event] ?? 'ignored',
      reference: data.reference ?? data.transaction_reference,
      amountCents: data.amount,
      method: data.channel,
      failureReason: data.gateway_response,
      raw: event,
    };
  },
};

export default paystack;
