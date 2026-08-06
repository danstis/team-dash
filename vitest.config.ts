import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * T05 (S01) — `virtual:pwa-register` stub plugin.
 *
 * `vite-plugin-pwa` registers a `resolveId` hook for the virtual
 * `virtual:pwa-register` module ID. That hook is installed when the
 * plugin is added to a Vite config (production `npm run build`,
 * `npm run preview`, `npm run dev`). Vitest is configured separately
 * and intentionally does NOT load `vite-plugin-pwa` — the PWA
 * plugin's dev-time SW registration would interfere with the MSW
 * dev worker (`src/mocks/browser.ts`, gated on `VITE_USE_MOCKS=1`).
 *
 * Without this stub, the static
 * `import { registerSW } from "virtual:pwa-register"` in
 * `src/main.tsx` (the production registration entry point) fails to
 * resolve under Vitest, even though `registerServiceWorker()`
 * short-circuits at runtime via `import.meta.env.PROD`. The unit
 * suite (`tests/unit/app/bootstrap-dev-mocks.test.tsx`,
 * `tests/unit/app/main.test.tsx`) imports `src/main.tsx`, so the
 * import-analysis failure surfaces as a whole-file load error and
 * five concrete test failures in `bootstrap-dev-mocks.test.tsx`.
 *
 * Why a custom plugin, not `resolve.alias`
 * ----------------------------------------
 * Vite's `resolve.alias` API supports either a flat `{ key: path }`
 * object (with string targets) or an array of `{ find, replacement }`
 * entries (with string replacements). The `virtual:` scheme prefix is
 * a Vite virtual-module convention; Vite's alias plugin recognises it
 * and short-circuits before the user-supplied alias sees the request.
 * A plain string alias therefore does NOT intercept
 * `virtual:pwa-register`. The function form of `replacement` (which
 * could lazily resolve at request time) is not part of the public
 * `resolve.alias` type signature either.
 *
 * A small `Plugin` whose `resolveId` hook returns the absolute path
 * to the stub is the documented escape hatch: it runs in the same
 * `resolveId` hook chain as `vite-plugin-pwa`'s own virtual-module
 * resolver, and its return value (`{ id }` or a plain string) is
 * honoured by the alias plugin's later pass. The function body is
 * only evaluated at module-resolve time, so the meta-test at
 * `tests/unit/config/vitest-config.test.ts` (which imports this
 * config as a plain module to read `default`'s `test.environment`
 * property) never touches the URL/path computation — it just reads
 * the exported object.
 *
 * Stub contract
 * -------------
 * The stub at `tests/stubs/pwa-register-stub.ts` is a no-op module
 * exporting `registerSW(options)`. The export shape mirrors the
 * vite-plugin-pwa ambient declaration
 * (`node_modules/vite-plugin-pwa/client.d.ts`, pulled in via
 * `tsconfig.json`'s `types: ["vite-plugin-pwa/client"]`), so the
 * static import in `src/main.tsx` continues to type-check without
 * any cast at the call site. PROD is always false in Vitest, so the
 * stub is never reached from a test surface — `import.meta.env.PROD`
 * short-circuits `registerServiceWorker()` before it would have
 * called the import.
 */
const virtualPwaRegisterStub: Plugin = {
  name: "virtual-pwa-register-stub",
  enforce: "pre",
  resolveId(id) {
    if (id === "virtual:pwa-register") {
      const here = fileURLToPath(new URL(".", import.meta.url));
      return path.resolve(here, "tests/stubs/pwa-register-stub.ts");
    }
    return null;
  },
};

export default defineConfig({
  plugins: [virtualPwaRegisterStub],
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
  },
});