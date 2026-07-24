/**
 * T030 — canonical MSW Node server wiring.
 *
 * Purpose
 * -------
 * This module exposes the single MSW Node server instance that the
 * small-dataset Asana fixture handlers (T029, `fixtures/asana/small-dataset/`)
 * are bound to at module-evaluation time. It exists so every consumer
 * of the deterministic Asana API surface — Vitest contract and
 * integration tests (`tests/contract/*`, `tests/integration/*`), a
 * one-off Node REPL session during manual debugging, or a future
 * Playwright-style harness driving the production build — boots the
 * Asana API with a single import and a single `startServer()` call.
 *
 * Why a single canonical instance
 * --------------------------------
 * - **`onUnhandledRequest: "error"` is the canonical policy.** The
 *   fixture's contract is "every Asana call goes through one of these
 *   handlers or the test is wrong"; encoding that policy once at the
 *   wiring boundary prevents per-test drift and means a forgotten
 *   `server.use(...)` fails loudly rather than silently reaching the
 *   real network (`tests/setup.ts` uses the same policy for the same
 *   reason; this module is the place that policy is named and
 *   documented).
 * - **The handler list is captured at module-evaluation time**, not on
 *   every `startServer()` call. A consumer can `server.use(...)` a
 *   per-test override and rely on `resetServer()` returning the
 *   canonical fixture handlers as the next-request baseline. The
 *   contract test suite (`asana-client.readonly.test.ts`,
 *   `asana-fixtures.test.ts`) depends on this exact behaviour so a
 *   regression that re-creates the server on each start (and so wipes
 *   the `use(...)` overrides) fails immediately.
 * - **The token never leaves the per-call boundary.** The fixture
 *   handlers themselves reject calls that lack an `Authorization:
 *   Bearer` header (`fixtures/asana/small-dataset/handlers.ts`); this
 *   module never imports `src/data/asana/client.ts`, never sees a
 *   real Asana PAT, and never logs a request URL. The Principle IV
 *   "token never appears in URLs/logs/error reports" rule is
 *   preserved by construction.
 *
 * Boundary
 * --------
 * `src/mocks/**` is a top-level wiring module outside the
 * `src/{app,features,domain,data,shared}` boundary groups declared in
 * `eslint.config.js`; no boundary rule restricts what it may import.
 * The only deliberate discipline is that this module imports the
 * *fixture handlers* (a test artefact) and MSW itself, and never the
 * real `src/data/asana/client.ts` — keeping the mock server free of
 * any code path that could touch a live Asana endpoint.
 *
 * Tests
 * -----
 * The smoke test `tests/unit/mocks/server.test.ts` (this task's TDD
 * gate) exercises the three promises above: the server exposes the
 * expected lifecycle methods, an Asana endpoint round-trips through
 * the fixture handlers without a per-test `server.use(...)`, and
 * `resetServer()` restores the canonical baseline after a per-test
 * override.
 */

import { setupServer } from "msw/node";

import { asanaHandlers } from "../../fixtures/asana/small-dataset/handlers";

/**
 * The canonical MSW Node server pre-loaded with the small-dataset
 * fixture handlers. Module-level so the handler list is captured
 * exactly once at evaluation time (see "Why a single canonical
 * instance" above).
 */
export const server = setupServer(...asanaHandlers);

/**
 * Start request interception with the canonical policy
 * `{ onUnhandledRequest: "error" }`. Mirrors `tests/setup.ts`'s setup
 * hook so a consumer never has to spell the policy inline.
 */
export function startServer(): void {
  server.listen({ onUnhandledRequest: "error" });
}

/**
 * Reset the request handler list back to the canonical
 * `asanaHandlers`. A consumer that `server.use(...)`ed a per-test
 * override can call this to restore the fixture baseline for the next
 * request without re-importing the handlers.
 */
export function resetServer(): void {
  server.resetHandlers(...asanaHandlers);
}

/**
 * Stop request interception and restore the underlying `fetch` /
 * `XMLHttpRequest` implementations. Call in `afterAll` of any test
 * suite that called `startServer()` to avoid leaking interceptors
 * into a later suite.
 */
export function stopServer(): void {
  server.close();
}
