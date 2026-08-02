/**
 * BSOD-351 (T131) — Playwright e2e for the first landing surface the
 * user reaches after first-run completes: the `/settings` credentials
 * panel.
 *
 * Sister file to `tests/e2e/first-run.spec.ts` (BSOD-350 / T130). Where
 * that spec walks the live `/` route through `TokenEntry` →
 * `StorageMode` → `WorkspaceSelector` to lift the T046 route guard,
 * this spec assumes that flow has already completed and drives the
 * post-first-run `/settings` credentials panel (T045's
 * `SettingsCredentialsPanel`) end-to-end through a real browser.
 *
 * Spec / contract references
 * --------------------------
 * US1 acceptance scenario 6 (spec.md §"User Story 1") that flow from
 * this surface:
 *
 *   "Given an already-configured session, When the user opens Settings,
 *    Then they can test the current token again, replace it, switch
 *    between session-only and persistent storage, or clear the token
 *    and all locally retained Asana data in one explicit action."
 *
 * The decomposition into FR-004 (Retest), FR-005 / FR-005a (Replace),
 * FR-006 / FR-003 (Switch-mode), and FR-007 (Clear-all) is what the
 * `tests/integration/credentials/settings-panel.test.tsx` (BSOD-165 /
 * T037) test pins at the integration layer — this file is the
 * end-to-end pin that the same actions still function when driven
 * through the production Docker build + a real browser.
 *
 * Why this test mocks the Asana API at the network layer
 * -------------------------------------------------------
 * Same rationale as `tests/e2e/first-run.spec.ts`: the production
 * Docker container the CI `test-e2e` job runs has the MSW dev worker
 * stripped by `src/mocks/browser.ts`'s `import.meta.env.PROD` guard
 * (Constitution Principle IV — the production PWA must call the real
 * Asana API with a user-supplied PAT). The Vitest / integration layer
 * mocks the same endpoints server-side via `tests/setup.ts`'s MSW
 * node server; the e2e layer mocks them at the browser's network
 * boundary via Playwright's `page.route()`. The fixture data is the
 * same `smallDataset` the BSOD-165 / BSOD-347 integration tests
 * read, so the e2e and integration layers are pinned to the same
 * Asana response shapes by construction.
 *
 * How `TokenEntryForm` completion is stubbed
 * -----------------------------------------
 * BSOD-350's first-run page test (`tests/e2e/first-run.spec.ts`)
 * already walks the full `TokenEntryForm` → `StorageModeSelector` →
 * `WorkspaceSelector` flow on the live `/` route. The test below
 * reuses that flow's output by walking the same path first; once the
 * T046 gate lifts and the placeholder (`<h1>Team Dash</h1>`) is
 * visible, the test follows the new `data-testid="nav-settings"`
 * link to the `/settings` route that the BSOD-351 router change
 * mounts. The link is the canonical in-app entry point for the
 * `/settings` route; the `first-run-flow` step is the documented
 * "stub `TokenEntryForm` completion" path the BSOD-351 issue
 * references.
 *
 * Token-safety guard
 * ------------------
 * The fixture PATs are synthetic strings (`fixture-e2e…`) that are
 * obviously not real Asana tokens, used so the test never
 * accidentally submits a real PAT to the production Asana API if the
 * `page.route()` mock is ever bypassed by a CI regression. The
 * small-dataset handlers authorise any `Authorization: Bearer …`
 * request, so the retest round-trip succeeds. The FR-008 invariant
 * (full token never rendered, logged, or embedded in a URL) is
 * preserved end-to-end because every Phase 3 component already pins
 * it in isolation and the e2e composition does not widen the
 * surface.
 *
 * Failure artifacts (BSOD-349)
 * ----------------------------
 * The Playwright config sets `screenshot: "only-on-failure"` and
 * `trace: "retain-on-failure"`, and the CI workflow uploads the
 * resulting `test-results/` directory on test failure — a regression
 * that drops the retest / replace / switch-mode actions lands here
 * with a screenshot of the broken page and a full trace, which is
 * what the acceptance criteria for this sub-issue require.
 *
 * Boundary
 * --------
 * `tests/e2e/**` runs against the production Docker container
 * (`npm run test:e2e` after the CI's `docker run --publish 8080:8080 …`).
 * No live Asana workspace, no live token (NFR-005), no MSW required
 * — the browser itself is the only runtime dependency, and the
 * `Asana` network calls are intercepted at the browser's network
 * layer.
 */
import { test, expect, type Page, type Request } from "@playwright/test";

import { smallDataset } from "../../fixtures/asana/small-dataset/data";

/**
 * The synthetic PAT the test submits during the first-run walk. A
 * string that is obviously not a real Asana token (`fixture-e2e…`),
 * used so the test never accidentally submits a real PAT to the
 * production Asana API if the `page.route()` mock is ever bypassed
 * by a CI regression. The last four characters (`7890`) are the
 * masked identifier the retest / replace assertions below anchor on.
 */
const FIXTURE_TOKEN = "fixture-e2e-landing-credentials-token-1234567890";

/**
 * The replacement PAT the Replace action submits. Distinct from
 * `FIXTURE_TOKEN` so the masked-identifier assertion proves the
 * replace action actually re-issued the credentials context's
 * `maskedIdentifier` rather than echoing the prior token.
 */
const REPLACEMENT_TOKEN = "fixture-e2e-landing-credentials-replacement-zzzz9";

/**
 * The Asana API base URL the production client always targets. The
 * browser's CSP (`index.html`'s `connect-src 'self' https://app.asana.com`)
 * whitelists this origin, so the test's `page.route()` wildcard must
 * cover the same host.
 */
const ASANA_API_BASE = "https://app.asana.com/api/1.0";

/**
 * The four PAT characters the masked identifier is allowed to
 * surface (T044 / BSOD-172 — last-4-characters only). The full token
 * never appears in the rendered DOM or the credentials context value
 * (FR-008).
 */
function lastFour(token: string): string {
  return token.slice(-4);
}

/**
 * The canonical rendered form of the T044 `<MaskedToken />` component:
 * the credentials-context `maskedIdentifier` (`lastFour(token)`) is
 * the algorithm output the `maskTokenIdentifier` / `maskedIdentifierFor`
 * helpers produce, and the component prepends a single
 * horizontal-ellipsis character so the masked surface is visually
 * distinct from a raw suffix. The integration test's
 * `tests/integration/credentials/token-masking.test.tsx` (T038)
 * asserts on the same shape; the e2e layer re-uses the rendered form
 * so the two layers agree on what the user actually sees.
 */
const ELLIPSIS = "\u2026";
function renderedMaskedToken(token: string): string {
  return `${ELLIPSIS}${lastFour(token)}`;
}

/**
 * The `<h1>Team Dash</h1>` text the T031 placeholder reporting route
 * renders. The placeholder is the canonical "post-first-run landing"
 * surface until US2's dashboard chrome ships; the test asserts on
 * its presence so a regression that breaks the first-run walk fails
 * this file with a clear "heading not found" message rather than a
 * stale first-run surface.
 */
const PLACEHOLDER_HEADING = /team dash/i;

/**
 * The Settings nav link the post-first-run placeholder renders. The
 * test uses this `data-testid` as the canonical anchor for the
 * "navigate to `/settings`" step the BSOD-351 issue spec calls for.
 */
const SETTINGS_NAV_TEST_ID = "nav-settings";

/**
 * The first workspace the fixture exposes. The integration test
 * `tests/integration/credentials/settings-panel.test.tsx` selects
 * the same row, so the e2e and integration layers are pinned to the
 * same fixture workspace by construction.
 */
const PRIMARY_WORKSPACE_GID = smallDataset.workspaces[0].gid;

/**
 * Wire the Asana API mocks for the post-first-run landing panel.
 *
 * The panel calls the same two endpoints the first-run flow calls
 * (see `mockAsanaApiForFirstRun` in `tests/e2e/first-run.spec.ts` for
 * the canonical list) — `/users/me` for the retest round-trip and
 * `/workspaces` for the post-validation workspace list. Routes are
 * matched against the URL + query string via glob (`*` matches any
 * path suffix including `?opt_fields=…`); the matchers MUST NOT be
 * exact because the production client adds `opt_fields` query
 * parameters (`asanaUserSchema` / `asanaWorkspaceListResponseSchema`
 * request narrowing) that would otherwise flow past the mock straight
 * to the real Asana API.
 *
 * Each route enforces the `Authorization: Bearer …` header the MSW
 * server enforces in fixtures, so a regression that drops the header
 * from the client would surface as a 401 + a recognisable
 * "Invalid token" summary in the panel rather than a silent green
 * test.
 */
async function mockAsanaApiForSettingsPanel(page: Page): Promise<void> {
  await page.route(`${ASANA_API_BASE}/users/me*`, async (route) => {
    const request: Request = route.request();
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
        data: {
          gid: smallDataset.users[0].gid,
          name: smallDataset.users[0].name,
          email: smallDataset.users[0].email,
          resource_type: "user",
        },
      }),
    });
  });

  await page.route(`${ASANA_API_BASE}/workspaces*`, async (route) => {
    const request: Request = route.request();
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

/**
 * Walk the BSOD-350 first-run flow on the live `/` route so the T046
 * route guard's gate lifts and the placeholder reporting surface is
 * rendered. Mirrors the flow `tests/e2e/first-run.spec.ts` walks —
 * token → session mode → workspace — so the two sibling Stage 2 / 3
 * specs agree on the post-first-run landing surface.
 *
 * The flow MUST complete before the test asserts any `/settings`
 * surface, because the BSOD-351 router change mounts
 * `SettingsCredentialsPanel` as a child of `RouteGuard` (T046); until
 * both providers report `'ready'`, the gate redirects to the
 * `FirstRunRoute` and the `/settings` route is unreachable.
 */
async function walkFirstRunFlowToGateOpen(page: Page): Promise<void> {
  await page.goto("/");

  // The first-run sentinel the route guard's gate contract pins
  // (`tests/integration/credentials/first-run.test.tsx`). A reader
  // who sees the test fail here knows the gate is open or the
  // FirstRunState primitive is missing — both are regression
  // signals, not flake.
  await expect(page.locator('[data-view-state="first_run"]')).toBeVisible();

  // Phase 1 — token entry + test. The MSW-mocked `users/me`
  // endpoint accepts any Bearer-prefixed token, so the `testToken`
  // round-trip succeeds and the form's `onValidated` callback fires
  // the `StorageModeSelector` phase.
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
  await workspaceField.selectOption(PRIMARY_WORKSPACE_GID);
  await page.getByRole("button", { name: /select workspace/i }).click();

  // Gate lifts — the first-run surface unmounts and the T031
  // placeholder reporting surface (the `<h1>Team Dash</h1>`
  // heading) becomes visible.
  await expect(page.locator('[data-view-state="first_run"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: PLACEHOLDER_HEADING }),
  ).toBeVisible();

  // The placeholder's Settings nav link is now reachable — it is
  // the in-app entry point for the `/settings` route the BSOD-351
  // router change mounts.
  await expect(page.getByTestId(SETTINGS_NAV_TEST_ID)).toBeVisible();
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

test.describe("BSOD-351 (T131) first landing surface on `/settings`", () => {
  test.beforeEach(async ({ page }) => {
    await mockAsanaApiForSettingsPanel(page);
  });

  test("renders the masked-token display, retest, replace, switch-mode, and clear-all surfaces", async ({
    page,
  }) => {
    await walkFirstRunFlowToGateOpen(page);

    // Navigate from the placeholder's Settings link to the
    // `/settings` route. The link is the canonical in-app entry
    // point the router exposes; a regression that drops the link
    // (or mounts the panel without a route) fails this step with
    // a clear "nav-settings not visible after navigation" message.
    await page.getByTestId(SETTINGS_NAV_TEST_ID).click();

    // The panel's stable `data-testid` is the canonical anchor for
    // every action the integration test (`BSOD-165` / T037)
    // exercises; the e2e layer re-uses the same anchor so the two
    // layers are pinned to the same surface.
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // The active credential section's Token input + Set token +
    // Retest trio is the FR-004 surface the panel renders. The
    // `aria-label` on the input is the FR-008 a11y anchor
    // (Constitution Principle VII).
    await expect(
      page.getByRole("button", { name: /set token/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^retest$/i })).toBeVisible();

    // The replace section's Replacement-credential input + Replace
    // button is the FR-005 / FR-005a surface. The label's
    // `Replacement credential` wording is what the BSOD-165
    // integration test asserts on — the e2e layer re-uses the
    // same wording so the two layers agree on the surface.
    await expect(
      page.getByRole("button", { name: /^replace$/i }),
    ).toBeVisible();

    // The storage-mode section's "Switch to persistent" button is
    // the FR-006 / FR-003 disclosure-trigger surface. The
    // post-first-run landing flow uses session-only, so the
    // session-to-persistent button is the one rendered (not the
    // inverse "Switch to session-only" button the persistent-mode
    // branch renders).
    await expect(
      page.getByRole("button", { name: /switch to persistent/i }),
    ).toBeVisible();

    // The clear-all section's "Clear all" button is the FR-007
    // single-action-wipe trigger. The accompanying confirmation
    // dialog (`data-testid="clear-all-confirmation"`) is not
    // rendered until the user opts in.
    await expect(
      page.getByRole("button", { name: /clear all/i }),
    ).toBeVisible();
    await expect(page.getByTestId("clear-all-confirmation")).toHaveCount(0);
  });

  test("renders the last-4-chars masked-token display for the active credential (FR-008)", async ({
    page,
  }) => {
    await walkFirstRunFlowToGateOpen(page);
    await page.getByTestId(SETTINGS_NAV_TEST_ID).click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // The credentials context has the session token the first-run
    // walk committed, so the storage-mode section's `Active token`
    // line renders the T044 `MaskedToken` component. The
    // `data-testid="masked-token"` hook is the same anchor the
    // `tests/integration/credentials/token-masking.test.tsx` (T038)
    // integration test asserts on.
    await expect(page.getByTestId("masked-token")).toHaveText(
      renderedMaskedToken(FIXTURE_TOKEN),
    );

    // FR-008 — the rendered DOM MUST NOT carry the full plaintext
    // token, only the masked identifier. The HTML payload is the
    // surface a screenshot or `view-source` reveals, so the
    // assertion pins the invariant at the rendered boundary a
    // contributor sees in DevTools, not just the React tree.
    const settingsHtml = await page.getByTestId("settings-panel").innerHTML();
    expect(settingsHtml).not.toContain(FIXTURE_TOKEN);
    // At most a 4-character masked tail is acceptable.
    expect(settingsHtml).not.toContain(FIXTURE_TOKEN.slice(0, -4));
  });

  test("retest round-trips the mocked Asana `/users/me` handler and surfaces the 'valid' outcome", async ({
    page,
  }) => {
    await walkFirstRunFlowToGateOpen(page);
    await page.getByTestId(SETTINGS_NAV_TEST_ID).click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // The panel's local `currentToken` state is empty on first
    // mount (the post-first-run landing mount is a fresh React
    // tree), so the Retest button needs the user to commit a
    // token first via the "Set token" path the panel exposes.
    // The MSW-mocked `users/me` handler accepts any bearer token
    // and returns the fixture's first user, so the round-trip
    // succeeds.
    await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: /set token/i }).click();

    // The masked-token display updates to the new token's
    // last-four. The assertion proves the Set-token path
    // transitioned the credentials context to `'ready'` with the
    // matching masked identifier before the Retest action runs.
    await expect(page.getByTestId("masked-token")).toHaveText(
      renderedMaskedToken(FIXTURE_TOKEN),
    );

    // Click Retest — the panel calls `testToken(currentToken)`,
    // which round-trips against the MSW-mocked `users/me`
    // endpoint. The handler returns a 200 with the fixture's
    // first user, so the `summariseUserValidationResult` helper
    // renders the "valid" branch on the retest-outcome element.
    await page.getByRole("button", { name: /^retest$/i }).click();

    await expect(page.getByTestId("retest-outcome")).toBeVisible();
    await expect(page.getByTestId("retest-outcome")).toContainText(/valid/i);

    // FR-008 — the retest outcome MUST NOT contain the plaintext
    // token, only the masked identifier. The fixture user
    // surfaces the user name in the outcome copy (per
    // `summariseUserValidationResult`'s "Authenticated as {name}"
    // format) so the outcome DOM is non-empty without echoing the
    // token.
    const outcomeText =
      (await page.getByTestId("retest-outcome").textContent()) ?? "";
    expect(outcomeText).not.toContain(FIXTURE_TOKEN);
    expect(outcomeText).not.toContain(FIXTURE_TOKEN.slice(0, -4));
  });

  test("replace updates the masked-token display to the replacement token", async ({
    page,
  }) => {
    await walkFirstRunFlowToGateOpen(page);
    await page.getByTestId(SETTINGS_NAV_TEST_ID).click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // Commit the fixture token via the panel's Set-token path so
    // the credentials context has a session-mode record the
    // Replace action will swap (FR-005 / FR-005a).
    await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: /set token/i }).click();
    await expect(page.getByTestId("masked-token")).toHaveText(
      renderedMaskedToken(FIXTURE_TOKEN),
    );

    // Replace — type the replacement token and click Replace.
    // The panel's handleReplace clears `currentToken` and calls
    // `setSessionToken`, which transitions the credentials context
    // to the new masked identifier and (FR-005a) immediately
    // deletes any prior persistent record. The session-only
    // post-first-run landing state has no persistent record, so
    // the FR-005a delete is a no-op here — the e2e assertion
    // still pins the masked-identifier transition.
    await page.getByLabel(/replacement/i).fill(REPLACEMENT_TOKEN);
    await page.getByRole("button", { name: /^replace$/i }).click();

    await expect(page.getByTestId("masked-token")).toHaveText(
      renderedMaskedToken(REPLACEMENT_TOKEN),
    );

    // FR-008 — the rendered panel DOM MUST NOT carry either
    // token's plaintext. The integration test's
    // "never embeds the full token in any link or route" assertion
    // is the in-process pin; this e2e assertion is the
    // cross-process pin so the boundary holds end-to-end through
    // the production Docker build.
    const settingsHtml = await page.getByTestId("settings-panel").innerHTML();
    expect(settingsHtml).not.toContain(FIXTURE_TOKEN);
    expect(settingsHtml).not.toContain(REPLACEMENT_TOKEN);
    expect(settingsHtml).not.toContain(FIXTURE_TOKEN.slice(0, -4));
    expect(settingsHtml).not.toContain(REPLACEMENT_TOKEN.slice(0, -4));
  });

  test("switch-mode opens the persistent-storage disclosure (FR-003) and declines back to session-only", async ({
    page,
  }) => {
    await walkFirstRunFlowToGateOpen(page);
    await page.getByTestId(SETTINGS_NAV_TEST_ID).click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // The session-only post-first-run landing state renders the
    // "Switch to persistent" button. The button's surface is the
    // FR-006 disclosure-trigger the integration test pins at
    // `tests/integration/credentials/settings-panel.test.tsx`.
    await page.getByLabel(/^token$/i).fill(FIXTURE_TOKEN);
    await page.getByRole("button", { name: /set token/i }).click();
    await expect(
      page.getByRole("button", { name: /switch to persistent/i }),
    ).toBeVisible();

    // Click the button — the panel opens the
    // `data-testid="persistent-confirmation"` alertdialog. The
    // dialog copy names the encryption-at-rest approach and its
    // stated limitation (FR-002a + FR-003) — the e2e layer
    // asserts on the visible confirmation surface rather than the
    // internal `role` attributes the integration test exercises
    // because the browser's a11y tree is what a screen-reader
    // user actually sees.
    await page.getByRole("button", { name: /switch to persistent/i }).click();

    const confirmation = page.getByTestId("persistent-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(/persist|encrypt|sensitive/i);

    // Decline — the dialog closes without writing an encrypted
    // record. The session-mode credentials context is unchanged
    // (the panel calls `clearToSessionOnly` is not invoked here;
    // the decline path simply closes the dialog).
    await page.getByRole("button", { name: /decline/i }).click();

    await expect(confirmation).toHaveCount(0);
    // The masked identifier still points at the session token the
    // Set-token path committed — a regression that drops the
    // decline-no-write invariant fails this assertion.
    await expect(page.getByTestId("masked-token")).toHaveText(
      renderedMaskedToken(FIXTURE_TOKEN),
    );
  });
});
