import { readFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
      injectRegister: false,
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
        runtimeCaching: [],
      },
    }),
  ],
});
