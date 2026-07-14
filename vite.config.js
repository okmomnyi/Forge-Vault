import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

const VIRTUAL_ID = 'virtual:asset-manifest';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;

function listImages(dir, urlBase) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = `${urlBase}/${entry.name}`;
    if (entry.isDirectory()) return listImages(join(dir, entry.name), url);
    return IMAGE_RE.test(entry.name) ? [url] : [];
  });
}

/**
 * Exposes the set of images that actually exist in `public/assets` as
 * `virtual:asset-manifest`.
 *
 * The site ships gradient placeholders for artwork that hasn't been supplied
 * yet. Without this manifest the browser would request every expected filename
 * and log a 404 for each missing one. Instead, the client only attaches a `src`
 * for files the manifest lists — so a half-populated assets folder produces
 * zero failed requests and zero console errors.
 */
function assetManifest() {
  let publicDir = '';

  return {
    name: 'forgevault-asset-manifest',

    configResolved(config) {
      publicDir = config.publicDir;
    },

    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),

    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export const ASSETS = ${JSON.stringify(listImages(join(publicDir, 'assets'), '/assets'))};`;
    },

    configureServer(server) {
      const refresh = (file) => {
        if (!file.replaceAll('\\', '/').includes('/public/assets/')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };

      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

/* ==========================================================================
   Dev API
   ==========================================================================
   In production Vercel routes every /api/* request to the single catch-all
   function at api/[[...path]].js, which dispatches to a handler in
   api/_handlers/. (One function, not 32, because Vercel's Hobby plan caps a
   deployment at 12 — see the comment in that file.)

   This does exactly the same thing for `npm run dev`: hand the request to the
   same catch-all. Dev and production therefore share one router, so a route
   that works locally cannot be missing in production.
   ========================================================================== */

function devApi() {
  return {
    name: 'forgevault-dev-api',

    /**
     * Vite only exposes VITE_-prefixed vars, and only via import.meta.env on the
     * client — it never populates process.env. The API handlers read secrets
     * from process.env (which is what Vercel gives them in production), so
     * without this the entire backend runs unconfigured under `npm run dev`:
     * no database, and — worse — webhook handlers that cannot read their
     * signing key and therefore fail open-ish with a 500 instead of rejecting
     * a forged event with a 401.
     */
    config(_config, { mode }) {
      const env = loadEnv(mode, process.cwd(), '');
      for (const [key, value] of Object.entries(env)) {
        process.env[key] ??= value;
      }
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        // Express-style helpers the handlers expect from Vercel.
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (payload) => {
          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
          return res;
        };

        // The catch-all runs with bodyParser disabled (the Paystack webhook must
        // see the exact bytes it was sent, or its HMAC will not verify), so we
        // deliberately do NOT pre-parse the body here either. The handlers read
        // the stream themselves via readJson/readRaw.

        try {
          const { default: router } = await server.ssrLoadModule('/api/[[...path]].js');
          await router(req, res);
        } catch (error) {
          server.config.logger.error(`[dev-api] ${req.url}: ${error.message}\n${error.stack}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'Handler failed. See the dev server log.' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [assetManifest(), devApi()],

  build: {
    rollupOptions: {
      input: {
        // Storefront
        main: 'index.html',
        about: 'about.html',
        contact: 'contact.html',
        products: 'products.html',
        product: 'product.html',
        cart: 'cart.html',
        checkout: 'checkout.html',
        order: 'order.html',
        account: 'account.html',
        orders: 'orders.html',

        // Admin
        adminLogin: 'admin/login.html',
        adminDashboard: 'admin/index.html',
        adminOrders: 'admin/orders.html',
        adminProducts: 'admin/products.html',
        adminRefunds: 'admin/refunds.html',
        adminMedia: 'admin/media.html',
      },
    },
  },
});
