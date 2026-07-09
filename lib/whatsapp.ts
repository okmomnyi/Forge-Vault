/**
 * WhatsApp integration — the entire "checkout" (build spec §5).
 *
 * Just wa.me URL construction: no API keys, no webhooks, no message queue. The
 * deal is closed in the chat, off-platform.
 */

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER!; // e.g. 254700000000, no + or leading 0

function waLink(text: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export function buildOrderMessage(part: {
  name: string;
  partNumber?: string | null;
  priceKes: number;
  url: string;
}): string {
  const lines = [
    `Hi Forge Auto Parts, I'd like to order:`,
    `*${part.name}*`,
    part.partNumber ? `Part #: ${part.partNumber}` : null,
    `Price: KSh ${part.priceKes.toLocaleString()}`,
    `Link: ${part.url}`,
  ].filter(Boolean) as string[];
  return waLink(lines.join('\n'));
}

export function buildQueryMessage(part: { name: string; url: string }): string {
  const lines = [`Hi, I have a question about:`, `*${part.name}*`, part.url];
  return waLink(lines.join('\n'));
}

export function buildGeneralContactMessage(): string {
  return waLink('Hi Forge Auto Parts, I have a question.');
}
