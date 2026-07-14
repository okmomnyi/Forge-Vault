/** Shared formatting + escaping. */

const formatters = new Map();

/** Money is always integer cents on the wire. Formatting is the only place it becomes a decimal. */
export function money(cents, currency = 'USD') {
  if (!formatters.has(currency)) {
    formatters.set(
      currency,
      new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }),
    );
  }
  return formatters.get(currency).format((cents ?? 0) / 100);
}

/** Escapes text before it goes anywhere near innerHTML. */
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** Human label + colour for each order status. */
export const STATUS = {
  awaiting_verification: { label: 'Awaiting email verification', tone: 'slate' },
  pending_payment: { label: 'Awaiting payment', tone: 'amber' },
  payment_failed: { label: 'Payment failed', tone: 'red' },
  paid: { label: 'Paid — to fulfil', tone: 'blue' },
  processing: { label: 'Processing', tone: 'blue' },
  shipped: { label: 'Shipped', tone: 'indigo' },
  delivered: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  partially_refunded: { label: 'Partially refunded', tone: 'amber' },
  refunded: { label: 'Refunded', tone: 'slate' },
};

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
};

export function statusBadge(status) {
  const meta = STATUS[status] ?? { label: status, tone: 'slate' };
  return `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${TONES[meta.tone]}">${esc(meta.label)}</span>`;
}
