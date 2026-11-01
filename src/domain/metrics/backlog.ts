/**
 * `src/domain/metrics/backlog.ts` — the P1 "backlog size & direction"
 * metric (FR-063..FR-067).
 *
 * RED PHASE — T082. This commit ships the metric's PUBLIC SURFACE
 * only, so the unit suite in `tests/unit/domain/metrics/backlog.test.ts`
 * compiles and fails on the FIGURES (not on an unresolved import). The
 * reconstruction predicate itself lands in the next commit of the same
 * pull request, per Constitution Principle III ("the failing test and
 * the implementation that makes it green land in the same task").
 */

import type {
  FilterCriteria,
  ISODate,
  MetricContext,
  MetricResult,
} from "../types";
import type { FilterableTask } from "../filtering/filters";

/**
 * The task projection this metric reads — the shared `FilterableTask`
 * shape, so a cached task row satisfies it without an adapter.
 */
export interface BacklogTask extends FilterableTask {}

/**
 * The current backlog state (FR-063): a point-in-time snapshot of the
 * incomplete tasks, not an activity-in-range count.
 */
export interface BacklogCurrentFigures {
  /** How many tasks are incomplete right now (FR-063). */
  readonly incompleteCount: number;
  /** The summed estimate of the incomplete tasks, in minutes (FR-063). */
  readonly incompleteEffortMinutes: number;
  /** How many of the incomplete tasks carry no estimate (FR-066). */
  readonly unestimatedIncompleteCount: number;
}

/**
 * One reconstructed calendar day of the backlog series (FR-064).
 */
export interface BacklogPoint {
  /** The reconstructed calendar date. */
  readonly date: ISODate;
  /** How many tasks were incomplete on that date. */
  readonly incompleteCount: number;
  /** The summed estimate of those tasks, in minutes. */
  readonly incompleteEffortMinutes: number;
  /** How many of those tasks carried no estimate (FR-066). */
  readonly unestimatedIncompleteCount: number;
}

/**
 * Whether a reconstructed series grew, shrank or stayed flat.
 */
export type BacklogTrend = "up" | "down" | "flat";

/**
 * The reconstructed backlog series (contracts/metrics-engine.md, P1 —
 * Backlog Size & Backlog Direction).
 */
export interface BacklogPointSeries {
  /** One point per calendar day of the requested range. */
  readonly points: readonly BacklogPoint[];
  /** The count trend across the points. */
  readonly trend: BacklogTrend;
  /** The effort trend across the points, reported separately. */
  readonly effortTrend: BacklogTrend;
}

/**
 * The reason label this metric uses in `MetricResult.population.excluded`
 * (FR-066).
 */
export const NO_ESTIMATE_REASON = "no_estimate";

/**
 * The FR-066 disclosure: historical effort figures use each task's
 * CURRENT cached estimate applied retroactively, because Asana does not
 * expose historical estimate values.
 */
export const BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE =
  "Historical effort uses each task's current estimate, applied to the days the task was incomplete; Asana does not expose historical estimate values.";

/**
 * Computes the current backlog state (FR-063).
 */
export function calculateBacklogCurrent(
  _tasks: readonly BacklogTask[],
  _filter: FilterCriteria,
  context: MetricContext,
): MetricResult<BacklogCurrentFigures> {
  return {
    population: { total: 0, excluded: [] },
    series: {
      incompleteCount: 0,
      incompleteEffortMinutes: 0,
      unestimatedIncompleteCount: 0,
    },
    contributingTaskGids: {},
    dedupApplied: true,
    asOf: context.now,
  };
}

/**
 * Computes the reconstructed backlog series (FR-064).
 */
export function calculateBacklogDirection(
  _tasks: readonly BacklogTask[],
  _filter: FilterCriteria,
  context: MetricContext,
  _range: { readonly start: ISODate; readonly end: ISODate },
): MetricResult<BacklogPointSeries> {
  return {
    population: { total: 0, excluded: [] },
    series: { points: [], trend: "flat", effortTrend: "flat" },
    contributingTaskGids: {},
    dedupApplied: true,
    asOf: context.now,
  };
}
