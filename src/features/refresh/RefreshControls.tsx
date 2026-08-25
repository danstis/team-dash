/**
 * BSOD-303 (T049) — `RefreshControls` + `RefreshButton` + `ProgressIndicator`
 * + `OutcomeBanner` (US2, success + partial-failure rendering).
 *
 * Spec / contract references
 * --------------------------
 * Spec US2 acceptance scenario 4 (spec.md §"User Story 2"):
 *
 *   "Given the user is viewing the dashboard, When they choose Refresh,
 *    Then the dashboard shows progress, then on completion shows a
 *    success outcome with the last successful refresh timestamp, and
 *    indicates whether the currently displayed data is cached or fresh."
 *
 * And the FR-021 / FR-068 / FR-022 contract that flows from it:
 *
 *   - FR-020: "the system MUST provide a prominent, explicit manual
 *     Refresh action; the system MUST NOT perform scheduled or
 *     background refreshes without user action."
 *   - FR-021: "During a refresh, the system MUST show progress, and on
 *     completion MUST show the outcome (success, partial failure,
 *     cancellation, authentication failure, permission failure, or
 *     rate-limit failure) along with the last successful refresh
 *     timestamp and whether currently displayed data is cached or
 *     fresh."
 *   - FR-022: "A failed, cancelled, or incomplete refresh MUST NOT
 *     replace a previously complete cache with partial data; the last
 *     known-good complete cache MUST remain the data shown until a new
 *     refresh completes successfully." Pinned by routing every write
 *     through the `RefreshStagingRepository` so the orchestrator's
 *     `commit()`/`discard()` pair is the only path that moves staged
 *     rows into the live cache.
 *
 * Cached-vs-fresh labelling is T050 (BSOD-304, `FreshnessBanner`). The
 * failure-reason branch of the outcome banner is T051 (BSOD-305) — T049
 * ships the primitive shape with the success-variant copy and a
 * `partial_failure` shape that T051 will fill in with the
 * reason-specific text (cancelled / auth-failure / permission-failure /
 * rate-limited). The contract: the two `OutcomeBanner.kind` values T049
 * ships are `'success' | 'partial_failure'`, the latter carrying an
 * `errorDetail` field T051 will populate. T049's own success-path
 * integration test asserts the success variant only; the partial-failure
 * rendering is verified through the type-level contract so a future
 * contributor who deletes the partial-failure branch by accident
 * breaks the build.
 *
 * What this module owns
 * ---------------------
 * - `<RefreshControls />` — the US2 composition. Renders the refresh
 *   button, the progress indicator, and the outcome banner; owns the
 *   in-component state machine (`'idle' | 'running' | 'success' |
 *   'partial_failure'`). Drives a minimal refresh that fetches projects
 *   and tasks via the read-only Asana client (`fetchProjectsPage`,
 *   `fetchTasksPage`), stages the rows through `RefreshStagingRepository`,
 *   and commits or discards based on the outcome. T051 will extract
 *   the fetch/stage/commit/dispatch logic into a dedicated
 *   `src/data/refresh/refresh-orchestrator.ts` and extend the failure
 *   accounting onto the same state machine — the UI surface this
 *   module exposes is the contract both rows preserve.
 * - `<RefreshButton />` — the click-to-refresh button. Disabled while
 *   a refresh is in flight (`aria-busy="true"`) and while the
 *   preconditions (token, workspace) are not met.
 * - `<ProgressIndicator />` — the polite status region surfaced while
 *   a refresh is in flight. Decoupled from a spinner library so the
 *   consumer can add one without this primitive taking a styling
 *   dependency.
 * - `<OutcomeBanner />` — the outcome surface. Renders the success
 *   variant with the FR-021 completion timestamp, and the
 *   `partial_failure` variant with a placeholder error detail that
 *   T051 will fill in.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The orchestrator's per-outcome accounting (cancelled, auth,
 *   permission, rate-limited): T051. The component routes any
 *   non-`ok` projects/tasks fetch outcome through the
 *   `'partial_failure'` state and preserves the thrown message
 *   verbatim; T051's failure-reason rendering is the second consumer
 *   of that field.
 * - Cached-vs-fresh labelling: T050 (`FreshnessBanner`).
 * - Subtask project-membership resolution: T058 (BSOD-309) extends
 *   the task normaliser with parent→subtask project inheritance.
 *   T049 ships a minimal `normaliseTask` that resolves the
 *   `projects[]` array directly from the wire; T058 is the
 *   subsequent red→green row that introduces the FR-014 inheritance
 *   step at ingestion time.
 * - The `WorkspaceProvider` / `CredentialsProvider` / route guard
 *   wiring: pre-existing (T031, T046). The component reads the
 *   current token via `useCredentialTokenAccessor()` and the current
 *   workspace via `useWorkspace()`; it never calls the providers'
 *   write-side actions itself.
 *
 * Determinism
 * -----------
 * The component is fully synchronous on first paint (no async init,
 * no IndexedDB read). The refresh is driven exclusively by user
 * action (the FR-020 explicit-action rule). The `completedAt` string
 * surfaced by `OutcomeBanner` is the `RefreshSession.finishedAt` the
 * `RefreshStagingRepository.commit()` path writes, which is a fresh
 * `new Date().toISOString()` per call — not a fixture-stable value —
 * so a future regression that surfaces a stale or pre-epoch
 * timestamp fails the integration test's recent-instant assertion.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The plaintext token is consumed via
 * `useCredentialTokenAccessor().getPlaintextToken()` inside the click
 * handler and is never echoed into a `data-*` attribute, a log line,
 * or a `data-completed-at` payload. The `completedAt` string surfaced
 * by `OutcomeBanner` is a committed timestamp, and the thrown task /
 * project fetch errors this module currently surfaces are outcome-only
 * strings rather than token-bearing payloads. The `completedAt` ISO
 * string never contains the credential.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is a feature component boundary the plan
 * documents as the home for the refresh-flow React UI. This module
 * imports from:
 *   - `../../app/credentials-context` — `useCredentialTokenAccessor()`
 *     the shell mounts. The component reads the current token via
 *     this accessor on every click rather than subscribing to it
 *     through a state-driven effect, so a token rotation between
 *     mount and click is observed correctly.
 *   - `../../app/workspace-context` — `useWorkspace()` for the
 *     currently selected workspace.
 *   - `../../data/asana/client` — the read-only Asana client
 *     (`fetchProjectsPage`, `fetchTasksPage`, `src/data/asana/client.ts`).
 *   - `../../data/asana/schemas` — the Zod resource schemas whose
 *     inferred types the wire→cache normaliser takes as input.
 *   - `../../data/db/repositories/refresh-staging.repository` —
 *     the staged-commit storage boundary every refresh write goes
 *     through (T047 / BSOD-301).
 *   - `../../data/db/schema` — the `RefreshSession` Dexie row type
 *     the orchestrator seeds before `beginStaging` runs.
 * It does NOT import from `src/domain/**` (the ESLint boundary
 * enforced by `eslint.config.js` rejects a domain import here) and
 * it does NOT mutate Dexie directly (Constitution Principle VI:
 * every storage side effect goes through a repository).
 */
import { useCallback, useState, type ReactElement } from "react";
import type { z } from "zod";

import { useCredentialTokenAccessor } from "../../app/credentials-context";
import { useWorkspace } from "../../app/workspace-context";
import { fetchProjectsPage, fetchTasksPage } from "../../data/asana/client";
import type {
  asanaProjectSchema,
  asanaTaskSchema,
} from "../../data/asana/schemas";
import { refreshStagingRepository } from "../../data/db/repositories/refresh-staging.repository";
import {
  db,
  type Project,
  type RefreshSession,
  type Task,
} from "../../data/db/schema";

/* -------------------------------------------------------------------------- */
/* Wire-shape aliases                                                         */
/* -------------------------------------------------------------------------- */

type WireProject = z.infer<typeof asanaProjectSchema>;
type WireTask = z.infer<typeof asanaTaskSchema>;

/* -------------------------------------------------------------------------- */
/* Outcome surface                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The closed union of outcome variants `<OutcomeBanner />` renders.
 * The success variant ships in T049; the partial-failure variant
 * ships as a shape-only primitive in T049 (with a generic
 * `errorDetail` field) and T051 extends its rendering with
 * reason-specific copy. The shape is closed at the type level so
 * T051's extension is additive — the `OutcomeBanner` union widens
 * with a new variant, not a renames an existing one.
 */
export type RefreshOutcomeKind = "success" | "partial_failure";

/**
 * The shape `<OutcomeBanner />` consumes. `completedAt` is the ISO
 * string the `RefreshStagingRepository.commit()` path wrote on the
 * matching `RefreshSession` row; `errorDetail` is a short message the
 * refresh path surfaced for a partial failure.
 */
export interface RefreshOutcome {
  readonly kind: RefreshOutcomeKind;
  readonly completedAt: string | null;
  readonly errorDetail: string | null;
}

/* -------------------------------------------------------------------------- */
/* Minimal wire→cache normalisation                                            */
/* -------------------------------------------------------------------------- */

/**
 * The current local-date used to populate `Task.lastSeenInScopeAt` on
 * each successful retrieval pass. The data-model.md invariant is
 * "updated every refresh the task is still retrieved in" — the
 * `Date.now()` snapshot is consistent with the rest of the cache
 * layer's now-based labelling, even if the value drifts from the
 * orchestrator's `MetricContext.now` (T051 / T064 are the rows that
 * thread the canonical now through the orchestrator).
 */
function nowIsoDateTime(): string {
  return new Date().toISOString();
}

/**
 * Collapse a single Asana project wire row into the cache's
 * `Project` shape. The wire format nests `workspace` and `team` as
 * compact references; the cache flattens those into
 * `workspaceGid`/`asanaTeamGid` scalars. `portfolioGids` is left
 * empty here — T052 (BSOD-306, `SnapshotRepository`) is the row that
 * owns the portfolio→project edge, and the FR-016 reporting
 * requirements (FR-039 / FR-040) are downstream of T049.
 */
function normaliseProject(wire: WireProject): Project {
  return {
    gid: wire.gid,
    name: wire.name,
    workspaceGid: wire.workspace?.gid ?? "",
    asanaTeamGid: wire.team?.gid ?? null,
    portfolioGids: [],
    archived: wire.archived,
  };
}

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
 * Collapse a single Asana task wire row into the cache's `Task`
 * shape. Subtask project-membership inheritance (FR-014) is T058
 * (BSOD-309) — T049 stages the `projectGids` exactly as Asana
 * returned them, so a subtask whose `projects[]` is empty in the
 * wire shape is staged with `projectGids: []` and the future row
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
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The FR-020 manual-refresh button. Disabled when a refresh is
 * already in flight, when the token accessor reports no plaintext
 * token (e.g. the user landed on a placeholder surface before
 * completing the first-run flow), or when the workspace context
 * has not reported a selection. `aria-busy="true"` is set while the
 * running state is in flight so assistive tech announces the busy
 * state alongside the visible label change.
 */
export interface RefreshButtonProps {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly busy: boolean;
}

export function RefreshButton({
  onClick,
  disabled,
  busy,
}: Readonly<RefreshButtonProps>): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="refresh-button"
      data-variant="primary"
      aria-busy={busy}
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

/**
 * The FR-021 progress surface. Decoupled from a spinner library per
 * the same reasoning the shared `<LoadingState />` primitive
 * documents (`src/shared/states/LoadingState.tsx`): a CSS-only
 * spinner can be added by the consuming feature without this
 * primitive taking a styling dependency. The copy is
 * self-sufficient — a screen-reader user hears the same
 * announcement whether or not the spinner is visible, so the
 * visual decoration is non-essential.
 */
export function ProgressIndicator(): ReactElement {
  return (
    <div
      data-testid="progress-indicator"
      data-view-state="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Refreshing"
    >
      Refreshing your workspace…
    </div>
  );
}

/**
 * The FR-021 outcome surface. The `data-outcome` attribute carries
 * the discriminated `kind` value the test pins (and that T051 will
 * extend with the failure-reason branch). The `data-completed-at`
 * attribute exposes the ISO string the
 * `RefreshStagingRepository.commit()` path wrote — a stable
 * contract selector for a future contributor's regression test
 * (e.g. "the surfaced timestamp is the same as the persisted
 * `RefreshSession.finishedAt`").
 *
 * The `partial_failure` branch ships in T049 as a shape-only
 * primitive (a generic "Partial refresh" heading with a
 * `errorDetail` line). T051 will replace the body with
 * reason-specific copy (cancelled / auth-failure / permission-
 * failure / rate-limited) by widening the `RefreshOutcomeKind`
 * union — the existing success path's DOM contract is preserved
 * because the new variants are additive.
 */
export interface OutcomeBannerProps extends Readonly<RefreshOutcome> {}

export function OutcomeBanner({
  kind,
  completedAt,
  errorDetail,
}: OutcomeBannerProps): ReactElement {
  if (kind === "success") {
    return (
      <section
        data-testid="outcome-banner"
        data-outcome="success"
        data-completed-at={completedAt ?? ""}
        role="status"
        aria-live="polite"
        aria-label="Refresh complete"
      >
        <h2>Refresh complete</h2>
        <p>
          {completedAt === null
            ? "Your workspace data is up to date."
            : `Your workspace data is up to date as of ${completedAt}.`}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="outcome-banner"
      data-outcome="partial_failure"
      data-completed-at=""
      role="alert"
      aria-label="Partial refresh result"
    >
      <h2>Partial refresh result</h2>
      <p>
        {errorDetail ??
          "The refresh stopped before the workspace was fully retrieved. Your previous good cache has been kept."}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Main composition                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The in-component refresh state machine. `'idle'` is the rest
 * state; `'running'` is set the moment the user clicks the
 * button and the Asana round-trips are in flight; `'success'` is
 * set after the `RefreshStagingRepository.commit()` path resolves
 * the `RefreshSession.status` to `'succeeded'`; `'partial_failure'`
 * is the catch-all for any non-`ok` outcome the orchestrator
 * surfaces (T051 will split this into the documented failure kinds
 * but the UI surface stays a single state here).
 */
type RefreshState = "idle" | "running" | "success" | "partial_failure";

/**
 * Seed a running `RefreshSession` row before `beginStaging` runs.
 * The `RefreshStagingRepository.commit()` path requires the row to
 * exist; a missing row makes `commit()` throw with the documented
 * "RefreshSession was not seeded" error. The session is the
 * audit-trail artifact FR-068 / data-model.md pin.
 */
async function seedRunningSession(
  sessionId: string,
  workspaceGid: string,
): Promise<RefreshSession> {
  const row: RefreshSession = {
    id: sessionId,
    workspaceGid,
    startedAt: nowIsoDateTime(),
    finishedAt: null,
    status: "running",
    itemsRetrieved: 0,
    errorDetail: null,
    syncMode: "full",
  };
  await db.refreshSessions.put(row);
  return row;
}

/**
 * Generate a per-refresh session id. The T047 contract test seeds
 * a fixed `"session-1"` id; production refreshes get a fresh
 * id per click so concurrent refreshes (or repeated refreshes
 * after a discard) never collide on the same Dexie primary key.
 */
function makeSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

/**
 * The US2 refresh surface. Reads the current token and workspace
 * from the shell's provider tree, drives a minimal success-path
 * refresh against the Asana client on click, and surfaces the
 * outcome through the `<OutcomeBanner />`. See the module-level
 * docstring for the cross-row contract — T051 extracts the
 * fetch/stage/commit logic into a dedicated orchestrator and
 * extends the failure-reason accounting; T050 adds the
 * cached-vs-fresh label; T058 widens the task normaliser with
 * the FR-014 subtask inheritance. The component's public surface
 * (`<RefreshControls />` only) is preserved across those rows.
 */
export function RefreshControls(): ReactElement {
  const tokenAccessor = useCredentialTokenAccessor();
  const workspace = useWorkspace();
  const [state, setState] = useState<RefreshState>("idle");
  const [outcome, setOutcome] = useState<RefreshOutcome>({
    kind: "success",
    completedAt: null,
    errorDetail: null,
  });

  const isRunning = state === "running";
  const preconditionsMet =
    tokenAccessor.getPlaintextToken() !== null && workspace.workspace !== null;
  const buttonDisabled = isRunning || !preconditionsMet;

  const runRefresh = useCallback(async (): Promise<void> => {
    if (isRunning) {
      return;
    }
    const currentToken = tokenAccessor.getPlaintextToken();
    const currentWorkspace = workspace.workspace;
    if (currentToken === null || currentWorkspace === null) {
      return;
    }

    setState("running");
    const sessionId = makeSessionId();
    await seedRunningSession(sessionId, currentWorkspace.gid);

    try {
      await refreshStagingRepository.beginStaging(sessionId);

      // Fetch + stage every non-archived project in the workspace.
      // The pagination walk is orchestrator-driven: the Asana
      // client's stateless per-call contract
      // (`contracts/asana-client.md` § "Pagination") means a
      // multi-page workspace would loop on `next_page` here. T049
      // ships the single-page walk because the small-dataset
      // fixture fits on one page; T051's orchestrator is the
      // documented landing site for the multi-page walk.
      const projectsResult = await fetchProjectsPage(
        currentToken,
        currentWorkspace.gid,
      );
      if (projectsResult.outcome !== "ok") {
        throw new Error(`Failed to fetch projects: ${projectsResult.outcome}`);
      }
      const projects = projectsResult.data.data.map(normaliseProject);
      if (projects.length > 0) {
        await refreshStagingRepository.stageUpsert("projects", projects);
      }

      // Fetch + stage every task in each in-scope project. The
      // wire shape's `projectGids[]` becomes the cache's
      // `projectGids[]` verbatim at this stage; T058 (BSOD-309)
      // is the row that introduces FR-014 subtask inheritance.
      const lastSeenAt = nowIsoDateTime();
      for (const project of projects) {
        const tasksResult = await fetchTasksPage(currentToken, project.gid);
        if (tasksResult.outcome !== "ok") {
          throw new Error(
            `Failed to fetch tasks for project ${project.gid}: ${tasksResult.outcome}`,
          );
        }
        const tasks = tasksResult.data.data.map((task) =>
          normaliseTask(task, lastSeenAt),
        );
        if (tasks.length > 0) {
          await refreshStagingRepository.stageUpsert("tasks", tasks);
        }
      }

      // Single-Dexie-transaction flush of the staged rows plus
      // the session transition to `succeeded`. Dexie's native
      // transaction atomicity is the FR-022 / FR-068 enforcement
      // mechanism — a mid-batch throw rolls back both the
      // staged rows and the session transition so a partial
      // refresh never lands in the live cache.
      await refreshStagingRepository.commit(sessionId);

      const session = await db.refreshSessions.get(sessionId);
      setOutcome({
        kind: "success",
        completedAt: session?.finishedAt ?? nowIsoDateTime(),
        errorDetail: null,
      });
      setState("success");
    } catch (error) {
      // The catch is intentionally coarse at this stage: any
      // non-`ok` projects/tasks fetch outcome, a thrown Asana call,
      // or a staging validation failure routes here. T051 splits this into
      // reason-specific kinds (cancelled / auth-failure /
      // permission-failure / rate-limited) and maps them onto
      // the `partial_failure` rendering. The session stays
      // `running` (FR-068 — the orchestrator is the only caller
      // that transitions a session to a terminal failure
      // status); the discarded staging buffer leaves the live
      // cache untouched, satisfying FR-022.
      await refreshStagingRepository.discard(sessionId).catch(() => {
        // Discard is best-effort cleanup; an already-discarded
        // session (e.g. the orchestrator discarded it on a
        // previous failure) is not a re-throw condition here.
      });
      setOutcome({
        kind: "partial_failure",
        completedAt: null,
        errorDetail:
          error instanceof Error
            ? error.message
            : "The refresh stopped before the workspace was fully retrieved.",
      });
      setState("partial_failure");
    }
  }, [isRunning, tokenAccessor, workspace.workspace]);

  return (
    <section
      className="td-refresh-controls"
      data-testid="refresh-controls"
      aria-label="Refresh"
    >
      <RefreshButton
        onClick={() => {
          void runRefresh();
        }}
        disabled={buttonDisabled}
        busy={isRunning}
      />
      {state === "running" && <ProgressIndicator />}
      {state !== "idle" && state !== "running" && (
        <OutcomeBanner
          kind={outcome.kind}
          completedAt={outcome.completedAt}
          errorDetail={outcome.errorDetail}
        />
      )}
    </section>
  );
}
