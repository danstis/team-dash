/**
 * `src/domain/filtering/filters.ts` — the composable `FilterCriteria`
 * predicate contract (T065).
 *
 * Background
 * ----------
 * FR-047 (`/specs/001-asana-team-dashboard/spec.md`) requires the system
 * to support composable filtering by date range, assignee (including an
 * explicit "unassigned" option), reporting team, Asana team, Person
 * Group, project, portfolio, priority (including an explicit "missing
 * priority" option), completion state, overdue/on-time state,
 * estimated/unestimated state, and blocked/stalled state. FR-048
 * requires those filters to combine simultaneously.
 *
 * This module is the *domain-level* half of that contract: a set of
 * pure, side-effect-free predicates over a task's own fields, composed
 * with AND/OR. The UI half — `FilterBar`, `ActiveFiltersList`,
 * `TaskTable` — lands in T066 against exactly this contract, so the
 * filter UI never re-implements predicate logic.
 *
 * Semantics
 * ---------
 * - **Across dimensions the filters AND**: a task must satisfy every
 *   active dimension to survive.
 * - **Inside one dimension the values OR**: selecting two assignees
 *   means "either of these people", selecting two projects means
 *   "either of these projects" (a task in *any* of them matches).
 * - **Composition order is irrelevant**: `and(a, b)` and `and(b, a)`
 *   agree for every task, and composing a predicate with itself changes
 *   nothing (idempotent AND/OR). Every predicate here is pure, so the
 *   result depends on the *set* of active filters, never on the order
 *   in which they were applied.
 * - **Nothing is silently ignored**: a criterion this contract does not
 *   implement yet (see `RESERVED_FILTER_DIMENSIONS`) raises
 *   `UnsupportedFilterDimensionError` instead of quietly matching every
 *   task, so a filter bar can never show an unfiltered list while
 *   claiming a filter is active.
 *
 * Date basis (FR-033)
 * -------------------
 * A date range filters on exactly ONE task date, and the basis is
 * explicit: `"due"` (default), `"created"` or `"completed"`. The basis
 * never blends, and the range bounds are evaluated under the active
 * timezone basis (FR-030/FR-034) via `domain/datetime`'s
 * `isDateInRange`. A task that lacks the basis date (no due date, not
 * completed) cannot satisfy a range on that basis and is excluded.
 *
 * Boundary
 * --------
 * This file lives in `src/domain/**`, so it MUST stay presentation-free,
 * browser-free, and network-free per Constitution Principle VI (the
 * `eslint-plugin-boundaries` rule in `eslint.config.js` enforces it).
 * There is no I/O here: no Dexie, no `fetch`, no `Date.now()`. The
 * clock is *injected* (`FilterOptions.now`) exactly like
 * `MetricContext.now` (data-model.md), so an overdue filter is
 * reproducible from its inputs.
 *
 * Extending the contract
 * -----------------------
 * Later dimensions (Person Group per T120, Asana team / reporting team,
 * portfolio, blocked / stalled) are added as new predicate factories and
 * wired into `createFilterPredicate`; existing callers keep working
 * because a later dimension can also be composed *around* this contract
 * with `andPredicates(...)` / `orPredicates(...)` — no re-plumbing of
 * the filter UI or the metric calculators is required.
 */

/* -------------------------------------------------------------------------- */
/* Imports                                                                     */
/* -------------------------------------------------------------------------- */

import { isDateInRange } from "../datetime";
import type {
  DateRange,
  FilterCriteria,
  ISODateTime,
  TimezoneSetting,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The subset of the cached `Task` row (`data-model.md` § Task) a filter
 * predicate can read. Declaring it structurally means a cached task row
 * satisfies `FilterableTask` as-is — no adapter, no mapping layer — while
 * the predicates stay testable against a plain literal fixture.
 *
 * `gid` is carried because a filtered result is a drill-down set: the
 * UI hands the surviving `gid`s straight to the task-detail view
 * (FR-052/FR-053).
 */
export interface FilterableTask {
  readonly gid: string;
  readonly assigneeGid: string | null;
  readonly projectGids: readonly string[];
  readonly createdAt: ISODateTime;
  readonly dueAt: ISODateTime | null;
  readonly completedAt: ISODateTime | null;
  readonly priorityOptionId: string | null;
  readonly estimatedMinutes: number | null;
}

/**
 * A single composable filter unit: a pure function from a task to
 * "does this task survive the filter?".
 */
export type TaskPredicate = (task: FilterableTask) => boolean;

/**
 * The task date a date range is evaluated against (FR-033). The basis is
 * explicit — a range never means "any date on the task".
 */
export type TaskDateBasis = "due" | "created" | "completed";

/**
 * The default date basis for `FilterCriteria.dateRange`: the due date.
 * A task list filtered by "this week" most usefully means "due this
 * week"; callers that want another basis pass `FilterOptions.dateBasis`
 * explicitly.
 */
export const DEFAULT_TASK_DATE_BASIS: TaskDateBasis = "due";

/**
 * Options shared by every predicate factory: the date basis, the
 * timezone the range bounds are evaluated under (FR-030/FR-034), and the
 * injected clock the overdue/on-time state is measured against.
 */
export interface FilterOptions {
  readonly dateBasis?: TaskDateBasis;
  readonly timezone?: TimezoneSetting;
  readonly now?: ISODateTime;
}

/**
 * Options for the date-range predicate alone.
 */
export interface DateRangeFilterOptions {
  readonly basis?: TaskDateBasis;
  readonly timezone?: TimezoneSetting;
}

/**
 * Options for the overdue/on-time predicate alone. `now` is required
 * whenever the state is actually evaluated — the domain never reads the
 * wall clock (Principle VI, `MetricContext.now`).
 */
export interface OverdueStateOptions {
  readonly now?: ISODateTime;
}

/**
 * The filter dimensions this contract implements (FR-047).
 */
export type FilterDimension =
  | "dateRange"
  | "assigneeGids"
  | "projectGids"
  | "completionState"
  | "priorityOptionIds"
  | "estimateState"
  | "overdueState";

/**
 * Runtime list of the implemented dimensions, exposed so the filter UI
 * can enumerate what it may offer without hard-coding the list twice.
 */
export const SUPPORTED_FILTER_DIMENSIONS = [
  "dateRange",
  "assigneeGids",
  "projectGids",
  "completionState",
  "priorityOptionIds",
  "estimateState",
  "overdueState",
] as const satisfies readonly FilterDimension[];

/**
 * `FilterCriteria` dimensions this contract does NOT implement yet,
 * because each of them needs context the task row does not carry:
 *
 * - `reportingTeamIds` / `asanaTeamGids` — need the project→team mapping
 *   (FR-041..FR-046), which lives outside the task row.
 * - `personGroupIds` — needs Person Group membership (FR-042a..e; wired
 *   in by T120).
 * - `portfolioGids` — needs portfolio→project membership.
 * - `blockedOnly` / `stalledOnly` — need dependency and last-activity
 *   data beyond the task's own fields.
 *
 * A criterion naming one of these raises
 * `UnsupportedFilterDimensionError` rather than being ignored, so the
 * UI can never display an unfiltered list under an active-filter label.
 */
export const RESERVED_FILTER_DIMENSIONS = [
  "reportingTeamIds",
  "asanaTeamGids",
  "personGroupIds",
  "portfolioGids",
  "blockedOnly",
  "stalledOnly",
] as const satisfies readonly (keyof FilterCriteria)[];

/**
 * Every `FilterCriteria` key this module knows about — implemented or
 * reserved — used by `hasActiveFilters`.
 */
const ALL_FILTER_DIMENSIONS = [
  ...SUPPORTED_FILTER_DIMENSIONS,
  ...RESERVED_FILTER_DIMENSIONS,
] as const satisfies readonly (keyof FilterCriteria)[];

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Raised when a `FilterCriteria` object names a dimension this contract
 * does not implement. Failing loudly is deliberate: silently ignoring
 * the criterion would show every task while the UI claimed a filter was
 * active, which is exactly the kind of dishonest reporting Principle II
 * forbids.
 */
export class UnsupportedFilterDimensionError extends Error {
  /** The criterion that could not be honoured. */
  readonly dimension: keyof FilterCriteria;

  constructor(dimension: keyof FilterCriteria) {
    super(
      `UnsupportedFilterDimensionError: filter dimension "${dimension}" is not implemented by the current filter contract. ` +
        `Implemented dimensions: ${SUPPORTED_FILTER_DIMENSIONS.join(", ")}. ` +
        `Reserved (not yet implemented) dimensions: ${RESERVED_FILTER_DIMENSIONS.join(", ")}.`,
    );
    this.name = "UnsupportedFilterDimensionError";
    this.dimension = dimension;
  }
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Returns `true` when a criterion value actually narrows the result
 * set. `null`, `undefined` and an empty list mean "no filter selected";
 * a boolean flag means "off" when it is `false`.
 */
function isActiveCriterion(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return true;
}

/**
 * Returns the task date the given basis points at, or `null` when the
 * task has no such date (no due date, not completed).
 */
function dateForBasis(
  task: FilterableTask,
  basis: TaskDateBasis,
): ISODateTime | null {
  switch (basis) {
    case "due":
      return task.dueAt;
    case "created":
      return task.createdAt;
    case "completed":
      return task.completedAt;
    default: {
      // Exhaustiveness check: a future basis added to the union surfaces
      // here at compile time rather than silently filtering on nothing.
      const _exhaustive: never = basis;
      throw new Error(
        `dateForBasis: unhandled date basis "${String(basis)}" (exhaustive: ${_exhaustive})`,
      );
    }
  }
}

/**
 * Throws when the criteria name a dimension this contract has not
 * implemented yet (see `RESERVED_FILTER_DIMENSIONS`).
 */
function assertSupportedDimensions(criteria: FilterCriteria): void {
  for (const dimension of RESERVED_FILTER_DIMENSIONS) {
    if (isActiveCriterion(criteria[dimension])) {
      throw new UnsupportedFilterDimensionError(dimension);
    }
  }
}

/**
 * Guards the composition helpers against a non-predicate argument.
 * TypeScript already forbids it; the runtime check keeps a JavaScript
 * caller (or a value that crossed an `any` boundary) from silently
 * changing the meaning of an AND/OR composition.
 */
function assertPredicates(predicates: readonly TaskPredicate[]): void {
  predicates.forEach((predicate, index) => {
    if (typeof predicate !== "function") {
      throw new TypeError(
        `Predicate composition expects functions; argument ${index} is ${String(predicate)}.`,
      );
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Dimension predicates                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Date-range predicate (FR-032, FR-030, FR-033).
 *
 * The range is a CLOSED interval: a task whose basis date equals the
 * start or the end is kept. Bounds are compared as calendar dates under
 * `options.timezone` (default `"local"`), so a time-of-day difference
 * never moves a task in or out of the range.
 *
 * A task with no date on the chosen basis (no due date under the
 * default basis, an incomplete task under the `"completed"` basis)
 * cannot satisfy the range and is excluded. An inverted range
 * (`start` after `end`) matches no task.
 *
 * @example
 *   matchesDateRange({ start: "2026-03-01", end: "2026-03-31", preset: "custom" });
 */
export function matchesDateRange(
  range: DateRange,
  options: DateRangeFilterOptions = {},
): TaskPredicate {
  const basis = options.basis ?? DEFAULT_TASK_DATE_BASIS;
  const timezone = options.timezone ?? "local";

  return (task) => {
    const value = dateForBasis(task, basis);
    if (value === null) {
      return false;
    }
    return isDateInRange(value, range, timezone);
  };
}

/**
 * Assignee predicate (FR-047), including the explicit `"unassigned"`
 * option.
 *
 * - A list of user `gid`s keeps a task whose assignee is one of them
 *   (OR inside the dimension) and drops unassigned tasks.
 * - The literal `"unassigned"` keeps ONLY tasks with no assignee.
 * - `null` / `undefined` / an empty list means "no assignee filter" and
 *   keeps every task.
 */
export function matchesAssignee(
  assigneeGids: string[] | "unassigned" | null | undefined,
): TaskPredicate {
  if (assigneeGids === null || assigneeGids === undefined) {
    return () => true;
  }
  if (assigneeGids === "unassigned") {
    return (task) => task.assigneeGid === null;
  }
  if (assigneeGids.length === 0) {
    return () => true;
  }
  const selected = new Set(assigneeGids);
  return (task) => task.assigneeGid !== null && selected.has(task.assigneeGid);
}

/**
 * Project predicate (FR-047).
 *
 * A task belongs to every project it is a member of, so a task matches
 * when it belongs to ANY of the selected projects (OR inside the
 * dimension). `null` / `undefined` / an empty list means "no project
 * filter".
 */
export function matchesProject(
  projectGids: string[] | null | undefined,
): TaskPredicate {
  if (projectGids === null || projectGids === undefined) {
    return () => true;
  }
  if (projectGids.length === 0) {
    return () => true;
  }
  const selected = new Set(projectGids);
  return (task) => task.projectGids.some((gid) => selected.has(gid));
}

/**
 * Completion-state predicate (FR-047): `"complete"` keeps tasks with a
 * completion timestamp, `"incomplete"` keeps tasks without one, and
 * `null` / `undefined` means "no completion filter".
 */
export function matchesCompletionState(
  state: "incomplete" | "complete" | null | undefined,
): TaskPredicate {
  if (state === null || state === undefined) {
    return () => true;
  }
  if (state === "complete") {
    return (task) => task.completedAt !== null;
  }
  return (task) => task.completedAt === null;
}

/**
 * Priority predicate (FR-047), including the explicit `"no_priority"`
 * option: a list of priority-option `gid`s keeps tasks carrying one of
 * them, the literal `"no_priority"` keeps ONLY tasks with no priority,
 * and `null` / `undefined` / an empty list means "no priority filter".
 */
export function matchesPriority(
  priorityOptionIds: string[] | "no_priority" | null | undefined,
): TaskPredicate {
  if (priorityOptionIds === null || priorityOptionIds === undefined) {
    return () => true;
  }
  if (priorityOptionIds === "no_priority") {
    return (task) => task.priorityOptionId === null;
  }
  if (priorityOptionIds.length === 0) {
    return () => true;
  }
  const selected = new Set(priorityOptionIds);
  return (task) =>
    task.priorityOptionId !== null && selected.has(task.priorityOptionId);
}

/**
 * Estimate-state predicate (FR-047): `"estimated"` keeps tasks with an
 * estimate, `"unestimated"` keeps tasks without one, and `null` /
 * `undefined` means "no estimate filter".
 */
export function matchesEstimateState(
  state: "estimated" | "unestimated" | null | undefined,
): TaskPredicate {
  if (state === null || state === undefined) {
    return () => true;
  }
  if (state === "estimated") {
    return (task) => task.estimatedMinutes !== null;
  }
  return (task) => task.estimatedMinutes === null;
}

/**
 * Overdue / on-time predicate (FR-047).
 *
 * - `"overdue"` keeps incomplete tasks whose due date has passed.
 * - `"on_time"` keeps tasks that have a due date and are not overdue
 *   (a completed task is never counted as overdue).
 * - `"no_due_date"` keeps tasks without a due date.
 *
 * `options.now` is REQUIRED when the state is evaluated: the domain
 * never reads the wall clock, so an overdue filter is reproducible from
 * its inputs (Principle VI, `MetricContext.now`).
 */
export function matchesOverdueState(
  state: "overdue" | "on_time" | "no_due_date" | null | undefined,
  options: OverdueStateOptions = {},
): TaskPredicate {
  if (state === null || state === undefined) {
    return () => true;
  }
  if (options.now === undefined) {
    throw new Error(
      `matchesOverdueState: an explicit "now" is required to evaluate the "${state}" state; the domain layer never reads the wall clock.`,
    );
  }
  const nowMs = new Date(options.now).getTime();

  return (task) => {
    if (state === "no_due_date") {
      return task.dueAt === null;
    }
    if (task.dueAt === null) {
      return false;
    }
    const dueMs = new Date(task.dueAt).getTime();
    const isOverdue = dueMs < nowMs && task.completedAt === null;
    return state === "overdue" ? isOverdue : !isOverdue;
  };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ANDs predicates together (FR-048). A task survives only when it
 * satisfies EVERY predicate.
 *
 * The result does not depend on the order the predicates are supplied
 * in, and composing a predicate with itself changes nothing — the
 * predicates are pure, so the outcome depends on the *set* of active
 * filters only. Composing zero predicates matches every task (the
 * identity of AND).
 */
export function andPredicates(...predicates: TaskPredicate[]): TaskPredicate {
  assertPredicates(predicates);
  if (predicates.length === 0) {
    return () => true;
  }
  return (task) => predicates.every((predicate) => predicate(task));
}

/**
 * ORs predicates together. A task survives when it satisfies AT LEAST
 * ONE predicate.
 *
 * As with `andPredicates`, the result does not depend on the order the
 * predicates are supplied in. Composing zero predicates matches no task
 * (the identity of OR).
 */
export function orPredicates(...predicates: TaskPredicate[]): TaskPredicate {
  assertPredicates(predicates);
  if (predicates.length === 0) {
    return () => false;
  }
  return (task) => predicates.some((predicate) => predicate(task));
}

/* -------------------------------------------------------------------------- */
/* Criteria-level API                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds the predicate described by a `FilterCriteria` object: every
 * active dimension is ANDed together, and the values inside a dimension
 * are ORed (see the module header).
 *
 * Throws `UnsupportedFilterDimensionError` when the criteria name a
 * dimension this contract does not implement yet.
 */
export function createFilterPredicate(
  criteria: FilterCriteria,
  options: FilterOptions = {},
): TaskPredicate {
  assertSupportedDimensions(criteria);

  const predicates: TaskPredicate[] = [];

  if (criteria.dateRange) {
    predicates.push(
      matchesDateRange(criteria.dateRange, {
        basis: options.dateBasis,
        timezone: options.timezone,
      }),
    );
  }
  if (criteria.assigneeGids !== undefined && criteria.assigneeGids !== null) {
    predicates.push(matchesAssignee(criteria.assigneeGids));
  }
  if (criteria.projectGids !== undefined && criteria.projectGids !== null) {
    predicates.push(matchesProject(criteria.projectGids));
  }
  if (
    criteria.completionState !== undefined &&
    criteria.completionState !== null
  ) {
    predicates.push(matchesCompletionState(criteria.completionState));
  }
  if (
    criteria.priorityOptionIds !== undefined &&
    criteria.priorityOptionIds !== null
  ) {
    predicates.push(matchesPriority(criteria.priorityOptionIds));
  }
  if (criteria.estimateState !== undefined && criteria.estimateState !== null) {
    predicates.push(matchesEstimateState(criteria.estimateState));
  }
  if (criteria.overdueState !== undefined && criteria.overdueState !== null) {
    predicates.push(
      matchesOverdueState(criteria.overdueState, { now: options.now }),
    );
  }

  return andPredicates(...predicates);
}

/**
 * Returns `true` when the task satisfies every active dimension of the
 * criteria. The convenience single-task form of
 * `createFilterPredicate(...)`.
 */
export function matchesFilterCriteria(
  task: FilterableTask,
  criteria: FilterCriteria,
  options: FilterOptions = {},
): boolean {
  return createFilterPredicate(criteria, options)(task);
}

/**
 * Returns the tasks that satisfy every active dimension of the criteria,
 * preserving the input order.
 *
 * The input array is never mutated and the returned array is a fresh
 * allocation, so a caller can hand the result straight to a table or a
 * drill-down list without defensive copying.
 */
export function filterTasks<T extends FilterableTask>(
  tasks: readonly T[],
  criteria: FilterCriteria,
  options: FilterOptions = {},
): T[] {
  const predicate = createFilterPredicate(criteria, options);
  return tasks.filter((task) => predicate(task));
}

/**
 * Returns the tasks that satisfy every supplied predicate, preserving
 * the input order. This is the composition entry point for dimensions
 * that live outside `FilterCriteria` (Person Group, Asana team, …) —
 * they compose AROUND this contract without changing it.
 */
export function filterTasksByPredicates<T extends FilterableTask>(
  tasks: readonly T[],
  ...predicates: TaskPredicate[]
): T[] {
  const predicate = andPredicates(...predicates);
  return tasks.filter((task) => predicate(task));
}

/**
 * Returns `true` when the criteria describe at least one active filter.
 * Used by the filter UI to decide whether to show the active-filter list
 * and the clear-all action (FR-048).
 *
 * A criterion naming a reserved (not yet implemented) dimension counts
 * as active — `createFilterPredicate` would refuse it, so hiding it
 * would be misleading.
 */
export function hasActiveFilters(criteria: FilterCriteria): boolean {
  return ALL_FILTER_DIMENSIONS.some((dimension) =>
    isActiveCriterion(criteria[dimension]),
  );
}
