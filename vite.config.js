import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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
   Dev API router
   ==========================================================================
   Vercel routes /api/** to the matching file under api/ in production. Vite's
   dev server does not, so this reimplements that mapping — including dynamic
   [id] segments — and runs the same handler files unmodified. Without it none
   of the backend is reachable during `npm run dev`.
   ========================================================================== */

function collectRoutes(dir, apiRoot) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);

    // `_lib` is shared code, not routes — same convention Vercel uses.
    if (entry.isDirectory()) {
      return entry.name.startsWith('_') ? [] : collectRoutes(full, apiRoot);
    }

    if (!entry.name.endsWith('.js')) return [];

    const rel = relative(apiRoot, full).replaceAll('\\', '/').replace(/\.js$/, '');
    const urlPath = `/api/${rel.replace(/\/index$/, '')}`;

    // /api/products/[slug] -> ^/api/products/([^/]+)$
    const paramNames = [];
    const pattern = urlPath.replace(/\[([^\]]+)\]/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });

    return [
      {
        file: `/${relative(process.cwd(), full).replaceAll('\\', '/')}`,
        regex: new RegExp(`^${pattern}/?$`),
        paramNames,
        // Static routes must win over dynamic ones: /api/products/index
        // should not be shadowed by /api/products/[slug].
        dynamic: paramNames.length > 0,
      },
    ];
  });
}

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
      const apiRoot = join(process.cwd(), 'api');
      const routes = collectRoutes(apiRoot, apiRoot).sort((a, b) => a.dynamic - b.dynamic);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const url = new URL(req.url, 'http://localhost');
        const match = routes
          .map((route) => ({ route, result: route.regex.exec(url.pathname) }))
          .find(({ result }) => result);

        if (!match) return next();

        // Rebuild the request shape Vercel hands its handlers.
        req.query = Object.fromEntries(url.searchParams);
        match.route.paramNames.forEach((name, i) => {
          req.query[name] = decodeURIComponent(match.result[i + 1]);
        });

        // Webhook handlers verify signatures over the exact bytes received, so
        // they opt out of body parsing. Respect that here too.
        const module = await server.ssrLoadModule(match.route.file);
        const parseBody = module.config?.api?.bodyParser !== false;

        if (parseBody && req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString('utf8');

          try {
            req.body = raw ? JSON.parse(raw) : {};
          } catch {
            req.body = raw;
          }
        }

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

        try {
          await module.default(req, res);
        } catch (error) {
          server.config.logger.error(`[dev-api] ${url.pathname}: ${error.message}\n${error.stack}`);
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
