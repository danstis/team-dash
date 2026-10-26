/**
 * BSOD-307 (T053) — Playwright e2e for the offline reload.
 *
 * Sister file to `tests/e2e/first-run.spec.ts` (BSOD-350 / T130) and
 * `tests/e2e/landing-shell.spec.ts`. Where those two drive the live
 * `/` route through the credential flow and the app-shell chrome,
 * this file drives the *offline* branch of the same route: the user
 * refreshes their workspace while online, the browser loses the
 * network, and the user reloads the page.
 *
 * Spec / contract references
 * --------------------------
 * FR-087: "As an installable Progressive Web App, the system MUST
 * allow the cached dashboard and locally stored snapshot history to
 * be viewed while offline, and MUST clearly state that refresh is
 * unavailable offline."
 *
 * FR-021: the system must state whether the displayed data is cached
 * or fresh, along with the last successful refresh timestamp. The
 * T050 `FreshnessBanner` (BSOD-304) owns that copy; this file is the
 * end-to-end pin that the banner reports the *cached* state after an
 * offline reload.
 *
 * FR-022: a failed, cancelled, or incomplete refresh must never
 * replace a previously complete cache. The refresh below therefore
 * runs to a successful completion *before* the network is dropped —
 * the offline reload then shows that same completed cache.
 *
 * What this file owns
 * -------------------
 * The offline delivery path end-to-end:
 *
 * 1. The user completes first run with **persistent** storage, so the
 *    encrypted token and the selected workspace survive the reload
 *    (a session-only token lives in memory only — see
 *    `src/data/db/repositories/credential.repository.ts` — and would
 *    send the reload back to the first-run surface instead of the
 *    dashboard).
 * 2. The user runs a refresh against the mocked Asana API, so the
 *    last complete cache lands in IndexedDB.
 * 3. The service worker registers, activates, and takes control of the
 *    page (the `vite-plugin-pwa` configuration in `vite.config.ts`
 *    precaches the app shell).
 * 4. The network is dropped and the page is reloaded.
 * 5. The assertions: the app boots from the cached app shell, the
 *    dashboard reports the *cached* data with the last successful
 *    refresh timestamp, and the Refresh action is visibly disabled
 *    with the reason stated.
 *
 * Why the API mocks are removed before the reload
 * -----------------------------------------------
 * Playwright's `context.route()` handlers fulfil requests from the
 * test driver, so they keep answering even while the browser context
 * is offline. Leaving them installed would let the page appear to
 * "work offline" while it was actually being fed live responses.
 * `context.unrouteAll()` removes them first, so the only thing that
 * can answer the reload is the service worker's cache.
 *
 * Why the Asana API is mocked at the network layer
 * -------------------------------------------------
 * Same rationale as the other e2e files: the production Docker
 * container the CI `test-e2e` job runs has the MSW dev worker
 * stripped by `src/mocks/browser.ts`'s `import.meta.env.PROD` guard
 * (Constitution Principle IV). The fixture data is the same
 * `smallDataset` the Vitest contract / integration tests read, so the
 * e2e and the fixture layer are pinned to the same Asana response
 * shapes by construction.
 *
 * Token-safety guard
 * ------------------
 * The fixture PAT is synthetic (a string that is obviously not a real
 * Asana token). The FR-008 invariant (the full token is never
 * rendered, logged, or embedded in a URL) is preserved end-to-end
 * because the mocked `/users/me` and `/workspaces` responses never
 * echo the bearer token.
 *
 * Boundary
 * --------
 * `tests/e2e/**` runs against the production build published on
 * host port 8080 (the CI job starts the Docker container; a local
 * developer runs the same container or any static server that serves
 * `dist/`). The PWA *install* and service-worker-activation e2e
 * belong to T125 (BSOD-253) — this file assumes the worker is
 * registered and asserts only the offline behaviour that T053 owns.
 */
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

import {
  smallDataset,
  smallDatasetWorkspaceGid,
} from "../../fixtures/asana/small-dataset/data";

/**
 * The synthetic PAT the test submits. A string that is obviously not
 * a real Asana token, so the test can never submit a real PAT to the
 * production Asana API if the `context.route()` mock is ever bypassed.
 */
const FIXTURE_TOKEN = "fixture-e2e-offline-token-1234567890";

/**
 * The Asana API path prefix every mocked endpoint shares. The matchers
 * below compare the pathname rather than matching a glob so the
 * client's own query parameters (`opt_fields`, `workspace`,
 * `archived`, `offset`) never defeat the match.
 */
const ASANA_API_PATH_PREFIX = "/api/1.0";

/**
 * Answer an unauthorised request the way the MSW fixture does, so a
 * regression that drops the `Authorization` header surfaces as a 401
 * (and a recognisable "invalid token" surface) rather than as a
 * silently green test.
 */
async function fulfilUnauthorised(route: Route): Promise<void> {
  await route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ errors: [{ message: "Not Authorized" }] }),
  });
}

/**
 * Whether the outgoing request carries the bearer header the Asana
 * client always sends.
 */
function isAuthorised(request: { headers(): Record<string, string> }): boolean {
  return request.headers().authorization?.startsWith("Bearer ") === true;
}

/**
 * Wire the Asana API mocks for the refresh walk.
 *
 * Four endpoints are mocked — the two the credential flow calls and
 * the two the refresh walk calls:
 *
 *   - `GET /users/me` — token validation.
 *   - `GET /workspaces` — the workspace selector's list.
 *   - `GET /projects` — the refresh walk's project page. The
 *     `archived=false` filter the client sends is honoured, exactly
 *     as the MSW fixture honours it.
 *   - `GET /projects/{gid}/tasks` — the refresh walk's task page.
 *
 * The response bodies mirror `fixtures/asana/small-dataset/handlers.ts`
 * so the wire shapes the production client validates against are the
 * same shapes the contract tests pin.
 *
 * BSOD-307 (T053) — the routes are registered on the BROWSER
 * CONTEXT rather than on the page. Once the app's service worker
 * controls the page, the page's outbound requests are issued by the
 * worker, and a page-level route no longer sees them; a
 * context-level route covers both the page's requests and the
 * worker's.
 */
async function mockAsanaApi(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.pathname === `${ASANA_API_PATH_PREFIX}/users/me`,
    async (route) => {
      if (!isAuthorised(route.request())) {
        await fulfilUnauthorised(route);
        return;
      }
      const user = smallDataset.users[0];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            gid: user.gid,
            name: user.name,
            email: user.email,
            resource_type: user.resource_type,
          },
        }),
      });
    },
  );

  await context.route(
    (url) => url.pathname === `${ASANA_API_PATH_PREFIX}/workspaces`,
    async (route) => {
      if (!isAuthorised(route.request())) {
        await fulfilUnauthorised(route);
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: smallDataset.workspaces }),
      });
    },
  );

  await context.route(
    (url) => url.pathname === `${ASANA_API_PATH_PREFIX}/projects`,
    async (route) => {
      if (!isAuthorised(route.request())) {
        await fulfilUnauthorised(route);
        return;
      }
      const requestUrl = new URL(route.request().url());
      const workspace = requestUrl.searchParams.get("workspace");
      const archived = requestUrl.searchParams.get("archived");
      const projects = smallDataset.projects.filter(
        (project) =>
          (workspace === null || project.workspace?.gid === workspace) &&
          (archived !== "false" || !project.archived),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: projects, next_page: null }),
      });
    },
  );

  await context.route(
    (url) =>
      url.pathname.startsWith(`${ASANA_API_PATH_PREFIX}/projects/`) &&
      url.pathname.endsWith("/tasks"),
    async (route) => {
      if (!isAuthorised(route.request())) {
        await fulfilUnauthorised(route);
        return;
      }
      const projectGid = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/")[4] ?? "",
      );
      const dashboardTask = smallDataset.tasks.find(
        (task) => task.name === "Launch dashboard",
      );
      const webAppProject = smallDataset.projects.find(
        (project) => project.name === "Web App",
      );
      const tasks = smallDataset.tasks.filter(
        (task) =>
          task.projects.some((project) => project.gid === projectGid) ||
          (task.parent !== null &&
            dashboardTask !== undefined &&
            task.parent.gid === dashboardTask.gid &&
            webAppProject !== undefined &&
            projectGid === webAppProject.gid),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: tasks, next_page: null }),
      });
    },
  );
}

/**
 * Walk the first-run flow and store the token **persistently**.
 *
 * Persistent storage is what makes the offline reload reach the
 * dashboard: the encrypted token and its non-extractable key live in
 * IndexedDB, so the credentials context reports `'ready'` after the
 * reload. A session-only token lives in memory only and would drop
 * the reload back onto the first-run surface.
 */
async function completeFirstRun(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();

  await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
  await page.getByRole("button", { name: /test token/i }).click();

  const storageMode = page.getByTestId("storage-mode-selector");
  await expect(storageMode).toBeVisible();
  await page.getByRole("radio", { name: /persistent/i }).click();
  await page
    .getByRole("button", { name: /confirm persistent storage/i })
    .click();

  await expect(page.getByTestId("workspace-selector")).toBeVisible();
  await page
    .getByRole("combobox", { name: /workspace/i })
    .selectOption(smallDatasetWorkspaceGid);
  await page.getByRole("button", { name: /select workspace/i }).click();
}

/**
 * Run the manual refresh and wait for the success outcome.
 *
 * The refresh is what populates the last complete cache, so the
 * offline reload has something honest to show. The completion
 * timestamp the outcome banner reports is the same
 * `RefreshSession.finishedAt` the committed session row carries — the
 * offline assertions compare the two, which is what proves the reload
 * shows *that* cache and not a different one.
 */
async function runRefresh(page: Page): Promise<string> {
  await expect(page.getByTestId("refresh-controls")).toBeVisible();
  await page.getByTestId("refresh-button").click();

  const outcome = page.getByTestId("outcome-banner");
  await expect(outcome).toHaveAttribute("data-outcome-state", "succeeded", {
    timeout: 30_000,
  });
  const completedAt = await outcome.getAttribute("data-completed-at");
  expect(completedAt).toBeTruthy();
  return completedAt ?? "";
}

/**
 * Wait until the service worker is registered, activated, and
 * controlling the page.
 *
 * `registerType: "autoUpdate"` in `vite.config.ts` makes Workbox
 * skip waiting and claim the client, so the worker controls the page
 * without a second navigation. The precache is complete before the
 * worker activates, so an activated worker means the app shell is
 * already in the cache.
 */
async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 30_000 },
  );
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("BSOD-307 (T053) offline reload", () => {
  test("serves the last cached dashboard offline and disables the refresh action", async ({
    page,
    context,
  }) => {
    await mockAsanaApi(context);

    // 1. First run (persistent storage) — the credentials have to
    //    survive the offline reload for the dashboard to be reachable.
    await completeFirstRun(page);

    // 2. A successful refresh — the last complete cache.
    const completedAt = await runRefresh(page);

    // 3. The service worker takes control of the page.
    await waitForServiceWorkerControl(page);

    // 4. Drop the network. The API mocks are removed first so that
    //    nothing but the service worker's cache can answer.
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await context.setOffline(true);

    // 5. Reload with no network at all.
    await page.reload();

    // The app boots from the service-worker-cached app shell: the
    // dashboard chrome is reachable without a network.
    await expect(
      page.getByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The dashboard reports the *cached* data — not fresh data — and
    // the timestamp is the one the successful refresh committed, so
    // the user can see exactly how old the cache is.
    const freshnessBanner = page.getByTestId("freshness-banner");
    await expect(freshnessBanner).toHaveAttribute("data-freshness", "cached");
    await expect(freshnessBanner).toHaveAttribute(
      "data-last-refreshed-at",
      completedAt,
    );

    // FR-087: the refresh action is visibly disabled and the reason
    // is stated, so the user is never left thinking the app is
    // broken.
    const refreshButton = page.getByTestId("offline-refresh-button");
    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toHaveAttribute("aria-disabled", "true");
    const explanation = page.getByTestId("offline-explanation");
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText(/offline/i);
  });
});
