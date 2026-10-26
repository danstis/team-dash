/// <reference types="vite-plugin-pwa/vanillajs" />
import { registerSW } from "virtual:pwa-register";

/**
 * BSOD-307 (T053) — the app's service-worker registration.
 *
 * Why this file exists
 * --------------------
 * `vite-plugin-pwa` can inject a registration script into the built
 * `index.html` (`injectRegister: "script"`), but the Team Dash page
 * ships a strict Content Security Policy (`script-src 'self'`) and
 * the repository prefers the built HTML to stay free of
 * plugin-generated markup. Registering from the app's own source
 * keeps the registration visible to the next contributor who wonders
 * how the offline surface comes to exist, and it lets the app decide
 * *when* the worker is registered.
 *
 * This module is loaded as its own module entry from `index.html`
 * (see the `<script type="module" src="/src/registerSW.ts">` tag
 * there) rather than from `src/main.tsx`. Two reasons:
 *
 * 1. The `virtual:pwa-register` module only exists inside a Vite
 *    build. Importing it from the application entry would make every
 *    unit test that imports `src/main.tsx` depend on the PWA plugin
 *    being present in the Vitest configuration.
 * 2. The registration runs in parallel with the application boot, so
 *    the worker starts installing (and precaching the app shell)
 *    while React is still mounting — the offline surface is ready
 *    sooner after the first visit.
 *
 * How the worker becomes active
 * -----------------------------
 * - `immediate: true` registers the worker as soon as this module
 *   runs rather than waiting for the `load` event, so the worker
 *   starts precaching the app shell straight away.
 * - `vite.config.ts` configures Workbox with `skipWaiting` and
 *   `clientsClaim`, so the freshly installed worker takes control of
 *   the open page without the user having to reload once. The first
 *   offline reload therefore works on the very first visit.
 * - `registerType: "autoUpdate"` means a later deployment replaces
 *   the worker in place instead of waiting for every tab to close.
 *
 * Failure behaviour
 * -----------------
 * A registration failure (an unsupported browser, a private-mode
 * restriction, a corporate policy) must never break the app: the
 * failure is logged and the app continues online-only. The message
 * carries no credential — the personal access token is never part of
 * a service-worker registration error (FR-008 / FR-010).
 *
 * Boundary
 * --------
 * This module registers the worker and nothing else. The worker's
 * caching strategy lives in `vite.config.ts`; the offline UX (the
 * disabled refresh action and the cached-data banner) lives in
 * `src/features/refresh/**`.
 */
export function registerServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisterError: (error: unknown) => {
      console.warn(
        "[team-dash] The service worker could not be registered; the app will " +
          "keep working online but will not be available offline.",
        error,
      );
    },
  });
}

registerServiceWorker();
