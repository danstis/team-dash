/**
 * T025 — base Asana HTTP client contract tests (Red phase, written before
 * `src/data/asana/client.ts` lands).
 *
 * These tests are the Red half of T025's Red/Green/Refactor (Constitution
 * Principle III). They MUST fail before `src/data/asana/client.ts` exists
 * (the import resolves to nothing) and MUST pass once the base client
 * implements the contract in `specs/001-asana-team-dashboard/contracts/asana-client.md`.
 *
 * What this file asserts (verbatim from `contracts/asana-client.md` § "Client
 * function contract" and § "URL/log safety"):
 *
 * 1. **Per-call token parameter** — the token is passed as a function argument
 *    on every call; a request made with one token MUST send `Authorization:
 *    Bearer <that-token>` and MUST NOT echo the token through any other
 *    channel (no query parameter, no body, no error message). The contract
 *    § "Token handling" makes this the structural reason the client cannot
 *    itself become a place where a token outlives a single request.
 *
 * 2. **`Authorization: Bearer` header only** — `Authorization` is the only
 *    header carrying the credential. The token MUST NOT appear in the URL,
 *    in the request body, in the response body that survives a failure
 *    surface, in `network_error.message`, or in `validation_error.issues`.
 *    (FR-008 / FR-010.)
 *
 * 3. **Zod validation boundary before returning `ok`** — a successful
 *    (`HTTP 200`) response is parsed through the resource's Zod schema
 *    before being returned as `outcome: 'ok'`. A schema mismatch returns
 *    `outcome: 'validation_error'` with the structured `ZodIssue[]` array
 *    (FR-081 / FR-082 / FR-083) so the refresh orchestrator can route the
 *    issue into `DataQualityFlag`s without throwing or silently coercing.
 *
 * 4. **`429` → `rate_limited` with parsed `Retry-After`** — the contract
 *    delegates retry/backoff to the orchestrator, so the client only
 *    parses the header. `Retry-After` in seconds is mapped to milliseconds;
 *    HTTP-date form is parsed relative to the response date and surfaced
 *    as a positive millisecond delay. The client performs no automatic
 *    retry — verified by asserting the client returns immediately with
 *    `outcome: 'rate_limited'` on a single 429.
 *
 * 5. **Offset pagination passthrough** — `?offset=...` on a list request
 *    reaches the server verbatim, and the response's `next_page.offset`
 *    is exposed on the `ok.data` variant so the refresh orchestrator can
 *    loop until exhaustion without the client itself doing so (the
 *    client is stateless per call, per the contract § "Pagination").
 *
 * 6. **Never throws for expected failure modes** — `auth_failure`,
 *    `permission_failure`, `network_error` are all returned through the
 *    `AsanaClientResult` union rather than thrown, so the refresh
 *    orchestrator can switch on `outcome` without ad-hoc try/catch
 *    branching scattered through call sites.
 *
 * Read-only is asserted separately in `tests/contract/asana-client.readonly.test.ts`
 * (T026). Network failure and token scrubbing share a test because both
 * verify FR-008/FR-010 ("token MUST NOT appear in URLs, logs, error
 * reports") — any future regression that surfaces the token in an error
 * path fails this file, not just the read-only assertion.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  asanaUserSchema,
  asanaWorkspaceListResponseSchema,
} from "../../src/data/asana/schemas";
import { server } from "../setup";

/**
 * The base client import under test. The path is the contract's named
 * `src/data/asana/client.ts` (T025). The import will fail to resolve
 * until that module exists, which is the Red-phase signal that the test
 * is correctly placed before implementation.
 */
import { asanaGet } from "../../src/data/asana/client";

/**
 * Local fixtures that are valid against the contract's named schemas.
 * Kept inline (rather than shared with the schemas test) so a reader can
 * read this file top-to-bottom without cross-file grep.
 */
const sampleWorkspace = {
  gid: "1200000000000001",
  name: "Engineering",
  resource_type: "workspace" as const,
  is_organization: false,
};

const sampleUser = {
  gid: "1200000000000002",
  name: "Alex Kim",
  email: "alex@example.com",
  resource_type: "user" as const,
};

/**
 * A simple echo schema used to exercise the validation boundary without
 * pulling in every Asana resource shape. The schema accepts exactly the
 * payload below; anything else fails with a structured `ZodIssue`.
 */
const pingSchema = z.object({ ok: z.literal(true) });
const pingPayload = { ok: true };

describe("T025 base Asana HTTP client (contracts/asana-client.md)", () => {
  describe("per-call token parameter and Bearer header", () => {
    it("sends `Authorization: Bearer <token>` on every call and uses the token passed to that call", async () => {
      let observedAuthorization: string | null = null;
      let observedUrl: string | null = null;

      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          ({ request, request: { url } }) => {
            observedAuthorization = request.headers.get("Authorization");
            observedUrl = url.toString();
            // Asana's `/users/me` returns the user resource directly (not
            // wrapped in a `{ data }` envelope), so the schema under test
            // (`asanaUserSchema`) parses the body verbatim.
            return HttpResponse.json(sampleUser);
          },
        ),
      );

      const token = "personal-access-token-1";
      const result = await asanaGet("/users/me", asanaUserSchema, token);

      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(observedAuthorization).toBe(`Bearer ${token}`);
      // The token MUST NOT appear in the URL — only the Authorization header.
      expect(observedUrl).not.toContain(token);
      // The parsed data is the resource body, untouched by the auth header.
      expect(result.data.gid).toBe(sampleUser.gid);
    });

    it("does not retain the token across calls — a different token produces a different Authorization header", async () => {
      const observations: Array<{ token: string; header: string | null }> = [];

      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", ({ request }) => {
          // Capture every request's Authorization header alongside the
          // expected token from the caller's perspective. The server
          // doesn't know which token to expect — that's the client's
          // job — so we record the header verbatim and assert below.
          observations.push({
            token: "set-by-test",
            header: request.headers.get("Authorization"),
          });
          return HttpResponse.json(sampleUser);
        }),
      );

      await asanaGet("/users/me", asanaUserSchema, "token-alpha");
      await asanaGet("/users/me", asanaUserSchema, "token-beta");

      expect(observations).toHaveLength(2);
      expect(observations[0]?.header).toBe("Bearer token-alpha");
      expect(observations[1]?.header).toBe("Bearer token-beta");
    });

    it("never places the token in the URL query string", async () => {
      let observedUrl = "";

      server.use(
        http.get(
          "https://app.asana.com/api/1.0/workspaces",
          ({ request: { url } }) => {
            observedUrl = url.toString();
            return HttpResponse.json({
              data: [sampleWorkspace],
              next_page: null,
            });
          },
        ),
      );

      await asanaGet(
        "/workspaces",
        asanaWorkspaceListResponseSchema,
        "super-secret-token",
      );

      expect(observedUrl).not.toContain("super-secret-token");
      expect(observedUrl).not.toContain("token=");
      expect(observedUrl).not.toContain("Authorization=");
    });
  });

  describe("Zod validation boundary before returning `ok`", () => {
    it("returns `ok` with the Zod-parsed data when the response validates", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/workspaces", () =>
          HttpResponse.json({ data: [sampleWorkspace], next_page: null }),
        ),
      );

      const result = await asanaGet(
        "/workspaces",
        asanaWorkspaceListResponseSchema,
        "token",
      );

      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      // The contract guarantees the parsed shape — `data` and `next_page`
      // exactly — so the cache can rely on the discriminated union.
      expect(result.data.data).toHaveLength(1);
      expect(result.data.data[0]?.gid).toBe(sampleWorkspace.gid);
      expect(result.data.next_page).toBeNull();
    });

    it("returns `validation_error` with structured ZodIssue[] when the response fails schema validation", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/workspaces", () =>
          // `archived` is missing — would be valid for a workspace but the
          // schema requires it via asanaWorkspaceListResponseSchema's item.
          // Easier: send a workspace missing `name` to trigger a Zod issue.
          HttpResponse.json({ data: [{ gid: "1" }], next_page: null }),
        ),
      );

      const result = await asanaGet(
        "/workspaces",
        asanaWorkspaceListResponseSchema,
        "token",
      );

      expect(result.outcome).toBe("validation_error");
      if (result.outcome !== "validation_error") return;
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      // Each issue MUST carry a code/path/message — that's what FR-084
      // routes into `DataQualityFlag`s.
      for (const issue of result.issues) {
        expect(typeof issue.code).toBe("string");
        expect(Array.isArray(issue.path)).toBe(true);
        expect(typeof issue.message).toBe("string");
      }
    });

    it("uses the schema passed at the call site (different schemas validate different endpoints independently)", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/ping", () =>
          HttpResponse.json(pingPayload),
        ),
      );

      const pingResult = await asanaGet("/ping", pingSchema, "token");
      expect(pingResult.outcome).toBe("ok");
      if (pingResult.outcome !== "ok") return;
      expect(pingResult.data).toEqual(pingPayload);
    });
  });

  describe("HTTP failure modes map to outcome variants (never throw)", () => {
    it("returns `auth_failure` on 401 and does not include the token in any payload", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 401 }),
        ),
      );

      const result = await asanaGet(
        "/users/me",
        asanaUserSchema,
        "must-not-leak",
      );

      expect(result.outcome).toBe("auth_failure");
      if (result.outcome === "auth_failure") {
        // The variant carries no payload per `src/data/asana/types.ts` —
        // confirms the contract that a 401 body cannot echo the token.
        expect(Object.keys(result)).toEqual(["outcome"]);
      }
    });

    it("returns `permission_failure` on 403", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse(null, { status: 403 }),
        ),
      );

      const result = await asanaGet("/users/me", asanaUserSchema, "token");

      expect(result.outcome).toBe("permission_failure");
    });

    it("returns `rate_limited` with retryAfterMs parsed from `Retry-After` (seconds form)", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () =>
            new HttpResponse(null, {
              status: 429,
              headers: { "Retry-After": "30" },
            }),
        ),
      );

      const result = await asanaGet("/users/me", asanaUserSchema, "token");

      expect(result.outcome).toBe("rate_limited");
      if (result.outcome !== "rate_limited") return;
      expect(result.retryAfterMs).toBe(30_000);
    });

    it("returns `rate_limited` with retryAfterMs parsed from `Retry-After` (HTTP-date form)", async () => {
      const futureDate = new Date(Date.now() + 5_000).toUTCString();
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () =>
            new HttpResponse(null, {
              status: 429,
              headers: { "Retry-After": futureDate },
            }),
        ),
      );

      const result = await asanaGet("/users/me", asanaUserSchema, "token");

      expect(result.outcome).toBe("rate_limited");
      if (result.outcome !== "rate_limited") return;
      // The parsed delay should be positive and not absurdly large.
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThan(60_000);
    });

    it("returns `network_error` with a non-token message on a transport failure", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/users/me", () =>
          HttpResponse.error(),
        ),
      );

      const result = await asanaGet(
        "/users/me",
        asanaUserSchema,
        "do-not-leak-me",
      );

      expect(result.outcome).toBe("network_error");
      if (result.outcome !== "network_error") return;
      // FR-008 / FR-010: token MUST NOT appear in the surfaced message.
      expect(result.message).not.toContain("do-not-leak-me");
    });

    it("returns `network_error` when the response body is not valid JSON", async () => {
      server.use(
        http.get(
          "https://app.asana.com/api/1.0/users/me",
          () => new HttpResponse("<html>not json</html>", { status: 200 }),
        ),
      );

      const result = await asanaGet("/users/me", asanaUserSchema, "token");

      expect(result.outcome).toBe("network_error");
      if (result.outcome !== "network_error") return;
      expect(result.message).not.toContain("token");
    });
  });

  describe("offset pagination passthrough", () => {
    it("forwards the `offset` query parameter verbatim to the server", async () => {
      let observedOffset: string | null = null;

      server.use(
        http.get(
          "https://app.asana.com/api/1.0/projects/123/tasks",
          ({ request }) => {
            observedOffset = new URL(request.url).searchParams.get("offset");
            return HttpResponse.json({ data: [], next_page: null });
          },
        ),
      );

      await asanaGet(
        "/projects/123/tasks",
        z.object({
          data: z.array(z.unknown()),
          next_page: z.unknown().nullable(),
        }),
        "token",
        { offset: "eyJsYXN0X2dpZCI6ICIxMjM0In0=" },
      );

      expect(observedOffset).toBe("eyJsYXN0X2dpZCI6ICIxMjM0In0=");
    });

    it("returns the next_page token on the ok variant so the orchestrator can loop until exhaustion", async () => {
      server.use(
        http.get("https://app.asana.com/api/1.0/projects/123/tasks", () =>
          HttpResponse.json({
            data: [],
            next_page: {
              offset: "next-page-offset-token",
              path: "/projects/123/tasks",
            },
          }),
        ),
      );

      const result = await asanaGet(
        "/projects/123/tasks",
        z.object({
          data: z.array(z.unknown()),
          next_page: z.unknown().nullable(),
        }),
        "token",
      );

      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.next_page).toEqual({
        offset: "next-page-offset-token",
        path: "/projects/123/tasks",
      });
    });

    it("does not loop internally — the client returns after one request even when next_page is set", async () => {
      let callCount = 0;
      server.use(
        http.get("https://app.asana.com/api/1.0/projects/123/tasks", () => {
          callCount += 1;
          return HttpResponse.json({
            data: [],
            next_page: {
              offset: `offset-${callCount}`,
              path: "/projects/123/tasks",
            },
          });
        }),
      );

      const result = await asanaGet(
        "/projects/123/tasks",
        z.object({
          data: z.array(z.unknown()),
          next_page: z.unknown().nullable(),
        }),
        "token",
      );

      expect(callCount).toBe(1);
      expect(result.outcome).toBe("ok");
      if (result.outcome !== "ok") return;
      expect(result.data.next_page).toEqual({
        offset: "offset-1",
        path: "/projects/123/tasks",
      });
    });
  });
});
