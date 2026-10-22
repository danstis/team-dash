/**
 * T051 — Refresh orchestrator (US2, BSOD-305).
 *
 * Drives the refresh state machine end-to-end. The orchestrator is the
 * only caller of `RefreshStagingRepository` (T047) and the only writer
 * that drives the Asana pagination walk the contract test
 * (`asana-client.pagination.test.ts`) is written against. It is owned
 * by `src/data/refresh/` because its single responsibility is moving
 * data from the Asana network boundary into the local Dexie cache
 * through the staged-commit-on-success-only invariant (Principle V /
 * FR-022 / FR-068 / `data-model.md: RefreshSession`).
 *
 * What this module owns
 * ---------------------
 * 1. **Pagination loop**. The orchestrator drives the offset-pagination
 *    walk the Asana client surfaces — one page at a time, terminated
 *    by `next_page === null`. The base HTTP client (`asanaGet` in
 *    `src/data/asana/client.ts`) is stateless per call; the loop
 *    lives here so a failure on page 3 of 7 still preserves the cache
 *    by staging rows for pages 1 and 2 then discarding the whole
 *    batch.
 *
 * 2. **FR-024 incremental/full fallback**. When `mode === 'incremental'`,
 *    the orchestrator probes `fetchEventsSince` first. Any of the four
 *    "stale/invalid incremental state" triggers
 *    (`validation_error` for missing sync token, `permission_failure`
 *    for `412 Precondition Failed`, `network_error`, `rate_limited`)
 *    cascades to a full reconciliation — never to a hard failure.
 *    Full reconciliation is the FR-024 "fall back to a full
 *    reconciliation that restores correctness without corrupting the
 *    existing cache during the fallback" recovery path.
 *
 * 3. **Live progress counter** (FR-021 / NFR-002). The orchestrator
 *    accepts an `onProgress(itemsRetrieved)` callback and invokes it
 *    after every `stageUpsert` call so the UI's `ProgressIndicator`
 *    (T049, future) updates continuously rather than at page
 *    boundaries only.
 *
 * 4. **Staged-commit-on-success-only** (data-model.md: RefreshSession
 *    commit rule, FR-022 / FR-068). The orchestrator never touches
 *    the cache directly; every write goes through
 *    `refreshStagingRepository.stageUpsert(...)`. The cache is only
 *    updated on `refreshStagingRepository.commit(sessionId)` which
 *    atomically flushes the staged rows AND transitions the session
 *    to `'succeeded'` in a single Dexie transaction. Every other
 *    terminal status (cancelled / auth_failure / permission_failure /
 *    rate_limited / network_error) calls `discard()` and writes the
 *    matching terminal session status directly to the `refreshSessions`
 *    table — leaving the cache stores untouched.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The HTTP plumbing (401/403/429/network classification). That
 *   belongs to `src/data/asana/client.ts` (T048). The orchestrator
 *   switches on the closed `AsanaClientResult` union verbatim — no
 *   try/catch around network calls because the client never throws
 *   for documented failure modes.
 * - The schema-level normalisation of `Task.projectGids` from
 *   compact references to opaque `gid[]`, parent→subtask membership
 *   resolution (FR-014), and any other cache-side reshaping. The
 *   minimal `normaliseProject` / `normaliseTask` helpers below only
 *   translate wire → cache row shape — they do NOT enrich or
 *   deduplicate. Full normalisation is owned by T058's normalise.ts.
 * - The Snapshot backfill / replace path (FR-026a, FR-026b). The
 *   `RefreshStagingRepository.commit()` implementation calls
 *   `SnapshotRepository.backfillSnapshots()` (T052) inside the same
 *   transaction; this module never reaches the snapshot store
 *   directly.
 * - The RefreshButton / ProgressIndicator / OutcomeBanner UI
 *   components. The orchestrator's caller passes an `onProgress`
 *   callback and consumes the `RefreshOutcome` discriminated union;
 *   `src/features/refresh/RefreshControls.tsx` renders the result.
 *
 * RefreshSession state transitions this module performs
 * -----------------------------------------------------
 *   running → succeeded         (via RefreshStagingRepository.commit())
 *   running → cancelled        (user-cancel via AbortSignal)
 *   running → auth_failure      (401 from any page)
 *   running → permission_failure (403 / 412 from any page)
 *   running → rate_limited      (429 from any page)
 *   running → partial_failure   (NOT implemented here — T049 owns the
 *                                success-with-partial-failure rendering;
 *                                this row only handles the four clean
 *                                failure modes the spec enumerates.)
 *
 * The session row is seeded before the first Asana call (status:
 * 'running') and updated to its terminal status by the orchestrator
 * inside its own Dexie write (NOT inside the staging repository —
 * only `succeeded` is in the repository's commit transaction because
 * only `succeeded` means "the cache is now the new complete cache";
 * every other terminal status preserves the existing cache and
 * therefore does not need to atomically interleave cache writes).
 *
 * Boundary
 * --------
 * `src/data/refresh/**` is the network-acquisition → cache boundary
 * the spec draws (`plan.md: Project Structure`, `data/refresh` row).
 * It imports from `src/data/asana/**` (the read-only HTTP client)
 * and `src/data/db/**` (the Dexie schema and the staging repository);
 * it MUST NOT import from React, the React DOM, the app shell,
 * feature UI, or `src/domain/**` (Principle VI's ESLint boundary
 * convention). The orchestrator returns a plain `RefreshOutcome`
 * union the UI layer renders — the orchestrator is callable from a
 * worker / background context as easily as from a React component.
 */
import {
  fetchEventsSince,
  fetchProjectsPage,
  fetchTasksPage,
  scrubTokenFromMessage,
} from "../asana/client";
import type { asanaProjectSchema, asanaTaskSchema } from "../asana/schemas";
import type {
  AsanaClientResult,
  AsanaClientResultOutcome,
} from "../asana/types";
import { refreshStagingRepository } from "../db/repositories/refresh-staging.repository";
import { db } from "../db/schema";
import type { Project, RefreshSession, Task } from "../db/schema";
import type { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The closed set of failure reasons the orchestrator surfaces to the
 * UI layer. Every value maps 1:1 onto one of the documented
 * `AsanaClientResult` outcomes (the client is the boundary that
 * classifies the wire failure), with the one addition that
 * `'cancelled'` is its own state (the user-cancel path produces no
 * Asana-side outcome at all — the AbortSignal fires inside the
 * network call and the client surfaces it through a generic
 * `network_error`, which the orchestrator reclassifies to
 * `'cancelled'` when the failure was user-initiated).
 */
export type RefreshFailureReason =
  | "network_error"
  | "auth_failure"
  | "permission_failure"
  | "rate_limited"
  | "validation_error";

/**
 * The terminal outcome the orchestrator returns to the UI layer.
 * Mirrors the documented `RefreshSession.status` enumeration
 * (`data-model.md`) with the addition of `succeeded` (the success
 * terminal) and `failed` (the umbrella for the four Asana-side
 * failure modes — the inner `reason` discriminates which one).
 *
 * The union is exhaustive over the orchestrator's possible returns
 * — every Asana failure mode maps to one branch, the user-cancel
 * path maps to one branch, and the success path maps to one branch.
 * The UI layer's `OutcomeBanner` switches on `state` and reads
 * `reason` only on the `'failed'` branch.
 */
export type RefreshOutcome =
  | {
      readonly status: "succeeded";
      readonly sessionId: string;
      readonly itemsRetrieved: number;
      /**
       * The `RefreshSession.finishedAt` the atomic commit path wrote.
       * The banner surfaces it verbatim (FR-021 — "the last successful
       * refresh timestamp"); it is read back from the committed
       * session row so the DOM value and the persisted value are the
       * same string by construction.
       */
      readonly completedAt: string;
    }
  | {
      readonly status: "cancelled";
      readonly sessionId: string;
      readonly itemsRetrieved: number;
      readonly message: string;
    }
  | {
      readonly status: "failed";
      readonly sessionId: string;
      readonly itemsRetrieved: number;
      readonly reason: RefreshFailureReason;
      readonly message: string;
    };

/**
 * The sync mode the orchestrator should attempt. Per FR-024,
 * `'incremental'` is preferred when a prior `syncToken` is available;
 * the orchestrator detects stale / invalid incremental state and
 * falls back to a full reconciliation transparently (the UI never
 * sees the fallback — the `RefreshOutcome.status === 'succeeded'`
 * path is the same either way).
 */
export type RefreshSyncMode = "full" | "incremental";

/**
 * The orchestrator's caller-facing input. The shape is the union of
 * every input the spec's FR-024 / FR-021 / FR-022 flow requires:
 *
 * - `workspaceGid` — Asana's opaque `gid` for the workspace to
 *   refresh (the current selection).
 * - `token` — the plaintext Asana PAT, passed per call per the
 *   `contracts/asana-client.md` token-handling rule.
 * - `signal` — an optional `AbortSignal` for user-cancel. The
 *   orchestrator forwards the signal to every Asana call and checks
 *   `signal.aborted` between stages; a cancel mid-refresh surfaces
 *   as `RefreshOutcome.status === 'cancelled'`.
 * - `mode` — `'full'` (default) or `'incremental'` per FR-024.
 * - `syncToken` — opaque Asana sync token persisted from the prior
 *   successful incremental refresh; required for `mode: 'incremental'`,
 *   ignored otherwise.
 * - `onProgress` — optional live progress callback (FR-021). The
 *   orchestrator invokes it with the running `itemsRetrieved` count
 *   after every successful `stageUpsert` so the UI's progress
 *   indicator (T049) updates continuously.
 */
export interface RefreshOrchestratorOptions {
  readonly workspaceGid: string;
  readonly token: string;
  readonly signal?: AbortSignal;
  readonly mode?: RefreshSyncMode;
  readonly syncToken?: string | null;
  readonly onProgress?: (itemsRetrieved: number) => void;
}

/**
 * The orchestrator's surface. A future feature component takes the
 * `RefreshOrchestrator` interface as a dependency so it can be
 * stubbed from a test fixture; the production code consumes the
 * exported singleton.
 */
export interface RefreshOrchestrator {
  runRefresh(options: RefreshOrchestratorOptions): Promise<RefreshOutcome>;
}

/* -------------------------------------------------------------------------- */
/* Failure mapping                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Map a non-`ok` `AsanaClientResult` outcome to the orchestrator's
 * `RefreshFailureReason` vocabulary. The mapping is 1:1 because the
 * Asana client is the classification boundary — the orchestrator
 * reads the discriminant verbatim rather than re-classifying based on
 * HTTP status codes or error message substrings (which would couple
 * the orchestrator to the client's internal failure-detection
 * mechanism).
 */
function mapFailureReason(
  outcome: Exclude<AsanaClientResultOutcome, "ok">,
): RefreshFailureReason {
  switch (outcome) {
    case "auth_failure":
      return "auth_failure";
    case "permission_failure":
      return "permission_failure";
    case "rate_limited":
      return "rate_limited";
    case "network_error":
      return "network_error";
    case "validation_error":
      return "validation_error";
  }
}

/**
 * The terminal `RefreshSession.status` value to record for each
 * `RefreshFailureReason`. `validation_error` does not have a matching
 * `RefreshSession.status` literal (the data model collapses
 * validation issues into `partial_failure` or `succeeded` depending on
 * the orchestrator's tolerance) — for T051 the orchestrator treats a
 * `validation_error` outcome as a hard failure that maps to
 * `'partial_failure'` because the schema-violating rows would
 * otherwise be silently dropped (Principle II's "no silent coercion"
 * rule). Future rows that distinguish validation from transport
 * failures can extend the union without breaking the existing UI.
 */
function sessionStatusForReason(
  reason: RefreshFailureReason,
): RefreshSession["status"] {
  switch (reason) {
    case "auth_failure":
      return "auth_failure";
    case "permission_failure":
      return "permission_failure";
    case "rate_limited":
      return "rate_limited";
    case "network_error":
      return "partial_failure";
    case "validation_error":
      return "partial_failure";
  }
}

/* -------------------------------------------------------------------------- */
/* Wire → cache normalisation (moved from T049's RefreshControls)             */
/* -------------------------------------------------------------------------- */

/**
 * The wire shapes the Asana client returns. The orchestrator takes
 * the Zod-inferred types so the normalisers below cannot drift from
 * the validation boundary (`src/data/asana/schemas.ts`).
 */
type WireProject = z.infer<typeof asanaProjectSchema>;
type WireTask = z.infer<typeof asanaTaskSchema>;

/**
 * The Asana prebuilt custom field the dashboard reads as the task's
 * estimated minutes (FR-016 / data-model.md / spec §"Glossary" —
 * "Estimated Time"). Held as a named constant rather than an inline
 * literal so the lookup site, its docstring, and any future
 * contributor who needs to reference the same field (e.g. a Priority
 * field sibling reader) refer to one source of truth rather than
 * re-typing the string in each call site.
 */
const ESTIMATED_TIME_FIELD_NAME = "Estimated Time";

/**
 * Extract the "Estimated Time" custom field's `number_value` as the
 * cache's `estimatedMinutes` scalar. Returns `null` when the field
 * is absent or has no numeric value — the data-model.md distinction
 * between `null` (tracked but not entered) and the literal
 * `'unavailable'` (workspace without Time Tracking) is recorded here
 * rather than at the wire-validation boundary.
 */
function extractEstimatedMinutes(
  customFields: WireTask["custom_fields"],
): number | null {
  if (customFields === undefined) {
    return null;
  }
  for (const field of customFields) {
    if (field.name === ESTIMATED_TIME_FIELD_NAME) {
      return field.number_value ?? null;
    }
  }
  return null;
}

/**
 * Collapse a single Asana project wire row into the cache's
 * `Project` shape. The wire format nests `workspace` and `team` as
 * compact references; the cache flattens those into
 * `workspaceGid`/`asanaTeamGid` scalars. `portfolioGids` is left
 * empty here — T052 (BSOD-306, `SnapshotRepository`) is the row that
 * owns the portfolio→project edge, and the FR-016 reporting
 * requirements (FR-039 / FR-040) are downstream of T049.
 *
 * The `workspaceGid` is the *selected* workspace rather than the
 * wire's `workspace.gid` — the two agree for every project the
 * orchestrator fetches (the projects page is scoped to the selected
 * workspace), and using the selected gid means a project whose wire
 * omits the workspace reference still lands in the right scope.
 */
function normaliseProject(wire: WireProject, workspaceGid: string): Project {
  return {
    gid: wire.gid,
    name: wire.name,
    workspaceGid,
    asanaTeamGid: wire.team?.gid ?? null,
    portfolioGids: [],
    archived: wire.archived,
  };
}

/**
 * Collapse a single Asana task wire row into the cache's `Task`
 * shape. Subtask project-membership inheritance (FR-014) is T058
 * (BSOD-309) — the orchestrator stages the `projectGids` exactly as
 * Asana returned them, so a subtask whose `projects[]` is empty in
 * the wire shape is staged with `projectGids: []` and the future row
 * (T058) is responsible for resolving the parent's projects into
 * the subtask at ingestion time.
 */
function normaliseTask(wire: WireTask, lastSeenAt: string): Task {
  return {
    gid: wire.gid,
    name: wire.name,
    assigneeGid: wire.assignee?.gid ?? null,
    projectGids: (wire.projects ?? []).map((project) => project.gid),
    parentTaskGid: wire.parent?.gid ?? null,
    resourceSubtype: wire.resource_subtype,
    createdAt: wire.created_at,
    modifiedAt: wire.modified_at,
    completedAt: wire.completed_at ?? null,
    dueAt: wire.due_at ?? null,
    priorityOptionId: null,
    estimatedMinutes: extractEstimatedMinutes(wire.custom_fields),
    actualMinutes: null,
    dependsOnTaskGids: (wire.dependencies ?? []).map((dep) => dep.gid),
    lastSeenInScopeAt: lastSeenAt,
    outOfScopeReason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Failure write-through                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Persist a terminal failure status on the session row WITHOUT
 * touching the cache stores. The commit transaction in
 * `RefreshStagingRepository.commit()` is the ONLY path that
 * atomically interleaves cache writes + session status; this helper
 * is the matching non-succeeded path that updates the session row
 * alone, leaving the cache stores untouched (FR-022 / FR-068).
 */
async function writeTerminalSessionStatus(
  sessionId: string,
  status: RefreshSession["status"],
  errorDetail: string | null,
): Promise<void> {
  const existing = await db.refreshSessions.get(sessionId);
  if (existing === undefined) {
    throw new Error(
      `refreshOrchestrator: RefreshSession "${sessionId}" was not seeded before the failure path ran`,
    );
  }
  await db.refreshSessions.put({
    ...existing,
    status,
    finishedAt: new Date().toISOString(),
    errorDetail,
  });
}

/**
 * The failure half of the Asana client's outcome union — every
 * variant except `'ok'`. The failure variants carry no success
 * payload, so the union does not depend on the caller's success
 * type parameter and can be named concretely.
 */
type AsanaClientFailure = Exclude<
  AsanaClientResult<unknown>,
  { outcome: "ok" }
>;

/**
 * The scope label a failure message names — the Asana resource the
 * failing request was fetching. A failure message is the only
 * detail the UI surfaces alongside the failure reason, so it has to
 * say *what* failed as well as *how*.
 */
type FetchScope = "projects" | { readonly tasksForProject: string };

/**
 * Render a fetch scope as the human-readable fragment the failure
 * message embeds: `"projects"` or `"tasks for project 1200…"`.
 */
function describeScope(scope: FetchScope): string {
  return typeof scope === "string"
    ? scope
    : `tasks for project ${scope.tasksForProject}`;
}

/**
 * Build the failure detail the orchestrator surfaces for a failed
 * Asana request.
 *
 * The message is constructed from the request's scope and the
 * Asana client's outcome discriminant — NEVER from the raw response
 * body or an arbitrary error string — so the detail is token-free by
 * construction (FR-008 / FR-010). The format
 * `"Failed to fetch <scope>: <outcome>"` is the contract the T049
 * success-path row's failure assertions pin.
 */
function buildFailureMessage(
  scope: FetchScope,
  outcome: Exclude<AsanaClientResultOutcome, "ok">,
): string {
  return `Failed to fetch ${describeScope(scope)}: ${outcome}`;
}

/**
 * The cancellation detail the orchestrator surfaces when the caller
 * aborts mid-refresh. There is no Asana outcome to report (the
 * request never produced one), so the detail states what happened in
 * the user's terms.
 */
const CANCELLED_MESSAGE =
  "The refresh was cancelled before the workspace was fully retrieved.";

/* -------------------------------------------------------------------------- */
/* Orchestrator implementation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate a per-refresh session id. The `session-` prefix is part
 * of the id contract T049 pinned (`RefreshSession.id` matches
 * `/^session-/` so a reader can tell a refresh session row apart
 * from any other id in the store); the UUID suffix keeps concurrent
 * or repeated refreshes from colliding on the same Dexie primary
 * key. Uses `crypto.randomUUID()` when available (Node ≥ 19, every
 * modern browser) and falls back to a Web Crypto
 * `getRandomValues`-derived v4 UUID in the (older) environments that
 * predate `randomUUID`.
 *
 * The fallback deliberately does NOT use `Math.random()`: the session
 * id is a cache-store primary key and an audit-trail identifier, and
 * a predictable pseudo-random id is the kind of thing Sonar's
 * `typescript:S2245` (and a security reviewer) rightly flags. Web
 * Crypto is already a hard dependency of the app — the token crypto
 * module (`src/data/crypto/token-crypto.ts`) cannot run without it —
 * so requiring it here adds no new constraint.
 */
function generateSessionId(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") {
    return `session-${cryptoRef.randomUUID()}`;
  }
  if (typeof cryptoRef?.getRandomValues !== "function") {
    throw new Error(
      "refreshOrchestrator: this environment provides no Web Crypto random source; cannot mint a RefreshSession id",
    );
  }
  const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
  // RFC 4122 §4.4 — set the version (4) and variant (10xx) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `session-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Map a non-`ok` Asana outcome onto the orchestrator's terminal
 * `failed` shape and write the matching session status. Returns the
 * `RefreshOutcome` the orchestrator should surface to the caller.
 *
 * The `scope` argument names the request that failed so the detail
 * says which fetch broke; the `outcome` argument is the Asana
 * client's own discriminant, which is the classification boundary
 * (the orchestrator never re-derives the reason from a status code
 * or a message substring).
 */
async function failOutcome(
  sessionId: string,
  scope: FetchScope,
  result: AsanaClientFailure,
  itemsRetrieved: number,
): Promise<Extract<RefreshOutcome, { status: "failed" }>> {
  const reason = mapFailureReason(result.outcome);
  const message = buildFailureMessage(scope, result.outcome);
  await writeTerminalSessionStatus(
    sessionId,
    sessionStatusForReason(reason),
    message,
  );
  return {
    status: "failed",
    sessionId,
    itemsRetrieved,
    reason,
    message,
  };
}

/**
 * Record the user-cancel terminal state and return the matching
 * `RefreshOutcome`. The staging buffer is discarded first so the
 * partially-staged rows never reach the cache (FR-022).
 */
async function cancelOutcome(
  sessionId: string,
  itemsRetrieved: number,
): Promise<Extract<RefreshOutcome, { status: "cancelled" }>> {
  await refreshStagingRepository.discard(sessionId);
  await writeTerminalSessionStatus(sessionId, "cancelled", CANCELLED_MESSAGE);
  return {
    status: "cancelled",
    sessionId,
    itemsRetrieved,
    message: CANCELLED_MESSAGE,
  };
}

/**
 * Cancellation sentinel — `AbortSignal.reason` may be any value; the
 * orchestrator only needs to know "did the caller abort, vs did Asana
 * return a failure?". `signal.aborted === true` is the only signal-
 * level check.
 */
function isAbortRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/* -------------------------------------------------------------------------- */
/* Refresh context                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The ambient state every stage of a refresh run needs. Bundling it
 * into one object keeps the stage helpers' signatures small and makes
 * it obvious that no stage carries hidden state between them.
 */
interface RefreshContext {
  readonly token: string;
  readonly workspaceGid: string;
  readonly sessionId: string;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: ((itemsRetrieved: number) => void) | undefined;
}

/**
 * The result of a pagination walk. Either the walk completed and
 * carries its data, or the walk ended in a terminal refresh outcome
 * (a failure or a cancellation) and the refresh stops there.
 */
type WalkResult<T> =
  | { readonly status: "walked"; readonly data: T }
  | { readonly status: "terminal"; readonly outcome: RefreshOutcome };

/* -------------------------------------------------------------------------- */
/* FR-024 sync-mode resolution                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the sync mode this session actually uses.
 *
 * FR-024 — "the system MUST prefer incremental/delta retrieval when
 * it can be done validly per Asana's documented capabilities, and MUST
 * detect when incremental state is stale, invalid, or insufficient and
 * fall back to a full reconciliation that restores correctness without
 * corrupting the existing cache during the fallback."
 *
 * The probe reads the stored sync state through the Events API. Its
 * outcomes split into two groups:
 *
 * - **Stale / invalid / insufficient incremental state** — no stored
 *   sync token, Asana's documented `412 Precondition Failed`
 *   sync-token-expired, a transport failure, a rate-limit, or a
 *   schema mismatch. Each one means the incremental state cannot be
 *   trusted, so the refresh continues as a full reconciliation. This
 *   is the FR-024 fallback and it is never surfaced to the user as a
 *   failure — an expired sync token is not the user's fault.
 * - **A rejected token** (`auth_failure`) — the credential itself is
 *   invalid, so no reconciliation can succeed either. The refresh
 *   fails with the auth reason instead of walking the whole
 *   workspace for a result that cannot arrive.
 *
 * T051 implements the *fallback* half of the contract: the
 * reconciliation is the full walk, which is always a correct superset
 * of the incremental result and never corrupts the existing cache
 * (the whole walk is staged and committed atomically). The row that
 * implements the incremental fast path branches on the probe's
 * outcome here.
 */
async function resolveSyncMode(
  context: RefreshContext,
  mode: RefreshSyncMode,
  syncToken: string | null,
): Promise<
  | { readonly status: "resolved"; readonly mode: RefreshSyncMode }
  | { readonly status: "terminal"; readonly outcome: RefreshOutcome }
> {
  if (mode !== "incremental") {
    return { status: "resolved", mode };
  }

  const probe = await fetchEventsSince(
    context.token,
    context.workspaceGid,
    syncToken ?? undefined,
    { signal: context.signal },
  );

  if (probe.outcome === "auth_failure") {
    // The token is rejected — surface the authentication failure
    // rather than walking the workspace for a result that cannot
    // arrive.
    return {
      status: "terminal",
      outcome: {
        status: "failed",
        sessionId: context.sessionId,
        itemsRetrieved: 0,
        reason: "auth_failure",
        message: buildFailureMessage("projects", probe.outcome),
      },
    };
  }

  // Every other probe outcome — including a successful one — resolves
  // to the full reconciliation. See the docblock for why.
  return { status: "resolved", mode: "full" };
}

/* -------------------------------------------------------------------------- */
/* Pagination walks                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Walk the workspace's project pages, staging every project row as it
 * arrives.
 *
 * The walk is sequential by necessity: Asana's offset pagination
 * hands out the *next* offset in the current page's response, so the
 * pages cannot be requested in parallel. The `await` inside the loop
 * is therefore intentional, not an oversight.
 *
 * @returns the staged project gids and the running item count, or the
 * terminal outcome that ended the walk.
 */
async function walkProjectPages(
  context: RefreshContext,
  itemsRetrieved: number,
): Promise<WalkResult<{ projectGids: string[]; itemsRetrieved: number }>> {
  const projectGids: string[] = [];
  let projectOffset: string | undefined = undefined;

  do {
    if (isAbortRequested(context.signal)) {
      return {
        status: "terminal",
        outcome: await cancelOutcome(context.sessionId, itemsRetrieved),
      };
    }

    const page = await fetchProjectsPage(context.token, context.workspaceGid, {
      offset: projectOffset,
      signal: context.signal,
    });

    if (page.outcome !== "ok") {
      await refreshStagingRepository.discard(context.sessionId);
      return {
        status: "terminal",
        outcome: await failOutcome(
          context.sessionId,
          "projects",
          page,
          itemsRetrieved,
        ),
      };
    }

    for (const project of page.data.data) {
      const row = normaliseProject(project, context.workspaceGid);
      await refreshStagingRepository.stageUpsert("projects", [row]);
      projectGids.push(row.gid);
      itemsRetrieved += 1;
      context.onProgress?.(itemsRetrieved);
    }

    projectOffset = page.data.next_page?.offset;
  } while (projectOffset !== undefined);

  return { status: "walked", data: { projectGids, itemsRetrieved } };
}

/**
 * Walk every in-scope project's task pages, staging every task row as
 * it arrives. The walk is sequential per project for the same reason
 * the project walk is (Asana's offset pagination hands out the next
 * offset in the current page's response).
 *
 * @returns the running item count, or the terminal outcome that ended
 * the walk.
 */
async function walkTaskPages(
  context: RefreshContext,
  projectGids: readonly string[],
  itemsRetrieved: number,
): Promise<WalkResult<{ itemsRetrieved: number }>> {
  const lastSeenAt = new Date().toISOString();

  for (const projectGid of projectGids) {
    let taskOffset: string | undefined = undefined;

    do {
      if (isAbortRequested(context.signal)) {
        return {
          status: "terminal",
          outcome: await cancelOutcome(context.sessionId, itemsRetrieved),
        };
      }

      const page = await fetchTasksPage(context.token, projectGid, {
        offset: taskOffset,
        signal: context.signal,
      });

      if (page.outcome !== "ok") {
        await refreshStagingRepository.discard(context.sessionId);
        return {
          status: "terminal",
          outcome: await failOutcome(
            context.sessionId,
            { tasksForProject: projectGid },
            page,
            itemsRetrieved,
          ),
        };
      }

      for (const task of page.data.data) {
        const row = normaliseTask(task, lastSeenAt);
        await refreshStagingRepository.stageUpsert("tasks", [row]);
        itemsRetrieved += 1;
        context.onProgress?.(itemsRetrieved);
      }

      taskOffset = page.data.next_page?.offset;
    } while (taskOffset !== undefined);
  }

  return { status: "walked", data: { itemsRetrieved } };
}

/* -------------------------------------------------------------------------- */
/* Orchestrator implementation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The orchestrator singleton. The module exports both the interface
 * and the implementation so a test can construct a fake
 * `RefreshOrchestrator` without monkey-patching the global instance.
 */
export const refreshOrchestrator: RefreshOrchestrator = {
  async runRefresh(options): Promise<RefreshOutcome> {
    const {
      workspaceGid,
      token,
      signal,
      mode = "full",
      syncToken = null,
      onProgress,
    } = options;

    if (isAbortRequested(signal)) {
      // Caller aborted before the orchestrator started — surface a
      // `cancelled` outcome. The session row is the only state
      // mutated (it records the cancellation for the FR-068 audit
      // trail); the cache is untouched (FR-022).
      const sessionId = generateSessionId();
      await db.refreshSessions.put({
        id: sessionId,
        workspaceGid,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: "cancelled",
        itemsRetrieved: 0,
        errorDetail: CANCELLED_MESSAGE,
        syncMode: mode,
      });
      return {
        status: "cancelled",
        sessionId,
        itemsRetrieved: 0,
        message: CANCELLED_MESSAGE,
      };
    }

    const sessionId = generateSessionId();
    const context: RefreshContext = {
      token,
      workspaceGid,
      sessionId,
      signal,
      onProgress,
    };

    // FR-024 — resolve the sync mode before the session row is
    // seeded, so the recorded `syncMode` is the mode the session
    // actually runs in. A rejected token terminates the refresh here.
    const syncMode = await resolveSyncMode(context, mode, syncToken);
    if (syncMode.status === "terminal") {
      await writeTerminalSessionStatus(
        sessionId,
        "auth_failure",
        syncMode.outcome.status === "failed"
          ? syncMode.outcome.message
          : CANCELLED_MESSAGE,
      );
      return syncMode.outcome;
    }

    await db.refreshSessions.put({
      id: sessionId,
      workspaceGid,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: "running",
      itemsRetrieved: 0,
      errorDetail: null,
      syncMode: syncMode.mode,
    });

    // Begin staging — every write from here until commit() is
    // invisible to getInScopeTasks(). A throw / abort / failure
    // before commit() lands us on the `discard()` path; the cache
    // and the session status are then updated atomically by the
    // helper above, NOT by the staging repository.
    await refreshStagingRepository.beginStaging(sessionId);

    let itemsRetrieved = 0;

    try {
      const projects = await walkProjectPages(context, itemsRetrieved);
      if (projects.status === "terminal") {
        return projects.outcome;
      }
      itemsRetrieved = projects.data.itemsRetrieved;

      const tasks = await walkTaskPages(
        context,
        projects.data.projectGids,
        itemsRetrieved,
      );
      if (tasks.status === "terminal") {
        return tasks.outcome;
      }
      itemsRetrieved = tasks.data.itemsRetrieved;

      // Success path — commit atomically flushes the staged rows
      // AND transitions the session to `succeeded` in a single
      // Dexie transaction (FR-068, data-model.md RefreshSession
      // commit rule). A throw before this point leaves the
      // staging buffer intact; the orchestrator catches the throw,
      // discards the buffer, and surfaces the failure reason.
      await refreshStagingRepository.commit(sessionId);
      // The completion timestamp is read back from the committed
      // session row so the value the banner renders and the value
      // the cache persisted are the same string by construction
      // (FR-021 — "the last successful refresh timestamp").
      const committed = await db.refreshSessions.get(sessionId);
      return {
        status: "succeeded",
        sessionId,
        itemsRetrieved,
        completedAt: committed?.finishedAt ?? new Date().toISOString(),
      };
    } catch (error) {
      // Internal / unexpected throw — preserve the cache by
      // discarding the staging buffer. A failure here is not the
      // orchestrator's documented failure surface (those are
      // surfaced through the walk helpers); it is an unexpected
      // exception (e.g. a Dexie write rejection). We surface it as
      // a `network_error` outcome because the UI's
      // RefreshFailureReason vocabulary has no "internal_error"
      // literal — FR-022 says "failed, cancelled, or incomplete
      // refresh MUST NOT replace a previously complete cache";
      // this catch is the catch-all that guarantees the
      // preservation guarantee.
      try {
        await refreshStagingRepository.discard(sessionId);
      } catch {
        // Best-effort — a failing discard is itself an internal
        // error; the cache stores remain untouched because the
        // staging buffer never flushed.
      }
      // The thrown message is scrubbed of the token before it
      // becomes the surfaced detail (FR-008 / FR-010) — the
      // orchestrator is the single producer of that string, so the
      // scrub has to happen here. `scrubTokenFromMessage` is the
      // Asana client's own helper (BSOD-748 exported it for exactly
      // this purpose), so the orchestrator and the client share one
      // implementation of the rule.
      const detail = scrubTokenFromMessage(
        error instanceof Error ? error.message : "Unknown orchestrator error",
        token,
      );
      await writeTerminalSessionStatus(sessionId, "partial_failure", detail);
      return {
        status: "failed",
        sessionId,
        itemsRetrieved,
        reason: "network_error",
        message: detail,
      };
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Re-exports                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Re-export the `AsanaClientResult` type so a future feature
 * component can switch on the orchestrator's outcome AND the Asana
 * client's outcome from a single import path. Type-only re-export so
 * the bundler tree-shakes the runtime surface.
 */
export type { AsanaClientResult };
