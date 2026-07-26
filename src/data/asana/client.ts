/**
 * T025 — base Asana HTTP client.
 *
 * This module is the app's *only* outbound network boundary to Asana
 * (FR-009, NFR-004, `specs/001-asana-team-dashboard/contracts/asana-client.md`).
 * It exports a single generic GET plumbing function (`asanaGet`) that
 * every resource-specific client function in subsequent tasks (T039
 * `testToken`/`listWorkspaces`, T054 `fetchProjectsPage`/
 * `fetchTasksPage`/`fetchTaskDetail`/`fetchEventsSince`) composes
 * against. No function in this module is capable of issuing a `POST`,
 * `PUT`, `PATCH`, or `DELETE`; the read-only guarantee is verified by
 * the static + runtime scan in `tests/contract/asana-client.readonly.test.ts`
 * (T026).
 *
 * Resource-specific wrappers
 * --------------------------
 * The two resource-specific wrappers mandated by Phase 3 / US1 (T039
 * `testToken` / `listWorkspaces`, BSOD-167) live in this module as
 * thin delegations over `asanaGet`. T025's original design commented
 * that they would "intentionally not live here" with full T039
 * delegation as the landing site; the BSOD-163 release-readiness
 * verdict (2026-07-26) requested the symbol surface land early as
 * tactical stubs so `tests/contract/asana-client.auth.test.ts` (T034,
 * BSOD-162) can typecheck and the CI pipeline can run to completion.
 * T039 keeps the canonical ownership and extends each stub with the
 * rest of the credential-flow surface (schedulable re-validation,
 * `AbortSignal` cancellation, FR-005a re-encryption on token replace,
 * `opt_fields` narrowing, explicit `400 Bad Request` outcome) — every
 * extension is additive; the stub signatures here are the contract
 * T039 starts from.
 *
 * T054 (US2) will add `fetchProjectsPage`, `fetchTasksPage`,
 * `fetchTaskDetail`, and `fetchEventsSince` to this module as the
 * refresh orchestrator's data-acquisition surface, each with its own
 * contract test (T048, BSOD-176).
 *
 * Per-call token parameter
 * ------------------------
 * Every exported function takes the current token as a positional
 * argument on every call (`contracts/asana-client.md` § "Token
 * handling"). The client holds no module-level mutable token state and
 * retains no token after a request resolves — the function-scope
 * parameter is the only place the credential exists, and it is dropped
 * on return so a future contributor who adds long-lived caching cannot
 * accidentally retain the token by construction.
 *
 * `Authorization: Bearer` header only
 * -----------------------------------
 * The token is transmitted exclusively as `Authorization: Bearer <token>`
 * (FR-008, FR-010, `contracts/asana-client.md` § "URL/log safety"). It is
 * never appended to the URL as a query parameter, never echoed in the
 * request body, never included in any returned error payload, and never
 * logged. The `network_error.message` field is scrubbed of the token
 * before being surfaced — see `scrubTokenFromMessage` below — so even a
 * buggy `fetch` implementation that embeds the credential in its
 * rejection error cannot leak it through the union.
 *
 * Zod validation boundary before returning `ok`
 * ---------------------------------------------
 * Every successful HTTP response is parsed through the caller-supplied
 * Zod schema *before* being returned as `outcome: 'ok'`. A schema
 * mismatch returns `outcome: 'validation_error'` with the structured
 * `ZodIssue[]` array (FR-081 / FR-082 / FR-083) so the refresh
 * orchestrator can route the issue into `DataQualityFlag`s without
 * throwing or silently coercing (Principle II). The validation step is
 * the structural reason the app can never accept an Asana-side wire
 * change silently.
 *
 * `429` → `rate_limited` with parsed `Retry-After`
 * -------------------------------------------------
 * Per `contracts/asana-client.md` § "Rate limiting", the client performs
 * no automatic retry — retry/backoff is the orchestrator's
 * responsibility, kept out of the client so tests can assert
 * orchestrator retry behaviour deterministically without real timers
 * leaking into client tests. The client parses `Retry-After` in either
 * the seconds form (`Retry-After: 30`) or the HTTP-date form
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`) and exposes the
 * resulting delay in milliseconds on the union's `retryAfterMs` field.
 *
 * Offset pagination passthrough
 * -----------------------------
 * List endpoints accept an `offset` query parameter; the client forwards
 * it verbatim to the server and returns the response's `next_page` on
 * the `ok.data` variant unchanged (FR-021). The client is stateless per
 * call (no internal loop) so the refresh orchestrator can drive the
 * pagination walk itself, which is also what makes the contract test
 * one-page-at-a-time feasible.
 *
 * Never throws for expected failure modes
 * ---------------------------------------
 * The union's six outcomes (`ok`, `auth_failure`, `permission_failure`,
 * `rate_limited`, `network_error`, `validation_error`) cover every
 * expected failure mode. The client surfaces network-level `fetch`
 * rejections through `outcome: 'network_error'` rather than letting
 * them escape as exceptions; the refresh orchestrator's
 * `outcome`-switching flow has no `try/catch` paths to scatter.
 *
 * `412 Precondition Failed` (Asana's documented sync-token-expired
 * signal — `contracts/asana-client.md` § "Incremental sync fallback
 * contract") falls through to `outcome: 'network_error'` with
 * `message: "Unexpected HTTP 412"`. The orchestrator is expected to
 * substring-match on that status code (or be refactored later to a
 * dedicated outcome) — the current shape keeps the outcome union
 * stable for US2's incremental-sync fallback work without growing the
 * base client's surface area for a single Asana-specific status.
 *
 * Module boundary
 * ---------------
 * `src/data/asana/**` is the network-acquisition boundary the spec
 * draws (plan.md: Technical Context, `data/asana` row; ESLint boundary
 * rule in `eslint.config.js`). It is allowed to import Zod for the
 * schema parameter; it MUST NOT import React, the React DOM, the app
 * shell, feature UI, or `src/domain/**` (Principle VI's ESLint
 * boundary).
 */

import type { ZodTypeAny, z } from "zod";

import { asanaUserSchema, asanaWorkspaceListResponseSchema } from "./schemas";
import type { AsanaClientResult } from "./types";

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Asana's documented API base. Hard-coded so the read-only guarantee
 * cannot be subverted by a runtime-config override pointing at an
 * attacker-controlled host — the only outbound surface this app uses
 * is `app.asana.com`, period.
 */
const ASANA_API_BASE = "https://app.asana.com/api/1.0";

/* -------------------------------------------------------------------------- */
/* Public plumbing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The base read-only HTTP plumbing every resource-specific client
 * function in subsequent tasks (`testToken`, `listWorkspaces`,
 * `fetchProjectsPage`, `fetchTasksPage`, `fetchTaskDetail`,
 * `fetchEventsSince`) wraps. Takes a relative Asana API path
 * (e.g. `"/users/me"`, `"/projects/123/tasks"`), a Zod schema that
 * the response body will be validated against, the caller's current
 * token (passed per call — never held in module state), and an
 * optional `searchParams` bag for offset pagination and any other
 * documented query-string parameters.
 *
 * Returns `AsanaClientResult<T>` where `T = z.infer<Schema>`. The
 * function never throws for any documented failure mode; callers
 * switch on `outcome` to drive their state machine.
 */
export async function asanaGet<Schema extends ZodTypeAny>(
  path: string,
  schema: Schema,
  token: string,
  searchParams?: Readonly<Record<string, string | undefined>>,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<AsanaClientResult<z.infer<Schema>>> {
  const url = buildAsanaUrl(path, searchParams);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: options?.signal,
    });
  } catch (error) {
    // `fetch` rejects on transport-level failures (DNS, abort, offline,
    // CORS, etc.). The error's `message` may surface the request URL or
    // other identifying data; `scrubTokenFromMessage` strips any
    // substring matching the token so FR-008 / FR-010 cannot be broken
    // by a hostile `Error.message` surface.
    return {
      outcome: "network_error",
      message: scrubTokenFromMessage(extractErrorMessage(error), token),
    };
  }

  if (response.status === 401) {
    return { outcome: "auth_failure" };
  }

  if (response.status === 403) {
    return { outcome: "permission_failure" };
  }

  if (response.status === 429) {
    return {
      outcome: "rate_limited",
      retryAfterMs: parseRetryAfter(response.headers.get("Retry-After")),
    };
  }

  if (!response.ok) {
    // Any other 4xx / 5xx is a transport-level failure from this
    // client's perspective — the response is neither a successful parse
    // nor one of the documented outcome variants above. Surface it as
    // `network_error` with the status code so the orchestrator can
    // show "unexpected HTTP <status>" in the UI rather than swallowing
    // it. The token is not echoed back; the status code alone is safe
    // to log.
    return {
      outcome: "network_error",
      message: `Unexpected HTTP ${response.status}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      outcome: "network_error",
      message: "Response body is not valid JSON",
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      outcome: "validation_error",
      issues: parsed.error.issues,
    };
  }

  return { outcome: "ok", data: parsed.data };
}

/* -------------------------------------------------------------------------- */
/* T039 [BSOD-167] wrappers — minimal stubs to unblock BSOD-163 CI gate       */
/* -------------------------------------------------------------------------- */

/**
 * Validate the supplied personal access token by calling `GET /users/me`.
 *
 * Per-call token parameter (per `contracts/asana-client.md` § "Token
 * handling"): the token is the second positional argument on every call,
 * the function holds no module-level mutable credential state, and the
 * token is dropped on function return — the call site is the only place
 * the credential exists.
 *
 * The success variant returns `AsanaUser` per `schemas.ts`, satisfying
 * the T034 contract test (BSOD-162) and the future T039 form-driven
 * `TestTokenButton` (BSOD-169) which composes the same `outcome`
 * discriminant into its UI state machine.
 *
 * ## This is a BSOD-163 unblock stub
 *
 * The Release/Link Steward's `not-merge-ready` verdict on PR #81
 * (2026-07-26) flagged the upstream CI `Typecheck` failure caused by
 * `tests/contract/asana-client.auth.test.ts` importing `testToken` /
 * `listWorkspaces` before they were exported. This stub is the
 * tactical fix: a one-line delegation to `asanaGet` against the
 * already-defined `asanaUserSchema` so the typecheck compiles and the
 * contract test passes.
 *
 * T039 [BSOD-167] is the canonical owner of this function. The full
 * implementation will land here too (the contract document does not
 * prescribe a separate module for upstream credential wrappers) and
 * will extend the stub with the rest of the credential-flow surface
 * — schedulable re-validation, FR-005a re-encryption on token replace,
 * `AbortSignal` cancellation hook (the orchestrator passes one in
 * `User Story 2` for the refresh flow), and the explicit `400 Bad
 * Request` outcome for malformed tokens that this stub inherits from
 * `asanaGet`'s generic `network_error` arm. Every extention is
 * additive — this stub's signature is the contract T039 starts from.
 *
 * Read-only guarantee (FR-009 / NFR-004): `GET /users/me` is the
 * documented Asana endpoint for token validation. The function
 * inherits `asanaGet`'s read-only enforcement and cannot smuggle a
 * write verb through this module.
 */
export async function testToken(
  token: string,
): Promise<AsanaClientResult<z.infer<typeof asanaUserSchema>>> {
  return asanaGet("/users/me", asanaUserSchema, token);
}

/**
 * List the workspaces the supplied token can access by calling
 * `GET /workspaces`. The wire shape is Asana's documented envelope
 * `{"data": Workspace[], "next_page": …}`; the response is parsed
 * through `asanaWorkspaceListResponseSchema` so a malformed item is
 * surfaced as a `validation_error` (FR-081 / FR-082 / FR-083) rather
 * than silently coerced.
 *
 * Per-call token parameter: same contract as `testToken` above — no
 * module-level credential state, the token is dropped on return, and
 * `Authorization: Bearer` is the only credential-bearing header.
 *
 * ## This is a BSOD-163 unblock stub
 *
 * Same provenance as `testToken` above: a one-line delegation to
 * `asanaGet` to satisfy the T034 contract test (BSOD-162) and unblock
 * PR #81's CI gate. T039 [BSOD-167] will own the full implementation
 * — including the `offset` pagination passthrough that lets the
 * future `WorkspaceSelector` (T043, BSOD-171) page through very large
 * workspace lists, and the `opt_fields` parameter Asana documents
 * for narrowing the response to the fields the app actually caches.
 *
 * Read-only guarantee (FR-009 / NFR-004): `GET /workspaces` is the
 * documented endpoint. The function inherits `asanaGet`'s read-only
 * enforcement; the T026 read-only contract test pins the invariant.
 */
export async function listWorkspaces(
  token: string,
): Promise<
  AsanaClientResult<z.infer<typeof asanaWorkspaceListResponseSchema>>
> {
  return asanaGet("/workspaces", asanaWorkspaceListResponseSchema, token);
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build a fully-qualified Asana API URL from a path and optional
 * query-string bag. Path components are not URL-encoded here because
 * the wrappers in subsequent tasks compose paths from already-encoded
 * `gid` values (callers `encodeURIComponent` interpolated `gid`s
 * before formatting). Query parameters are stringified via
 * `URLSearchParams`, which handles the encoding of `offset` tokens
 * and other opaque values correctly without any manual encoding.
 */
function buildAsanaUrl(
  path: string,
  searchParams?: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(`${ASANA_API_BASE}${path}`);
  if (searchParams !== undefined) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

/**
 * Parse the `Retry-After` header into a millisecond delay. Supports
 * both forms Asana documents (seconds and HTTP-date). The contract
 * delegates the actual retry to the orchestrator, so this function
 * is deliberately pure: it returns a non-negative integer delay
 * without invoking `setTimeout` or sleeping.
 *
 * Unknown / missing values fall back to a conservative default rather
 * than throwing — Asana's docs consider the header optional in some
 * 429 responses, and a missing `Retry-After` is best surfaced as "we
 * don't know how long to wait" rather than "we crashed before we
 * could parse it".
 */
function parseRetryAfter(rawHeader: string | null): number {
  const DEFAULT_RETRY_AFTER_MS = 30_000;
  /**
   * Smallest positive delay surfaced when an HTTP-date `Retry-After`
   * resolves to the past. A `Retry-After` already in the past means
   * "retry now" — return a small positive floor so the orchestrator's
   * backoff machinery doesn't interpret zero as "no retry needed".
   */
  const MIN_RETRY_AFTER_MS = 1_000;

  if (rawHeader === null || rawHeader.trim() === "") {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const trimmed = rawHeader.trim();

  // Seconds form — `Retry-After: 30`.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number.parseFloat(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return DEFAULT_RETRY_AFTER_MS;
    }
    return Math.ceil(seconds * 1000);
  }

  // HTTP-date form — `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const delay = dateMs - Date.now();
  if (delay <= 0) {
    return MIN_RETRY_AFTER_MS;
  }
  return delay;
}

/**
 * Best-effort extraction of a human-readable message from an unknown
 * value (`fetch` rejections are `TypeError` instances whose `message`
 * we want to preserve for debugging without leaking the credential).
 * Falls back to a generic message so the `network_error` variant
 * always carries a non-empty, non-token-leaking string.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return "Network request failed";
}

/**
 * Strip every occurrence of the supplied token from a message string.
 * A buggy `fetch` implementation or a third-party `Error` subclass
 * may echo the token into its `message` (e.g. "TypeError: failed to
 * fetch https://…?token=<token>"); FR-008 / FR-010 require that no
 * token survives in any surfaced error payload, so this scrub is
 * applied uniformly to every `network_error.message` the client
 * produces.
 *
 * The function is intentionally simple — replace every match of the
 * token substring with a fixed placeholder — because the alternative
 * (URL-decode then re-match) would itself need to encode the token to
 * handle the edge case where the URL-encoded form differs from the
 * raw form, and the difference would be tiny relative to the simpler
 * scrub.
 */
function scrubTokenFromMessage(message: string, token: string): string {
  if (token === "") {
    return message;
  }
  return message.split(token).join("[redacted]");
}
