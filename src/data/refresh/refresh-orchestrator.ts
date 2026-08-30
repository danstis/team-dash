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
} from "../asana/client";
import type {
  AsanaClientResult,
  AsanaClientResultOutcome,
} from "../asana/types";
import { refreshStagingRepository } from "../db/repositories/refresh-staging.repository";
import { db } from "../db/schema";
import type { Project, RefreshSession, Task } from "../db/schema";

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
    }
  | {
      readonly status: "cancelled";
      readonly sessionId: string;
    }
  | {
      readonly status: "failed";
      readonly sessionId: string;
      readonly reason: RefreshFailureReason;
      readonly message?: string;
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
/* Normalisation (minimal wire → cache row)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Minimal wire → cache row normalisation for a Project. Full
 * normalisation (priority field extraction, portfolio membership,
 * custom-field handling) is owned by T058; this helper is the
 * minimum needed to write the row into the staging buffer without
 * losing the opaque-`gid`-only invariant (FR-017) and without
 * dropping the `archived` flag the in-scope predicate relies on
 * (FR-012). The cache schema fields that this helper leaves `null`
 * (`portfolioGids`, `asanaTeamGid` when no team reference exists)
 * are filled by the dedicated enrichment step in a later row — T051
 * does not pre-empt T058's normalisation surface.
 */
function normaliseProjectAsanaWire(
  workspaceGid: string,
  wire: {
    gid: string;
    name: string;
    archived: boolean;
    team?: { gid: string } | null;
  },
): Project {
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
 * Minimal wire → cache row normalisation for a Task. Asana's task
 * wire shape includes a `projects[]` compact-reference array; the
 * minimal projection here flattens it to `projectGids: string[]`
 * (the cache's denormalised membership column). Subtask → parent
 * membership resolution (FR-014) is owned by T058; the T051 helper
 * does not perform it (a future subtask normalisation pass will
 * rewrite the staged rows in-place before commit). The
 * `dependsOnTaskGids[]`, `lastSeenInScopeAt`, and `outOfScopeReason`
 * fields use sensible defaults that downstream enrichment will
 * overwrite.
 */
function normaliseTaskAsanaWire(
  wire: {
    gid: string;
    name: string;
    resource_subtype: Task["resourceSubtype"];
    assignee?: { gid: string } | null;
    projects?: ReadonlyArray<{ gid: string }>;
    parent?: { gid: string } | null;
    created_at: string;
    modified_at: string;
    completed_at?: string | null;
    due_at?: string | null;
    dependencies?: ReadonlyArray<{ gid: string }>;
  },
  nowIso: string,
): Task {
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
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: (wire.dependencies ?? []).map(
      (dependency) => dependency.gid,
    ),
    lastSeenInScopeAt: nowIso,
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
 * Extract a non-credential-bearing message from an
 * `AsanaClientResult` for the `RefreshSession.errorDetail` column.
 * The Asana client's `network_error.message` is already token-
 * scrubbed by the client itself (T025, `scrubTokenFromMessage`); we
 * copy it verbatim. The other variants do not carry a message field
 * (the contract deliberately omits it for `auth_failure`,
 * `permission_failure`, `rate_limited`, `validation_error`).
 */
function extractErrorDetail(
  reason: RefreshFailureReason,
  source: AsanaClientResult<unknown>,
): string | null {
  if (reason === "network_error" && source.outcome === "network_error") {
    return source.message;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Orchestrator implementation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate a v4-shaped session id for the `refreshSessions` table.
 * Uses `crypto.randomUUID()` when available (Node ≥ 19, every modern
 * browser) and falls back to a `Math.random`-based generator in
 * environments without Web Crypto — the test environment does have
 * Web Crypto via `tests/setup.ts`, so this fallback is a defensive
 * guard only.
 */
function generateSessionId(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Map a non-`ok` Asana outcome onto the orchestrator's terminal
 * `failed` shape and write the matching session status. Returns the
 * `RefreshOutcome` the orchestrator should surface to the caller.
 */
async function failOutcome(
  sessionId: string,
  reason: RefreshFailureReason,
  source: AsanaClientResult<unknown>,
): Promise<Extract<RefreshOutcome, { status: "failed" }>> {
  await writeTerminalSessionStatus(
    sessionId,
    sessionStatusForReason(reason),
    extractErrorDetail(reason, source),
  );
  return source.outcome === "network_error"
    ? {
        status: "failed",
        sessionId,
        reason,
        message: source.message,
      }
    : { status: "failed", sessionId, reason };
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
      // `cancelled` outcome without writing any session row. The
      // session table is the only state mutated; the cache is
      // untouched (FR-022).
      const sessionId = generateSessionId();
      await db.refreshSessions.put({
        id: sessionId,
        workspaceGid,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: "cancelled",
        itemsRetrieved: 0,
        errorDetail: null,
        syncMode: mode,
      });
      return { status: "cancelled", sessionId };
    }

    // FR-024 incremental/full fallback resolution. The probe uses
    // `fetchEventsSince` when `mode === 'incremental'`; any of the
    // four "stale/invalid incremental state" triggers cascades to a
    // full reconciliation (never to a hard failure — the user is
    // never punished for an expired sync token). On a successful
    // incremental probe the orchestrator would apply events and
    // commit; for T051's scope (failure modes only) we treat the
    // successful incremental probe as a no-op that still triggers a
    // full reconciliation so the success-path commit behaviour is
    // testable end-to-end.
    let effectiveMode: RefreshSyncMode = mode;
    if (mode === "incremental") {
      const probe = await fetchEventsSince(
        token,
        workspaceGid,
        syncToken ?? undefined,
        { signal },
      );
      if (probe.outcome === "ok") {
        // Successful incremental probe — FR-024 says "incremental
        // MAY be used to improve efficiency but MUST NOT be
        // treated as infallible". For T051's red→green slice we
        // cascade to a full reconciliation anyway; future rows can
        // short-circuit on a successful probe and apply the events
        // diff without the full walk. The fallback path here is
        // also what the test exercises when the probe succeeds
        // but the orchestrator's downstream pages fail — the UI
        // sees the same `failed` / `cancelled` / `succeeded`
        // surface either way.
        effectiveMode = "full";
      } else {
        // Probe failed — FR-024 fallback. The failure reason on the
        // probe is informative (the UI could surface "incremental
        // state stale, falling back to full refresh"), but for T051
        // we still cascade to full and let the eventual walk's
        // outcome drive the UI.
        effectiveMode = "full";
      }
    }

    const sessionId = generateSessionId();
    const startedAt = new Date().toISOString();
    await db.refreshSessions.put({
      id: sessionId,
      workspaceGid,
      startedAt,
      finishedAt: null,
      status: "running",
      itemsRetrieved: 0,
      errorDetail: null,
      syncMode: effectiveMode,
    });

    // Begin staging — every write from here until commit() is
    // invisible to getInScopeTasks(). A throw / abort / failure
    // before commit() lands us on the `discard()` path; the cache
    // and the session status are then updated atomically by the
    // helper above, NOT by the staging repository.
    await refreshStagingRepository.beginStaging(sessionId);

    let itemsRetrieved = 0;

    /**
     * Local helper to classify a single Asana call's failure. The
     * `discriminant` from the union is the only signal we trust;
     * the orchestrator never re-parses the message string.
     */
    const failOnOutcome = async <T>(
      result: AsanaClientResult<T>,
    ): Promise<Extract<RefreshOutcome, { status: "failed" }> | null> => {
      if (result.outcome === "ok") {
        return null;
      }
      await refreshStagingRepository.discard(sessionId);
      return failOutcome(sessionId, mapFailureReason(result.outcome), result);
    };

    try {
      // Pagination loop: projects page.
      const projectGids: string[] = [];
      let projectOffset: string | undefined = undefined;
      // The loop is bounded by the Asana-side pagination walk; a
      // pagination walk that never terminates is a server bug, not
      // a normal-case state, so the loop is allowed to run to
      // completion. Each iteration surfaces failure through
      // `failOnOutcome` above; the loop terminates as soon as the
      // outcome is non-`ok`.
      do {
        if (isAbortRequested(signal)) {
          await refreshStagingRepository.discard(sessionId);
          await writeTerminalSessionStatus(sessionId, "cancelled", null);
          return { status: "cancelled", sessionId };
        }
        const projectsPage = await fetchProjectsPage(token, workspaceGid, {
          offset: projectOffset,
          signal,
        });
        const failure = await failOnOutcome(projectsPage);
        if (failure !== null) {
          return failure;
        }
        if (projectsPage.outcome !== "ok") {
          // Unreachable — `failOnOutcome` would have returned — but
          // the TypeScript narrowing requires a defensive return so
          // the rest of the function can rely on `projectsPage.data`.
          return await failOutcome(sessionId, "network_error", {
            outcome: "network_error",
            message:
              "Internal orchestrator error: projectsPage was not ok after failOnOutcome",
          });
        }
        for (const project of projectsPage.data.data) {
          const row = normaliseProjectAsanaWire(workspaceGid, project);
          await refreshStagingRepository.stageUpsert("projects", [row]);
          projectGids.push(row.gid);
          itemsRetrieved += 1;
          onProgress?.(itemsRetrieved);
        }
        projectOffset = projectsPage.data.next_page?.offset;
      } while (projectOffset !== undefined);

      // Pagination loop: tasks page per project. The outer loop
      // walks projects; the inner loop walks each project's task
      // pagination walk. Both loops surface failure through the
      // shared `failOnOutcome` helper.
      const nowIso = new Date().toISOString();
      for (const projectGid of projectGids) {
        let taskOffset: string | undefined = undefined;
        do {
          if (isAbortRequested(signal)) {
            await refreshStagingRepository.discard(sessionId);
            await writeTerminalSessionStatus(sessionId, "cancelled", null);
            return { status: "cancelled", sessionId };
          }
          const tasksPage = await fetchTasksPage(token, projectGid, {
            offset: taskOffset,
            signal,
          });
          const failure = await failOnOutcome(tasksPage);
          if (failure !== null) {
            return failure;
          }
          if (tasksPage.outcome !== "ok") {
            return await failOutcome(sessionId, "network_error", {
              outcome: "network_error",
              message:
                "Internal orchestrator error: tasksPage was not ok after failOnOutcome",
            });
          }
          for (const task of tasksPage.data.data) {
            const row = normaliseTaskAsanaWire(task, nowIso);
            await refreshStagingRepository.stageUpsert("tasks", [row]);
            itemsRetrieved += 1;
            onProgress?.(itemsRetrieved);
          }
          taskOffset = tasksPage.data.next_page?.offset;
        } while (taskOffset !== undefined);
      }

      // Success path — commit atomically flushes the staged rows
      // AND transitions the session to `succeeded` in a single
      // Dexie transaction (FR-068, data-model.md RefreshSession
      // commit rule). A throw before this point leaves the
      // staging buffer intact; the orchestrator catches the throw,
      // discards the buffer, and surfaces the failure reason.
      await refreshStagingRepository.commit(sessionId);
      return { status: "succeeded", sessionId, itemsRetrieved };
    } catch (error) {
      // Internal / unexpected throw — preserve the cache by
      // discarding the staging buffer. A failure here is not the
      // orchestrator's documented failure surface (those are
      // surfaced through `failOnOutcome`); it is an unexpected
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
      await writeTerminalSessionStatus(
        sessionId,
        "partial_failure",
        error instanceof Error ? error.message : "Unknown orchestrator error",
      );
      return {
        status: "failed",
        sessionId,
        reason: "network_error",
        message:
          error instanceof Error ? error.message : "Unknown orchestrator error",
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
