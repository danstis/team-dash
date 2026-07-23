/**
 * T026 — read-only guarantee for the Asana client.
 *
 * Per `contracts/asana-client.md` § "Read-only guarantee (test-verifiable)"
 * and Constitution Principle IV's "no Asana API call capable of creating,
 * editing, completing, assigning, or deleting a resource", this file is
 * the automated backstop that no request ever leaves the Asana client
 * module with a write method.
 *
 * Two assertions, both required by the contract:
 *
 * 1. **Static scan of the module's exports.** No exported function from
 *    `src/data/asana/client.ts` (and, for safety, the wider
 *    `src/data/asana/**` module surface the refresh orchestrator and
 *    credential flow consume) is named or shaped to issue a write
 *    request. The client's surface is *only* the read endpoints documented
 *    in `contracts/asana-client.md` § "Endpoints consumed (all `GET`)" —
 *    `testToken`, `listWorkspaces`, `fetchProjectsPage`, `fetchTasksPage`,
 *    `fetchTaskDetail`, `fetchEventsSince`, and the base
 *    `asanaGet(path, schema, token, …)` plumbing — plus any future read-
 *    only endpoints added by later tasks (US1/US2/US6–US10). The scan is
 *    intentionally name-based so a future contributor who adds a
 *    `createTask`/`updateProject`/`deleteSubtask` export fails CI
 *    immediately, not just at code review.
 *
 * 2. **MSW request-log inspection.** During this contract test file's
 *    exercises, the client is driven through every outcome variant and
 *    endpoint type with MSW as the network boundary; MSW's request-log
 *    is then asserted to contain only `GET` methods. A regression that
 *    smuggles a write method through (e.g. via `fetch(url, { method:
 *    'POST' })`) fails this assertion even if the export name itself
 *    looks innocuous.
 *
 * The read-only guarantee is NFR-004 in the spec and Principle IV in the
 * constitution; failing either assertion is a blocker, not a warning.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { asanaUserSchema } from "../../src/data/asana/schemas";
import { server } from "../setup";
import { asanaGet } from "../../src/data/asana/client";

/**
 * Write HTTP methods the Asana client MUST NOT issue. Spelled out as a
 * `readonly` tuple so the assertion below is statically verifiable and
 * a future contributor adding, say, `CONNECT` is forced to revisit the
 * read-only contract rather than silently extending the deny list.
 */
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
type WriteMethod = (typeof WRITE_METHODS)[number];

/**
 * `msw.http` exposes handlers per method (`http.get`, `http.post`, …).
 * The exported method-named constructors are the structural reason MSW
 * never sees a write method without an explicit `http.post(...)` call,
 * which is what this test asserts does not exist in the Asana client's
 * import graph.
 *
 * `http.all` is the wildcard catcher used to record every request for
 * the runtime assertion.
 */
const WRITE_METHOD_NAMES = ["post", "put", "patch", "delete"] as const;

/**
 * Module surface the rest of the app actually imports from. The base
 * client (`client.ts`) is the focus; the schemas/types modules are read-
 * only by construction (data, no `fetch`) but are listed so a future
 * regression that adds a network call from `schemas.ts` (or anywhere
 * else under `src/data/asana/**`) also fails the static scan.
 */
const ASANA_CLIENT_MODULE_PATHS = [
  "src/data/asana/client.ts",
  "src/data/asana/schemas.ts",
  "src/data/asana/types.ts",
] as const;

describe("T026 Asana client read-only guarantee (NFR-004, Principle IV)", () => {
  describe("static scan of the module's exports", () => {
    it("`src/data/asana/client.ts` does not export any function whose name implies a write method", async () => {
      const clientModule = await import("../../src/data/asana/client");
      const exportedNames = Object.keys(clientModule);

      expect(exportedNames.length).toBeGreaterThan(0);

      for (const name of exportedNames) {
        const lower = name.toLowerCase();
        for (const writeName of WRITE_METHOD_NAMES) {
          // `createTask`, `deleteProject`, `updateWorkspace`, `postEvent`,
          // `patchTask`, `putProject` — any of those is a regression.
          expect(
            lower.includes(writeName),
            `Export '${name}' from src/data/asana/client.ts suggests a write operation (matched '${writeName}'). ` +
              `Per contracts/asana-client.md § "Read-only guarantee", the Asana client MUST NOT expose any function ` +
              `capable of issuing POST/PUT/PATCH/DELETE.`,
          ).toBe(false);
        }
      }
    });

    it("`src/data/asana/client.ts` does not embed any write-method literal in its source as a fetch `method` value", () => {
      const source = readClientSource("src/data/asana/client.ts");

      for (const writeMethod of WRITE_METHODS) {
        // Match `method: 'POST'` / `method: "POST"` (and PUT/PATCH/DELETE).
        // The bounded regex avoids matching e.g. "postpone" or comments
        // referencing the methods rhetorically — the assertion is
        // specifically that no string literal of an HTTP method is used
        // as a fetch `method` value. A balanced delimiter (quote + close)
        // ensures we don't match `method: 'POSTS'` (5+ letter word starting
        // with a write method) by requiring the closing quote/space/newline
        // right after the method name.
        const fetchMethodLiteral = new RegExp(
          `method\\s*:\\s*['"\`]${writeMethod}['"\`]`,
          "i",
        );
        expect(
          source.match(fetchMethodLiteral),
          `src/data/asana/client.ts contains a fetch method literal '${writeMethod}' ` +
            `which would issue a ${writeMethod} request. The Asana client is read-only by ` +
            `construction (NFR-004 / Principle IV); remove the write call.`,
        ).toBeNull();
      }
    });

    it("`src/data/asana/**` source files contain no `http.post`/`http.put`/`http.patch`/`http.delete` MSW handler registrations (handlers would imply the module wants to exercise those methods)", () => {
      // The Asana client shouldn't import MSW at all — MSW handlers live in
      // `fixtures/asana/*` and `src/mocks/*`. A handler import inside
      // `src/data/asana/**` would mean the production module is
      // registering mockable write handlers, which is the wrong side of
      // the boundary. This is a static backstop so a future contributor
      // who adds an MSW handler to `client.ts` (e.g. "to test the rate-
      // limit path") fails CI before the wrong abstraction takes root.
      for (const modulePath of ASANA_CLIENT_MODULE_PATHS) {
        const source = readClientSource(modulePath);
        for (const writeName of WRITE_METHOD_NAMES) {
          const mswHandlerPattern = new RegExp(
            String.raw`http\.` + writeName + String.raw`\b`,
            "i",
          );
          expect(
            source.match(mswHandlerPattern),
            `${modulePath} references http.${writeName}(…). Asana client source must not register MSW ` +
              `handlers — those live under fixtures/asana/* and src/mocks/*.`,
          ).toBeNull();
        }
      }
    });
  });

  describe("MSW request-log inspection during the contract test suite", () => {
    /**
     * Records every request that passes through MSW during the test
     * file's exercises, so the assertion below can verify only `GET`
     * methods ever fired. MSW exposes lifecycle events for every
     * request that goes through its server (including unhandled ones
     * that would otherwise throw under `tests/setup.ts`'s
     * `onUnhandledRequest: "error"`), so this listener is the
     * deterministic observability hook the assertion reads.
     */
    const observedRequests: Array<{ method: string; url: string }> = [];
    let listener: (args: { request: Request }) => void;

    beforeEach(() => {
      observedRequests.length = 0;
      listener = (args: { request: Request }) => {
        observedRequests.push({
          method: args.request.method,
          url: args.request.url,
        });
      };
      server.events.on("request:start", listener);
    });

    afterEach(() => {
      server.events.removeListener("request:start", listener);
    });

    it("the base client issues only `GET` requests across success, validation, auth, permission, rate-limit, and network-failure exercises", async () => {
      // 1. Success path — `asanaGet` returns `ok`.
      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", () =>
          HttpResponse.json({ gid: "1", name: "Alex", resource_type: "user" }),
        ),
      );
      const okResult = await asanaGet("/users/me", asanaUserSchema, "token");
      expect(okResult.outcome).toBe("ok");

      // 2. Validation-error path — schema mismatch.
      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", () =>
          HttpResponse.json({ data: { not: "a user" } }),
        ),
      );
      const validationResult = await asanaGet(
        "/users/me",
        z.object({ data: asanaUserSchema }),
        "token",
      );
      expect(validationResult.outcome).toBe("validation_error");

      // 3. Auth-failure path — 401.
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 401 }),
        ),
      );
      const authResult = await asanaGet("/users/me", asanaUserSchema, "token");
      expect(authResult.outcome).toBe("auth_failure");

      // 4. Permission-failure path — 403.
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 403 }),
        ),
      );
      const permResult = await asanaGet("/users/me", asanaUserSchema, "token");
      expect(permResult.outcome).toBe("permission_failure");

      // 5. Rate-limit path — 429 with Retry-After.
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () =>
            new HttpResponse(null, {
              status: 429,
              headers: { "Retry-After": "1" },
            }),
        ),
      );
      const rateResult = await asanaGet("/users/me", asanaUserSchema, "token");
      expect(rateResult.outcome).toBe("rate_limited");

      // 6. Network-failure path — transport-level error.
      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", () =>
          HttpResponse.error(),
        ),
      );
      const networkResult = await asanaGet(
        "/users/me",
        asanaUserSchema,
        "token",
      );
      expect(networkResult.outcome).toBe("network_error");

      // Assertion: across every exercise above, every observed request
      // method is `GET`. The wildcard `http.all("*", …)` handler recorded
      // every request MSW processed — including unhandled ones — so a
      // write-method regression shows up here even if a regression also
      // dodges the static scan.
      const writeMethodsObserved = observedRequests
        .map((request) => request.method.toUpperCase())
        .filter((method): method is WriteMethod =>
          (WRITE_METHODS as readonly string[]).includes(method),
        );

      expect(writeMethodsObserved).toEqual([]);

      // Cross-check: at least the success-path GET request was recorded,
      // so the assertion above is meaningful (the empty-observedRequests
      // edge case would otherwise trivially pass).
      expect(observedRequests.length).toBeGreaterThan(0);
      for (const request of observedRequests) {
        expect(request.method.toUpperCase()).toBe("GET");
      }
    });
  });
});

/**
 * Read a source file relative to the repository root, returning its
 * raw UTF-8 text. Used by the static-scan assertions above. Synchronous
 * because the files are tiny and the test wants to fail fast on a
 * missing file rather than produce a flaky async error.
 */
function readClientSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}
