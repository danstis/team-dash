/**
 * T024 — `AsanaClientResult<T>` outcome union unit tests (Red phase).
 *
 * Verifies the contract documented in
 * `specs/001-asana-team-dashboard/contracts/asana-client.md` (§ "Client
 * function contract"): every exported Asana client function MUST return
 * `AsanaClientResult<T>` and MUST model the read-only outcome shape with
 * the exact six outcomes (`ok`, `auth_failure`, `permission_failure`,
 * `rate_limited`, `network_error`, `validation_error`). The contract is
 * the single source of truth for how the refresh orchestrator (US2)
 * distinguishes a 401 from a 429 from a Zod failure without scattered
 * try/catch branches, so the union shape itself is behaviour and the test
 * below is the TDD gate that the implementation lands green on.
 *
 * The type-level assertions are compile-time checks: `tsc --noEmit` is the
 * real verification. Runtime assertions confirm the discriminant literal
 * union is closed, the type-guard accepts/rejects each variant
 * deterministically, and the helper exports stay in sync with the union
 * so a future contributor adding a seventh outcome without updating the
 * guard fails CI rather than silently widening the union.
 *
 * Per Constitution Principle III, these tests MUST fail before
 * `src/data/asana/types.ts` is implemented and pass after it lands.
 */
import { describe, expect, it } from "vitest";
import type { ZodIssue } from "zod";
import {
  type AsanaClientOk,
  type AsanaClientResult,
  type AsanaClientResultOutcome,
  ASANA_CLIENT_RESULT_OUTCOMES,
  isAsanaClientResult,
} from "../../../../src/data/asana/types";

/**
 * Local fixtures mirroring the contract's call-site examples — keeping
 * the data shapes here lets a reader understand the discriminated union
 * without grepping for client implementations that don't exist yet
 * (T039/T054 in `tasks.md`).
 */
const sampleZodIssue: ZodIssue = {
  code: "invalid_type",
  expected: "string",
  path: ["gid"],
  message: "Expected string, received number",
  input: 42,
} as unknown as ZodIssue;

const sampleData = { gid: "1200", name: "Sample workspace" };

describe("T024 AsanaClientResult<T> outcome union (contracts/asana-client.md)", () => {
  describe("ASANA_CLIENT_RESULT_OUTCOMES discriminant", () => {
    it("exposes exactly the six outcomes mandated by the contract", () => {
      expect(ASANA_CLIENT_RESULT_OUTCOMES).toEqual([
        "ok",
        "auth_failure",
        "permission_failure",
        "rate_limited",
        "network_error",
        "validation_error",
      ]);
    });

    it("AsanaClientResultOutcome is the closed 'ok' | 'auth_failure' | 'permission_failure' | 'rate_limited' | 'network_error' | 'validation_error' literal union", () => {
      const literals: AsanaClientResultOutcome[] = [
        "ok",
        "auth_failure",
        "permission_failure",
        "rate_limited",
        "network_error",
        "validation_error",
      ];
      expect(literals).toHaveLength(6);
    });
  });

  describe("variant shape — each outcome carries the contract-mandated payload", () => {
    it("'ok' carries the parsed, Zod-validated payload as `data`", () => {
      const result: AsanaClientResult<typeof sampleData> = {
        outcome: "ok",
        data: sampleData,
      };
      expect(result.outcome).toBe("ok");
      if (result.outcome === "ok") {
        expect(result.data).toBe(sampleData);
      }
    });

    it("AsanaClientOk<T> is the { outcome: 'ok'; data: T } variant only", () => {
      const ok: AsanaClientOk<typeof sampleData> = {
        outcome: "ok",
        data: sampleData,
      };
      expect(ok.outcome).toBe("ok");
      expect(ok.data).toEqual(sampleData);
    });

    it("'auth_failure' carries no payload (no token / no error message leak)", () => {
      const result: AsanaClientResult<unknown> = { outcome: "auth_failure" };
      expect(result.outcome).toBe("auth_failure");
      // The variant must NOT carry a `message` field — a 401 response body
      // can echo the token, and the contract explicitly forbids carrying
      // any such detail in the result (FR-008 / FR-010).
      expect("message" in result).toBe(false);
    });

    it("'permission_failure' accepts the optional `resource` hint", () => {
      const withResource: AsanaClientResult<unknown> = {
        outcome: "permission_failure",
        resource: "/projects/1234",
      };
      const withoutResource: AsanaClientResult<unknown> = {
        outcome: "permission_failure",
      };
      expect(withResource.outcome).toBe("permission_failure");
      expect(withResource).toMatchObject({ resource: "/projects/1234" });
      expect(withoutResource.outcome).toBe("permission_failure");
      // The variant is valid whether `resource` is absent or explicitly
      // undefined — the contract documents it as an optional hint, not a
      // required field.
      expect(
        withoutResource.outcome === "permission_failure" &&
          (withoutResource.resource === undefined ||
            !("resource" in withoutResource)),
      ).toBe(true);
    });

    it("'rate_limited' carries the parsed `retryAfterMs` (number, not a Date)", () => {
      const result: AsanaClientResult<unknown> = {
        outcome: "rate_limited",
        retryAfterMs: 60_000,
      };
      expect(result.outcome).toBe("rate_limited");
      if (result.outcome === "rate_limited") {
        expect(result.retryAfterMs).toBe(60_000);
        expect(typeof result.retryAfterMs).toBe("number");
      }
    });

    it("'network_error' carries a `message` string and never a `token` field (FR-008)", () => {
      const result: AsanaClientResult<unknown> = {
        outcome: "network_error",
        message: "fetch failed",
      };
      expect(result.outcome).toBe("network_error");
      if (result.outcome === "network_error") {
        expect(result.message).toBe("fetch failed");
      }
      expect("token" in result).toBe(false);
      expect("authorization" in result).toBe(false);
    });

    it("'validation_error' carries a ZodIssue[] so DataQualityFlag can be populated from it", () => {
      const result: AsanaClientResult<unknown> = {
        outcome: "validation_error",
        issues: [sampleZodIssue],
      };
      expect(result.outcome).toBe("validation_error");
      if (result.outcome === "validation_error") {
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0]).toBe(sampleZodIssue);
      }
    });
  });

  describe("URL/log safety contract (FR-008 / FR-010)", () => {
    it("no outcome variant exposes a `token` field that could leak into logs/URLs", () => {
      const results: AsanaClientResult<unknown>[] = [
        { outcome: "ok", data: sampleData },
        { outcome: "auth_failure" },
        { outcome: "permission_failure" },
        { outcome: "rate_limited", retryAfterMs: 1000 },
        { outcome: "network_error", message: "boom" },
        { outcome: "validation_error", issues: [sampleZodIssue] },
      ];
      for (const result of results) {
        expect("token" in result).toBe(false);
      }
    });
  });

  describe("isAsanaClientResult runtime type-guard", () => {
    it("accepts every documented outcome variant", () => {
      const candidates: unknown[] = [
        { outcome: "ok", data: sampleData },
        { outcome: "auth_failure" },
        { outcome: "permission_failure" },
        { outcome: "permission_failure", resource: "/projects/1" },
        { outcome: "rate_limited", retryAfterMs: 500 },
        { outcome: "network_error", message: "dns failure" },
        { outcome: "validation_error", issues: [sampleZodIssue] },
      ];
      for (const candidate of candidates) {
        expect(isAsanaClientResult<unknown>(candidate)).toBe(true);
      }
    });

    it("rejects values whose `outcome` is not in the documented literal union", () => {
      const candidates: unknown[] = [
        null,
        undefined,
        {},
        { outcome: "succeeded", data: sampleData },
        { outcome: "ok" }, // missing `data`
        { outcome: "rate_limited" }, // missing `retryAfterMs`
        { outcome: "network_error" }, // missing `message`
        { outcome: "validation_error" }, // missing `issues`
        { outcome: "permission_failure", resource: 1234 }, // `resource` must be a string when present
        { outcome: 42 },
        { outcome: "" },
      ];
      for (const candidate of candidates) {
        expect(isAsanaClientResult<unknown>(candidate)).toBe(false);
      }
    });

    it("returns a strongly-typed result so a switch is exhaustive over AsanaClientResult<T>", () => {
      const value: unknown = { outcome: "ok", data: sampleData };
      if (isAsanaClientResult<typeof sampleData>(value)) {
        // The narrowing must expose the discriminant and the variant
        // payload — the test below compiles only when the guard's
        // generic binds the payload type correctly.
        const exhausted: AsanaClientResult<typeof sampleData> = value;
        switch (exhausted.outcome) {
          case "ok":
            expect(exhausted.data.gid).toBe("1200");
            break;
          case "auth_failure":
          case "permission_failure":
          case "rate_limited":
          case "network_error":
          case "validation_error":
            break;
        }
      } else {
        throw new Error("guard should have accepted a valid ok variant");
      }
    });
  });
});
