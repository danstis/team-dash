/**
 * T05 (S01) — Vite production build configuration.
 *
 * Owns:
 *   1. The `VitePWA` plugin configuration that ships the US2 offline
 *      reload path (FR-087, SC-007). The plugin emits a Workbox-
 *      generated service worker (`dist/sw.js`) and a PWA manifest
 *      (`dist/manifest.webmanifest`) that satisfy the slice plan's
 *      "dist/sw.js and dist/manifest.webmanifest emitted by the
 *      production build" verification line.
 *   2. The service worker itself is *registered* by `src/main.tsx`
 *      via `virtual:pwa-register` so the registration lives in the
 *      app's own module graph (testable, observable, and easy to
 *      gate on `import.meta.env.PROD`) rather than being auto-
 *      injected into `index.html`. `injectRegister: false` keeps the
 *      emitted `index.html` CSP-safe (`script-src 'self'`, no
 *      `'unsafe-inline'`) — an inline registration script would be
 *      blocked by the policy.
 *
 * Workbox precache contract
 * -------------------------
 * The `globPatterns` list below is the canonical "app shell" the
 * production build precaches:
 *
 *   - `index.html` — the SPA shell. `navigateFallback` below wires
 *     it as the fallback for any navigation request that is not
 *     already precached, so deep-links (`/settings`, future routes)
 *     still resolve when the browser is offline.
 *   - `assets/` — Vite-emitted bundles (`assets/<name>.<hash>.js`,
 *     `assets/<name>.<hash>.css`, plus the emitted webmanifest).
 *     Hashed filenames keep the precache invalidation honest (a
 *     new build replaces the hash, Workbox notices).
 *   - `icons/` — the manifest-declared app icons. `vite-plugin-pwa`
 *     emits these from `public/icons/` unchanged.
 *   - `manifest.webmanifest` — the PWA manifest. The HTML's
 *     `<link rel="manifest">` references the same path so the SW
 *     precache entry and the HTML link stay in lockstep.
 *
 * The list explicitly **excludes** `mockServiceWorker.js`. The MSW
 * dev worker (`src/mocks/browser.ts`, gated on `import.meta.env.DEV`)
 * is dev-only; shipping it in the production precache is harmless
 * dead weight and the negative glob keeps the precache honest.
 *
 * Runtime caching
 * ---------------
 * The dashboard's "last complete refresh payload" lives in IndexedDB
 * (the Dexie cache the refresh orchestrator's `commit()` writes to
 * via `RefreshStagingRepository`). IndexedDB is browser-persistent
 * storage and survives offline reloads by construction — it is not
 * SW-managed and does not need a Workbox route. The slice verification
 * line ("the last complete refresh payload is viewable offline") is
 * satisfied by the Dexie persistence layer + the app-shell precache,
 * so the SW does not add a separate `runtimeCaching` rule for the
 * Asana API. A future story that wants offline drill-down against a
 * net-new Asana endpoint (e.g. US3's task-detail hydration) can add a
 * `NetworkFirst` rule without changing this file's shape.
 *
 * `autoUpdate` vs `prompt`
 * ------------------------
 * `registerType: 'autoUpdate'` means the SW activates as soon as the
 * browser sees a new revision; the next page load picks up the new
 * shell. This is the right default for a single-developer dashboard
 * where the user manually pulls changes; the alternative
 * (`'prompt'`) requires a UI hook the slice does not ship. A future
 * story that adds an in-app update toast can flip this to `'prompt'`
 * and wire `onNeedRefresh` in `src/main.tsx`.
 */
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      strategies: "generateSW",
      // Explicit registration from `src/main.tsx` via
      // `virtual:pwa-register`. Setting this to `false` keeps the
      // emitted `index.html` free of an inline registration script
      // (which would violate the existing `script-src 'self'`
      // CSP).
      injectRegister: false,
      // Background-update: a new SW takes over on the next page
      // load. See the module-level docstring for the rationale and
      // the future `'prompt'` migration hook.
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
        // The "app shell" precache. The negative glob for
        // `mockServiceWorker.js` keeps the production precache free
        // of MSW's dev-only worker script; see the module-level
        // docstring.
        //
        // NB: the literal patterns below use the standard
        // `brace expansion` syntax — a glob pattern like
        // `<dir>/<glob>{a,b}` — which contains the substring
        // `*/`. That substring closes a JSDoc / block-comment
        // delimiter if it ever appears inside a `/* … */`
        // region, so any future contributor who lifts these
        // patterns into a docstring MUST rephrase them or wrap
        // the closing asterisk in a no-op token.
        globPatterns: [
          "**/*.{js,css,html,webmanifest,svg,woff2,png,ico}",
          "icons/**/*.{png,svg,webmanifest}",
          "!mockServiceWorker.js",
        ],
        // SPA navigation fallback — any in-scope navigation that
        // is not itself precached falls back to the precached
        // `index.html`. This is what makes `/settings` reachable
        // offline once the SW has activated the shell.
        navigateFallback: "/index.html",
        // Drop stale precache entries from prior builds so a
        // returning user does not retain orphaned chunks from a
        // previous deploy.
        cleanupOutdatedCaches: true,
        // Runtime caching is intentionally empty: the dashboard's
        // "last complete refresh payload" lives in IndexedDB (a
        // browser-persistent store) and the Asana API responses
        // are not served by the SW. See the module-level
        // docstring for the rationale.
        runtimeCaching: [],
        // Allow the precache list to grow past the default 2 MB
        // per-entry limit; the bundled JS chunks include Recharts
        // and are larger than the default cap.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      // The dev server should NOT spin up the SW — MSW owns the
      // dev-time network layer (`src/mocks/browser.ts`,
      // `import.meta.env.VITE_USE_MOCKS=1`). A dev SW would
      // intercept those mocks and break the fixture surface.
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
