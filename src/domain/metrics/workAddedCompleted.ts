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
  | "assignee"
  | "reportingTeam"
  | "project"
  | "portfolio"
  | "priority";

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
 *
 * RED PHASE (Constitution Principle III — red/green as one deliverable):
 * the body lands in the green commit of this pull request. Until then
 * the metric returns an empty, well-formed result so the unit suite
 * fails on the *figures* (the hand-computed reference values) rather
 * than on an unresolved import.
 */
export function calculateWorkAddedVsCompleted(
  tasks: readonly WorkAddedCompletedTask[],
  filter: FilterCriteria,
  context: MetricContext,
  groupBy?: WorkAddedCompletedGroupBy,
):
  | MetricResult<WorkAddedCompletedSeries>
  | Record<string, MetricResult<WorkAddedCompletedSeries>> {
  void tasks;
  void filter;
  void groupBy;
  return {
    population: { total: 0, excluded: [] },
    series: { buckets: [], createdUnestimatedCount: 0, completedUnestimatedCount: 0 },
    contributingTaskGids: {},
    dedupApplied: true,
    asOf: context.now,
  };
}
