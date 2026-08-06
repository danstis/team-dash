import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the end-to-end test layer (T009 / BSOD-137,
 * extended with the BSOD-349 failure-artifact wiring, then again with the
 * T05 offline-reload webServer block).
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
 *   When the env var is unset, `baseURL` falls back to port 4173
 *   (`vite preview`'s default) so the local `webServer` fallback
 *   resolves the Team Dash preview without racing whatever else
 *   happens to be listening on 8080 — a real risk on developer
 *   workstations; the original 8080 default clashed with a
 *   CubeCoders AMP instance during T05 local bring-up.
 * - `screenshot: "only-on-failure"` + `trace: "retain-on-failure"` —
 *   the BSOD-349 failure-artifact contract: a failing test leaves a
 *   Playwright HTML report, screenshot, and trace on disk, which the
 *   CI workflow uploads via `actions/upload-artifact` so a regression
 *   can be diagnosed without re-running the suite locally.
 *
 * What this configuration deliberately does not own
 * --------------------------------------------------
 * - A `webServer` block for the production Docker container — the CI
 *   workflow starts the container separately (`docker run --detach
 *   --publish 8080:8080 …`) so the test job can run in parallel with
 *   the build. T05 added a *local-only* `webServer` fallback (see
 *   below) that spins up `vite preview` so the new offline-reload
 *   spec is runnable via `npm run test:e2e` without requiring the
 *   developer to manually start a container first.
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
 *
 * ## T05 webServer fallback (local-only)
 *
 * The CI `test-e2e` job publishes the production Docker container on
 * port 8080 *before* the test job starts, so on CI the tests resolve
 * `baseURL` against an already-running container and the `webServer`
 * block is intentionally absent. Local development has historically
 * required the developer to start the same container manually before
 * `npm run test:e2e` could resolve any URL — a friction point that
 * the offline-reload spec amplifies (the new spec needs a live HTTP
 * server to register a service worker against, which `file://` does
 * not provide).
 *
 * The `webServer` block below therefore activates **only when
 * `PLAYWRIGHT_BASE_URL` is unset**:
 *
 * - **CI**: `PLAYWRIGHT_BASE_URL=http://localhost:8080/` is set by
 *   the workflow; the Docker container serves the build; `webServer`
 *   is not started (the `process.env.PLAYWRIGHT_BASE_URL` guard
 *   short-circuits it).
 * - **Local dev**: the env var is unset; Playwright auto-starts
 *   `npm run preview -- --port 4173 --strictPort` against the
 *   already-built `dist/` directory, waits for the server to
 *   respond, runs the suite, then tears the preview process down.
 *   `reuseExistingServer: true` lets a developer who has already
 *   started their own `npm run preview` reuse it without a port
 *   conflict.
 *
 * `--strictPort` makes `vite preview` exit non-zero if port 4173 is
 * already in use rather than silently picking 4174 — combined with
 * `reuseExistingServer`, this means "the developer's existing
 * server is reused if it's the same port, otherwise the test fails
 * with a port-in-use error rather than racing against the wrong
 * instance". Port 4173 is `vite preview`'s default; T05 picked it
 * over 8080 to avoid colliding with whatever else listens on 8080
 * on developer workstations (the original 8080 choice clashed with
 * a CubeCoders AMP instance during T05's local bring-up).
 */
const LOCAL_PREVIEW_PORT = 4173;
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${LOCAL_PREVIEW_PORT}/`;
const useLocalWebServer = process.env.PLAYWRIGHT_BASE_URL === undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: [["html"], ["list"], ["github"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: useLocalWebServer
    ? {
        command: `npm run preview -- --port ${LOCAL_PREVIEW_PORT} --strictPort`,
        url: `http://localhost:${LOCAL_PREVIEW_PORT}/`,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});
