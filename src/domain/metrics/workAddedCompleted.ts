/**
 * `src/domain/metrics/workAddedCompleted.ts` — the P1 "work added vs.
 * work completed" metric (FR-056..FR-062).
 *
 * Background
 * ----------
 * FR-056 requires the system to count the tasks *created* within the
 * selected date range (using each task's creation date), FR-057 the
 * tasks *completed* within it (using each task's completion date), and
 * FR-058 to sum the estimated effort of each population separately,
 * leaving tasks without an estimate out of the sum while disclosing how
 * many were left out. FR-059 charts the two measures over time buckets
 * sized to the selected range, FR-060 lets the user group the metric by
 * team member, team, project, portfolio and priority, FR-061 keeps the
 * item-count view and the estimated-effort view as two separate fields
 * of the same bucket (never one blended number), and FR-062 makes every
 * created/completed figure drillable to its exact contributing task
 * list.
 *
 * `contracts/metrics-engine.md` (P1 — Work Added / Work Completed) fixes
 * the shape of the result and the six shared output rules this module
 * honours:
 *
 * 1. **Deduplication (FR-036)**: every total is deduplicated by `gid`
 *    through `domain/dedup`'s `dedupeByGid` — never a hand-rolled `Set`
 *    — so a task that belongs to several projects is counted exactly
 *    once in the workspace-level figures.
 * 2. **Multi-group attribution (FR-045/FR-042e)**: when the grouping
 *    dimension lets a task belong to more than one group (a task in two
 *    projects, two reporting teams or two portfolios), the task is
 *    attributed to *each* of those groups' per-group figures, while the
 *    ungrouped workspace total stays deduplicated.
 * 3. **Missing-value disclosure (FR-058)**: tasks without an estimate
 *    are excluded from the effort sums and reported through
 *    `MetricResult.population.excluded` — never silently dropped.
 * 4. **Zero-denominator handling**: not applicable — this metric reports
 *    counts and sums, never a rate, so there is no denominator that
 *    could be zero (the effort sums are `0` when every task in the
 *    population is unestimated, and the exclusion count says why).
 * 5. **Drill-down parity (FR-062)**: `contributingTaskGids` carries the
 *    task list behind every displayed figure, so re-fetching and
 *    re-aggregating it reproduces the displayed count and sum exactly.
 * 6. **Determinism**: identical `(tasks, filter, context)` inputs
 *    produce byte-identical output — no clock reads, no randomness, and
 *    the group keys and drill-down lists are sorted.
 *
 * Date bases
 * ----------
 * The two measures are *independent scans* over the same task list
 * (FR-056/FR-057): a task is counted as "added" when its creation date
 * falls in the range and as "completed" when its completion date falls
 * in the range, so a task can appear in both without either measure
 * affecting the other. The date basis is explicit per measure and never
 * blended (FR-033).
 *
 * Grouping data
 * -------------
 * Two grouping dimensions are properties of a task's *projects* rather
 * than of the task row, and they reach the metric differently:
 *
 * - **Reporting team**: resolved through `context.teamMapping`
 *   (`contracts/metrics-engine.md`: "Reporting-team-grouped calls always
 *   resolve team membership via `context.teamMapping` (the *current*
 *   mapping)"). The metric maps each of a task's projects through that
 *   mapping, so a project the user re-mapped moves to its new team
 *   without any cached grouping state (FR-042/FR-046). A task whose
 *   projects resolve to no reporting team falls under the explicit
 *   `'unassigned'` key.
 * - **Portfolio**: `MetricContext` carries no portfolio mapping and the
 *   task row carries no portfolio membership, so the calling layer
 *   resolves the portfolios a task's projects belong to and passes them
 *   on the task row as `portfolioGids` (FR-040). This mirrors how the
 *   data layer already resolves a subtask's project memberships from
 *   its parent at ingestion time (data-model.md, FR-014).
 *
 * Boundary
 * --------
 * This file lives under `src/domain/**`, so it MUST stay
 * presentation-free, browser-free, and network-free per Constitution
 * Principle VI and the `no-restricted-imports` rule in
 * `eslint.config.js`. It reads no wall clock: the clock arrives through
 * `MetricContext.now`, and the timezone basis through
 * `MetricContext.timezone`, so a run is reproducible from its inputs.
 */

/* -------------------------------------------------------------------------- */
/* Imports                                                                     */
/* -------------------------------------------------------------------------- */

import {
  diffInDaysInclusive,
  generateBuckets,
  isDateInRange,
  isoDateTimeToDate,
  selectBucketWidth,
  startOfWeekInTimezone,
  toIsoDate,
  type BucketWidth,
  type DateBucket,
} from "../datetime";
import { dedupeByGid } from "../dedup/dedupeByGid";
import {
  createFilterPredicate,
  type FilterableTask,
} from "../filtering/filters";
import type {
  ExcludedPopulationEntry,
  FilterCriteria,
  ISODate,
  ISODateTime,
  MetricContext,
  MetricResult,
  TeamMappingOverride,
  TimezoneSetting,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The task projection this metric reads. It is the shared
 * `FilterableTask` shape (so a cached task row satisfies it without an
 * adapter) plus the one group membership the task row can carry:
 * the portfolios its projects belong to. The reporting team is NOT
 * carried here — it is resolved through `context.teamMapping`.
 */
export interface WorkAddedCompletedTask extends FilterableTask {
  /**
   * The portfolios the task's projects belong to (FR-040). A task whose
   * projects sit in two portfolios is attributed to both of their
   * per-group figures.
   */
  readonly portfolioGids?: readonly string[];
}

/**
 * The grouping dimensions this metric supports (FR-060). `assignee` and
 * `priority` carry an explicit `'unassigned'` / `'no_priority'` key for
 * the tasks that have no such value, so a group is never missing
 * without saying why.
 */
export type WorkAddedCompletedGroupBy =
  "assignee" | "reportingTeam" | "project" | "portfolio" | "priority";

/**
 * One time bucket of the created / completed series (FR-059). The
 * item-count view and the estimated-effort view are separate fields of
 * the *same* bucket (FR-061) — the UI toggles which one it reads, it
 * never blends them.
 */
export interface WorkAddedCompletedBucket {
  /** The first calendar date of the bucket (inclusive). */
  readonly bucketStart: ISODate;
  /** The last calendar date of the bucket (inclusive). */
  readonly bucketEnd: ISODate;
  /** Tasks created within the bucket (FR-056). */
  readonly createdCount: number;
  /** Tasks completed within the bucket (FR-057). */
  readonly completedCount: number;
  /** Sum of the estimates of the tasks created within the bucket, in minutes (FR-058). */
  readonly createdEffortMinutes: number;
  /** Sum of the estimates of the tasks completed within the bucket, in minutes (FR-058). */
  readonly completedEffortMinutes: number;
}

/**
 * The series this metric returns (contracts/metrics-engine.md, P1 —
 * Work Added / Work Completed).
 */
export interface WorkAddedCompletedSeries {
  /** The buckets covering the selected range, in chronological order. */
  readonly buckets: readonly WorkAddedCompletedBucket[];
  /** How many tasks created within the range carried no estimate (FR-058). */
  readonly createdUnestimatedCount: number;
  /** How many tasks completed within the range carried no estimate (FR-058). */
  readonly completedUnestimatedCount: number;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The group key used for a task that has no value in the grouped
 * dimension — no assignee (FR-047's explicit "unassigned" option), no
 * reporting team, no project or no portfolio.
 */
export const UNASSIGNED_GROUP_KEY = "unassigned";

/**
 * The group key used for a task that carries no priority (FR-047's
 * explicit "missing priority" option). Kept distinct from
 * `UNASSIGNED_GROUP_KEY` because "no priority" is a state of the task,
 * not a missing assignment.
 */
export const NO_PRIORITY_GROUP_KEY = "no_priority";

/**
 * The reason labels this metric uses in `MetricResult.population.excluded`
 * (FR-058). One label per date basis, because the created-effort sum and
 * the completed-effort sum exclude different populations.
 */
export const NO_ESTIMATE_CREATED_REASON = "no_estimate_created";
export const NO_ESTIMATE_COMPLETED_REASON = "no_estimate_completed";

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Computes the work-added / work-completed metric over the given
 * (already in-scope) task list.
 *
 * @param tasks - The in-scope task rows. Duplicated `gid`s are
 *   deduplicated before anything else is counted (FR-036).
 * @param filter - The user's active filters. `filter.dateRange` is the
 *   reporting period and is REQUIRED: the metric buckets that period.
 *   Every other criterion is applied to the task list before the two
 *   independent scans, through `domain/filtering`'s shared predicate —
 *   so a criterion that module does not implement yet raises its
 *   `UnsupportedFilterDimensionError` rather than being ignored.
 * @param context - The injected clock, the timezone basis and the
 *   current team mapping. The mapping resolves the reporting-team
 *   grouping (FR-042/FR-046).
 *
 * @returns The metric result when no grouping is requested.
 *
 * @throws When `filter.dateRange` is missing — the metric reports a
 *   period and cannot invent one.
 */
export function calculateWorkAddedVsCompleted(
  tasks: readonly WorkAddedCompletedTask[],
  filter: FilterCriteria,
  context: MetricContext,
): MetricResult<WorkAddedCompletedSeries>;

/**
 * Computes the work-added / work-completed metric, split by one
 * grouping dimension (FR-060).
 *
 * @returns One result per group value, keyed by the group value. A task
 *   that belongs to several groups of the dimension is attributed to
 *   each of them (FR-045/FR-042e); the ungrouped result stays
 *   deduplicated (FR-036).
 */
export function calculateWorkAddedVsCompleted(
  tasks: readonly WorkAddedCompletedTask[],
  filter: FilterCriteria,
  context: MetricContext,
  groupBy: WorkAddedCompletedGroupBy,
): Record<string, MetricResult<WorkAddedCompletedSeries>>;

/**
 * Implementation of both public overloads.
 */
export function calculateWorkAddedVsCompleted(
  tasks: readonly WorkAddedCompletedTask[],
  filter: FilterCriteria,
  context: MetricContext,
  groupBy?: WorkAddedCompletedGroupBy,
):
  | MetricResult<WorkAddedCompletedSeries>
  | Record<string, MetricResult<WorkAddedCompletedSeries>> {
  const range = filter.dateRange;
  if (range === undefined) {
    throw new Error(
      "calculateWorkAddedVsCompleted: filter.dateRange is required — the metric reports the selected period (FR-059).",
    );
  }

  // FR-059: the bucket width follows from the length of the range, and
  // the bucket sequence comes from the shared datetime helpers so every
  // metric buckets a period the same way.
  const width = selectBucketWidth(diffInDaysInclusive(range.start, range.end));
  const buckets = generateBuckets(range, width);
  const indexByStart = new Map<string, number>();
  buckets.forEach((bucket, index) => {
    indexByStart.set(bucket.bucketStart, index);
  });

  // FR-036 / Shared Output Rule 1: deduplicate by gid through the
  // shared helper BEFORE anything is counted, so a task that belongs to
  // several projects is counted exactly once.
  const deduped = dedupeByGid(tasks);

  // The user's own filters apply on top of the in-scope task list. The
  // date range is deliberately left out of the shared predicate: this
  // metric applies it per scan, on each scan's own date basis (creation
  // for the added figures, completion for the completed ones), so a
  // single blended basis would be wrong (FR-033/FR-056/FR-057).
  const criteria: FilterCriteria = { ...filter, dateRange: undefined };
  const predicate = createFilterPredicate(criteria, {
    timezone: context.timezone,
    now: context.now,
  });
  const scoped = deduped.filter(predicate);

  const basis: ScanBasis = {
    buckets,
    indexByStart,
    width,
    range,
    context,
  };

  if (groupBy === undefined) {
    return buildResult(scoped, basis);
  }

  // Shared Output Rule 2: a task that belongs to several groups of the
  // chosen dimension is attributed to EACH of their per-group figures;
  // the ungrouped result above stays deduplicated (FR-036).
  const reportingTeamByProject = reportingTeamLookup(context.teamMapping);
  const grouped = new Map<string, WorkAddedCompletedTask[]>();
  for (const task of scoped) {
    for (const key of groupKeysFor(task, groupBy, reportingTeamByProject)) {
      const existing = grouped.get(key);
      if (existing) {
        existing.push(task);
      } else {
        grouped.set(key, [task]);
      }
    }
  }

  const results: Record<string, MetricResult<WorkAddedCompletedSeries>> = {};
  // Sorted so the group order never depends on iteration order
  // (Shared Output Rule 6).
  for (const key of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    results[key] = buildResult(grouped.get(key) ?? [], basis);
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything a scan needs besides the tasks themselves: the bucket
 * sequence of the period, the index that resolves a date to its bucket,
 * and the reporting basis.
 */
interface ScanBasis {
  readonly buckets: readonly DateBucket[];
  readonly indexByStart: ReadonlyMap<string, number>;
  readonly width: BucketWidth;
  readonly range: { readonly start: ISODate; readonly end: ISODate };
  readonly context: MetricContext;
}

/**
 * The figures of one bucket on ONE date basis. The item count and the
 * effort sum stay separate (FR-061) — the UI toggles which one it
 * reads, it never blends them into one number.
 */
interface BasisFigure {
  count: number;
  effortMinutes: number;
}

/**
 * The outcome of one independent scan over the task list (FR-056/FR-057).
 */
interface BasisScan {
  /** The figures of every bucket, in bucket order. */
  readonly figures: BasisFigure[];
  /** The gids behind each figure, keyed '<basis>:<bucketStart>' (FR-062). */
  readonly contributing: Record<string, string[]>;
  /** How many tasks in the population carried no estimate (FR-058). */
  readonly unestimatedCount: number;
  /** The tasks that contributed at least one figure. */
  readonly gids: Set<string>;
}

/**
 * Runs one independent scan over the task list: the tasks whose date on
 * the given basis falls inside the reporting period, bucketed by that
 * date.
 *
 * The two measures share this one function and differ only in the date
 * they read (`createdAt` / `completedAt`) and the label they key their
 * drill-down sets with, which is what "each independently" (FR-056/
 * FR-057) means in practice: neither scan can move the other's figures.
 */
function scan(
  tasks: readonly WorkAddedCompletedTask[],
  basis: ScanBasis,
  label: "created" | "completed",
  dateOf: (task: WorkAddedCompletedTask) => ISODateTime | null,
): BasisScan {
  const { buckets, indexByStart, width, range, context } = basis;
  const figures: BasisFigure[] = buckets.map(() => ({
    count: 0,
    effortMinutes: 0,
  }));
  const contributing: Record<string, string[]> = {};
  const gids = new Set<string>();
  let unestimatedCount = 0;

  for (const task of tasks) {
    const value = dateOf(task);
    if (value === null) {
      continue;
    }
    const index = bucketIndexOf(
      value,
      range,
      width,
      indexByStart,
      context.timezone,
    );
    if (index === undefined) {
      continue;
    }
    const figure = figures[index];
    figure.count += 1;
    if (task.estimatedMinutes === null) {
      // FR-058: no estimate — the task joins the count but not the
      // effort sum, and the exclusion is disclosed below.
      unestimatedCount += 1;
    } else {
      figure.effortMinutes += task.estimatedMinutes;
    }
    addContributor(
      contributing,
      `${label}:${buckets[index].bucketStart}`,
      task.gid,
    );
    gids.add(task.gid);
  }

  return { figures, contributing, unestimatedCount, gids };
}

/**
 * Builds the metric result for one set of tasks — the whole task list
 * for the ungrouped call, or one group's tasks for a grouped call.
 */
function buildResult(
  tasks: readonly WorkAddedCompletedTask[],
  basis: ScanBasis,
): MetricResult<WorkAddedCompletedSeries> {
  const { buckets, context } = basis;
  const created = scan(tasks, basis, "created", (task) => task.createdAt);
  const completed = scan(tasks, basis, "completed", (task) => task.completedAt);

  const contributingGids = new Set([...created.gids, ...completed.gids]);

  const excluded: ExcludedPopulationEntry[] = [];
  if (created.unestimatedCount > 0) {
    excluded.push({
      reason: NO_ESTIMATE_CREATED_REASON,
      count: created.unestimatedCount,
    });
  }
  if (completed.unestimatedCount > 0) {
    excluded.push({
      reason: NO_ESTIMATE_COMPLETED_REASON,
      count: completed.unestimatedCount,
    });
  }

  return {
    population: { total: contributingGids.size, excluded },
    series: {
      buckets: buckets.map((bucket, index) => ({
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        createdCount: created.figures[index].count,
        completedCount: completed.figures[index].count,
        createdEffortMinutes: created.figures[index].effortMinutes,
        completedEffortMinutes: completed.figures[index].effortMinutes,
      })),
      createdUnestimatedCount: created.unestimatedCount,
      completedUnestimatedCount: completed.unestimatedCount,
    },
    contributingTaskGids: sortContributors({
      ...created.contributing,
      ...completed.contributing,
    }),
    dedupApplied: true,
    asOf: context.now,
  };
}

/**
 * Returns the index of the bucket a dated task belongs to, or
 * `undefined` when the date falls outside the reporting period.
 *
 * The period check comes FIRST: a weekly bucket can start before the
 * period does (the first bucket snaps back to the Monday on or before
 * the range start), so a task dated before the range must not land in
 * it.
 */
function bucketIndexOf(
  value: ISODateTime,
  range: { readonly start: ISODate; readonly end: ISODate },
  width: BucketWidth,
  indexByStart: ReadonlyMap<string, number>,
  timezone: TimezoneSetting,
): number | undefined {
  if (!isDateInRange(value, range, timezone)) {
    return undefined;
  }
  const bucketStart =
    width === "day"
      ? toIsoDate(isoDateTimeToDate(value), timezone)
      : startOfWeekInTimezone(value, timezone);
  return indexByStart.get(bucketStart);
}

/**
 * Records a task as a contributor of one displayed figure (FR-062). The
 * key names the figure: the date basis and the bucket it belongs to, so
 * every created and completed figure has its own exact task list.
 */
function addContributor(
  contributing: Record<string, string[]>,
  key: string,
  gid: string,
): void {
  const existing = contributing[key];
  if (existing) {
    existing.push(gid);
  } else {
    contributing[key] = [gid];
  }
}

/**
 * Sorts the drill-down lists so their order never depends on the input
 * order (Shared Output Rule 6).
 */
function sortContributors(
  contributing: Record<string, string[]>,
): Record<string, string[]> {
  for (const key of Object.keys(contributing)) {
    contributing[key].sort((a, b) => a.localeCompare(b));
  }
  return contributing;
}

/**
 * The current project → reporting-team mapping, as `context.teamMapping`
 * carries it (FR-042/FR-046).
 */
function reportingTeamLookup(
  teamMapping: readonly TeamMappingOverride[],
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const override of teamMapping) {
    lookup.set(override.projectGid, override.reportingTeamGid);
  }
  return lookup;
}

/**
 * The group keys a task belongs to in the chosen dimension (FR-060).
 *
 * - `assignee` and `priority` are single-valued, and a task with no
 *   value lands under the explicit `'unassigned'` / `'no_priority'` key
 *   so the group is never silently missing.
 * - `project`, `reportingTeam` and `portfolio` can hold several groups
 *   for one task; the keys are de-duplicated so a task that sits in two
 *   projects of the SAME reporting team is counted once there.
 */
function groupKeysFor(
  task: WorkAddedCompletedTask,
  groupBy: WorkAddedCompletedGroupBy,
  reportingTeamByProject: ReadonlyMap<string, string>,
): string[] {
  switch (groupBy) {
    case "assignee":
      return [task.assigneeGid ?? UNASSIGNED_GROUP_KEY];
    case "priority":
      return [task.priorityOptionId ?? NO_PRIORITY_GROUP_KEY];
    case "project":
      return uniqueOrUnassigned(task.projectGids);
    case "reportingTeam":
      return uniqueOrUnassigned(
        task.projectGids
          .map((projectGid) => reportingTeamByProject.get(projectGid))
          .filter((gid): gid is string => gid !== undefined),
      );
    case "portfolio":
      return uniqueOrUnassigned(task.portfolioGids ?? []);
    default: {
      // Exhaustiveness check: a future grouping dimension added to the
      // union surfaces here at compile time rather than silently
      // falling through to no group at all.
      const _exhaustive: never = groupBy;
      throw new Error(
        `groupKeysFor: unhandled grouping dimension "${String(groupBy)}" (exhaustive: ${_exhaustive})`,
      );
    }
  }
}

/**
 * The distinct group keys of a multi-valued dimension, or the explicit
 * `'unassigned'` key when the task belongs to none of them.
 */
function uniqueOrUnassigned(gids: readonly string[]): string[] {
  const unique = [...new Set(gids)];
  return unique.length > 0 ? unique : [UNASSIGNED_GROUP_KEY];
}
