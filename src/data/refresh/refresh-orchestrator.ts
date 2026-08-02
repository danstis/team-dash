/**
 * `src/data/refresh/refresh-orchestrator` — the US2 refresh entry point
 * (T051, S01).
 *
 * This module is the **single coordinator** that drives a Refresh from
 * the user's click to a persisted cache update. Per Constitution
 * Principle VI (single coordinator pattern, MEM001) and decision
 * D001/D002, the refresh pipeline is one orchestrator with a
 * well-defined dependency surface — there is no second place in the
 * codebase that knows how to write to the cache during a refresh.
 *
 * What this module owns
 * ---------------------
 * 1. **RefreshSession seeding** (FR-068): before any work begins the
 *    orchestrator inserts a `RefreshSession` row with `status:
 *    'running'`. The `RefreshStagingRepository.commit()` path
 *    transitions this row to `succeeded` inside the same Dexie
 *    transaction as the cache flush; the orchestrator transitions
 *    failure states (auth/permission/rate-limited/cancelled/
 *    partial_failure) on its own.
 *
 * 2. **The pagination walk** for every list endpoint the refresh
 *    touches (`fetchProjectsPage`, `fetchTasksPage`). The Asana
 *    client is stateless per call
 *    (`specs/001-asana-team-dashboard/contracts/asana-client.md` §
 *    "Pagination"); the orchestrator drives the loop, calling the
 *    client again with `next_page.offset` until the field is
 *    `null`. The single-page and multi-page walks are exercised
 *    end-to-end against the small-dataset fixture and the
 *    `asana-client.pagination.test.ts` contract test, respectively.
 *
 * 3. **Wire-to-cache normalisation** (FR-014, FR-081, FR-082) via the
 *    sibling `normalise.ts` module. The orchestrator is the only
 *    caller of `normaliseTask`, `normaliseProject`,
 *    `deriveAsanaTeams`, `buildPriorityField`,
 *    `applySubtaskProjectInheritance`, and `buildDependencyEdges`.
 *
 * 4. **The Dexie-backed state machine** (MEM001). The
 *    `RefreshSession` row is the canonical observer surface; UI
 *    components consume it via `useLiveQuery` so persisted truth
 *    and component-local status cannot diverge. The orchestrator
 *    never owns a long-lived in-memory state — every state
 *    transition is persisted to Dexie so a page reload mid-refresh
 *    sees the running session and can recover.
 *
 * 5. **Failure-mode accounting** (FR-021, FR-068). The six
 *    `AsanaClientResultOutcome`s map onto the
 *    `RefreshSession.status` union as follows:
 *
 *       | Asana outcome          | Session status   | Outcome reason |
 *       |------------------------|------------------|----------------|
 *       | `ok`                   | `succeeded`      | (commit path)  |
 *       | `auth_failure`         | `auth_failure`   | `auth_failure` |
 *       | `permission_failure`   | `permission_failure` | `permission_failure` |
 *       | `rate_limited`         | `rate_limited`   | `rate_limited` |
 *       | `network_error`        | `partial_failure`| `network_error`|
 *       | `validation_error`     | `partial_failure`| `validation_error` |
 *       | (signal abort)         | `cancelled`      | (cancelled)    |
 *
 *    `network_error` and `validation_error` share the
 *    `partial_failure` status because both are transient /
 *    recoverable states where the previous good cache is kept
 *    (FR-022); the orchestrator's `OutcomeBanner` distinguishes the
 *    two via the outcome's `reason` field. `auth_failure` /
 *    `permission_failure` / `rate_limited` get their own status
 *    enum values per the data-model.md RefreshSession contract.
 *
 * 6. **Atomic refresh integrity** (FR-022, FR-068). On any failure
 *    path the orchestrator calls
 *    `refreshStagingRepository.discard(sessionId)` to drop the
 *    in-memory buffer without touching the live cache, then writes
 *    the terminal `RefreshSession` row to Dexie. The cache is never
 *    partially applied — the `commit()` path is the ONLY path that
 *    flushes staged rows to the live stores, and it does so inside
 *    one Dexie transaction (T047).
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - **UI**: `src/features/refresh/RefreshControls.tsx` consumes the
 *   orchestrator via `createRefreshOrchestrator(deps)(args)`. The
 *   component knows nothing about the Asana client or the staging
 *   repository — it just calls `runRefresh` and surfaces the
 *   `RefreshOutcome` through the `OutcomeBanner`.
 * - **The `SnapshotRepository.backfillSnapshots()` call**: per
 *   decision D002 / MEM002, the daily snapshot backfill MUST happen
 *   inside the same Dexie transaction as the cache flush; that
 *   wiring lands in T02 (`refresh-staging.repository.ts` is updated
 *   to call `SnapshotRepository.backfillSnapshots()` from inside
 *   `commit()`). T01 ships the orchestrator that produces the
 *   staging rows; T02 closes the snapshot backfill loop.
 * - **The credential / workspace gate**: the orchestrator takes the
 *   plaintext token and selected workspace as parameters from the
 *   caller. It does not read from `CredentialsProvider` or
 *   `WorkspaceProvider` directly (the orchestrator is data-layer,
 *   not feature-layer).
 * - **Background or scheduled refreshes** (FR-020 explicit-action
 *   rule): the orchestrator is invoked exclusively by a user click.
 *
 * Cancellation
 * ------------
 * The orchestrator accepts an `AbortSignal`. On every client call
 * the orchestrator passes the signal through; on the next control
 * point after a client call it checks `signal.aborted` and, if set,
 * discards the staging buffer and transitions the session to
 * `cancelled`. The Asana client surfaces a `network_error` on an
 * aborted fetch (because the underlying `fetch` rejects with
 * `AbortError`), so the cancellation check runs BEFORE the outcome
 * switch so an aborted fetch is not misreported as a
 * `network_error`.
 *
 * Determinism
 * -----------
 * - The orchestrator accepts a `now` dependency for ISO-timestamp
 *   generation so tests can pin time. The default is
 *   `() => new Date().toISOString()`.
 * - The orchestrator accepts a `makeSessionId` dependency for the
 *   same reason; the default uses `crypto.randomUUID()`.
 * - The orchestrator accepts an `AsanaClientSurface` and a
 *   `RefreshStagingRepository` for test injection; production
 *   callers pass the real implementations.
 *
 * Boundary
 * --------
 * `src/data/refresh/**` is the data-side orchestration boundary
 * documented in plan.md. This module imports from
 * `src/data/asana/schemas`, `src/data/asana/types`, and
 * `src/data/db/**`. It MUST NOT import from `src/app/**`,
 * `src/features/**`, `src/domain/**`, or `src/shared/**` — the ESLint
 * boundary rule in `eslint.config.js` enforces that.
 */

import type { z } from "zod";

import {
  fetchProjectsPage,
  fetchTasksPage,
} from "../asana/client";
import type {
  asanaProjectListResponseSchema,
  asanaTaskListResponseSchema,
} from "../asana/schemas";
import type { AsanaClientResult } from "../asana/types";
import { refreshStagingRepository } from "../db/repositories/refresh-staging.repository";
import {
  type AsanaTeam,
  type Dependency,
  type PriorityField,
  type Project,
  type RefreshSession,
  type Task,
  db,
} from "../db/schema";
import {
  applySubtaskProjectInheritance,
  buildDependencyEdges,
  buildPriorityField,
  deriveAsanaTeams,
  normaliseProject,
  normaliseTask,
} from "./normalise";

/* -------------------------------------------------------------------------- */
/* Wire-shape aliases                                                         */
/* -------------------------------------------------------------------------- */

type WireProject = z.infer<typeof asanaProjectListResponseSchema>["data"][number];
type WireTask = z.infer<typeof asanaTaskListResponseSchema>["data"][number];

/* -------------------------------------------------------------------------- */
/* Outcome surface                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The set of failure reasons the orchestrator distinguishes on its
 * `partial_failure` outcome. The mapping from
 * `AsanaClientResultOutcome` to these values is documented in the
 * module-level docstring's failure-mode table; the type-level
 * exhaustiveness is enforced by the orchestrator's switch on the
 * client outcome union.
 */
export type RefreshFailureReason =
  | "auth_failure"
  | "permission_failure"
  | "rate_limited"
  | "network_error"
  | "validation_error";

/**
 * The closed outcome union the orchestrator returns to its caller.
 * The `sessionId` is included on every variant so the UI can
 * correlate the outcome to the persisted `RefreshSession` row
 * (FR-068 audit-trail invariant — every refresh leaves exactly one
 * row behind, and the UI displays its id on demand).
 */
export type RefreshOutcome =
  | {
      readonly kind: "success";
      readonly sessionId: string;
      readonly completedAt: string;
      readonly itemsRetrieved: number;
    }
  | {
      readonly kind: "partial_failure";
      readonly sessionId: string;
      readonly reason: RefreshFailureReason;
      readonly message: string;
    }
  | {
      readonly kind: "cancelled";
      readonly sessionId: string;
    };

/* -------------------------------------------------------------------------- */
/* AsanaClientSurface (test seam)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The narrow client surface the orchestrator depends on. Mirrors the
 * `fetchProjectsPage` and `fetchTasksPage` exports of the real
 * `src/data/asana/client.ts` module so a test fixture can supply a
 * scripted fake without monkey-patching the module-level exports.
 *
 * Both methods take the same `(token, …, options?)` shape as the
 * real client; the orchestrator passes its `AbortSignal` through so
 * cancellation propagates to the underlying `fetch`.
 */
export interface AsanaClientSurface {
  fetchProjectsPage(
    token: string,
    workspaceGid: string,
    options?: Readonly<{ offset?: string; signal?: AbortSignal }>,
  ): Promise<AsanaClientResult<z.infer<typeof asanaProjectListResponseSchema>>>;
  fetchTasksPage(
    token: string,
    projectGid: string,
    options?: Readonly<{ offset?: string; signal?: AbortSignal }>,
  ): Promise<AsanaClientResult<z.infer<typeof asanaTaskListResponseSchema>>>;
}

/**
 * The default `AsanaClientSurface` built from the real
 * `src/data/asana/client.ts` exports. Production callers wire this
 * surface into the orchestrator; tests construct their own fakes.
 */
export const realAsanaClient: AsanaClientSurface = {
  fetchProjectsPage,
  fetchTasksPage,
};

/* -------------------------------------------------------------------------- */
/* Orchestrator dependencies                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The orchestrator's dependency bag. Production callers pass the
 * default `realAsanaClient` (built from the module-level exports of
 * `src/data/asana/client.ts`) and the module-level
 * `refreshStagingRepository` singleton; tests pass fakes.
 *
 * The `now` and `makeSessionId` hooks are pure time / id helpers
 * that are defaulted at the bottom of the module; tests inject
 * deterministic versions.
 */
export interface RefreshOrchestratorDeps {
  readonly asanaClient: AsanaClientSurface;
  readonly staging: typeof refreshStagingRepository;
  readonly dbInstance: typeof db;
  readonly now: () => string;
  readonly makeSessionId: () => string;
}

/* -------------------------------------------------------------------------- */
/* RefreshOrchestrator interface                                              */
/* -------------------------------------------------------------------------- */

/**
 * The public surface every orchestrator implementation satisfies.
 * `createRefreshOrchestrator(deps)` is the production factory; the
 * type is exported so a future feature-layer test can supply a
 * mock that does not import the production factory.
 */
export interface RefreshOrchestrator {
  /**
   * Drive one refresh to completion (success or terminal failure).
   * The returned promise never rejects for any documented failure
   * mode — every outcome surfaces as a `RefreshOutcome` variant so
   * the caller's switch is exhaustive and there is no try/catch
   * scattered through UI code.
   *
   * @param args.token        Plaintext Asana PAT (FR-008 / FR-010:
   *                          the orchestrator never logs it).
   * @param args.workspaceGid The currently-selected workspace.
   * @param args.workspaceName The currently-selected workspace's
   *                          display name (currently unused; the
   *                          workspace cache is managed by the
   *                          credentials/workspace flow rather than
   *                          the refresh path).
   * @param args.signal       Optional `AbortSignal` for cancellation
   *                          (FR-020 explicit-action rule: cancellation
   *                          is a user-initiated abort, not a timer).
   */
  runRefresh(args: {
    readonly token: string;
    readonly workspaceGid: string;
    readonly workspaceName: string;
    readonly signal?: AbortSignal;
  }): Promise<RefreshOutcome>;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Map the orchestrator's failure-mode accounting onto the persisted
 * `RefreshSession.status` enum. The mapping is the inverse of the
 * docstring's failure-mode table; the function exists once so a
 * future contributor adding a new outcome variant only needs to
 * update one switch.
 */
function failureStatusForReason(
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
    case "validation_error":
      return "partial_failure";
  }
}

/**
 * Build a short, scrubbed message string for the
 * `RefreshSession.errorDetail` and the outcome's `message` field.
 * The token is NEVER included (FR-008 / FR-010) — the message is
 * the outcome discriminant and (optionally) the first Zod issue's
 * path. Validation issues carry structured `ZodIssue[]` data which
 * the FR-084 data-quality panel surfaces; we surface a compact
 * one-line summary in the session's `errorDetail` so the audit
 * trail is human-readable.
 */
function describeFailure(
  result: Exclude<AsanaClientResult<unknown>, { outcome: "ok" }>,
): string {
  switch (result.outcome) {
    case "auth_failure":
      return "Authentication failed: the token was rejected by Asana.";
    case "permission_failure":
      return result.resource !== undefined
        ? `Permission denied while accessing ${result.resource}.`
        : "Permission denied by Asana.";
    case "rate_limited":
      return `Rate limited by Asana; retry after ${result.retryAfterMs}ms.`;
    case "network_error":
      return `Network error: ${result.message}`;
    case "validation_error": {
      const first = result.issues[0];
      if (first === undefined) {
        return "Asana response failed schema validation.";
      }
      const path =
        first.path.length > 0 ? first.path.join(".") : "(root)";
      return `Asana response failed schema validation at ${path}: ${first.message}`;
    }
  }
}

/**
 * Drive the multi-page pagination walk for a list endpoint. The
 * `fetchPage` callback takes the previous response's `next_page.offset`
 * (or `undefined` on the first call) and returns the next page. The
 * walk terminates when the `next_page` field is `null` / `undefined`.
 *
 * The function short-circuits on `signal.aborted` between pages so
 * a cancellation midway through a multi-page walk does not issue
 * an extra request; the orchestrator handles the cancellation
 * outcome higher up the call stack.
 *
 * The pagination token is opaque (Asana documents
 * `next_page.offset` as a base64-ish string), so it is passed
 * through verbatim.
 */
async function walkPagination<TRow>(
  fetchPage: (
    offset: string | undefined,
  ) => Promise<
    AsanaClientResult<{
      data: TRow[];
      next_page: { offset: string; path: string } | null | undefined;
    }>
  >,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "ok"; rows: TRow[] }
  | { kind: "aborted" }
  | {
      kind: "failure";
      result: Exclude<AsanaClientResult<unknown>, { outcome: "ok" }>;
    }
> {
  const rows: TRow[] = [];
  let offset: string | undefined = undefined;
  for (;;) {
    if (signal?.aborted === true) {
      return { kind: "aborted" };
    }
    const page = await fetchPage(offset);
    if (page.outcome !== "ok") {
      return {
        kind: "failure",
        result: page as unknown as Exclude<
          AsanaClientResult<unknown>,
          { outcome: "ok" }
        >,
      };
    }
    rows.push(...page.data.data);
    if (
      page.data.next_page === null ||
      page.data.next_page === undefined
    ) {
      return { kind: "ok", rows };
    }
    offset = page.data.next_page.offset;
  }
}

/* -------------------------------------------------------------------------- */
/* Orchestrator factory                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a `RefreshOrchestrator` bound to the supplied dependency bag.
 * Production callers pass `realAsanaClient`, the module-level
 * `refreshStagingRepository`, the module-level `db`, and accept the
 * default `now` / `makeSessionId` helpers. Tests can pass any
 * combination of fakes.
 */
export function createRefreshOrchestrator(
  deps: RefreshOrchestratorDeps,
): RefreshOrchestrator {
  const { asanaClient, staging, dbInstance, now, makeSessionId } = deps;

  return {
    async runRefresh({ token, workspaceGid, signal }) {
      const sessionId = makeSessionId();

      // Step 1 — seed the running session BEFORE beginStaging.
      // `RefreshStagingRepository.commit()` requires the row to
      // exist; a missing row makes commit() throw with the
      // documented "RefreshSession was not seeded" error.
      const runningSession: RefreshSession = {
        id: sessionId,
        workspaceGid,
        startedAt: now(),
        finishedAt: null,
        status: "running",
        itemsRetrieved: 0,
        errorDetail: null,
        syncMode: "full",
      };
      await dbInstance.refreshSessions.put(runningSession);

      // Step 2 — begin staging. The contract is that no live cache
      // store is touched until commit(); the staging buffer is
      // in-memory per-sessionId.
      await staging.beginStaging(sessionId);

      try {
        // Step 3 — fetch + paginate projects, then normalise.
        const projectsWalk = await walkPagination<WireProject>(
          (offset) =>
            asanaClient.fetchProjectsPage(token, workspaceGid, {
              offset,
              signal,
            }),
          signal,
        );

        if (projectsWalk.kind === "aborted") {
          return await handleCancellation(
            sessionId,
            staging,
            dbInstance,
            now,
          );
        }
        if (projectsWalk.kind === "failure") {
          return await handleClientFailure(
            sessionId,
            projectsWalk.result,
            staging,
            dbInstance,
            now,
          );
        }

        const wireProjects = projectsWalk.rows;
        const projects: Project[] = wireProjects.map(normaliseProject);

        if (projects.length > 0) {
          await staging.stageUpsert("projects", projects);
        }

        // Step 4 — fetch + paginate tasks per project. The wire
        // tasks are kept in a side map keyed by gid so the
        // dependency / priority derivation can iterate the
        // original wire shape (the cache row only carries
        // `dependsOnTaskGids: string[]`, not the full reference
        // list).
        const wireTasksByGid = new Map<string, WireTask>();
        const allTasks: Task[] = [];
        let itemsRetrieved = projects.length;

        for (const project of projects) {
          const tasksWalk = await walkPagination<WireTask>(
            (offset) =>
              asanaClient.fetchTasksPage(token, project.gid, {
                offset,
                signal,
              }),
            signal,
          );

          if (tasksWalk.kind === "aborted") {
            return await handleCancellation(
              sessionId,
              staging,
              dbInstance,
              now,
            );
          }
          if (tasksWalk.kind === "failure") {
            return await handleClientFailure(
              sessionId,
              tasksWalk.result,
              staging,
              dbInstance,
              now,
            );
          }

          const wireTasks = tasksWalk.rows;
          const lastSeenAt = now();
          const normalisedTasks = wireTasks.map((task) =>
            normaliseTask(task, { lastSeenAt }),
          );

          for (const wireTask of wireTasks) {
            wireTasksByGid.set(wireTask.gid, wireTask);
          }
          allTasks.push(...normalisedTasks);
          itemsRetrieved += normalisedTasks.length;
        }

        // Step 5 — apply FR-014 subtask projectGids inheritance.
        // The second pass needs the parent's projects to be
        // already collected, so it runs after the per-project walk
        // completes for every project.
        const tasksWithInheritance =
          applySubtaskProjectInheritance(allTasks);

        // Step 6 — build dependency cache rows. The accessibility
        // flag requires the full task set, so the dependency
        // builder runs after the inheritance pass.
        const inScopeTaskGids = new Set(
          tasksWithInheritance.map((t) => t.gid),
        );
        const resolvedDependencies: Dependency[] = [];
        for (const task of tasksWithInheritance) {
          const wireTask = wireTasksByGid.get(task.gid);
          if (wireTask === undefined) {
            continue;
          }
          resolvedDependencies.push(
            ...buildDependencyEdges(wireTask, inScopeTaskGids),
          );
        }

        // Step 7 — group tasks per project for the PriorityField
        // derivation.
        const priorityFields: PriorityField[] = projects.map((project) =>
          buildPriorityField(
            project.gid,
            tasksWithInheritance.filter((task) =>
              task.projectGids.includes(project.gid),
            ),
          ),
        );

        // Step 8 — derive AsanaTeam cache rows from the project's
        // `asanaTeamGid` scalars.
        const asanaTeams: AsanaTeam[] = deriveAsanaTeams(
          projects,
          workspaceGid,
        );

        // Step 9 — stage every cache row. Empty arrays are a no-op
        // (the staging repository's contract) so it is safe to
        // call stageUpsert with empty rows when, e.g., the
        // workspace has no projects.
        if (tasksWithInheritance.length > 0) {
          await staging.stageUpsert("tasks", tasksWithInheritance);
        }
        if (resolvedDependencies.length > 0) {
          await staging.stageUpsert("dependencies", resolvedDependencies);
        }
        if (priorityFields.length > 0) {
          await staging.stageUpsert("priorityFields", priorityFields);
        }
        if (asanaTeams.length > 0) {
          await staging.stageUpsert("asanaTeams", asanaTeams);
        }

        // Step 10 — commit the staging buffer. `commit()`
        // transitions the running session to `succeeded` inside
        // the same Dexie transaction as the cache flush; a throw
        // here rolls back both the staged rows and the session
        // transition (FR-022 / FR-068 atomicity).
        try {
          await staging.commit(sessionId);
        } catch (commitError) {
          // A commit failure is the FR-068 "atomic refresh
          // integrity" failure path. The session stays running
          // (commit failed before the row was updated); the
          // orchestrator transitions the session to
          // `partial_failure` so the UI sees a terminal state and
          // the previous good cache stays intact.
          const message =
            commitError instanceof Error
              ? commitError.message
              : "Refresh commit failed";
          await dbInstance.refreshSessions.put({
            ...runningSession,
            status: "partial_failure",
            finishedAt: now(),
            errorDetail: message,
          });
          return {
            kind: "partial_failure",
            sessionId,
            reason: "network_error",
            message,
          };
        }

        const committedSession =
          await dbInstance.refreshSessions.get(sessionId);
        const completedAt =
          committedSession?.finishedAt ?? runningSession.finishedAt ?? now();

        return {
          kind: "success",
          sessionId,
          completedAt,
          itemsRetrieved,
        };
      } catch (unexpected) {
        // Catch-all for any synchronous throw (e.g. Dexie write
        // failure on session seeding) that escaped the staged
        // error-handling chain. The buffer is discarded, the
        // session is transitioned to `partial_failure`, and the
        // outcome surfaces the error message.
        await staging.discard(sessionId).catch(() => {
          // discard is best-effort; an already-discarded session
          // is not a re-throw condition here.
        });
        const message =
          unexpected instanceof Error
            ? unexpected.message
            : "Refresh failed with an unexpected error.";
        await dbInstance.refreshSessions.put({
          ...runningSession,
          status: "partial_failure",
          finishedAt: now(),
          errorDetail: message,
        });
        return {
          kind: "partial_failure",
          sessionId,
          reason: "network_error",
          message,
        };
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cancellation / failure helpers                                             */
/* -------------------------------------------------------------------------- */

/**
 * Handle an abort detected mid-pagination. The staging buffer is
 * discarded (FR-022 — the live cache stays untouched), the session
 * is transitioned to `cancelled`, and the orchestrator returns the
 * `cancelled` outcome variant.
 */
async function handleCancellation(
  sessionId: string,
  staging: typeof refreshStagingRepository,
  dbInstance: typeof db,
  now: () => string,
): Promise<Extract<RefreshOutcome, { kind: "cancelled" }>> {
  await staging.discard(sessionId).catch(() => undefined);
  const existing = await dbInstance.refreshSessions.get(sessionId);
  if (existing !== undefined) {
    await dbInstance.refreshSessions.put({
      ...existing,
      status: "cancelled",
      finishedAt: now(),
      errorDetail: "Refresh was cancelled.",
    });
  }
  return { kind: "cancelled", sessionId };
}

/**
 * Handle a non-`ok` outcome from the Asana client. The staging
 * buffer is discarded, the session is transitioned to the
 * failure-mode-specific status, and the orchestrator returns the
 * `partial_failure` outcome variant with the matching reason.
 */
async function handleClientFailure(
  sessionId: string,
  result: Exclude<AsanaClientResult<unknown>, { outcome: "ok" }>,
  staging: typeof refreshStagingRepository,
  dbInstance: typeof db,
  now: () => string,
): Promise<Extract<RefreshOutcome, { kind: "partial_failure" }>> {
  await staging.discard(sessionId).catch(() => undefined);
  const reason = result.outcome as RefreshFailureReason;
  const message = describeFailure(result);
  const existing = await dbInstance.refreshSessions.get(sessionId);
  if (existing !== undefined) {
    await dbInstance.refreshSessions.put({
      ...existing,
      status: failureStatusForReason(reason),
      finishedAt: now(),
      errorDetail: message,
    });
  }
  return { kind: "partial_failure", sessionId, reason, message };
}

/* -------------------------------------------------------------------------- */
/* Default factory helpers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The default `now()` helper — ISO-instant formatted. The refresh
 * orchestrator pins every `RefreshSession` / `Snapshot` /
 * `lastSeenInScopeAt` timestamp to this value, so a deterministic
 * clock here keeps the integration tests' timestamps stable.
 */
export function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * The default `makeSessionId()` helper — `crypto.randomUUID()` with
 * the documented `session-` prefix. The prefix is purely for log /
 * debug readability; the underlying value is opaque.
 */
export function defaultMakeSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}
