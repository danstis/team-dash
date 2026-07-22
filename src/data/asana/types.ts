/**
 * `src/data/asana/types` — the read-only outcome union every exported
 * Asana client function returns.
 *
 * This module defines the single contract boundary between
 * `src/data/asana/**` (network acquisition) and the rest of the app —
 * the refresh orchestrator (US2), the credential flow (US1), the
 * incremental-sync path (FR-024), and the data-quality summary (FR-084)
 * all switch on `outcome` rather than catching thrown exceptions, so the
 * union shape IS the contract. The contract itself is the verbatim text
 * published in `specs/001-asana-team-dashboard/contracts/asana-client.md`
 * (§ "Client function contract") and reproduced below for direct
 * traceability:
 *
 * ```ts
 * type AsanaClientResult<T> =
 *   | { outcome: 'ok'; data: T }
 *   | { outcome: 'auth_failure' }
 *   | { outcome: 'permission_failure'; resource?: string }
 *   | { outcome: 'rate_limited'; retryAfterMs: number }
 *   | { outcome: 'network_error'; message: string }
 *   | { outcome: 'validation_error'; issues: ZodIssue[] };
 * ```
 *
 * Design rationale (from the contract)
 * ------------------------------------
 * - **Read-only by construction (NFR-004 / FR-009)**: no variant carries
 *   a method verb or write-side identifier; the module-level
 *   `tests/contract/asana-client.readonly.test.ts` (T026) inspects this
 *   union's variants to confirm no write operation is reachable.
 * - **Never throws for expected failure modes** (contract § Client
 *   function contract): a 401 is `auth_failure`, a 403 is
 *   `permission_failure`, a 429 is `rate_limited`, a transport failure
 *   is `network_error`, and a Zod mismatch is `validation_error`. The
 *   refresh orchestrator maps 1:1 onto the union without ad-hoc
 *   try/catch scattered through call sites.
 * - **URL / log safety (FR-008 / FR-010)**: no variant carries a `token`,
 *   `authorization`, or URL field. The `network_error.message` and the
 *   `validation_error.issues` payloads are scrubbed by the caller (T025)
 *   before being placed in the union — this module asserts the
 *   boundary by exposing neither field on the success variant and no
 *   credential field on any variant.
 * - **Token handling (contract § Token handling)**: the client receives
 *   the current token as a function parameter on each call; the union
 *   itself never holds it.
 *
 * Boundary
 * --------
 * This file lives under `src/data/asana/**`. It is allowed to import
 * Zod (`zod`) for the `ZodIssue` type because the validation boundary
 * lives here per `contracts/asana-client.md` ("every successful HTTP
 * response is parsed through the resource's Zod schema before being
 * returned as `ok`"). It MUST NOT import React, the React DOM, the app
 * shell, feature UI, or `src/domain/**` — `eslint-plugin-boundaries`
 * enforces that.
 *
 * Tests
 * -----
 * `tests/unit/data/asana/types.test.ts` is the TDD gate for this
 * module; the variant-shape, discriminant, and type-guard assertions
 * there MUST pass on every change to this file.
 */

import type { ZodIssue } from "zod";

/* -------------------------------------------------------------------------- */
/* Discriminant                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The closed literal union of every outcome the client can return. Held
 * as a separate type so callers (the refresh orchestrator, MSW handlers,
 * the FR-084 data-quality summary) can refer to the discriminant alone
 * without dragging the full per-variant payload into a generic parameter.
 *
 * The runtime array `ASANA_CLIENT_RESULT_OUTCOMES` below is the
 * authoritative source for the iteration order used by `isAsanaClientResult`
 * and by the FR-084 summary's per-outcome aggregation; a future outcome
 * MUST be added to BOTH the literal union AND the array in lockstep, and
 * the unit test in `tests/unit/data/asana/types.test.ts` will fail if the
 * two drift apart.
 */
export type AsanaClientResultOutcome =
  | "ok"
  | "auth_failure"
  | "permission_failure"
  | "rate_limited"
  | "network_error"
  | "validation_error";

/**
 * Runtime enumeration of every supported `AsanaClientResultOutcome`,
 * ordered to match the contract's example above. Exposed for the
 * refresh orchestrator's per-outcome accounting and for the type-guard
 * below so neither hard-codes the literal union.
 */
export const ASANA_CLIENT_RESULT_OUTCOMES: readonly AsanaClientResultOutcome[] =
  [
    "ok",
    "auth_failure",
    "permission_failure",
    "rate_limited",
    "network_error",
    "validation_error",
  ] as const;

/* -------------------------------------------------------------------------- */
/* Per-variant shapes (named for ergonomics; the union is the contract)        */
/* -------------------------------------------------------------------------- */

/**
 * The success variant. `data` is the resource's Zod-parsed payload (a
 * `Workspace`, a `Project`, a `Task`, an `{ events, newSyncToken }`
 * envelope for incremental sync, etc.) — typed generically over `T` so a
 * single union serves every endpoint documented in
 * `contracts/asana-client.md` § "Endpoints consumed (all `GET`)".
 */
export interface AsanaClientOk<T> {
  readonly outcome: "ok";
  readonly data: T;
}

/**
 * The token is missing, malformed, revoked, or otherwise rejected by
 * Asana (`HTTP 401`). Carries no payload: a 401 body can echo the token,
 * and the contract explicitly forbids carrying any such detail in the
 * result (FR-008 / FR-010).
 */
export interface AsanaClientAuthFailure {
  readonly outcome: "auth_failure";
}

/**
 * The token is valid but the workspace or resource it targets is not
 * accessible (`HTTP 403` / `403 Forbidden`). `resource`, when present,
 * is an opaque path-style hint (e.g. `"/projects/1234"`) the UI can
 * surface verbatim — it MUST NOT include the token, query parameters,
 * or any other credential-bearing segment.
 */
export interface AsanaClientPermissionFailure {
  readonly outcome: "permission_failure";
  readonly resource?: string;
}

/**
 * Asana's documented rate-limit response (`HTTP 429`). `retryAfterMs` is
 * the `Retry-After` header parsed into milliseconds by the client; the
 * union itself does not retry (orchestrator concern, contract § "Rate
 * limiting"). The client does no automatic retry so tests can assert
 * orchestrator retry behaviour deterministically without real timers
 * leaking into client tests.
 */
export interface AsanaClientRateLimited {
  readonly outcome: "rate_limited";
  readonly retryAfterMs: number;
}

/**
 * A transport-level failure (`TypeError: fetch failed`, DNS error,
 * abort, `AbortError`, etc.). `message` is a short, scrubbed,
 * non-credential string safe to log; the client (T025) is responsible
 * for stripping any token-bearing text before populating this field.
 * Per FR-008 / FR-010 the field MUST NOT carry the token, an
 * Authorization header, or a URL containing it.
 */
export interface AsanaClientNetworkError {
  readonly outcome: "network_error";
  readonly message: string;
}

/**
 * The HTTP response parsed cleanly but the resource's Zod schema
 * rejected one or more fields. `issues` is the structured Zod issue
 * array used by the FR-084 data-quality summary and the FR-079
 * data-quality panel to populate `DataQualityFlag`s and
 * `PriorityField.status` (data-model.md) rather than throwing or
 * silently coercing (FR-081 / FR-082 / FR-083).
 */
export interface AsanaClientValidationError {
  readonly outcome: "validation_error";
  readonly issues: ZodIssue[];
}

/* -------------------------------------------------------------------------- */
/* The union — the contract boundary                                          */
/* -------------------------------------------------------------------------- */

/**
 * The full outcome union every exported client function (`testToken`,
 * `listWorkspaces`, `fetchProjectsPage`, `fetchTasksPage`,
 * `fetchTaskDetail`, `fetchEventsSince`, …) MUST return. This is the
 * verbatim contract from `contracts/asana-client.md` § "Client function
 * contract", assembled from the per-variant interfaces above so each
 * variant carries its own JSDoc but the union itself is one symbol.
 *
 * The generic parameter `T` is the success payload type. A caller
 * declares `AsanaClientResult<Workspace[]>` for `listWorkspaces` and
 * the `ok.data` variant carries `Workspace[]`; the failure variants
 * are payload-free (or carry their own contract-mandated fields) and
 * are unaffected by `T`.
 */
export type AsanaClientResult<T> =
  | AsanaClientOk<T>
  | AsanaClientAuthFailure
  | AsanaClientPermissionFailure
  | AsanaClientRateLimited
  | AsanaClientNetworkError
  | AsanaClientValidationError;

/* -------------------------------------------------------------------------- */
/* Runtime type-guard                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Type-guard an unknown value as `AsanaClientResult<T>`. Used at trust
 * boundaries (the MSW handler round-trip, an IndexedDB round-trip in
 * future tests, any place where data crosses a typed boundary back into
 * the client module) so a malformed variant is rejected at the call
 * site rather than surfacing as a missing-field `undefined` further
 * downstream.
 *
 * The guard is intentionally permissive about extra properties on
 * `ok`, `permission_failure`, `network_error`, and `validation_error`
 * because Zod-parsed payloads legitimately carry read-only metadata
 * beyond the contract's named fields; it is strict about the
 * contract-mandated fields being present and well-typed (a numeric
 * `outcome`, an empty string `outcome`, a missing `data` on `ok`,
 * a non-array `issues`, etc. all fail the guard). It is strict about
 * URL/log safety: a value carrying a `token` or `authorization` field
 * is rejected so a future contributor who accidentally echoes a token
 * into the union fails CI rather than shipping the leak.
 */
export function isAsanaClientResult<T>(
  value: unknown,
): value is AsanaClientResult<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const outcome = candidate.outcome;

  if (typeof outcome !== "string") {
    return false;
  }

  switch (outcome as AsanaClientResultOutcome) {
    case "ok":
      return "data" in candidate;
    case "auth_failure":
      return true;
    case "permission_failure":
      return (
        candidate.resource === undefined ||
        typeof candidate.resource === "string"
      );
    case "rate_limited":
      return typeof candidate.retryAfterMs === "number";
    case "network_error":
      return typeof candidate.message === "string";
    case "validation_error":
      return Array.isArray(candidate.issues);
    default:
      return false;
  }
}
