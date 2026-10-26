/**
 * T058 (BSOD-309) — Ingestion-time normalisation of the Asana wire rows.
 *
 * Where this module sits
 * ----------------------
 * `src/data/asana/schemas.ts` is the *validation* boundary: it decides
 * whether a response body is a well-formed Asana resource. This module
 * is the *normalisation* boundary: it decides what the cache row looks
 * like once a validated wire row is written. The two are deliberately
 * separate — a schema never enriches a row, and a normaliser never
 * re-validates one (FR-081 / FR-082 / FR-083: the validation outcome
 * and the stored row are two different facts).
 *
 * What this module owns
 * ---------------------
 * 1. **Wire → cache shape.** `asanaTaskSchema` / `asanaProjectSchema`
 *    describe Asana's snake_case resources with compact nested
 *    references (`{ gid, name }`); the cache stores flat camelCase rows
 *    (`src/data/db/schema.ts`). `normaliseTask` / `normaliseProject`
 *    are the single translation between the two — the refresh
 *    orchestrator (`src/data/refresh/refresh-orchestrator.ts`) calls
 *    them rather than re-implementing the mapping.
 *
 * 2. **FR-014 — subtask project-membership resolution.** Asana does not
 *    repeat the parent task's project metadata on a subtask record: a
 *    subtask commonly carries `projects: []` while its parent belongs
 *    to one or more projects. Such a subtask lands in the cache with an
 *    empty `projectGids`, and the in-scope predicate
 *    (`data-model.md` → "In-scope predicate") drops it from every figure
 *    the dashboard reports — the team's subtask effort disappears
 *    without any error being raised.
 *
 *    `resolveSubtaskProjectGids` resolves that membership at ingestion
 *    time, once, before the row is written, so `src/domain/**` never
 *    needs parent-lookup logic (`data-model.md` → "Subtask
 *    resolution": "this normalisation happens once, at write time").
 *
 * The rules the resolution follows
 * --------------------------------
 * - **Only subtasks inherit.** A task with `parentTaskGid === null`
 *   keeps its own memberships verbatim — a standard task's membership
 *   is whatever Asana reported for it.
 * - **The union, never a replacement.** A subtask's resolved membership
 *   is its own memberships ∪ its parent's *resolved* memberships. The
 *   union never drops a membership Asana reported explicitly and never
 *   drops the parent's membership — the latter is the case FR-014
 *   names. Membership order is stable (own first, inherited second)
 *   and de-duplicated.
 * - **Out-of-scope memberships are retained, not filtered.** The cache
 *   stores *all* project memberships; the reporting layer filters them
 *   (`data-model.md` → `Task.projectGids`: "all project memberships,
 *   including out-of-scope ones filtered at the reporting layer, not
 *   the storage layer"). The resolver therefore never needs to know
 *   which projects are in scope.
 * - **An unknown parent changes nothing.** When the parent row is
 *   neither in the ingested batch nor in `knownParents`, the subtask's
 *   memberships are left exactly as Asana reported them. The resolver
 *   never guesses a membership and never marks a row out-of-scope —
 *   FR-023 requires a record to be removed or marked only when the
 *   condition can be determined reliably.
 * - **Parent chains resolve transitively; cycles terminate.** A subtask
 *   of a subtask inherits the ancestor's memberships. A corrupt parent
 *   cycle terminates the walk instead of recursing forever.
 *
 * Boundary
 * --------
 * `src/data/asana/**` is the network-acquisition boundary the spec
 * draws. This module imports only the Zod-inferred wire types
 * (`./schemas`) and the cache row types (`../db/schema`); it performs no
 * I/O, holds no module-level state, and never reaches for React, the
 * app shell, feature UI, or `src/domain/**` (Principle VI).
 */

import type { z } from "zod";

import type { Project, Task } from "../db/schema";
import type { asanaProjectSchema, asanaTaskSchema } from "./schemas";

/* -------------------------------------------------------------------------- */
/* Wire types                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The validated Asana project resource — the Zod-inferred shape of
 * `asanaProjectSchema`. Exported so callers can type a wire payload
 * without re-deriving the inference.
 */
export type WireProject = z.infer<typeof asanaProjectSchema>;

/**
 * The validated Asana task resource — the Zod-inferred shape of
 * `asanaTaskSchema`. Exported so callers can type a wire payload
 * without re-deriving the inference.
 */
export type WireTask = z.infer<typeof asanaTaskSchema>;

/* -------------------------------------------------------------------------- */
/* Project normalisation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Collapse a single Asana project wire row into the cache's `Project`
 * shape.
 *
 * The wire format nests `workspace` and `team` as compact references;
 * the cache flattens those into the `workspaceGid` / `asanaTeamGid`
 * scalars. `portfolioGids` is left empty here — the portfolio→project
 * edge is owned by the reporting rows (FR-039 / FR-040), and the
 * project row's own portfolio membership is not part of the retrieval
 * contract's project shape.
 *
 * The `workspaceGid` is the *selected* workspace rather than the wire's
 * `workspace.gid` — the two agree for every project the refresh walks
 * (the projects page is scoped to the selected workspace), and using
 * the selected gid means a project whose wire omits the workspace
 * reference still lands in the right scope.
 */
export function normaliseProject(
  wire: WireProject,
  workspaceGid: string,
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

/* -------------------------------------------------------------------------- */
/* Task normalisation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The Asana prebuilt custom field the dashboard reads as the task's
 * estimated minutes (FR-016 / data-model.md — "Estimated Time"). Held
 * as a named constant rather than an inline literal so the lookup
 * site, its docstring, and any future reader of the same field refer
 * to one source of truth.
 */
const ESTIMATED_TIME_FIELD_NAME = "Estimated Time";

/**
 * Extract the "Estimated Time" custom field's `number_value` as the
 * cache's `estimatedMinutes` scalar. Returns `null` when the field is
 * absent or has no numeric value — the data-model.md distinction
 * between `null` (tracked but not entered) and the literal
 * `'unavailable'` (workspace without Time Tracking) is recorded by the
 * reporting layer, not by the normaliser.
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
 * Collapse a single Asana task wire row into the cache's `Task` shape.
 *
 * The wire's `projects[]` becomes the flat `projectGids` array, the
 * compact `parent` / `assignee` references become `parentTaskGid` /
 * `assigneeGid` scalars, and the `*_at` timestamps become the cache's
 * camelCase instants.
 *
 * `parent` is the already-normalised parent row when the caller already
 * holds it. When it is supplied, the task's memberships are resolved
 * against the parent's (FR-014) before the row is returned; when it is
 * omitted, the row carries exactly the memberships Asana reported —
 * `resolveSubtaskProjectGids` is the batch-level entry point that
 * performs the same resolution once the whole batch (and therefore the
 * parent rows) is known.
 */
export function normaliseTask(
  wire: WireTask,
  lastSeenAt: string,
  parent?: Task | null,
): Task {
  const ownProjectGids = (wire.projects ?? []).map((project) => project.gid);

  return {
    gid: wire.gid,
    name: wire.name,
    assigneeGid: wire.assignee?.gid ?? null,
    projectGids:
      parent === undefined || parent === null
        ? ownProjectGids
        : mergeProjectGids(ownProjectGids, parent.projectGids),
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
/* FR-014 — subtask project-membership resolution                              */
/* -------------------------------------------------------------------------- */

/**
 * Merge a task's own project memberships with the memberships it
 * inherits from its parent (FR-014).
 *
 * The result is the union of the two sets: the task's own memberships
 * come first (in wire order), the inherited ones follow (in the
 * parent's order), and a membership that appears in both is listed
 * once. The helper is pure — it never mutates either input, and it
 * always returns a fresh array.
 */
export function mergeProjectGids(
  own: readonly string[],
  inherited: readonly string[],
): string[] {
  const merged = [...own];
  const seen = new Set(own);
  for (const gid of inherited) {
    if (!seen.has(gid)) {
      seen.add(gid);
      merged.push(gid);
    }
  }
  return merged;
}

/**
 * Resolve every subtask's project memberships from its parent task's
 * memberships (FR-014).
 *
 * The rows passed in are the normalised cache rows of the batch being
 * ingested. A row whose `parentTaskGid` is set inherits the parent's
 * *resolved* memberships — so a chain of parents resolves transitively
 * — and a row whose parent is unknown keeps the memberships Asana
 * reported for it.
 *
 * `knownParents` supplies parent rows that are not part of `tasks` —
 * for example a parent that was retrieved in an earlier batch of the
 * same refresh. Rows in `tasks` win over `knownParents` for the same
 * gid: the batch being written is the fresher fact.
 *
 * The returned array has the same length and order as `tasks`; a row
 * whose memberships did not change is returned by reference (the same
 * object), so a caller can stage only the rows the resolution
 * actually touched.
 */
export function resolveSubtaskProjectGids(
  tasks: readonly Task[],
  knownParents?: ReadonlyMap<string, Task>,
): Task[] {
  const rowsByGid = new Map<string, Task>();
  for (const task of tasks) {
    rowsByGid.set(task.gid, task);
  }

  /** Memoised resolutions, keyed by task gid. */
  const resolved = new Map<string, string[]>();
  /** Gids on the current resolution path — the cycle guard. */
  const resolving = new Set<string>();

  const resolveFor = (task: Task): string[] => {
    const memoised = resolved.get(task.gid);
    if (memoised !== undefined) {
      return memoised;
    }

    // A cycle in the parent references (A is B's parent and B is A's
    // parent) means the data is corrupt. Stop the inheritance here
    // rather than recursing forever; the row keeps the memberships
    // Asana reported for it.
    if (resolving.has(task.gid)) {
      return task.projectGids;
    }

    const parentGid = task.parentTaskGid;
    if (parentGid === null) {
      resolved.set(task.gid, task.projectGids);
      return task.projectGids;
    }

    const parent = rowsByGid.get(parentGid) ?? knownParents?.get(parentGid);
    if (parent === undefined) {
      // The parent was not retrieved. The resolver does not guess a
      // membership (FR-014 asks for a *resolved* membership, not an
      // invented one) and does not mark the row out-of-scope (FR-023):
      // the row keeps exactly what Asana reported.
      resolved.set(task.gid, task.projectGids);
      return task.projectGids;
    }

    resolving.add(task.gid);
    const inherited = resolveFor(parent);
    resolving.delete(task.gid);

    const merged = mergeProjectGids(task.projectGids, inherited);
    resolved.set(task.gid, merged);
    return merged;
  };

  return tasks.map((task) => {
    const projectGids = resolveFor(task);
    if (sameProjectGids(projectGids, task.projectGids)) {
      return task;
    }
    return { ...task, projectGids };
  });
}

/**
 * Compare two membership lists by value. Used to decide whether the
 * resolution actually changed a row — the row is only copied when it
 * did.
 */
function sameProjectGids(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((gid, index) => gid === b[index]);
}

/**
 * Normalise a batch of Asana task wire rows into cache rows and resolve
 * the subtask project memberships across the batch (FR-014).
 *
 * This is the ingestion entry point for a task batch: the batch is
 * normalised first, then the resolution runs over the whole batch so a
 * subtask can inherit from a parent that appears later in the same
 * batch. `knownParents` supplies parent rows from outside the batch.
 */
export function normaliseTasks(
  wireTasks: readonly WireTask[],
  lastSeenAt: string,
  knownParents?: ReadonlyMap<string, Task>,
): Task[] {
  const rows = wireTasks.map((wire) => normaliseTask(wire, lastSeenAt));
  return resolveSubtaskProjectGids(rows, knownParents);
}
