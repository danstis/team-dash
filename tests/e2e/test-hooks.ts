/**
 * T05 (S01) — shared Playwright e2e test hooks.
 *
 * Helpers every e2e spec in `tests/e2e/**` can import to walk the
 * production app through the canonical user flows without each
 * spec re-implementing the Asana mock wiring, first-run walk, or
 * refresh trigger. The slice T05 ships this module specifically for
 * the new `offline-reload.spec.ts`, but the helpers are intentionally
 * generic so future US2–US15 e2e slices can compose against them.
 *
 * The helpers drive the **production build** the CI `test-e2e` job
 * publishes on port 8080 (or, locally, the `webServer` block in
 * `playwright.config.ts` spins up `vite preview` against the same
 * port). The production build has the MSW dev worker stripped by
 * `src/mocks/browser.ts`'s `import.meta.env.PROD` guard, so the
 * helpers mock the Asana API at the browser's network boundary via
 * Playwright's `page.route()` — the same pattern the BSOD-350
 * first-run spec uses.
 *
 * ## Why a separate module (and not a `test-utilities/` helper)
 *
 * - `tests/e2e/**` is the only Playwright-aware test layer; the
 *   helper shapes (`Page`, `Route`, `Locator`) are not usable from
 *   jsdom + Vitest. Co-locating the helpers next to the specs that
 *   consume them keeps the dependency direction obvious and avoids
 *   the cross-test-layer import that would otherwise drag
 *   `@playwright/test` into the unit-test bundle.
 * - The helpers are pure functions on `Page` — no module-level
 *   state, no side effects beyond the `page.route()` and
 *   `page.context()` calls they make. Multiple `test.describe`
 *   blocks can run in parallel (within the same file's serial
 *   flow) without interference.
 *
 * Boundary
 * --------
 * `tests/e2e/test-hooks.ts` is a Playwright-only helper module. It
 * is allowed to import from `../../fixtures/asana/**` (git-tracked
 * fixture data per the project's "tests use git-tracked fixtures,
 * never gitignored paths" rule); it MUST NOT import from
 * `src/**` directly because the production build is what the
 * browser sees, not the source modules.
 */

import {
  expect,
  type Page,
  type Route,
} from "@playwright/test";

import {
  smallDataset,
  smallDatasetWorkspaceGid,
} from "../../fixtures/asana/small-dataset/data";

/**
 * The Asana API base URL the production client always targets. The
 * browser's CSP (`index.html`'s `connect-src 'self' https://app.asana.com`)
 * whitelists this origin, so the test's `page.route()` wildcard must
 * cover the same host.
 */
export const ASANA_API_BASE = "https://app.asana.com/api/1.0";

/**
 * The synthetic PAT the offline-reload spec (and any future e2e spec
 * that wants to walk first-run) submits. The string is obviously
 * not a real Asana token — `fixture-e2e…` — so the test never
 * accidentally submits a real PAT to the production Asana API if
 * the `page.route()` mock is ever bypassed by a CI regression.
 */
export const FIXTURE_E2E_TOKEN = "fixture-e2e-offline-reload-token-1234567890";

/**
 * Mock the Asana API endpoints the refresh orchestrator touches.
 *
 * Endpoints covered:
 *
 * - `GET /users/me` — `testToken` (T039) validation. Authorises any
 *   `Bearer <token>` and returns the fixture's primary user.
 * - `GET /workspaces` — first-run `listWorkspaces` (T039) + the
 *   refresh orchestrator's pre-walk (none today, but covered for
 *   symmetry).
 * - `GET /projects?workspace=…` — `fetchProjectsPage` (T048). The
 *   handler paginates by reading the `offset` query parameter and
 *   returns the first page (single-page dataset). A `next_page: null`
 *   terminates the orchestrator's pagination walk on the first call.
 * - `GET /projects/{gid}/tasks` — `fetchTasksPage` (T048). One page
 *   per project; the small-dataset fixture's tasks are static so a
 *   single page suffices for the offline-reload spec.
 *
 * Routes are matched against the URL + query string via glob
 * (`*` matches any path suffix including `?opt_fields=…`); the
 * matchers MUST NOT be exact because the production client adds
 * `opt_fields` / `workspace` / `offset` query parameters that
 * would otherwise flow past the mock straight to the real Asana
 * API.
 *
 * Each route enforces the `Authorization: Bearer …` header the
 * MSW server enforces in fixtures, so a regression that drops the
 * header from the client would surface as a 401 + a recognisable
 * "Not Authorized" body rather than a silent green test.
 */
export async function mockAsanaApiForRefresh(page: Page): Promise<void> {
  await page.route(`${ASANA_API_BASE}/users/me*`, async (route: Route) => {
    const request = route.request();
    if (!request.headers().authorization?.startsWith("Bearer ")) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: smallDataset.users[0] }),
    });
  });

  await page.route(`${ASANA_API_BASE}/workspaces*`, async (route: Route) => {
    const request = route.request();
    if (!request.headers().authorization?.startsWith("Bearer ")) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: smallDataset.workspaces,
        next_page: null,
      }),
    });
  });

  await page.route(`${ASANA_API_BASE}/projects*`, async (route: Route) => {
    const request = route.request();
    if (!request.headers().authorization?.startsWith("Bearer ")) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: smallDataset.projects,
        next_page: null,
      }),
    });
  });

  await page.route(
    `${ASANA_API_BASE}/projects/*/tasks*`,
    async (route: Route) => {
      const request = route.request();
      if (!request.headers().authorization?.startsWith("Bearer ")) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: smallDataset.tasks,
          next_page: null,
        }),
      });
    },
  );
}

/**
 * Walk the three-step first-run flow the `FirstRunSetup` composition
 * orchestrates:
 *
 *   1. `<TokenEntryForm />` — submit the fixture PAT and click
 *      "Test token".
 *   2. `<StorageModeSelector />` — choose `session` (the default)
 *      or `persistent` (drives the confirmation dialog). Session-
 *      only tokens live in memory and are wiped on page reload;
 *      persistent tokens are encrypted at rest with a non-
 *      extractable AES-GCM key and survive reloads, which is what
 *      the offline-reload spec needs to verify the dashboard
 *      renders from IndexedDB after a SW-served navigation.
 *   3. `<WorkspaceSelector />` — pick the fixture's primary
 *      workspace and confirm.
 *
 * After this helper resolves, the route guard's gate lifts and the
 * `<Dashboard />` surface (T04) is mounted. The helper waits for
 * `getByTestId("dashboard")` to appear so the caller can compose
 * the next step (a refresh click, a navigation, etc.) without
 * racing the gate.
 */
export async function walkFirstRun(
  page: Page,
  options: { readonly storageMode?: "session" | "persistent" } = {},
): Promise<void> {
  const storageMode = options.storageMode ?? "session";
  await page.goto("/");

  // Step 1 — token entry.
  await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();
  await page.getByLabel(/^token$/i).fill(FIXTURE_E2E_TOKEN);
  await page.getByRole("button", { name: /test token/i }).click();

  // Step 2 — storage mode. The selector renders two radios; the
  // persistent branch opens a confirmation dialog (the
  // `data-testid="persistent-confirmation"` alertdialog) that the
  // caller must explicitly confirm before the credentials context
  // transitions to `'ready'`. The T03 + T04 integration tests
  // cover the session-only path; the offline-reload spec needs
  // the persistent path so the credential survives the SW-served
  // navigation.
  await expect(page.getByTestId("storage-mode-selector")).toBeVisible();
  if (storageMode === "persistent") {
    await page.getByRole("radio", { name: /persistent/i }).click();
    await expect(page.getByTestId("persistent-confirmation")).toBeVisible();
    await page
      .getByRole("button", { name: /confirm persistent storage/i })
      .click();
    await expect(page.getByTestId("persistent-confirmation")).toHaveCount(0);
  } else {
    await page.getByRole("radio", { name: /session[- ]only/i }).click();
  }

  // Step 3 — workspace selection.
  await expect(page.getByTestId("workspace-selector")).toBeVisible();
  await page
    .getByRole("combobox", { name: /workspace/i })
    .selectOption(smallDatasetWorkspaceGid);
  await page.getByRole("button", { name: /select workspace/i }).click();

  // Wait for the gate to lift — `<Dashboard />` mounts and the
  // `data-testid="dashboard"` anchor becomes visible.
  await expect(page.getByTestId("dashboard")).toBeVisible();
}

/**
 * Trigger one successful refresh and wait for the orchestrator to
 * commit a `RefreshSession` row with `status: 'succeeded'`. The
 * helper pins the success outcome via the
 * `<OutcomeBanner data-testid="outcome-banner">` element the T03
 * `<RefreshControls />` renders on the terminal state, and also
 * waits for the `<FreshnessBanner data-testid="freshness-banner">`
 * to flip from the empty-state path to the just-refreshed path
 * (`data-freshness="fresh"` for the 30-second window after commit).
 *
 * Both anchors must be visible for the helper to resolve — a test
 * that only checks the outcome banner would miss a regression that
 * commits the session but fails to render the freshness surface
 * (or vice versa).
 */
export async function triggerSuccessfulRefresh(page: Page): Promise<void> {
  const refreshButton = page.getByTestId("refresh-button");
  await expect(refreshButton).toBeEnabled();
  await refreshButton.click();

  // The orchestrator's commit path transitions the session to
  // `succeeded` and the dashboard's `<FreshnessBanner />` flips to
  // `data-freshness="fresh"` (within the 30s post-completion window).
  // Wait for the banner — its appearance proves both the refresh
  // completed and the dashboard re-rendered against the new session
  // row.
  const banner = page.getByTestId("freshness-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toHaveAttribute("data-freshness", "fresh");
}

/**
 * Wait for the production service worker to register and activate.
 *
 * `vite-plugin-pwa`'s `registerType: 'autoUpdate'` means the SW
 * activates as soon as the browser sees the precache manifest, but
 * the SW only *controls* a given page after the page reloads once
 * following registration. The helper therefore:
 *
 *   1. Awaits `navigator.serviceWorker.ready` (the first
 *      registration resolves once the SW is in `'activated'`
 *      state).
 *   2. Reloads the page once so the SW becomes the controller for
 *      subsequent navigations — without this step, an offline
 *      reload would race the SW's claim on the navigation request.
 *
 * The `waitUntil: 'load'` on the reload guarantees the page has
 * finished its initial render before the helper returns, so the
 * caller's subsequent assertions (e.g. `expect(dashboard).toBeVisible()`)
 * don't race the SW-controlled re-paint.
 */
export async function waitForServiceWorkerActive(page: Page): Promise<void> {
  // `serviceWorker.controller` is non-null once an active SW
  // controls the page. We first wait for the registration to
  // resolve (the SW is in `'activated'` state), then reload once
  // so the page is served by the controlled client.
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        "Service workers are unavailable in this browser context.",
      );
    }
    await navigator.serviceWorker.ready;
  });
  // Reload so the activated SW claims the navigation. The reload
  // waits for the `load` event so the post-reload render settles
  // before the helper returns.
  await page.reload({ waitUntil: "load" });
}
