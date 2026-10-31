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
 *    the group keys are sorted.
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
 * The reporting team and portfolio a task belongs to are properties of
 * its *projects*, not of the task row, so the calling layer resolves
 * them (FR-041: a project's reporting team is its Asana team unless a
 * local override says otherwise; FR-040: portfolios contain projects)
 * and carries them on the task row as `reportingTeamGids` /
 * `portfolioGids`. This mirrors how the data layer already resolves a
 * subtask's project memberships from its parent at ingestion time
 * (data-model.md, FR-014) — the domain layer never needs a lookup.
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
  TimezoneSetting,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The task projection this metric reads. It is the shared
 * `FilterableTask` shape (so a cached task row satisfies it without an
 * adapter) plus the two group memberships that live on the task's
 * *projects* rather than on the task itself.
 */
export interface WorkAddedCompletedTask extends FilterableTask {
  /**
   * The reporting teams the task's projects are mapped to (FR-040/FR-045).
   * A task whose projects sit in two reporting teams is attributed to
   * both of their per-group figures.
   */
  readonly reportingTeamGids?: readonly string[];

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
 *   independent scans.
 * @param context - The injected clock, the timezone basis and the
 *   current team mapping.
 *
 * @returns The metric result when no grouping is requested.
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

  if (groupBy === undefined) {
    return buildResult(scoped, buckets, indexByStart, width, range, context);
  }

  // Shared Output Rule 2: a task that belongs to several groups of the
  // chosen dimension is attributed to EACH of their per-group figures;
  // the ungrouped result above stays deduplicated (FR-036).
  const grouped = new Map<string, WorkAddedCompletedTask[]>();
  for (const task of scoped) {
    for (const key of groupKeysFor(task, groupBy)) {
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
  for (const key of [...grouped.keys()].sort()) {
    results[key] = buildResult(
      grouped.get(key) ?? [],
      buckets,
      indexByStart,
      width,
      range,
      context,
    );
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The running figures of one bucket. The item counts and the effort
 * sums are separate fields (FR-061) — the UI toggles which one it
 * reads, it never blends them into one number.
 */
interface BucketAccumulator {
  createdCount: number;
  completedCount: number;
  createdEffortMinutes: number;
  completedEffortMinutes: number;
}

function emptyAccumulator(): BucketAccumulator {
  return {
    createdCount: 0,
    completedCount: 0,
    createdEffortMinutes: 0,
    completedEffortMinutes: 0,
  };
}

/**
 * Builds the metric result for one set of tasks — the whole task list
 * for the ungrouped call, or one group's tasks for a grouped call.
 */
function buildResult(
  tasks: readonly WorkAddedCompletedTask[],
  buckets: readonly DateBucket[],
  indexByStart: ReadonlyMap<string, number>,
  width: BucketWidth,
  range: { readonly start: ISODate; readonly end: ISODate },
  context: MetricContext,
): MetricResult<WorkAddedCompletedSeries> {
  const accumulators = buckets.map(() => emptyAccumulator());
  const contributing: Record<string, string[]> = {};
  const contributingGids = new Set<string>();
  let createdUnestimatedCount = 0;
  let completedUnestimatedCount = 0;

  for (const task of tasks) {
    // FR-056: the added population — the task's creation date.
    const createdIndex = bucketIndexOf(
      task.createdAt,
      range,
      width,
      indexByStart,
      context.timezone,
    );
    if (createdIndex !== undefined) {
      const accumulator = accumulators[createdIndex];
      accumulator.createdCount += 1;
      if (task.estimatedMinutes === null) {
        // FR-058: no estimate — the task joins the count but not the
        // effort sum, and the exclusion is disclosed below.
        createdUnestimatedCount += 1;
      } else {
        accumulator.createdEffortMinutes += task.estimatedMinutes;
      }
      addContributor(
        contributing,
        `created:${buckets[createdIndex].bucketStart}`,
        task.gid,
      );
      contributingGids.add(task.gid);
    }

    // FR-057: the completed population — the task's completion date.
    // The two scans are independent, so a task can appear in both
    // without either measure affecting the other.
    if (task.completedAt !== null) {
      const completedIndex = bucketIndexOf(
        task.completedAt,
        range,
        width,
        indexByStart,
        context.timezone,
      );
      if (completedIndex !== undefined) {
        const accumulator = accumulators[completedIndex];
        accumulator.completedCount += 1;
        if (task.estimatedMinutes === null) {
          completedUnestimatedCount += 1;
        } else {
          accumulator.completedEffortMinutes += task.estimatedMinutes;
        }
        addContributor(
          contributing,
          `completed:${buckets[completedIndex].bucketStart}`,
          task.gid,
        );
        contributingGids.add(task.gid);
      }
    }
  }

  const excluded: ExcludedPopulationEntry[] = [];
  if (createdUnestimatedCount > 0) {
    excluded.push({
      reason: NO_ESTIMATE_CREATED_REASON,
      count: createdUnestimatedCount,
    });
  }
  if (completedUnestimatedCount > 0) {
    excluded.push({
      reason: NO_ESTIMATE_COMPLETED_REASON,
      count: completedUnestimatedCount,
    });
  }

  // The drill-down lists are sorted so the order never depends on the
  // input order (Shared Output Rule 6).
  for (const key of Object.keys(contributing)) {
    contributing[key].sort();
  }

  return {
    population: { total: contributingGids.size, excluded },
    series: {
      buckets: accumulators.map((accumulator, index) => ({
        bucketStart: buckets[index].bucketStart,
        bucketEnd: buckets[index].bucketEnd,
        createdCount: accumulator.createdCount,
        completedCount: accumulator.completedCount,
        createdEffortMinutes: accumulator.createdEffortMinutes,
        completedEffortMinutes: accumulator.completedEffortMinutes,
      })),
      createdUnestimatedCount,
      completedUnestimatedCount,
    },
    contributingTaskGids: contributing,
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
): string[] {
  switch (groupBy) {
    case "assignee":
      return [task.assigneeGid ?? UNASSIGNED_GROUP_KEY];
    case "priority":
      return [task.priorityOptionId ?? NO_PRIORITY_GROUP_KEY];
    case "project":
      return uniqueOrUnassigned(task.projectGids);
    case "reportingTeam":
      return uniqueOrUnassigned(task.reportingTeamGids ?? []);
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
