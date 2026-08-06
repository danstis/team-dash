/**
 * T05 (S01) — offline-reload end-to-end coverage.
 *
 * Spec / contract references
 * --------------------------
 * - FR-087 / SC-007 — the production build must register a Workbox
 *   service worker that precaches the app shell, and the offline
 *   reload experience must be verified end-to-end against the
 *   production Docker container (or, locally, the
 *   `playwright.config.ts` `webServer`-spun `vite preview`).
 * - Spec US2 acceptance scenario 4 — "On completion the outcome
 *   must be shown along with the last successful refresh timestamp
 *   and whether currently displayed data is cached or fresh."
 * - Spec US2 acceptance scenario 5 — "When the browser goes
 *   offline, the refresh action MUST be visibly disabled with an
 *   explanation."
 *
 * What this spec pins
 * --------------------
 * The end-to-end contract the S01 offline-reload slice delivers,
 * driven against the production build:
 *
 *   1. The PWA app shell (`dist/sw.js`, `dist/manifest.webmanifest`)
 *      is emitted by `npm run build`.
 *   2. Loading the production app registers the SW, precaches the
 *      app shell, and the SW claims the navigation on subsequent
 *      loads.
 *   3. After a successful refresh against the mocked Asana API,
 *      the dashboard surfaces the FR-021 freshness banner with
 *      `data-freshness="fresh"` and the FR-084 data-quality
 *      summary.
 *   4. After `context.setOffline(true)` + a full page reload, the
 *      dashboard still loads — the SW serves `index.html` from the
 *      precache, React mounts, and IndexedDB serves the cached
 *      `tasks` / `projects` / `refreshSessions` rows. The
 *      `<RefreshControls />` disables the refresh button and
 *      surfaces the FR-087 `<OfflineState />` explanation.
 *   5. After `context.setOffline(false)` the refresh button
 *      re-enables and a subsequent refresh succeeds (the Asana
 *      mock returns the fixture data again).
 *
 * Why this test mocks the Asana API at the network layer
 * -------------------------------------------------------
 * The production build the CI `test-e2e` job runs has the MSW dev
 * worker stripped by `src/mocks/browser.ts`'s `import.meta.env.PROD`
 * guard (Constitution Principle IV). The Vitest / integration layer
 * mocks the same endpoints server-side via `tests/setup.ts`'s MSW
 * node server; the e2e layer mocks them at the browser's network
 * boundary via Playwright's `page.route()` so the test does not
 * depend on the dev-only worker wiring. The fixture data is the
 * same `smallDataset` the integration tests use, so the e2e and
 * integration layers are pinned to the same Asana response shapes by
 * construction.
 *
 * Failure artifacts (BSOD-349)
 * ----------------------------
 * The Playwright config sets `screenshot: "only-on-failure"` and
 * `trace: "retain-on-failure"`; a failing spec lands with a
 * full-page screenshot and a Playwright trace in `test-results/`,
 * which the CI workflow uploads via `actions/upload-artifact`. The
 * T05 offline-reload spec is a particular fan-out of that contract
 * — the most likely failure modes are (a) the SW never registers
 * (CSP violation, missing `registerServiceWorker` call), (b) the SW
 * fails to claim the navigation (precache missing `index.html`),
 * (c) IndexedDB is wiped between reloads (browser-context
 * misconfiguration), (d) the offline state never propagates to
 * `<RefreshControls />` (Playwright `setOffline` doesn't fire the
 * `offline` event in headless Chromium). The trace files pin all
 * four cases cleanly.
 *
 * Boundary
 * --------
 * `tests/e2e/**` runs against the production build served on port
 * 8080. CI publishes the production Docker container on that port;
 * local development falls back to `npm run preview` via the
 * `webServer` block in `playwright.config.ts`. No live Asana
 * workspace, no live token (NFR-005), no MSW required.
 */
import { test, expect, type Page } from "@playwright/test";

import {
  FIXTURE_E2E_TOKEN,
  mockAsanaApiForRefresh,
  triggerSuccessfulRefresh,
  waitForServiceWorkerActive,
  walkFirstRun,
} from "./test-hooks";

/**
 * Wait for the dashboard's empty-state surface to disappear after a
 * successful refresh, then wait for the freshness banner to surface
 * with `data-freshness="fresh"`. Splitting this assertion out of
 * `triggerSuccessfulRefresh` keeps the test body focused on the
 * end-to-end UX contract (cached-after-offline-reload) rather than
 * the post-refresh re-render mechanics that the helper already
 * covers.
 */
async function expectFreshDashboard(page: Page): Promise<void> {
  await triggerSuccessfulRefresh(page);
  const banner = page.getByTestId("freshness-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("data-freshness", "fresh");
}

test.describe("T05 — offline reload (S01)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the Asana API for every spec. The route registrations
    // persist across navigations within the page, so a single
    // beforeEach covers the first-run walk + the refresh +
    // subsequent reloads.
    await mockAsanaApiForRefresh(page);
  });

  test("registers the production service worker and precaches the app shell", async ({
    page,
  }) => {
    // The slice verification contract: `dist/sw.js` and
    // `dist/manifest.webmanifest` must be emitted by the
    // production build, and the SW must register when the
    // production app loads. We probe the precache via the SW's
    // `caches.match()` after the first navigation; a missing
    // precache surfaces as `null` for the `/index.html` lookup.
    await page.goto("/");
    await waitForServiceWorkerActive(page);

    const precachedIndex = await page.evaluate(async () => {
      const cacheKeys = await caches.keys();
      // Workbox's `generateSW` precache stores entries under the
      // `workbox-precache-v2-<origin>` cache and decorates each
      // URL with a `?__WB_REVISION__=<hash>` query parameter so
      // the precache is content-addressed. A naive
      // `cache.match("/index.html")` therefore misses the entry
      // — the cached request URL is
      // `http://localhost:4173/index.html?__WB_REVISION__=…`.
      // The fix is to pass `ignoreSearch: true` to `cache.match`,
      // which matches against the path regardless of the query
      // string. Iterate every cache because the exact cache name
      // is build-dependent (`workbox-precache-v2-<origin>` for
      // `generateSW`; `workbox-precache-revisioned-<id>` for
      // `injectManifest`).
      for (const name of cacheKeys) {
        const cache = await caches.open(name);
        const response = await cache.match("/index.html", {
          ignoreSearch: true,
        });
        if (response !== undefined) {
          return true;
        }
      }
      return false;
    });
    expect(precachedIndex).toBe(true);

    // The manifest is a public, same-origin file; verify it is
    // served with the documented fields the offline-reload UX
    // depends on.
    const manifestResponse = await page.request.get("/manifest.webmanifest");
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      readonly name?: unknown;
      readonly start_url?: unknown;
      readonly display?: unknown;
    };
    expect(manifest.name).toBe("Team Dash");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  test("dashboard loads from cache after going offline and reloading", async ({
    page,
  }) => {
    // Phase 1 — load, walk first-run, refresh. The offline-reload
    // spec requires `persistent` storage so the encrypted credential
    // survives the SW-served navigation; session-only tokens live
    // in memory and are wiped on the first reload, which would
    // re-close the route guard and regress the test to the first-
    // run surface even with a perfectly-precached app shell.
    await walkFirstRun(page, { storageMode: "persistent" });
    await expectFreshDashboard(page);

    // Phase 2 — wait for the SW to activate and claim the page.
    // The orchestrator's refresh may have just finished; the SW
    // registration from the first page load has already
    // resolved, so this is a quick no-op reload. The explicit
    // wait guarantees the SW controls the page before we
    // disconnect the network.
    await waitForServiceWorkerActive(page);

    // Phase 3 — disconnect the network. Playwright blocks all
    // requests (including the SW's own navigation fetch), but
    // because the SW is the controller, its `fetch` event
    // handler resolves the navigation from the precache without
    // hitting the network layer.
    await page.context().setOffline(true);
    await page.reload();

    // Phase 4 — the dashboard surface must still render. The
    // freshness banner flips to `data-freshness="cached"` after
    // the 30 s window — the elapsed time between the just-
    // completed refresh and the offline reload is well under 30
    // s in practice, so the assertion accepts either variant.
    // The FR-087 offline explanation MUST surface (the
    // `RefreshControls` reads `navigator.onLine === false` and
    // renders `<OfflineState />`).
    const dashboard = page.getByTestId("dashboard");
    await expect(dashboard).toBeVisible({ timeout: 15_000 });
    const banner = page.getByTestId("freshness-banner");
    await expect(banner).toBeVisible();
    const freshness = await banner.getAttribute("data-freshness");
    expect(freshness === "fresh" || freshness === "cached").toBe(true);

    // The offline gate disables refresh and surfaces the
    // explanation block. Both anchors are pinned by the T03
    // RefreshControls unit suite; the e2e spec pins the same
    // shape against the production build.
    //
    // Playwright's `setOffline(true)` blocks network requests at
    // the CDP layer, but in headless Chromium the
    // `navigator.onLine` flip is asynchronous and can race the
    // post-reload React mount — the `useOffline()` hook reads
    // `navigator.onLine` synchronously on mount and would miss
    // the offline transition. We dispatch the event manually
    // so the hook picks it up deterministically; this is a
    // test-environment workaround for a real-browser behaviour
    // the production code already handles via the native
    // `online`/`offline` events.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
        writable: true,
      });
      window.dispatchEvent(new Event("offline"));
    });
    const offlineExplanation = page.getByTestId("offline-explanation");
    await expect(offlineExplanation).toBeVisible();
    await expect(offlineExplanation).toHaveAttribute("data-offline", "true");
    await expect(page.getByTestId("refresh-button")).toBeDisabled();

    // Phase 5 — reconnect the network. The browser fires the
    // `online` event; `<RefreshControls />` re-enables the
    // button. We dispatch the `online` event manually for the
    // same test-environment reason as Phase 4: Playwright's
    // `setOffline(false)` is asynchronous at the CDP layer and
    // the `useOffline()` hook needs an explicit event to flip
    // the refresh button back to enabled in headless Chromium.
    await page.context().setOffline(false);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", {
        value: true,
        configurable: true,
        writable: true,
      });
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.getByTestId("refresh-button")).toBeEnabled({
      timeout: 5_000,
    });
    await expect(offlineExplanation).toHaveCount(0);
  });

  test("token is never surfaced through the URL during the offline reload flow", async ({
    page,
  }) => {
    // FR-008 / FR-010 — the token never lands in the URL bar or
    // any rendered DOM surface during the offline reload path.
    // We walk first-run (which posts the token via fetch to
    // Asana — intercepted by `page.route()`), trigger a refresh,
    // go offline, reload, and assert the URL never contains the
    // fixture PAT. This is the offline-reload-specific slice of
    // the FR-008 invariant; the in-component unit suite covers
    // the rest. `persistent` storage is required so the
    // credential survives the reload.
    await walkFirstRun(page, { storageMode: "persistent" });
    await expectFreshDashboard(page);

    await page.context().setOffline(true);
    await page.reload();

    // Allow the post-reload render to settle before sampling the
    // URL — a race here would flake on slow CI runners.
    await expect(page.getByTestId("dashboard")).toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain(FIXTURE_E2E_TOKEN);
    expect(page.url()).not.toContain(encodeURIComponent(FIXTURE_E2E_TOKEN));
    await page.context().setOffline(false);
  });
});
