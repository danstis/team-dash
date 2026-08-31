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
 * contract", FR-024) is mapped to `outcome: 'permission_failure'` with
 * `resource: path` so the refresh orchestrator can identify the
 * sync-token-expired fallback trigger without substring-matching on a
 * `network_error.message`. The mapping lives at the base plumbing layer
 * because 412 is an Asana-wide semantic signal (any future endpoint
 * that uses a sync-token parameter would benefit from the same
 * outcome-shape), not just an Events-API quirk.
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
import { z as zod } from "zod";

import {
  asanaEventsResponseSchema,
  asanaProjectListResponseSchema,
  asanaResourceResponseSchema,
  asanaTaskListResponseSchema,
  asanaTaskSchema,
  asanaUserSchema,
  asanaWorkspaceListResponseSchema,
} from "./schemas";
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
 * Milliseconds in one second. Used by `parseRetryAfter` to convert the
 * seconds-form `Retry-After` header into the millisecond delay the
 * `rate_limited` outcome surfaces. Held as a named constant so this
 * file matches the project-wide unit-convention used by
 * `src/shared/format/index.ts` and `src/shared/states/RateLimitedState.tsx`
 * (see their `MINUTES_PER_HOUR` / `MS_PER_SECOND` / `SECONDS_PER_MINUTE`
 * declarations) rather than repeating an inline literal.
 */
const MS_PER_SECOND = 1_000;

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

  if (response.status === 412) {
    // Asana's documented sync-token-expired signal (FR-024,
    // contracts/asana-client.md § "Incremental sync fallback contract").
    // Returned as `permission_failure` with the request path as the
    // `resource` hint so the orchestrator can identify the caller
    // (`fetchEventsSince` is the only known caller today) without a
    // substring match on `network_error.message`. The path is taken
    // straight from the supplied `path` parameter; it MUST NOT include
    // the token (per FR-008 / FR-010) — `buildAsanaUrl` does not embed
    // the token in the URL.
    return { outcome: "permission_failure", resource: path };
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
  } catch (error) {
    // `response.json()` rejects on any malformed / non-UTF-8 / empty
    // body — the wire shape is `application/json` but the server may
    // still emit an HTML error page, a truncated chunk, or an empty
    // payload on a transport-level 5xx. As with the `fetch` rejection
    // path above, the error's `message` may surface the request URL
    // or other identifying data; `scrubTokenFromMessage` strips any
    // token substring before the message crosses the client
    // boundary so FR-008 / FR-010 cannot be broken by a hostile
    // `Error.message` surface.
    return {
      outcome: "network_error",
      message: scrubTokenFromMessage(extractErrorMessage(error), token),
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

const TOKEN_IDENTITY_FIELDS = "gid,name,email,resource_type";
const WORKSPACE_FIELDS = "gid,name,resource_type,is_organization";
const asanaUserResponseSchema = asanaResourceResponseSchema(asanaUserSchema);
const asanaTaskResponseSchema = asanaResourceResponseSchema(asanaTaskSchema);

type ClientRequestOptions = Readonly<{
  offset?: string;
  signal?: AbortSignal;
}>;

export async function testToken(
  token: string,
  options?: Pick<ClientRequestOptions, "signal">,
): Promise<AsanaClientResult<z.infer<typeof asanaUserSchema>>> {
  return asanaGet(
    "/users/me",
    asanaUserResponseSchema,
    token,
    { opt_fields: TOKEN_IDENTITY_FIELDS },
    options,
  );
}

export async function listWorkspaces(
  token: string,
  offsetOrOptions?: string | ClientRequestOptions,
): Promise<
  AsanaClientResult<z.infer<typeof asanaWorkspaceListResponseSchema>>
> {
  const options =
    typeof offsetOrOptions === "string"
      ? { offset: offsetOrOptions }
      : offsetOrOptions;

  return asanaGet(
    "/workspaces",
    asanaWorkspaceListResponseSchema,
    token,
    {
      opt_fields: WORKSPACE_FIELDS,
      offset: options?.offset,
    },
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* US2 resource-specific wrappers (T048 — pagination + events-since)           */
/* -------------------------------------------------------------------------- */

/**
 * Project-resource field selection (`contracts/asana-client.md` §
 * "Endpoints consumed (all `GET`)"). The `archived` field is the FR-012
 * exclusion flag and is required by `asanaProjectSchema`. The
 * `workspace`/`team` references are listed so the cache can resolve
 * project→AsanaTeam ownership (FR-041) without a second round trip
 * per project. The `custom_field_settings` is intentionally absent
 * here — the cache materialises it lazily for projects that participate
 * in the FR-081 priority-field validation (T082 / T084), and listing
 * it on every projects page would needlessly grow the response.
 */
const PROJECT_FIELDS =
  "gid,name,resource_type,archived,workspace.gid,workspace.name,team.gid,team.name";

/**
 * Task-resource field selection. Includes the custom-fields blob so the
 * FR-081/FR-082 validation can fire at the boundary (Principle II /
 * III). Includes `assignee`, `parent`, `projects[]` (compact
 * references — the cache normalises parent→subtask project
 * membership at ingestion time per FR-014), and the date fields the
 * reporting metrics need at the data-acquisition boundary so neither
 * the cache nor a later refresh round trip is required to populate them.
 */
const TASK_FIELDS =
  "gid,name,resource_type,resource_subtype,assignee.gid,assignee.name,parent.gid,parent.name,projects.gid,projects.name,created_at,modified_at,completed_at,completed,due_at,due_on,custom_fields,dependencies,notes";

/**
 * Task-detail field selection. Mirrors `TASK_FIELDS` so a task fetched
 * via `fetchTaskDetail` (for drill-down or staged dependent-task
 * hydration) carries the same shape as one fetched via
 * `fetchTasksPage`. Identical opt_fields ensures the cache upsert path
 * doesn't have to reconcile two shapes per `gid`.
 */
const TASK_DETAIL_FIELDS = TASK_FIELDS;

/**
 * T048 (US2) — fetch one page of projects for a workspace.
 *
 * Calls `GET /projects?workspace={gid}&archived=false&offset=…`. The
 * client is stateless per call (per `contracts/asana-client.md` §
 * "Pagination"); the refresh orchestrator (T051) drives the loop by
 * calling this function again with the previous response's
 * `next_page.offset` until it is `null`. The pagination walk itself
 * is exercised by the contract test (`asana-client.pagination.test.ts`
 * "completes a multi-page walk by following next_page.offset until
 * null").
 *
 * `@param` workspaceGid — Asana's opaque `gid` for the workspace to
 * enumerate; validated as a non-empty string by the caller (per
 * FR-017, `gid` is opaque so no further parsing is performed here).
 *
 * `@param` options.offset — opaque `next_page.offset` from the prior
 * page; `undefined` on the first call.
 *
 * The function never issues a write method; verified by the static +
 * runtime scan in `tests/contract/asana-client.readonly.test.ts`
 * (T026). A 401 maps to `auth_failure`, a 403 to `permission_failure`,
 * a 429 to `rate_limited`, a transport-level failure to `network_error`
 * (with the token scrubbed per FR-008/FR-010), and a Zod mismatch on
 * the `data[]` shape to `validation_error` with structured `ZodIssue[]`
 * (FR-081/FR-082/FR-083).
 */
export async function fetchProjectsPage(
  token: string,
  workspaceGid: string,
  options?: ClientRequestOptions,
): Promise<AsanaClientResult<z.infer<typeof asanaProjectListResponseSchema>>> {
  return asanaGet(
    "/projects",
    asanaProjectListResponseSchema,
    token,
    {
      opt_fields: PROJECT_FIELDS,
      workspace: workspaceGid,
      archived: "false",
      offset: options?.offset,
    },
    options,
  );
}

/**
 * T048 (US2) — fetch one page of tasks for a project.
 *
 * Calls `GET /projects/{gid}/tasks?opt_fields=…&offset=…`. The
 * pagination walk is orchestrator-driven, identical shape to
 * `fetchProjectsPage`. Tested by
 * `asana-client.pagination.test.ts`'s "completes a multi-page task
 * walk" case.
 *
 * `@param` projectGid — the opaque Asana `gid` of the project whose
 * task list is being fetched. The wrapper URL-encodes it via
 * `encodeURIComponent` before interpolating it into the path, so a
 * `gid` carrying URL-significant characters cannot break out of its
 * path segment (BSOD-449).
 */
export async function fetchTasksPage(
  token: string,
  projectGid: string,
  options?: ClientRequestOptions,
): Promise<AsanaClientResult<z.infer<typeof asanaTaskListResponseSchema>>> {
  return asanaGet(
    `/projects/${encodeURIComponent(projectGid)}/tasks`,
    asanaTaskListResponseSchema,
    token,
    {
      opt_fields: TASK_FIELDS,
      offset: options?.offset,
    },
    options,
  );
}

/**
 * T048 (US2) — fetch the full detail for a single task.
 *
 * Calls `GET /tasks/{gid}?opt_fields=…`. The Asana detail endpoint
 * returns a single-resource `{ data: task }` envelope; the wrapper
 * unwraps that envelope before returning `ok.data` so cache and UI
 * callers receive the task resource directly.
 *
 * Used by the refresh orchestrator for subtask and dependency
 * hydration (where the task list page's compact-reference shape is
 * insufficient — see `contracts/asana-client.md` § "Task detail"), and
 * by the US3 task-detail drill-down's "Open in Asana" link resolution.
 *
 * `@param` taskGid — the opaque Asana `gid` of the task. The wrapper
 * URL-encodes it via `encodeURIComponent` before interpolating it
 * into the path, so a `gid` carrying URL-significant characters
 * (`?`, `#`, `/`, `..`) cannot truncate the path, retarget the
 * request to another endpoint, or override the appended query
 * parameters (BSOD-449).
 *
 * A 404 (unknown task gid) is not enumerated as a dedicated outcome
 * variant per the contract's closed union; it surfaces through the
 * base client's generic `!response.ok` path as `network_error` with
 * `message: "Unexpected HTTP 404"` — see the contract test
 * "maps an unknown task to `network_error`" case, which pins this
 * shape so a future regression that promotes 404 to a dedicated
 * outcome either widens the union deliberately or updates the test.
 */
export async function fetchTaskDetail(
  token: string,
  taskGid: string,
  options?: Pick<ClientRequestOptions, "signal">,
): Promise<AsanaClientResult<z.infer<typeof asanaTaskSchema>>> {
  return asanaGet(
    `/tasks/${encodeURIComponent(taskGid)}`,
    asanaTaskResponseSchema,
    token,
    { opt_fields: TASK_DETAIL_FIELDS },
    options,
  );
}

/**
 * The success payload for `fetchEventsSince`. The wire shape Asana
 * returns is `{ data: Event[], sync: string, has_more: boolean }`; the
 * wrapper renames `sync` to `newSyncToken` and `has_more` to `hasMore`
 * on the union's `ok.data` variant so the wire field names do not leak
 * past the client boundary and a future Asana-side rename can be
 * absorbed at the wrapper rather than every call site.
 */
type AsanaEventsBatch = z.infer<typeof asanaEventsResponseSchema>;
type EventsSuccessPayload = {
  events: AsanaEventsBatch["data"];
  newSyncToken: AsanaEventsBatch["sync"];
  hasMore: AsanaEventsBatch["has_more"];
};

/**
 * T048 (US2) — FR-024 incremental sync entry point.
 *
 * Calls `GET /events?resource={gid}&sync={token}` per the contract's
 * § "Incremental sync fallback contract". Four "stale/invalid
 * incremental state" outcomes, all of which the orchestrator treats as
 * a trigger for a full reconciliation rather than a hard failure:
 *
 * - **No resource gid** (or empty-string `resourceGid`): the function
 *   returns `validation_error` with a structured `ZodIssue` **without**
 *   issuing a network request. The ZodIssue path points at the
 *   `resource` field so a missing scope is attributed to the request
 *   contract rather than an Asana-side transport failure.
 *
 * - **No prior sync token** (or empty-string `syncToken`): the
 *   function returns `validation_error` with a structured `ZodIssue`
 *   **without** issuing a network request. The ZodIssue path points
 *   at the `sync` field so the FR-084 data-quality panel attributes
 *   the gap correctly (see
 *   `asana-client.pagination.test.ts`'s `no sync token is supplied`
 *   and `sync token is empty` cases).
 *
 * - **Schema mismatch on the response body**: the base client's Zod
 *   boundary returns `validation_error` with structured `ZodIssue[]`
 *   (FR-081/FR-082/FR-083). The payload in this case carries no
 *   newSyncToken; the orchestrator should fall back to a full refresh
 *   and surface a new sync token from the next `data[]` ingestion
 *   pass per data-model.md.
 *
 * - **Asana's documented `412 Precondition Failed`** (expired sync
 *   token): the base client maps 412 to `permission_failure` with
 *   `resource: "/events"` (see `asanaGet`'s 412 branch — wired at
 *   the plumbing layer so any future sync-token-bearing endpoint
 *   benefits from the same outcome shape).
 *
 * On success the wrapper renames the wire's `sync`/`has_more` fields to
 * `newSyncToken`/`hasMore` on the result's `data` variant so the
 * orchestrator can persist the next sync token and continue fetching
 * while `hasMore` remains true without binding to the wire naming.
 *
 * `@param` resourceGid — Asana gid for the resource whose event stream
 * should be read. The Events API requires this scope on every call.
 * `@param` syncToken — opaque Asana sync token persisted from the
 * last successful `fetchEventsSince` call (or, on the orchestrator's
 * bootstrap, a fresh-token from the corresponding full refresh).
 * `undefined` or empty string means "no prior sync token stored for
 * the current workspace" per FR-024 / data-model.md, and triggers
 * the validation-error path above without a network round trip.
 */
export async function fetchEventsSince(
  token: string,
  resourceGid?: string,
  syncToken?: string,
  options?: Pick<ClientRequestOptions, "signal">,
): Promise<AsanaClientResult<EventsSuccessPayload>> {
  if (resourceGid === undefined || resourceGid === "") {
    return missingParameterValidationError({
      path: ["resource"],
      value: resourceGid,
      emptyMessage:
        "Resource gid is empty; Events API requests require a resource scope.",
      undefinedMessage:
        "No resource gid supplied; Events API requests require a resource scope.",
    });
  }

  if (syncToken === undefined || syncToken === "") {
    // No prior sync token persisted for the workspace — FR-024's
    // "absence of any previously stored sync token ⇒ full
    // reconciliation" trigger. Constructed via a synthetic Zod
    // parse so the surface is identical to a real validation_error
    // (structured `ZodIssue[]`, discriminant `validation_error`),
    // matches the contract's call-site pattern of switching on
    // `outcome` without a token-specific branch, and routes cleanly
    // into the FR-084 data-quality panel if the orchestrator chooses
    // to surface the gap rather than immediately cascading to a full
    // refresh.
    return missingParameterValidationError({
      path: ["sync"],
      value: syncToken,
      emptyMessage:
        "Sync token is empty; a prior successful sync is required before incremental fetch.",
      undefinedMessage:
        "No prior sync token stored for this workspace; a full reconciliation is required before incremental fetch.",
    });
  }

  const wire = await asanaGet(
    "/events",
    asanaEventsResponseSchema,
    token,
    { resource: resourceGid, sync: syncToken },
    options,
  );

  if (wire.outcome !== "ok") {
    return wire;
  }

  // Rename `sync` → `newSyncToken` so the wire field name doesn't leak
  // past the client boundary. The orchestrator persists this on success
  // and supplies it as the next call's `syncToken`.
  return {
    outcome: "ok",
    data: {
      events: wire.data.data,
      newSyncToken: wire.data.sync,
      hasMore: wire.data.has_more,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build a fully-qualified Asana API URL from a path and optional
 * query-string bag. Path components are not URL-encoded here: the
 * caller-facing wrappers (`fetchTasksPage`, `fetchTaskDetail`, …)
 * `encodeURIComponent` each interpolated `gid` at the point of
 * interpolation, so the `path` reaching this function already has
 * URL-safe segments (BSOD-449). Query parameters are stringified via
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
    return Math.ceil(seconds * MS_PER_SECOND);
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
 * Build the synthetic `validation_error` outcome the `fetchEventsSince`
 * wrapper surfaces when a required caller-supplied parameter is
 * missing. Both the "absent" and the "empty-string" shapes map to the
 * same outcome; the `path` on the synthetic `ZodIssue` is what
 * attributes the gap (resource scope vs. sync token) to the FR-084
 * data-quality panel.
 *
 * Centralised so the two "missing required input" branches in
 * `fetchEventsSince` share one `ZodIssue` shape rather than two
 * near-identical inline blocks whose `code` / `path` / `message`
 * literals could drift apart at the next contract refinement.
 */
function missingParameterValidationError({
  path,
  value,
  emptyMessage,
  undefinedMessage,
}: {
  readonly path: readonly [string];
  readonly value: string | undefined;
  readonly emptyMessage: string;
  readonly undefinedMessage: string;
}): AsanaClientResult<never> {
  return {
    outcome: "validation_error",
    issues: [
      {
        code: zod.ZodIssueCode.custom,
        path: [...path],
        message: value === "" ? emptyMessage : undefinedMessage,
      },
    ],
  };
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
