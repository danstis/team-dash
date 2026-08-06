/**
 * T05 (S01) — Vitest stub for `virtual:pwa-register`.
 *
 * `vite-plugin-pwa` resolves the `virtual:pwa-register` import ID at
 * build time via its own `resolveId` hook; that hook is registered
 * when the plugin is added to a Vite config (production `npm run
 * build`, `npm run preview`, `npm run dev`). Vitest is configured
 * separately and does NOT load `vite-plugin-pwa` — by design, so the
 * PWA plugin's dev-time SW registration does not interfere with the
 * MSW dev worker (`src/mocks/browser.ts`, gated on
 * `VITE_USE_MOCKS=1`). That asymmetry means any static
 * `import { registerSW } from "virtual:pwa-register"` in code that
 * the unit suite imports (`src/main.tsx` here) fails to resolve
 * under Vitest, even though `registerServiceWorker()` would have
 * short-circuited at runtime via its `import.meta.env.PROD` guard.
 *
 * `vitest.config.ts` aliases this file to `virtual:pwa-register`,
 * giving the static import a real, type-checked module to point at
 * inside the test environment. The stub is a complete no-op — the
 * production registration path is unreachable from any unit-test
 * surface (PROD is always false in Vitest), and the calls we do
 * reach (`registerServiceWorker()` from `mountRootApp`) exit at the
 * PROD gate before touching this stub. The export shape matches the
 * vite-plugin-pwa ambient declaration in
 * `node_modules/vite-plugin-pwa/client.d.ts` (typed via
 * `tsconfig.json`'s `types: ["vite-plugin-pwa/client"]` entry) so
 * the static import type-checks cleanly without an extra cast.
 */

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

export function registerSW(_options: RegisterSWOptions = {}): void {
  // Vitest stub. The production registration lives behind
  // `import.meta.env.PROD` inside `src/main.tsx`'s
  // `registerServiceWorker()`; this stub is never reached from a
  // test surface because PROD is always false in the Vitest
  // environment, and `import.meta.env.PROD` short-circuits before
  // the `registerSW()` call would have evaluated.
}