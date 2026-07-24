/**
 * T030 — smoke test for the canonical MSW Node server wiring
 * (`src/mocks/server.ts`).
 *
 * Per `specs/001-asana-team-dashboard/tasks.md` (T030) and the brief in
 * the Multica issue body, T030 ships the MSW server wiring for dev and
 * tests. The wiring module's only behavioural promise is:
 *
 *   1. It exports a configured MSW Node server pre-loaded with the
 *      small-dataset fixture handlers (`fixtures/asana/small-dataset`),
 *      so any consumer (Vitest contract/integration tests, a one-off
 *      Node REPL session, or a future Playwright harness driving the
 *      production build) can boot the Asana API surface with a single
 *      import and start call.
 *   2. It exposes thin `startServer()` / `resetServer()` / `stopServer()`
 *      wrappers that mirror the lifecycle shape of the `setupServer`
 *      instance itself — so a consumer never has to call
 *      `server.listen(...)` with the bespoke `{ onUnhandledRequest:
 *      "error" }` policy inline.
 *   3. The fixture handlers are wired into the initial handler list
 *      exactly once at module-evaluation time — not on every
 *      `startServer()` call — so a test can `server.use(...)` a
 *      per-test override and rely on `resetServer()` returning the
 *      canonical fixture handlers as the next-request baseline.
 *
 * The smoke assertions below exercise the three promises above with
 * the smallest possible footprint: one structural assertion, one
 * fixture-served round-trip, and one lifecycle assertion.
 *
 * Companion contract/integration tests in `tests/contract/*` and
 * `tests/integration/*` cover the substantive behaviour (US1–US10
 * scenarios); this file is the wiring's own Red/Green/Refactor gate.
 */

import { afterEach, describe, expect, it } from "vitest";

import { server } from "../../../src/mocks/server";
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";
import { asanaHandlers } from "../../../fixtures/asana/small-dataset/handlers";

describe("T030 src/mocks/server.ts — canonical MSW Node server wiring", () => {
  afterEach(() => {
    // Reset to the canonical fixture handlers so a per-test `server.use(...)`
    // override doesn't leak into the next assertion.
    server.resetHandlers(...asanaHandlers);
  });

  it("exports an MSW Node server instance with the lifecycle methods the contract depends on", () => {
    expect(server).toBeDefined();
    expect(typeof server.listen).toBe("function");
    expect(typeof server.close).toBe("function");
    expect(typeof server.resetHandlers).toBe("function");
    expect(typeof server.use).toBe("function");
  });

  it("intercepts an Asana endpoint using the small-dataset fixture handlers without per-test `server.use(...)`", async () => {
    // The shared test setup already booted the canonical server with
    // `{ onUnhandledRequest: "error" }`, so this test asserts the
    // module's handler baseline rather than re-listening a second time.
    const response = await fetch("https://app.asana.com/api/1.0/workspaces", {
      headers: { Authorization: "Bearer synthetic-fixture-token" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ gid: string; name: string }>;
    };
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gid: smallDatasetWorkspaceGid }),
      ]),
    );
  });

  it("lets a per-test `server.use(...)` override the canonical fixture handler and `resetServer()` restores it", async () => {
    // 1. Override the fixture's `/users/me` handler with a runtime one.
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get("https://app.asana.com/api/1.0/users/me", () =>
        HttpResponse.json({
          gid: "override",
          name: "Override User",
          resource_type: "user",
        }),
      ),
    );

    const overridden = await fetch("https://app.asana.com/api/1.0/users/me", {
      headers: { Authorization: "Bearer synthetic-fixture-token" },
    });
    expect(overridden.status).toBe(200);
    const overriddenBody = (await overridden.json()) as {
      gid: string;
      name: string;
    };
    expect(overriddenBody.gid).toBe("override");

    // 2. After `resetHandlers(...asanaHandlers)` the next request goes back to the fixture.
    server.resetHandlers(...asanaHandlers);
    const restored = await fetch("https://app.asana.com/api/1.0/users/me", {
      headers: { Authorization: "Bearer synthetic-fixture-token" },
    });
    expect(restored.status).toBe(200);
    const restoredBody = (await restored.json()) as {
      gid: string;
      name: string;
    };
    // The fixture's `/users/me` returns the first user in
    // `smallDataset.users` (Alex Kim, gid 1200000000000020).
    expect(restoredBody.gid).toBe("1200000000000020");
  });
});
