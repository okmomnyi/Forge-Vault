/**
 * The cart, in localStorage.
 *
 * It stores product ids and quantities and NOTHING ELSE — no prices. Every
 * total the customer sees comes back from /api/checkout/quote, priced from the
 * database. Editing localStorage therefore changes what you are buying, never
 * what it costs.
 */

const KEY = 'fv_cart_v1';
const EVENT = 'fv:cart-changed';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((line) => typeof line?.productId === 'string' && Number.isInteger(line?.quantity))
      .map((line) => ({
        productId: line.productId,
        quantity: Math.min(Math.max(line.quantity, 1), 99),
      }));
  } catch {
    // Corrupt or unavailable (private mode). An empty cart is the safe answer.
    return [];
  }
}

function write(lines) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Storage full or blocked. The cart just won't persist across reloads.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { lines } }));
  return lines;
}

export const getCart = read;

export const cartCount = () => read().reduce((sum, line) => sum + line.quantity, 0);

export function addToCart(productId, quantity = 1) {
  const lines = read();
  const existing = lines.find((line) => line.productId === productId);

  if (existing) {
    existing.quantity = Math.min(existing.quantity + quantity, 99);
  } else {
    lines.push({ productId, quantity: Math.min(Math.max(quantity, 1), 99) });
  }

  return write(lines);
}

export function setQuantity(productId, quantity) {
  const lines = read();

  if (quantity <= 0) return removeFromCart(productId);

  const line = lines.find((entry) => entry.productId === productId);
  if (line) line.quantity = Math.min(quantity, 99);

  return write(lines);
}

export const removeFromCart = (productId) => write(read().filter((line) => line.productId !== productId));

export const clearCart = () => write([]);

/** Subscribe to cart changes (the header badge uses this). */
export function onCartChange(callback) {
  window.addEventListener(EVENT, callback);

  // Another tab changed it.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) callback(event);
  });
}
