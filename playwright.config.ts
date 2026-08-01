import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the end-to-end test layer (T009 / BSOD-137,
 * extended with the BSOD-349 failure-artifact wiring).
 *
 * The configuration is intentionally minimal so the test layer stays
 * close to the documented user flows (Constitution Principle III — "the
 * tests must not drift from the documented user behaviour"):
 *
 * - `testDir: ./tests/e2e` — the e2e layer only; nothing else runs.
 * - `baseURL: http://localhost:8080/` — matches the CI job (`test-e2e`)
 *   that loads the production Docker container built by `docker-build`
 *   and publishes it on host port 8080. For local development, the
 *   developer can override with `PLAYWRIGHT_BASE_URL` (the
 *   `process.env.PLAYWRIGHT_BASE_URL` lookup below) or by running the
 *   same container with `docker run --publish 8080:8080 team-dash`.
 * - `screenshot: "only-on-failure"` + `trace: "retain-on-failure"` —
 *   the BSOD-349 failure-artifact contract: a failing test leaves a
 *   Playwright HTML report, screenshot, and trace on disk, which the
 *   CI workflow uploads via `actions/upload-artifact` so a regression
 *   can be diagnosed without re-running the suite locally.
 *
 * What this configuration deliberately does not own
 * --------------------------------------------------
 * - A `webServer` block — the CI workflow starts the production Docker
 *   container separately (`docker run --detach --publish 8080:8080 …`)
 *   so the test job can run in parallel with the build, and adding a
 *   `webServer` here would race the container's boot. Local
 *   developers run the same container manually.
 * - The MSW dev worker — the production build the browser test loads
 *   has the MSW worker stripped by `src/mocks/browser.ts`'s
 *   `import.meta.env.PROD` guard (Constitution Principle IV). The
 *   Asana API is mocked at the test's network layer via Playwright's
 *   `page.route()` instead, so the same fixture data drives both the
 *   e2e layer and the Vitest contract / integration tests without
 *   coupling the test to the dev-only worker wiring.
 * - A multi-browser matrix — the BSOD-137 baseline was Chromium-only;
 *   subsequent US2–US15 e2e slices can register a broader matrix
 *   when the Constitution Principle VII browser-matrix task lands.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  reporter: [["html"], ["list"], ["github"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080/",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
