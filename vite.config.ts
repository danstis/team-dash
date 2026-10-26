import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { ASANA_API_CACHE_NAME } from "./src/shared/service-worker-cache";

/**
 * Serve the MSW browser worker script during `vite serve` only.
 *
 * The script (`dev/mockServiceWorker.js`, copied verbatim from
 * `node_modules/msw/lib/mockServiceWorker.js`) is a development-only
 * fixture. Keeping it out of `public/` stops Vite copying it into
 * `dist/`, so a production build never publishes a fetch-interception
 * service worker at the site root (BSOD-450). This middleware keeps the
 * dev workflow unchanged: with `VITE_USE_MOCKS=1 npm run dev`,
 * `startDevWorker()` still registers `/mockServiceWorker.js`.
 */
export function devMockServiceWorker(): Plugin {
  return {
    name: "team-dash:dev-mock-service-worker",
    apply: "serve",
    configureServer(server) {
      const workerPath = join(
        server.config.root,
        "dev",
        "mockServiceWorker.js",
      );
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?", 1)[0];
        if (url !== "/mockServiceWorker.js") {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(readFileSync(workerPath));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    devMockServiceWorker(),
    VitePWA({
      strategies: "generateSW",
      // BSOD-307 (T053) — the worker is registered explicitly from
      // `src/registerSW.ts` (the `virtual:pwa-register` module), so
      // the plugin must not inject a registration script into the
      // built `index.html`. Registering from the app's own source
      // keeps the registration visible in the codebase and keeps the
      // built `index.html` free of plugin-generated markup (the page
      // ships a strict CSP — `script-src 'self'` — and an injected
      // inline script would violate it).
      injectRegister: false,
      // `autoUpdate` makes the worker take over as soon as a new
      // version is installed instead of waiting for every tab to be
      // closed. The Workbox half of that behaviour (`skipWaiting` +
      // `clientsClaim`) is configured explicitly below because the
      // plugin only derives it from `registerType` when
      // `injectRegister` is `"auto"`.
      registerType: "autoUpdate",
      manifest: {
        name: "Team Dash",
        short_name: "Team Dash",
        description:
          "A local-first Asana team performance and workload dashboard.",
        lang: "en-AU",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#0f172a",
        icons: [
          {
            src: "/icons/team-dash-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icons/team-dash-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // The app shell — the SPA entry document, every hashed build
        // asset, the web manifest, the PWA icons, and the bundled
        // fonts. Precaching this set is what lets the app boot with
        // no network at all, which is the first half of FR-087's
        // offline story: the app starts, reads the last complete
        // cache out of IndexedDB, and shows the dashboard the user
        // saw the last time they were online.
        //
        // The default glob (`**/*.{js,wasm,css,html}`) plus the
        // manifest icons leaves the remaining icons and the
        // `@fontsource` font files out of the cache, so an offline
        // reload would render the shell with fallback fonts and miss
        // the favicon.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
        // Every navigation is answered with the precached entry
        // document, so a deep link (`/settings`) and a plain reload
        // both work offline. The SPA router resolves the path in the
        // client, exactly as it does online.
        navigateFallback: "/index.html",
        // Drop the caches a previous Workbox version created, so an
        // upgraded install does not keep serving stale shells.
        cleanupOutdatedCaches: true,
        // Take over the open page as soon as the worker is activated
        // — the offline reload therefore works on the FIRST visit,
        // without the user having to reload the page once to put the
        // worker in control.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/app\.asana\.com\/api\/1\.0\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: ASANA_API_CACHE_NAME,
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              plugins: [
                {
                  cachedResponseWillBeUsed: async ({
                    cachedResponse,
                  }: {
                    cachedResponse?: Response;
                  }): Promise<Response | undefined> => {
                    if (cachedResponse === undefined) {
                      return cachedResponse;
                    }
                    const headers = new Headers(cachedResponse.headers);
                    headers.set(
                      "X-Team-Dash-Served-From",
                      "service-worker-cache",
                    );
                    return new Response(cachedResponse.body, {
                      status: cachedResponse.status,
                      statusText: cachedResponse.statusText,
                      headers,
                    });
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
});
