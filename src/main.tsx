/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
// `vite-plugin-pwa`'s `virtual:pwa-register` is a build-time virtual
// module the plugin resolves via its own `resolveId` hook. The
// `registerSW` export satisfies the slice-plan contract that the
// production build "register a Workbox service worker" — the helper
// issues `navigator.serviceWorker.register('/sw.js', { scope: '/' })`
// and (for `registerType: 'prompt'`) returns
// `{ needRefresh, offlineReady }` so the app can wire its own UI
// hooks later without re-running the SW registration.
//
// TypeScript does not know about the virtual module's types out of
// the box; the plugin ships an ambient declaration in its
// `client.d.ts` and the project's `tsconfig.json` includes
// `vite-plugin-pwa/client` (see `tsconfig.json`'s `types` array) so
// the import type-checks cleanly. The `/* eslint-disable
// import/no-unresolved */` pragma is unnecessary because the ESLint
// resolver is also configured to honour Vite virtual modules via
// `vite-plugin-pwa`'s `eslint.config` recommendation.
import { registerSW } from "virtual:pwa-register";

/**
 * BSOD-356 — the app's only stylesheet is loaded via the `<link
 * rel="stylesheet">` in `index.html`, not a JS-side `import
 * "./styles/global.css"` here. Vite's default JS-import CSS handling
 * injects the stylesheet as an inline `<style>` element in dev mode (for
 * fast HMR updates), which `index.html`'s CSP (`style-src 'self'`, no
 * `unsafe-inline`) blocks outright — the page would render completely
 * unstyled in `npm run dev` while looking fine in a production build
 * (where Vite emits a real same-origin `<link>` instead). A static `<link
 * href="/src/styles/global.css">` in `index.html` sidesteps that: Vite's
 * dev server serves and transforms it as a real CSS response either way,
 * and the production build resolves/hashes/rewrites the same reference
 * into `dist/assets/*.css` — one mechanism, CSP-safe in both modes. See
 * `src/styles/global.css`'s docstring for what the stylesheet covers.
 */

/**
 * T031 — entry point.
 *
 * The application entry point boots the Vite app. Its job is small:
 *
 * 1. Optionally start the MSW dev worker (T030) when the developer has
 *    explicitly opted into the fixture surface via `VITE_USE_MOCKS=1`.
 *    The default (no env var) leaves the dev server talking to the real
 *    Asana API, so a developer running `npm run dev` sees the same
 *    behaviour a user will see in production — see BSOD-347 and the
 *    module-level note in `src/mocks/browser.ts`.
 * 2. Mount the T031 `<App />` shell (provider tree + router) into the
 *    `#root` element declared in `index.html`.
 *
 * The MSW wiring stays in `main.tsx` (not in `<App />`) because the
 * worker must register before React mounts — a race here would
 * briefly let a real network call escape the dev server. The
 * `bootstrapDevMocks` helper is intentionally separate from
 * `<App />` so it can run on every build without dragging React into
 * the worker-startup path.
 */

export function renderApp(rootElement: Element): void {
  createRoot(rootElement).render(<App />);
}

/**
 * Boot the MSW browser worker before mounting React in development
 * builds (T030), and only when the developer has set `VITE_USE_MOCKS=1`
 * (BSOD-348). The worker MUST NOT run in production — see
 * `src/mocks/browser.ts` for the contract rationale. A failed MSW
 * start logs and continues so the app shell still renders during local
 * debugging when the `mockServiceWorker.js` is missing or the browser
 * refuses Service-Worker registration.
 *
 * The Vitest + Playwright setups do not consult this function — they
 * boot MSW on their own paths (`tests/setup.ts` listens on the Node
 * server; the Playwright harness will wire its own browser-side MSW
 * start when it lands) and continue to use the fixture handlers
 * regardless of `VITE_USE_MOCKS`. Leaving the env var unset in CI is
 * therefore safe for tests even though it disables the dev-only
 * fixture surface here.
 */
export async function bootstrapDevMocks(): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }
  if (import.meta.env.VITE_USE_MOCKS !== "1") {
    return;
  }
  try {
    const { startDevWorker } = await import("./mocks/browser");
    await startDevWorker();
  } catch (error) {
    console.warn(
      "[team-dash] MSW dev worker failed to start; falling back to live network. " +
        "This is expected in production builds, during unit tests, and when " +
        "`VITE_USE_MOCKS` is unset.",
      error,
    );
  }
}

/**
 * Run the dev-server boot sequence for a given root element:
 * `bootstrapDevMocks()` first (so the MSW worker registers before React
 * mounts and races a real network call), then `renderApp(rootElement)`
 * to mount the T031 `<App />` shell into the T010 `#root` container.
 *
 * Extracted from the module-top-level invocation so the wiring is
 * unit-testable in jsdom — see `tests/unit/app/main.test.tsx`. The
 * module-top-level script calls this when an `#root` element exists
 * (i.e. when the script is loaded from `index.html`, which is the only
 * production entry path).
 */
export async function mountRootApp(rootElement: Element): Promise<void> {
  await bootstrapDevMocks();
  registerServiceWorker();
  renderApp(rootElement);
}

/**
 * T05 (S01) — register the production service worker.
 *
 * Called from `mountRootApp` so every boot path (the module-top-level
 * invocation, future test surfaces) gets the SW registration for free.
 * The helper is a no-op in development because
 * `vite.config.ts`'s `devOptions.enabled: false` keeps the SW out of
 * the dev build entirely; `registerSW` is therefore production-only by
 * construction. The `import.meta.env.PROD` guard makes that intent
 * explicit and prevents any test or dev surface from accidentally
 * trying to register a worker that does not exist.
 *
 * The `onNeedRefresh` / `onOfflineReady` callbacks are observability
 * hooks — the slice plan keeps the SW on `registerType: 'autoUpdate'`
 * so neither callback fires in production today, but logging them
 * means a future `'prompt'` migration lands with the wiring already
 * in place. The console lines are intentionally plain so a regression
 * that flips to `'prompt'` produces a visible signal in the browser
 * devtools rather than a silent UI hole.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) {
    return;
  }
  registerSW({
    immediate: true,
    onNeedRefresh() {
      console.info(
        "[team-dash] A new version is available. Refresh to update.",
      );
    },
    onOfflineReady() {
      console.info("[team-dash] The app is ready to work offline.");
    },
    onRegisteredSW(swUrl) {
      console.info(`[team-dash] Service worker registered at ${swUrl}`);
    },
    onRegisterError(error) {
      console.warn(
        "[team-dash] Service worker registration failed; the app will not work offline.",
        error,
      );
    },
  });
}

const rootElement = document.getElementById("root");
if (rootElement) {
  await mountRootApp(rootElement);
}
