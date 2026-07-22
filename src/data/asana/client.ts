/**
 * T025 — base Asana HTTP client.
 *
 * This module is the app's *only* outbound network boundary to Asana
 * (FR-009, NFR-004, `specs/001-asana-team-dashboard/contracts/asana-client.md`).
 * Every export is read-only by construction: the module exposes a single
 * generic GET plumbing function (`asanaGet`) plus a small set of
 * resource-specific convenience wrappers (`testToken`, `listWorkspaces`,
 * `fetchProjectsPage`, `fetchTasksPage`, `fetchTaskDetail`,
 * `fetchEventsSince`) that the refresh orchestrator (US2), credential
 * flow (US1), and incremental-sync path (FR-024) compose against. No
 * function in this module is capable of issuing a `POST`, `PUT`,
 * `PATCH`, or `DELETE`; the read-only guarantee is verified by the
 * static + runtime scan in `tests/contract/asana-client.readonly.test.ts`
 * (T026).
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
 * Module boundary
 * ---------------
 * `src/data/asana/**` is the network-acquisition boundary the spec
 * draws (plan.md: Technical Context, `data/asana` row; ESLint boundary
 * rule in `eslint.config.js`). It is allowed to import Zod for the
 * schema parameter; it MUST NOT import React, the React DOM, the app
 * shell, feature UI, or `src/domain/**` (Principle VI's ESLint
 * boundary).
 */

import { z, type ZodTypeAny } from "zod";

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

/**
 * The well-known `GET /users/me` path used by `testToken` (US1, FR-004).
 * Exposed as a constant so the credential flow doesn't hard-code the
 * literal in two places and so the URL appears in a single grep-able
 * location for the security review.
 */
const ASANA_USERS_ME_PATH = "/users/me";

/* -------------------------------------------------------------------------- */
/* Public plumbing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The base read-only HTTP plumbing every resource-specific client
 * function in this module wraps. Takes a relative Asana API path
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
/* Resource-specific wrappers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Asana's documented "test the token" endpoint (`GET /users/me`,
 * FR-004). Returns the authenticated user record on success so the
 * credential flow can display the account name and confirm token
 * validity in a single round-trip.
 *
 * Higher-level US1 implementations (T039) build the "Test Token"
 * affordance on top of this; the base HTTP wrapper is what T025 ships.
 */
export async function testToken(
  token: string,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<AsanaClientResult<z.infer<typeof asanaUserSchema>>> {
  return asanaGet(
    ASANA_USERS_ME_PATH,
    asanaUserSchema,
    token,
    undefined,
    options,
  );
}

/**
 * List the workspaces the current token can access (`GET /workspaces`,
 * FR-011). Used by the workspace-selection step (T043).
 */
export function listWorkspaces(
  token: string,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<
  AsanaClientResult<z.infer<typeof asanaWorkspaceListResponseSchema>>
> {
  return asanaGet(
    "/workspaces",
    asanaWorkspaceListResponseSchema,
    token,
    undefined,
    options,
  );
}

/**
 * Page through the projects in a workspace (`GET /projects`,
 * FR-012). `archived=false` is requested explicitly per the contract;
 * the response is still re-validated for `archived` per-item by the
 * schema (the schema's required `archived` field enforces this).
 */
export function fetchProjectsPage(
  token: string,
  params: Readonly<{ workspaceGid: string; offset?: string }>,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<AsanaClientResult<z.infer<typeof asanaProjectListResponseSchema>>> {
  return asanaGet(
    "/projects",
    asanaProjectListResponseSchema,
    token,
    {
      workspace: params.workspaceGid,
      archived: "false",
      ...(params.offset !== undefined ? { offset: params.offset } : {}),
    },
    options,
  );
}

/**
 * Page through the tasks of a project (`GET /projects/{gid}/tasks`,
 * FR-014). The orchestrator (US2) loops with `offset` from
 * `next_page` until exhaustion; the client itself does no looping
 * (the contract's "stateless per call" requirement).
 */
export function fetchTasksPage(
  token: string,
  params: Readonly<{ projectGid: string; offset?: string; optFields?: string }>,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<AsanaClientResult<z.infer<typeof asanaTaskListResponseSchema>>> {
  return asanaGet(
    `/projects/${encodeURIComponent(params.projectGid)}/tasks`,
    asanaTaskListResponseSchema,
    token,
    {
      ...(params.offset !== undefined ? { offset: params.offset } : {}),
      ...(params.optFields !== undefined
        ? { opt_fields: params.optFields }
        : {}),
    },
    options,
  );
}

/**
 * Fetch a single task's full detail (`GET /tasks/{gid}`, FR-014 /
 * FR-016). Used by the drill-down drawer (T074) and the refresh
 * orchestrator's "hydration of compact references" path.
 */
export function fetchTaskDetail(
  token: string,
  params: Readonly<{ taskGid: string; optFields?: string }>,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<AsanaClientResult<z.infer<typeof asanaTaskSchema>>> {
  return asanaGet(
    `/tasks/${encodeURIComponent(params.taskGid)}`,
    asanaTaskSchema,
    token,
    params.optFields !== undefined
      ? { opt_fields: params.optFields }
      : undefined,
    options,
  );
}

/**
 * Asana's incremental-sync events endpoint (`GET /events`,
 * FR-024). Returns a `{ events, sync }` envelope; the orchestrator
 * treats a `validation_error` outcome, a documented `412`, or the
 * absence of any prior `sync` token as "stale incremental state,
 * fall back to full reconciliation" (see the contract's
 * "Incremental sync fallback contract" section).
 */
export function fetchEventsSince(
  token: string,
  params: Readonly<{ resourceGid: string; syncToken: string }>,
  options?: Readonly<{ signal?: AbortSignal }>,
): Promise<AsanaClientResult<z.infer<typeof asanaEventsResponseSchema>>> {
  return asanaGet(
    "/events",
    asanaEventsResponseSchema,
    token,
    {
      resource: params.resourceGid,
      sync: params.syncToken,
    },
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build a fully-qualified Asana API URL from a path and optional
 * query-string bag. Path components are not URL-encoded here because
 * the public wrappers compose paths from already-encoded `gid` values
 * (the callers `encodeURIComponent` interpolated `gid`s before
 * formatting). Query parameters are stringified via `URLSearchParams`,
 * which handles the encoding of `offset` tokens and other opaque
 * values correctly without any manual encoding.
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
    // A `Retry-After` already in the past means "retry now" — surface
    // a small positive delay so the orchestrator's backoff machinery
    // doesn't interpret zero as "no retry needed".
    return 1_000;
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

/* -------------------------------------------------------------------------- */
/* Local resource schema aliases                                                */
/* -------------------------------------------------------------------------- */

/**
 * The user schema is reused for `testToken`; `asanaUserSchema` lives
 * in `schemas.ts` but is imported here by the workspace-list wrapper
 * below. The schemas are imported lazily (top of file) to avoid
 * pulling the whole schemas module into this file's eager imports
 * when only the type-level contract is needed; `asanaGet`'s generic
 * parameter constrains the runtime schema parameter at the call site.
 */
import {
  asanaProjectListResponseSchema,
  asanaTaskListResponseSchema,
  asanaTaskSchema,
  asanaUserSchema,
  asanaWorkspaceListResponseSchema,
} from "./schemas";

/**
 * Schema for Asana's incremental-sync Events API response. The events
 * array's per-event shape varies by event type, so the items are
 * treated as opaque at this layer; per-event validation (if any) is
 * the orchestrator's responsibility once it has decided to act on the
 * stream.
 *
 * Declared locally rather than in `schemas.ts` (T023) because the
 * envelope is part of the *transport* contract for T025 (the base HTTP
 * plumbing) rather than a first-class resource shape. Moving it to
 * `schemas.ts` later is a trivial relocation; keeping it here for now
 * avoids touching T023's settled schema surface.
 */
const asanaEventsResponseSchema = z.object({
  data: z.array(z.unknown()),
  sync: z.string().min(1),
});
