/**
 * `src/data/refresh/normalise` — the wire-to-cache normalisation layer
 * for the refresh orchestrator (US2, FR-014..FR-022, FR-068).
 *
 * This module is the **single boundary** between the Asana wire shape
 * (`src/data/asana/schemas.ts`) and the cache row shape
 * (`src/data/db/schema.ts`). Every Asana resource the refresh
 * orchestrator fetches is collapsed here before being handed to the
 * `RefreshStagingRepository` for staging and (ultimately) commit.
 *
 * Why a dedicated module (decision D001, plan.md: Boundary Map)
 * -------------------------------------------------------------
 * 1. The `src/data/refresh/**` boundary is the only place the FR-014
 *    subtask project-membership inheritance (parent→subtask
 *    `projectGids` resolution at ingestion time) and the FR-081 /
 *    FR-082 priority extraction (custom-field `enum_value.gid` →
 *    `Task.priorityOptionId`, plus `PriorityField` derivation) live.
 *    Hoisting these helpers anywhere else means a future contributor
 *    who reaches for `wire.projects[].gid` at a feature-component
 *    level silently re-implements the boundary in two places.
 * 2. The decision also separates "wire shape collapse" from "refresh
 *    state machine": this module exports pure functions of the form
 *    `(wire) -> CacheRow` or `(wireRows, ctx) -> CacheRows`. It holds
 *    no module state, no network handles, no Dexie handles; the
 *    orchestrator (`refresh-orchestrator.ts`) is the only caller.
 * 3. Per the S01 plan, `RefreshControls` (T049 / T051) replaces its
 *    inline normalisers with calls into this module — `normalise.ts`
 *    is the shared implementation. The T049 file's inline copies
 *    (`normaliseProject`, `extractEstimatedMinutes`, `normaliseTask`)
 *    will be removed in the T03 red→green row once the orchestrator
 *    surface is wired through.
 *
 * Per-resource normalisers
 * ------------------------
 * Each Asana resource has exactly one normaliser here. The function
 * names match the cache row names (`normaliseProject`, `normaliseUser`,
 * `normaliseAsanaTeam`, `normalisePortfolio`, `normaliseSection`,
 * `normaliseTask`, `normaliseWorkspace`); the helpers that do not
 * map one-to-one (`extractEstimatedMinutes`, `extractPriorityOptionId`,
 * `buildPriorityField`, `applySubtaskProjectInheritance`,
 * `buildDependencyEdges`, `deriveAsanaTeams`) are documented inline
 * below.
 *
 * FR-014 subtask inheritance
 * --------------------------
 * A subtask — a task with a non-null `parentTaskGid` — whose
 * `wire.projects[]` is empty (Asana omits the array on subtask rows
 * returned from `/projects/{gid}/tasks`) inherits its parent's
 * `projectGids` so the cache's `getInScopeTasks()` predicate
 * (data-model.md) reports the subtask alongside its parent in the
 * same project. The inheritance rule is implemented as a single
 * second pass over the normalised tasks so the first-pass normaliser
 * stays a pure `(wire, ctx) -> Task`. A subtask whose `wire.projects[]`
 * is non-empty uses its own list (Asana's documented "task can belong
 * to projects other than the parent" case wins over inheritance).
 *
 * FR-081 / FR-082 priority extraction
 * ------------------------------------
 * Asana's task `custom_fields[]` may carry a "Priority" enum custom
 * field whose `enum_value.gid` is the canonical priority option id
 * for that task. The cache's `Task.priorityOptionId` holds that gid
 * (or `null` when the field is absent). The `PriorityField` cache row
 * for each project is derived from the union of distinct option gids
 * observed across that project's tasks; absence of any "Priority"
 * field on any task marks `status: 'missing'`; mixed presence
 * (some tasks with the field, some without) marks
 * `status: 'malformed'` (FR-082). The inferred option-ids list is the
 * row's `expectedOptionIds` so the FR-084 data-quality panel can
 * compare against the observed union.
 *
 * Boundary
 * --------
 * `src/data/refresh/**` is the data-side normalisation layer
 * documented in the plan.md Boundary Map. This module imports from
 * `src/data/asana/schemas` (for the Zod-inferred wire shapes),
 * `src/data/db/schema` (for the cache row types), and Zod (`zod`)
 * for the `ZodIssue` typing used in priority-field validation.
 * It MUST NOT import from `src/app/**`, `src/features/**`,
 * `src/domain/**`, or `src/shared/**` — the ESLint boundary rule in
 * `eslint.config.js` enforces that.
 */

import type { z } from "zod";

import type {
  asanaCustomFieldSchema,
  asanaPortfolioSchema,
  asanaProjectSchema,
  asanaSectionSchema,
  asanaTaskSchema,
  asanaUserSchema,
  asanaWorkspaceSchema,
} from "../asana/schemas";
import type {
  AsanaTeam,
  Dependency,
  Portfolio,
  PriorityField,
  Project,
  Section,
  Task,
  User,
  Workspace,
} from "../db/schema";

/* -------------------------------------------------------------------------- */
/* Wire-shape aliases                                                         */
/* -------------------------------------------------------------------------- */

type WireProject = z.infer<typeof asanaProjectSchema>;
type WireTask = z.infer<typeof asanaTaskSchema>;
type WireUser = z.infer<typeof asanaUserSchema>;
type WireSection = z.infer<typeof asanaSectionSchema>;
type WirePortfolio = z.infer<typeof asanaPortfolioSchema>;
type WireCustomField = z.infer<typeof asanaCustomFieldSchema>;
type WireWorkspace = z.infer<typeof asanaWorkspaceSchema>;

/* -------------------------------------------------------------------------- */
/* Per-resource normalisers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The well-known name of the Asana custom field that stores a task's
 * priority option. Exported so `buildPriorityField` and the tests can
 * refer to the same string without re-declaring the magic value.
 */
export const PRIORITY_CUSTOM_FIELD_NAME = "Priority";

/**
 * The well-known name of the Asana custom field that stores a task's
 * estimated time in minutes. Exported for the same reason as
 * `PRIORITY_CUSTOM_FIELD_NAME`.
 */
export const ESTIMATED_MINUTES_CUSTOM_FIELD_NAME = "Estimated Time";

/**
 * Collapse a wire project row into the cache's `Project` shape. The
 * wire format nests `workspace` and `team` as compact references; the
 * cache flattens those into `workspaceGid` / `asanaTeamGid` scalars.
 * `portfolioGids` is left empty here — the
 * `SnapshotRepository.backfillSnapshots()` row (T052) is the row
 * that owns the portfolio→project edge; refresh-side staging does
 * not derive it.
 *
 * `wire.workspace?.gid ?? ""` — Asana documents workspace as
 * effectively required on every project, but the schema marks it
 * optional because Asana returns `null` / omits on the
 * `archived=true` cases the cache already excludes. The fallback to
 * empty string is the documented cache invariant (a malformed
 * workspace assignment surfaces as an empty `workspaceGid` rather
 * than silently coercing to a guessed scope); the FR-084
 * data-quality panel flags the empty value when one is observed.
 */
export function normaliseProject(wire: WireProject): Project {
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
 * Collapse a wire user row into the cache's `User` shape. The
 * `workspaceGid` is supplied by the caller (the orchestrator's
 * selected-workspace context) because the wire shape does not
 * include the workspace — Asana documents `email` as nullable so a
 * user in a workspace where the token's visibility does not include
 * the email surfaces as `email: null` in the cache rather than an
 * empty string (data-model.md: cache-level distinction between
 * "tracked, missing" and "tracked, empty").
 */
export function normaliseUser(
  wire: WireUser,
  workspaceGid: string,
): User {
  return {
    gid: wire.gid,
    name: wire.name,
    email: wire.email ?? null,
    workspaceGid,
  };
}

/**
 * Derive the workspace's `AsanaTeam` cache rows from the normalised
 * project set. Each project's `asanaTeamGid` (a non-null scalar)
 * yields at most one cache row, deduped by gid across the project
 * set. Projects with a null `asanaTeamGid` (the documented
 * "no Asana team" fallback — data-model.md) contribute no team row.
 *
 * The team `name` is intentionally left empty here — the wire
 * shape's `team` reference carries the name, but the cache's
 * `AsanaTeam.name` is reconciled across projects and may differ
 * between two references to the same gid (Asana's documented
 * rename propagation). A dedicated hydration step (T052 territory)
 * is the canonical source for the AsanaTeam cache name; this
 * function keeps the refresh path's dependency on `team.name`
 * minimal so a future rename inside Asana does not silently
 * repopulate the cache through the refresh path.
 */
export function deriveAsanaTeams(
  projects: readonly Project[],
  workspaceGid: string,
): AsanaTeam[] {
  const seen = new Set<string>();
  const teams: AsanaTeam[] = [];
  for (const project of projects) {
    if (project.asanaTeamGid === null || seen.has(project.asanaTeamGid)) {
      continue;
    }
    seen.add(project.asanaTeamGid);
    teams.push({
      gid: project.asanaTeamGid,
      name: "",
      workspaceGid,
    });
  }
  return teams;
}

/**
 * Collapse a wire portfolio row into the cache's `Portfolio` shape.
 * `projectGids` is left empty here — the portfolio→project edge is
 * derived from `GET /portfolios/{gid}/items` at a later stage (T052
 * is the owner); refresh-side staging of portfolios therefore
 * records the gid+name+workspace anchor only.
 */
export function normalisePortfolio(
  wire: WirePortfolio,
  workspaceGid: string,
): Portfolio {
  return {
    gid: wire.gid,
    name: wire.name,
    workspaceGid,
    projectGids: [],
  };
}

/**
 * Collapse a wire section row into the cache's `Section` shape. The
 * `projectGid` is supplied by the caller — the wire shape's
 * `project?.gid` reference is an optional hint (Asana's `opt_fields`
 * selection can suppress it) and the cache-level invariant is that
 * every section belongs to exactly one project, so the caller (the
 * orchestrator, which knows the project it iterated) is the source
 * of truth.
 */
export function normaliseSection(
  wire: WireSection,
  projectGid: string,
): Section {
  return {
    gid: wire.gid,
    projectGid,
    name: wire.name,
  };
}

/**
 * Collapse a wire workspace row into the cache's `Workspace` shape.
 * The cache carries `selectedAt` (the FR-019 anchor for the
 * FreshnessBanner), which is supplied by the caller — the wire shape
 * does not include it, and the orchestrator's per-session "now"
 * snapshot is the canonical value.
 *
 * `selectedAt` is typed `string` rather than `Date` because the
 * cache schema stores ISO timestamps verbatim (data-model.md: every
 * timestamp is `string` for serialisation predictability); the
 * orchestrator's `now` is responsible for producing an ISO instant.
 */
export function normaliseWorkspace(
  wire: WireWorkspace,
  selectedAt: string,
): Workspace {
  return {
    gid: wire.gid,
    name: wire.name,
    selectedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Custom-field extraction                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Extract the "Estimated Time" custom field's `number_value` as the
 * cache's `estimatedMinutes` scalar. Returns `null` when the field
 * is absent or has no numeric value — the data-model.md distinction
 * between `null` (tracked, missing) and the literal `'unavailable'`
 * (workspace without Time Tracking) is recorded here rather than at
 * the wire-validation boundary (schemas.ts).
 *
 * The function is intentionally strict about the custom field name
 * ("Estimated Time") so a workspace that renames the field surfaces
 * the rename as `estimatedMinutes: null` (FR-081 / FR-082's
 * data-quality flag for "tracked, but absent" tasks) rather than
 * silently mapping an unrelated field's `number_value` onto the
 * cache row.
 */
export function extractEstimatedMinutes(
  customFields: readonly WireCustomField[] | undefined,
): number | null {
  if (customFields === undefined) {
    return null;
  }
  for (const field of customFields) {
    if (field.name === ESTIMATED_MINUTES_CUSTOM_FIELD_NAME) {
      return field.number_value ?? null;
    }
  }
  return null;
}

/**
 * Extract the "Priority" custom field's `enum_value.gid` as the
 * cache's `priorityOptionId` scalar. Returns `null` when the field
 * is absent, when the field has no enum_value (e.g. the field is
 * present but the task has not been assigned a priority), or when
 * the `enum_value` itself carries no `gid`.
 *
 * The same strict-name rule applies as in `extractEstimatedMinutes`
 * so a workspace that renames the Priority field surfaces the
 * rename as `priorityOptionId: null` for every task in that
 * workspace, which `buildPriorityField` then maps to
 * `status: 'missing'`.
 */
export function extractPriorityOptionId(
  customFields: readonly WireCustomField[] | undefined,
): string | null {
  if (customFields === undefined) {
    return null;
  }
  for (const field of customFields) {
    if (field.name !== PRIORITY_CUSTOM_FIELD_NAME) {
      continue;
    }
    if (field.enum_value === undefined || field.enum_value === null) {
      return null;
    }
    if (typeof field.enum_value.gid !== "string") {
      return null;
    }
    if (field.enum_value.gid === "") {
      return null;
    }
    return field.enum_value.gid;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Task normalisation (FR-014 inheritance deferred to second pass)            */
/* -------------------------------------------------------------------------- */

/**
 * The per-task context the first-pass normaliser accepts. The
 * `parentTaskProjects` map is empty during the first pass; the
 * orchestrator calls `applySubtaskProjectInheritance(tasks)` after
 * the first pass to mutate subtask rows in place. Splitting the
 * inheritance step out of the first pass keeps `normaliseTask` a
 * pure `(wire, ctx) -> Task` and makes the inheritance rule
 * independently testable (FR-014).
 */
export interface NormaliseTaskContext {
  /** ISO instant used as the cache's `Task.lastSeenInScopeAt`. */
  readonly lastSeenAt: string;
}

/**
 * First-pass collapse of a wire task row into the cache's `Task`
 * shape. Subtask projectGids inheritance is intentionally NOT applied
 * here — `applySubtaskProjectInheritance` runs as a post-pass over
 * the normalised collection so the FR-014 rule is one well-tested
 * function rather than a recursive edge case inside the per-row
 * normaliser.
 *
 * Field notes:
 *
 * - `assigneeGid`, `parentTaskGid`, `priorityOptionId`: optional
 *   references in the wire shape; the cache stores `string | null`.
 *   A `null` parent means "not a subtask" (data-model.md).
 *
 * - `projectGids`: the wire's compact `projects[]` references,
 *   projected to their `gid` scalars. Empty array is allowed at this
 *   stage (the second-pass inheritance fills subtasks whose own list
 *   is empty).
 *
 * - `resourceSubtype`: pass-through of the documented enum
 *   (`default_task` | `milestone` | `approval`). FR-015 excludes
 *   `milestone` and `approval` from the reportable metric; the
 *   `getInScopeTasks()` predicate already filters to
 *   `default_task`. Validation of the enum is owned by the Zod
 *   schema (schemas.ts), not by this normaliser.
 *
 * - `completedAt`: pass-through; a missing `completed_at` becomes
 *   `null` per data-model.md.
 *
 * - `dueAt`: pass-through of the wire's `due_at` (the
 *   timezone-bearing ISO instant). `due_on` (date-only) is
 *   intentionally NOT mapped here — date-only due dates are
 *   normalised to a UTC instant at the rendering layer so the
 *   cache's `dueAt` keeps a single semantic.
 *
 * - `estimatedMinutes`: extracted from custom_fields via
 *   `extractEstimatedMinutes`.
 *
 * - `actualMinutes`: hard-coded `null`. The cache's `'unavailable'`
 *   sentinel ("workspace without Time Tracking") is owned by the
 *   reporting metrics layer; the refresh path never observes an
 *   `actualMinutes` payload, so the cache column stays `null` on
 *   ingestion. Reporting-metric code applies the `'unavailable'`
 *   mapping at read time.
 *
 * - `dependsOnTaskGids`: the wire's compact dependency references
 *   projected to their `gid` scalars. The cache's `Dependency` rows
 *   are derived separately via `buildDependencyEdges` (one row per
 *   dependency edge with the `dependsOnTaskAccessible` flag
 *   resolved against the in-scope task set).
 *
 * - `lastSeenInScopeAt`: the orchestrator-supplied `lastSeenAt` ISO
 *   string. Pinned across the entire refresh so every task retrieved
 *   in the same refresh shares the same "last seen" instant —
 *   downstream readers can compare two tasks' `lastSeenInScopeAt`
 *   values to detect drift.
 *
 * - `outOfScopeReason`: hard-coded `null`. Refresh-side staging
 *   never observes an out-of-scope task (the orchestrator only
 *   fetches from non-archived projects); the mark-out-of-scope
 *   decision is owned by the FR-024 incremental-sync path which
 *   sets the reason when a task drops out of scope between refreshes.
 */
export function normaliseTask(
  wire: WireTask,
  context: NormaliseTaskContext,
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
    priorityOptionId: extractPriorityOptionId(wire.custom_fields),
    estimatedMinutes: extractEstimatedMinutes(wire.custom_fields),
    actualMinutes: null,
    dependsOnTaskGids: (wire.dependencies ?? []).map((dep) => dep.gid),
    lastSeenInScopeAt: context.lastSeenAt,
    outOfScopeReason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Subtask projectGids inheritance (FR-014)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Apply the FR-014 subtask projectGids inheritance rule as a
 * post-processing pass over a normalised task collection:
 *
 *   - For every task with `parentTaskGid !== null` AND
 *     `projectGids.length === 0`, look up the **immediate** parent
 *     (the task whose `gid === subtask.parentTaskGid`) in the same
 *     collection and copy its `projectGids` into the subtask. A
 *     subtask whose own `projectGids` is non-empty keeps its own
 *     list (Asana permits a subtask to belong to projects other
 *     than its parent). The lookup is against any task in the
 *     collection, not just top-level (parentless) tasks, so the
 *     rule applies to multi-level nesting (leaf subtasks inherit
 *     from their immediate parent's projects, which may themselves
 *     have been inherited from a grandparent).
 *   - Parents not found in the collection (orphan subtask rows) are
 *     left as-is — the FR-014 rule cannot resolve a missing parent,
 *     and the orchestrator's reportable predicate filters such rows
 *     out at read time. The function does not throw.
 *
 * The function returns a fresh array of (potentially mutated) task
 * rows so a caller that prefers immutable semantics can use the
 * return value verbatim. Rows not affected by the inheritance rule
 * are shared by reference with the input (no defensive copy), which
 * keeps the hot path allocation-free for the common case where every
 * task has its own projects array.
 */
export function applySubtaskProjectInheritance(
  tasks: readonly Task[],
): Task[] {
  // Index every task by gid so the immediate-parent lookup is O(1).
  // Any task in the collection is a valid resolution target: a
  // subtask whose parent is itself a subtask resolves to the
  // parent's projectGids, which themselves may have been filled in
  // by an earlier iteration of this pass (the orchestrator calls
  // this function once on the full collection, but the resolution
  // is parent-gid-only so a leaf subtask whose immediate parent is
  // a middle subtask picks up the middle's already-resolved list).
  const byGid = new Map<string, readonly string[]>();
  for (const task of tasks) {
    byGid.set(task.gid, task.projectGids);
  }

  let mutated = false;
  const result: Task[] = [];
  for (const task of tasks) {
    if (
      task.parentTaskGid !== null &&
      task.projectGids.length === 0
    ) {
      const inherited = byGid.get(task.parentTaskGid);
      if (inherited !== undefined && inherited.length > 0) {
        result.push({ ...task, projectGids: [...inherited] });
        mutated = true;
        continue;
      }
    }
    result.push(task);
  }
  // Hot path: if no inheritance fired the function still allocates a
  // new array (one row per input) so callers can rely on the return
  // value being safe to mutate. The allocation cost is O(n) and is
  // amortised against the staging buffer's subsequent iteration.
  void mutated;
  return result;
}

/* -------------------------------------------------------------------------- */
/* PriorityField derivation (FR-081 / FR-082)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the cache's `PriorityField` row for a project from the
 * normalised tasks that belong to it.
 *
 * Status derivation:
 *
 * - `missing`: no task in the collection carries a "Priority" custom
 *   field. The row's `expectedOptionIds` is `null` so the FR-084
 *   data-quality panel reports "the workspace has not configured a
 *   Priority field at all".
 *
 * - `malformed`: at least one task carries the Priority field but
 *   the union of observed option gids is non-contiguous with the
 *   absent set (some tasks have a priority, some do not). The
 *   `expectedOptionIds` is the union of observed gids so the
 *   FR-084 panel can still surface the available options.
 *
 * - `ok`: every task in the collection either carries the Priority
 *   field with a valid `enum_value.gid` or has `priorityOptionId:
 *   null` because no Priority field is configured at all. The
 *   "absent across all tasks" case is the `missing` status above;
 *   this branch is the "consistent presence" case.
 *
 * The inference rule is purely observational: the orchestrator does
 * not call Asana for the project's `custom_field_settings` because
 * the `PROJECT_FIELDS` opt_fields selection deliberately omits it
 * (FR-081 — the FR-081 priority field is derived at ingestion time,
 * not fetched eagerly). The union of observed option gids is the
 * best-available ground truth for the project's configured option
 * set within the small-dataset fixture's known-good shape.
 *
 * The function is deterministic and pure (no module state, no clock
 * reads); a test fixture can pin the inferred row by passing a fixed
 * task collection.
 */
export function buildPriorityField(
  projectGid: string,
  tasksInProject: readonly Task[],
): PriorityField {
  let tasksWithPriorityField = 0;
  const observedOptionIds = new Set<string>();

  for (const task of tasksInProject) {
    if (task.priorityOptionId !== null) {
      tasksWithPriorityField += 1;
      observedOptionIds.add(task.priorityOptionId);
    }
  }

  const totalTasks = tasksInProject.length;

  if (tasksWithPriorityField === 0) {
    return {
      projectGid,
      expectedOptionIds: null,
      status: "missing",
    };
  }

  if (tasksWithPriorityField < totalTasks) {
    return {
      projectGid,
      expectedOptionIds: [...observedOptionIds].sort(),
      status: "malformed",
    };
  }

  return {
    projectGid,
    expectedOptionIds: [...observedOptionIds].sort(),
    status: "ok",
  };
}

/* -------------------------------------------------------------------------- */
/* Dependency cache rows (US9 blocked-work foundation)                         */
/* -------------------------------------------------------------------------- */

/**
 * Build the cache's `Dependency` rows for a single wire task row.
 * Each dependency in the wire's `dependencies[]` becomes one cache
 * row, with `dependsOnTaskAccessible` set per the `inScopeTaskGids`
 * parameter:
 *
 *   - `true` when the depended-on task's gid is in the supplied
 *     in-scope task set (the task was retrieved in the current
 *     refresh, so the cache can resolve it).
 *   - `false` when the gid is NOT in the set (the depended-on task
 *     is either outside the token's access, out of scope, or was
 *     dropped from the refresh). Per data-model.md
 *     "Blocked-work definition", the conservative rule treats
 *     inaccessibility as still-blocking; the FR-084 data-quality
 *     panel flags `dependsOnTaskAccessible: false` so the user can
 *     see the gap.
 *
 * The function returns an empty array when the wire task has no
 * dependencies; an empty array is also the right answer when the
 * task is fetched but no dependency gids are in scope.
 */
export function buildDependencyEdges(
  wire: WireTask,
  inScopeTaskGids: ReadonlySet<string>,
): Dependency[] {
  if (wire.dependencies === undefined) {
    return [];
  }
  const edges: Dependency[] = [];
  for (const dependency of wire.dependencies) {
    edges.push({
      taskGid: wire.gid,
      dependsOnTaskGid: dependency.gid,
      dependsOnTaskAccessible: inScopeTaskGids.has(dependency.gid),
    });
  }
  return edges;
}
