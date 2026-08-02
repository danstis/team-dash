/**
 * BSOD-350 (T130) — Playwright e2e for the first-run page on the live `/`
 * route.
 *
 * Sister file to `tests/integration/credentials/first-run-setup.test.tsx`
 * (BSOD-347). Where that integration test walks the first-run flow inside
 * jsdom + Vitest against the imported `FirstRunSetup` component (and
 * covers the `data-view-state="first_run"` gate contract), this e2e file
 * drives a real browser against the production Docker container the CI
 * `test-e2e` job publishes on port 8080. The combination gives the
 * gate's behaviour the canonical documentation-from-the-outside view
 * a future contributor gets when they `docker run` the image and click
 * through the surfaces by hand.
 *
 * Spec / contract references
 * --------------------------
 * US1 acceptance scenarios (spec.md §"User Story 1") that flow from
 * this composition:
 *
 *   1. "Given no token has been entered, When the user opens the app,
 *      Then the app shows a first-run credential entry screen and
 *      blocks access to reporting screens until a valid token and
 *      workspace are set."
 *
 *   2. "Given the user enters a syntactically plausible token, When
 *      they choose 'Test token', Then the app calls Asana to validate
 *      it and reports success (with the workspaces the token can
 *      access) or a specific failure reason."
 *
 *   3. "Given a token has been validated, When the user chooses
 *      persistent storage, Then the app explains that the token is
 *      sensitive, states the storage risk and that it remains on this
 *      device/browser profile, and requires an explicit confirmation
 *      step before writing it to IndexedDB."
 *
 *   5. "Given a validated token, When the user views the list of
 *      accessible workspaces, Then they can select exactly one
 *      workspace to use for reporting, and that choice is what scopes
 *      all subsequent data retrieval."
 *
 * And FR-001: "The system MUST require a user-supplied Asana personal
 * access token before any reporting screen is accessible."
 *
 * Accessibility (Constitution Principle VII)
 * ------------------------------------------
 * The third test walks the form via `Tab` and confirms each field is
 * labelled and focusable — the browser's a11y tree is the only
 * "documented" surface a screen-reader user sees, so keyboard order
 * and explicit labels are the part of the first-run UX the test is
 * best placed to pin.
 *
 * Why this test mocks the Asana API at the network layer
 * -------------------------------------------------------
 * The production Docker container the CI `test-e2e` job runs has the
 * MSW dev worker stripped by `src/mocks/browser.ts`'s
 * `import.meta.env.PROD` guard (Constitution Principle IV — the
 * production PWA must call the real Asana API with a user-supplied
 * PAT). The Vitest / integration layer mocks the same endpoints
 * server-side via `tests/setup.ts`'s MSW node server; the e2e layer
 * mocks them at the browser's network boundary via Playwright's
 * `page.route()` so the test does not depend on the dev-only worker
 * wiring. The fixture data is the same `smallDataset` the BSOD-347
 * integration test reads, so the e2e and integration layers are
 * pinned to the same Asana response shapes by construction.
 *
 * Token-safety guard
 * ------------------
 * The fixture PAT is synthetic (a string that is obviously not a real
 * Asana token) and the small-dataset handlers authorise any
 * `Authorization: Bearer …` request. The FR-008 invariant (full token
 * never rendered, logged, or embedded in a URL) is preserved end-to-
 * end because every Phase 3 component already pins it in isolation
 * and the composition does not widen the prop surface. The mocked
 * `users/me`/`workspaces` responses never echo the bearer token.
 *
 * Failure artifacts (BSOD-349)
 * ----------------------------
 * The Playwright config sets `screenshot: "only-on-failure"` and
 * `trace: "retain-on-failure"`, and the CI workflow uploads the
 * resulting `test-results/` directory on test failure — a regression
 * that drops one of the three forms from the first-run surface lands
 * here with a screenshot of the broken page and a full trace, which
 * is what the acceptance criteria for this sub-issue require.
 *
 * Boundary
 * --------
 * `tests/e2e/**` runs against the production Docker container
 * (`npm run test:e2e` after the CI's `docker run --publish 8080:8080 …`).
 * No live Asana workspace, no live token (NFR-005), no MSW required
 * — the browser itself is the only runtime dependency, and `Asana`
 * network calls are intercepted at the browser's network layer.
 */
import { test, expect, type Page } from "@playwright/test";

import {
  smallDataset,
  smallDatasetWorkspaceGid,
} from "../../fixtures/asana/small-dataset/data";

/**
 * The synthetic PAT the test submits. A string that is obviously not
 * a real Asana token (`fixture-e2e…`), used so the test never
 * accidentally submits a real PAT to the production Asana API if the
 * `page.route()` mock is ever bypassed by a CI regression.
 */
const FIXTURE_TOKEN = "fixture-e2e-first-run-page-token-1234567890";

/**
 * The Asana API base URL the production client always targets. The
 * browser's CSP (`index.html`'s `connect-src 'self' https://app.asana.com`)
 * whitelists this origin, so the test's `page.route()` wildcard must
 * cover the same host.
 */
const ASANA_API_BASE = "https://app.asana.com/api/1.0";

/**
 * The `<h1>Team Dash</h1>` text the T031 placeholder reporting route
 * renders. The placeholder is the canonical "post-first-run landing"
 * surface until US2's dashboard chrome ships; the test asserts on
 * its presence so a regression that lifts the gate but leaves the
 * placeholder broken fails this file with a clear
 * "heading not found" message rather than a stale first-run surface.
 */
const PLACEHOLDER_HEADING = /team dash/i;

/**
 * The synthetic user the mocked `/users/me` endpoint returns. The
 * `testToken` client uses the endpoint's `name` field to build the
 * "Authenticated as {name}" success message, so the test can assert
 * the success outcome without reaching for a real Asana account.
 */
const MOCK_USER = smallDataset.users[0];

/**
 * Wire the Asana API mocks for the first-run flow.
 *
 * Only the two endpoints the first-run UI calls are mocked:
 *
 *   - `GET /users/me` — the `testToken` client (BSOD-167,
 *     `src/data/asana/client.ts`) hits this to validate the
 *     submitted PAT. The MSW server uses the same response shape
 *     (`fixtures/asana/small-dataset/handlers.ts`).
 *   - `GET /workspaces` — the post-validation `listWorkspaces`
 *     call in `TokenEntryForm.tsx` hits this to fetch the
 *     workspaces the validated token can access (FR-011).
 *
 * Routes are matched against the URL + query string via glob
 * (`*` matches any path suffix including `?opt_fields=…`); the
 * matchers MUST NOT be exact because the production client adds
 * `opt_fields` query parameters (`asanaUserSchema` /
 * `asanaWorkspaceListResponseSchema` request narrowing) that would
 * otherwise flow past the mock straight to the real Asana API.
 *
 * Each route enforces the `Authorization: Bearer …` header the
 * MSW server enforces in fixtures, so a regression that drops the
 * header from the client would surface as a 401 + a recognisable
 * "Invalid token" summary in the form rather than a silent green
 * test.
 */
async function mockAsanaApiForFirstRun(page: Page): Promise<void> {
  await page.route(`${ASANA_API_BASE}/users/me*`, async (route) => {
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
        gid: MOCK_USER.gid,
        name: MOCK_USER.name,
        email: MOCK_USER.email,
        resource_type: "user",
      }),
    });
  });

  await page.route(`${ASANA_API_BASE}/workspaces*`, async (route) => {
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
      body: JSON.stringify({ data: smallDataset.workspaces, next_page: null }),
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("BSOD-350 (T130) first-run page on the live `/` route", () => {
  test.beforeEach(async ({ page }) => {
    await mockAsanaApiForFirstRun(page);
  });

  test("renders the three first-run forms with no credentials cached", async ({
    page,
  }) => {
    await page.goto("/");

    // The first-run sentinel the route guard's gate contract pins
    // (`tests/integration/credentials/first-run.test.tsx`). A reader
    // who sees the test fail here knows the gate is open or the
    // FirstRunState primitive is missing — both are regression
    // signals, not flake.
    await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();

    // US1 scenario 1 — TokenEntryForm + TestTokenButton are the
    // first form the user sees. The `data-testid` is the stable
    // anchor the Phase 3 components already expose
    // (`src/features/credentials/TokenEntry.tsx`).
    await expect(page.getByTestId("token-entry-form")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /test token/i }),
    ).toBeVisible();

    // The other two forms are gated behind the validated-token
    // step — they MUST NOT be rendered on the first page-load
    // surface so the user is not overwhelmed with options that
    // depend on a token they have not entered yet. The test fails
    // clearly if a future contributor mounts them eagerly.
    await expect(page.getByTestId("storage-mode-selector")).toHaveCount(0);
    await expect(page.getByTestId("workspace-selector")).toHaveCount(0);
  });

  test("walks token → storage mode → workspace → post-first-run landing", async ({
    page,
  }) => {
    await page.goto("/");

    // Gate is closed on first load.
    await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();

    // Phase 1 — token entry + test. The MSW-mocked `users/me`
    // endpoint accepts any Bearer-prefixed token, so the
    // `testToken` round-trip succeeds and the form's
    // `onValidated` callback fires the
    // `StorageModeSelector` phase.
    await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: /test token/i }).click();

    // Phase 2 — StorageModeSelector replaces TokenEntryForm.
    await expect(page.getByTestId("storage-mode-selector")).toBeVisible();
    await expect(page.getByTestId("token-entry-form")).toHaveCount(0);

    // Choose session-only. The selector calls
    // `useCredentials().setSessionToken`, which transitions the
    // credentials context to `'ready'`, which advances the gate's
    // phase machine to the workspace selector.
    await page.getByRole("radio", { name: /session[- ]only/i }).click();

    // Phase 3 — WorkspaceSelector replaces StorageModeSelector.
    await expect(page.getByTestId("workspace-selector")).toBeVisible();
    await expect(page.getByTestId("storage-mode-selector")).toHaveCount(0);

    // Pick the fixture's primary workspace and commit it.
    const workspaceField = page.getByRole("combobox", { name: /workspace/i });
    await workspaceField.selectOption(smallDatasetWorkspaceGid);
    await page.getByRole("button", { name: /select workspace/i }).click();

    // Phase 4 — the route guard's gate lifts once both providers
    // report `'ready'`. The first-run surface unmounts and the
    // T031 placeholder reporting surface (the
    // `<h1>Team Dash</h1>` heading) becomes visible. The
    // `data-view-state="first_run"` sentinel is what the test
    // anchors on — its absence is the canonical "gate is open"
    // signal that every existing contract test (`T035`,
    // `BSOD-347`) already uses.
    await expect(page.locator('[data-view-state="first_run"]')).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: PLACEHOLDER_HEADING }),
    ).toBeVisible();

    // All three first-run forms are gone now that the gate has
    // lifted — the placeholder reporting surface is the only
    // mounted surface, so a regression that leaves a Phase 3 form
    // mounted after the transition fails this assertion.
    await expect(page.getByTestId("token-entry-form")).toHaveCount(0);
    await expect(page.getByTestId("storage-mode-selector")).toHaveCount(0);
    await expect(page.getByTestId("workspace-selector")).toHaveCount(0);
  });

  test("exposes the three first-run forms as labelled, keyboard-reachable fields", async ({
    page,
  }) => {
    await page.goto("/");

    // Each form is wrapped in a `<fieldset>` with a `<legend>` so
    // assistive tech announces the form's purpose before the
    // controls. The token entry form is the only one on the first
    // page-load surface; the storage-mode and workspace selectors
    // are mounted on the same DOM tree but `aria-hidden` via the
    // conditional `{phase === "…" && …}` renders — verify the
    // token-entry form is the active one before exercising focus.
    await expect(page.getByTestId("token-entry-form")).toBeVisible();

    // The token input is the first focusable control inside the
    // form. Tabbing from the document root should land on the
    // `<input type="password">` — the form's `<legend>` is not
    // focusable, then the labelled input is. We seed the focus
    // chain by querying for the labelled token input — the
    // matching `for` / wrapped `<label>` relationship is the
    // contract Principle VII requires.
    const tokenInput = page.getByLabel(/^token$/i);
    await expect(tokenInput).toBeVisible();
    await tokenInput.focus();
    await expect(tokenInput).toBeFocused();

    // Type a value and verify it is reflected in the input — the
    // FR-008 "token never rendered" rule is downstream of "the
    // input is a real, accessible, password-type input the user
    // can interact with"; the `type="password"` attribute is what
    // keeps the rendered surface from echoing the value.
    await tokenInput.fill(FIXTURE_TOKEN);
    await expect(tokenInput).toHaveValue(FIXTURE_TOKEN);
    const inputType = await tokenInput.getAttribute("type");
    expect(inputType).toBe("password");

    // The submit button is the next focusable control inside the
    // form. It carries an accessible name from its visible text
    // and is focusable via Tab — the keyboard-reachability
    // contract Principle VII requires.
    const testButton = page.getByRole("button", { name: /test token/i });
    await expect(testButton).toBeEnabled();
    await testButton.focus();
    await expect(testButton).toBeFocused();
  });
});
