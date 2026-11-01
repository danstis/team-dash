/**
 * `src/domain/metrics/backlog.ts` — the P1 "backlog size & direction"
 * metric (FR-063..FR-067).
 *
 * Background
 * ----------
 * FR-063 requires the current count of incomplete tasks and the current
 * total estimated effort of incomplete tasks, deduplicated across
 * projects, presented as a POINT-IN-TIME state rather than an
 * activity-in-range count. FR-064 requires the system to reconstruct
 * whether the incomplete count and the incomplete effort are growing,
 * shrinking or stable over time, from history derived from the in-scope
 * tasks' own creation / completion dates, available immediately from the
 * first successful refresh — no snapshot cache and no days of
 * accumulated refreshes. FR-065 requires the same figures for the
 * workspace, reporting-team, Asana-team, project, portfolio and
 * assignee views, deduplicated consistently, with reporting-team views
 * always using the CURRENT team mapping. FR-066 requires unestimated
 * incomplete tasks to be shown separately from the estimated effort
 * total, and requires the historical effort figure to use each task's
 * current cached estimate applied retroactively — disclosed as a known
 * limitation, because Asana does not expose historical estimate values.
 * FR-067 requires every backlog figure, historical points included, to
 * be drillable to its exact contributing incomplete-task list.
 *
 * The reconstruction predicate
 * ----------------------------
 * ONE predicate answers "was this task incomplete on date `d`?":
 *
 * ```
 * createdAt <= d && (completedAt == null || completedAt > d)
 * ```
 *
 * (research.md §11). It is implemented exactly once, in
 * `isIncompleteOn`, and BOTH calculators go through it: the current
 * state is the same predicate evaluated on today's date, and every point
 * of the series is the same predicate evaluated on that point's date.
 * There is no second implementation anywhere — the daily-snapshot cache
 * (FR-026a/b) is a memoised projection of this function, backfilled
 * through `calculateBacklogDirection` as its sole computation path (T085),
 * so a live figure and a cached figure cannot drift apart by
 * construction.
 *
 * The predicate is evaluated on CALENDAR dates, in the reporting
 * timezone basis (FR-029/FR-034): a task's creation instant is reduced
 * to the calendar date it falls on under `context.timezone`, and so is
 * its completion instant. A task completed at 2026-07-31T20:00Z was
 * completed on the 31st in UTC but on the 1st of August in Sydney
 * (+10), so it is still incomplete on the 31st under the local basis.
 *
 * The six shared output rules
 * ---------------------------
 * 1. **Deduplication (FR-036)**: the task list goes through
 *    `domain/dedup`'s `dedupeByGid` before anything is counted, so a
 *    task that belongs to several projects is counted exactly once in
 *    the workspace-level figures.
 * 2. **Multi-group attribution (FR-045/FR-042e)**: not applicable as a
 *    grouping — this metric reports one deduplicated population. A task
 *    that belongs to several reporting teams still appears in every
 *    reporting team's scope, because the reporting-team scope is a
 *    FILTER over the task list, not a partition of it.
 * 3. **Missing-value disclosure (FR-058/FR-066)**: a task without an
 *    estimate joins the count but not the effort sum, and the exclusion
 *    is reported through `MetricResult.population.excluded` — never
 *    silently dropped, so a missing estimate can never make the backlog
 *    look smaller than it is.
 * 4. **Zero-denominator handling**: not applicable — this metric reports
 *    counts and sums, never a rate.
 * 5. **Drill-down parity (FR-067)**: `contributingTaskGids` carries the
 *    exact task list behind every point, keyed `incomplete:<date>`, so
 *    re-fetching and re-aggregating it reproduces the displayed count
 *    and sum exactly.
 * 6. **Determinism**: identical `(tasks, filter, context)` inputs
 *    produce identical output — no clock reads (the clock arrives
 *    through `MetricContext.now`), no randomness, and the drill-down
 *    lists are sorted.
 *
 * The retroactive-estimate limitation (FR-066)
 * --------------------------------------------
 * A historical point's effort is the sum of the CURRENT cached estimates
 * of the tasks that were incomplete on that date. Asana does not expose
 * historical estimate values, so a task whose estimate changed after
 * that date is reported at its current estimate for that date too. This
 * is a documented limitation, not a bug: the JSDoc above states it, the
 * exported `BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE` string states it
 * for the UI to render verbatim, and the unit suite pins the behaviour
 * so it cannot be "fixed" into point-in-time estimate tracking without a
 * deliberate spec change.
 *
 * Boundary
 * --------
 * This file lives under `src/domain/**`, so it MUST stay
 * presentation-free, browser-free and network-free per Constitution
 * Principle VI and the `no-restricted-imports` rule in
 * `eslint.config.js`. It reads no wall clock: the clock arrives through
 * `MetricContext.now`, and the timezone basis through
 * `MetricContext.timezone`, so a run is reproducible from its inputs.
 */

/* -------------------------------------------------------------------------- */
/* Imports                                                                     */
/* -------------------------------------------------------------------------- */

import {
  addDays,
  diffInDaysInclusive,
  isoDateTimeToDate,
  toIsoDate,
} from "../datetime";
import { dedupeByGid } from "../dedup/dedupeByGid";
import {
  andPredicates,
  createFilterPredicate,
  type FilterableTask,
  type TaskPredicate,
} from "../filtering/filters";
import type {
  ExcludedPopulationEntry,
  FilterCriteria,
  ISODate,
  MetricContext,
  MetricResult,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The task projection this metric reads. It is the shared
 * `FilterableTask` shape, so a cached task row satisfies it without an
 * adapter: the metric needs the task's identity, its creation and
 * completion instants, and its estimate — plus the fields the shared
 * filter predicate reads.
 */
export interface BacklogTask extends FilterableTask {}

/**
 * The current backlog state (FR-063). The three figures are separate
 * fields of the SAME state, never one blended number (FR-061's
 * principle): the count says how many tasks are open, the effort says
 * how much estimated work they carry, and the unestimated count says how
 * many of them carry no estimate at all (FR-066).
 */
export interface BacklogCurrentFigures {
  /** How many tasks are incomplete as of today (FR-063). */
  readonly incompleteCount: number;
  /** The summed estimate of the incomplete tasks, in minutes (FR-063). */
  readonly incompleteEffortMinutes: number;
  /** How many of the incomplete tasks carry no estimate (FR-066). */
  readonly unestimatedIncompleteCount: number;
}

/**
 * One reconstructed calendar day of the backlog series (FR-064). The
 * point is a point-in-time state of that day, not the activity of that
 * day.
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
 * Whether a reconstructed series grew, shrank or stayed flat. The count
 * trend and the effort trend are reported separately: a backlog can grow
 * in item count while its estimated effort stays flat.
 */
export type BacklogTrend = "up" | "down" | "flat";

/**
 * The reconstructed backlog series (contracts/metrics-engine.md, P1 —
 * Backlog Size & Backlog Direction).
 */
export interface BacklogPointSeries {
  /** One point per calendar day of the requested range, in order. */
  readonly points: readonly BacklogPoint[];
  /** The count trend across the points. */
  readonly trend: BacklogTrend;
  /** The effort trend across the points, reported separately. */
  readonly effortTrend: BacklogTrend;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The reason label this metric uses in `MetricResult.population.excluded`
 * (FR-066): the task joined the incomplete count but carried no
 * estimate, so it is left out of the effort total.
 */
export const NO_ESTIMATE_REASON = "no_estimate";

/**
 * The FR-066 disclosure the UI renders next to a historical effort
 * figure: Asana does not expose historical estimate values, so a
 * historical point uses each task's current cached estimate applied
 * retroactively to the days the task was incomplete.
 */
export const BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE =
  "Historical effort uses each task's current estimate, applied to the days the task was incomplete; Asana does not expose historical estimate values.";

/**
 * The key prefix of the drill-down map (FR-067). One entry per point,
 * named by the date it reconstructs, so the drill-down of a historical
 * point hands back exactly the tasks that were incomplete on that date.
 */
const DRILL_DOWN_KEY_PREFIX = "incomplete";

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Computes the CURRENT backlog state (FR-063): how many tasks are
 * incomplete right now, how much estimated effort they carry, and how
 * many of them carry no estimate.
 *
 * The state is a point-in-time state, NOT an activity-in-range count,
 * so the selected date range does NOT narrow it — the range scopes the
 * DISPLAYED PERIOD of the trend chart (FR-064), not the current
 * snapshot. The user's other filters (assignee, project, priority,
 * completion state, estimate state, overdue state, reporting team) do
 * apply: they narrow the population the state is measured over.
 *
 * @param tasks - The in-scope task rows. Duplicated `gid`s are
 *   deduplicated before anything is counted (FR-036).
 * @param filter - The user's active filters, applied through
 *   `domain/filtering`'s shared predicate minus the date range.
 * @param context - The injected clock, the timezone basis and the
 *   current team mapping.
 *
 * @returns The current figures, the population summary and the
 *   drill-down set behind them.
 */
export function calculateBacklogCurrent(
  tasks: readonly BacklogTask[],
  filter: FilterCriteria,
  context: MetricContext,
): MetricResult<BacklogCurrentFigures> {
  const timelines = buildTimelines(tasks, filter, context);
  const today = toIsoDate(isoDateTimeToDate(context.now), context.timezone);
  const incomplete = incompleteOn(timelines, today);

  return {
    population: {
      total: incomplete.count,
      excluded: exclusionRows(incomplete.unestimatedCount),
    },
    series: {
      incompleteCount: incomplete.count,
      incompleteEffortMinutes: incomplete.effortMinutes,
      unestimatedIncompleteCount: incomplete.unestimatedCount,
    },
    contributingTaskGids: {
      [drillDownKey(today)]: [...incomplete.gids],
    },
    dedupApplied: true,
    asOf: context.now,
  };
}

/**
 * Computes the RECONSTRUCTED backlog series (FR-064): one point per
 * calendar day of the requested range, each the backlog state of that
 * day, plus the count trend and the effort trend across the points.
 *
 * The history is reconstructed from the tasks' own creation and
 * completion dates, so it is available from the very first successful
 * refresh — the daily-snapshot cache is a memoised projection of this
 * function, never a second source of truth (FR-026a/b, research.md §11).
 *
 * @param tasks - The in-scope task rows. Duplicated `gid`s are
 *   deduplicated before anything is counted (FR-036).
 * @param filter - The user's active filters, applied through
 *   `domain/filtering`'s shared predicate minus the date range — the
 *   range is the explicit parameter below.
 * @param context - The injected clock, the timezone basis and the
 *   current team mapping.
 * @param range - The period the series reconstructs, inclusive of both
 *   ends.
 *
 * @returns The reconstructed points, the two trends, the population
 *   summary and the per-point drill-down sets.
 *
 * @throws When the range's end precedes its start — a series needs a
 *   forward range, and an empty chart would hide the caller's mistake.
 */
export function calculateBacklogDirection(
  tasks: readonly BacklogTask[],
  filter: FilterCriteria,
  context: MetricContext,
  range: { readonly start: ISODate; readonly end: ISODate },
): MetricResult<BacklogPointSeries> {
  const timelines = buildTimelines(tasks, filter, context);
  const dates = datesOf(range);

  const points: BacklogPoint[] = [];
  const contributing: Record<string, string[]> = {};
  const contributingGids = new Set<string>();
  const unestimatedGids = new Set<string>();

  for (const date of dates) {
    const incomplete = incompleteOn(timelines, date);
    points.push({
      date,
      incompleteCount: incomplete.count,
      incompleteEffortMinutes: incomplete.effortMinutes,
      unestimatedIncompleteCount: incomplete.unestimatedCount,
    });
    contributing[drillDownKey(date)] = [...incomplete.gids];
    for (const gid of incomplete.gids) {
      contributingGids.add(gid);
    }
    for (const gid of incomplete.unestimatedGids) {
      unestimatedGids.add(gid);
    }
  }

  const first = points[0];
  const last = points[points.length - 1];

  return {
    population: {
      total: contributingGids.size,
      excluded: exclusionRows(unestimatedGids.size),
    },
    series: {
      points,
      trend: trendBetween(first?.incompleteCount, last?.incompleteCount),
      effortTrend: trendBetween(
        first?.incompleteEffortMinutes,
        last?.incompleteEffortMinutes,
      ),
    },
    contributingTaskGids: contributing,
    dedupApplied: true,
    asOf: context.now,
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A task reduced to what the reconstruction predicate reads: its
 * identity, the calendar date it was created on, the calendar date it
 * was completed on (or `null`), and its current cached estimate.
 *
 * The calendar dates are computed ONCE per task, in the reporting
 * timezone basis, so a reconstruction over a long range stays a cheap
 * comparison of date strings rather than a re-formatting of every
 * instant for every day.
 */
interface TaskTimeline {
  readonly gid: string;
  readonly createdDate: ISODate;
  readonly completedDate: ISODate | null;
  readonly estimatedMinutes: number | null;
}

/**
 * The incomplete set of one date: the figures and the task list behind
 * them.
 */
interface IncompleteSet {
  /** How many tasks were incomplete on the date. */
  readonly count: number;
  /** The summed estimate of those tasks, in minutes. */
  readonly effortMinutes: number;
  /** How many of those tasks carried no estimate. */
  readonly unestimatedCount: number;
  /** The gids of those tasks, sorted. */
  readonly gids: readonly string[];
  /** The gids of the unestimated ones, sorted. */
  readonly unestimatedGids: readonly string[];
}

/**
 * The single reconstruction predicate (research.md §11):
 * `createdAt <= d && (completedAt == null || completedAt > d)`.
 *
 * Both boundaries are inclusive/exclusive exactly as the contract
 * states them: a task created ON date `d` was already incomplete on that
 * date, and a task completed ON date `d` was NOT still incomplete on
 * that date (it left the backlog on the day it was completed).
 *
 * The comparison runs on the `YYYY-MM-DD` calendar dates of the
 * reporting timezone basis, which sort lexicographically in the same
 * order they sort chronologically.
 */
function isIncompleteOn(timeline: TaskTimeline, date: ISODate): boolean {
  return (
    timeline.createdDate <= date &&
    (timeline.completedDate === null || timeline.completedDate > date)
  );
}

/**
 * Builds the timelines of the tasks that survive the user's filters.
 *
 * The order is the contract's: deduplicate by `gid` FIRST (FR-036), so
 * a task that belongs to several projects is counted exactly once, then
 * apply the user's own criteria through `domain/filtering`'s shared
 * predicate.
 *
 * The date range is deliberately left out of the shared predicate: the
 * backlog is a point-in-time state (FR-063), and the reconstruction
 * applies its own per-date predicate (FR-033's "never blend the date
 * basis" rule) — a range filter on the due-date basis would drop every
 * task without a due date from the backlog.
 */
function buildTimelines(
  tasks: readonly BacklogTask[],
  filter: FilterCriteria,
  context: MetricContext,
): TaskTimeline[] {
  const deduped = dedupeByGid(tasks);
  const shared = createFilterPredicate(
    {
      ...filter,
      // The date range is not a filter of this metric (see above), and
      // the reporting-team scope is composed AROUND the shared contract
      // below, so both are taken out of the shared criteria.
      dateRange: undefined,
      reportingTeamIds: undefined,
    },
    { timezone: context.timezone, now: context.now },
  );
  const reportingTeam = reportingTeamPredicate(filter, context);
  const predicate =
    reportingTeam === undefined ? shared : andPredicates(shared, reportingTeam);

  const timelines: TaskTimeline[] = [];
  for (const task of deduped) {
    if (!predicate(task)) {
      continue;
    }
    timelines.push({
      gid: task.gid,
      createdDate: toIsoDate(
        isoDateTimeToDate(task.createdAt),
        context.timezone,
      ),
      completedDate:
        task.completedAt === null
          ? null
          : toIsoDate(isoDateTimeToDate(task.completedAt), context.timezone),
      estimatedMinutes: task.estimatedMinutes,
    });
  }
  return timelines;
}

/**
 * The reporting-team scope of the call (FR-065), composed AROUND the
 * shared filter contract.
 *
 * The reporting team is a property of a PROJECT's mapping, not of the
 * task row, so it is resolved through `context.teamMapping` — the
 * CURRENT mapping, for every historical point alike (FR-046). The
 * shared filter contract does not implement this dimension yet (it
 * needs context the task row does not carry), so the metric resolves it
 * here.
 *
 * A task belongs to a reporting team when ANY of its projects maps to
 * one of the selected teams; a task whose projects map to no selected
 * team is out of scope. With no reporting-team filter, no predicate is
 * returned and every task stays in scope.
 */
function reportingTeamPredicate(
  filter: FilterCriteria,
  context: MetricContext,
): TaskPredicate | undefined {
  const selected = filter.reportingTeamIds;
  if (selected === undefined || selected === null || selected.length === 0) {
    return undefined;
  }
  const teams = new Set(selected);
  const teamByProject = new Map<string, string>();
  for (const override of context.teamMapping) {
    teamByProject.set(override.projectGid, override.reportingTeamGid);
  }
  return (task) =>
    task.projectGids.some((projectGid) => {
      const team = teamByProject.get(projectGid);
      return team !== undefined && teams.has(team);
    });
}

/**
 * The incomplete set of one date: every task the reconstruction
 * predicate accepts, its figures, and the task lists behind them.
 */
function incompleteOn(
  timelines: readonly TaskTimeline[],
  date: ISODate,
): IncompleteSet {
  const gids: string[] = [];
  const unestimatedGids: string[] = [];
  let effortMinutes = 0;

  for (const timeline of timelines) {
    if (!isIncompleteOn(timeline, date)) {
      continue;
    }
    gids.push(timeline.gid);
    if (timeline.estimatedMinutes === null) {
      // FR-066: no estimate — the task joins the count but not the
      // effort sum, and the exclusion is disclosed.
      unestimatedGids.push(timeline.gid);
    } else {
      effortMinutes += timeline.estimatedMinutes;
    }
  }

  return {
    count: gids.length,
    effortMinutes,
    unestimatedCount: unestimatedGids.length,
    gids: gids.sort((a, b) => a.localeCompare(b)),
    unestimatedGids: unestimatedGids.sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * The calendar days of the range, inclusive of both ends. One point per
 * day — the backlog is a point-in-time state, so the series has daily
 * resolution.
 *
 * @throws When the range's end precedes its start.
 */
function datesOf(range: {
  readonly start: ISODate;
  readonly end: ISODate;
}): ISODate[] {
  if (range.end < range.start) {
    throw new RangeError(
      `calculateBacklogDirection: the range end ("${range.end}") precedes its start ("${range.start}") — the reconstructed series needs a forward range.`,
    );
  }
  const days = diffInDaysInclusive(range.start, range.end);
  const dates: ISODate[] = [];
  for (let index = 0; index < days; index += 1) {
    dates.push(addDays(range.start, index));
  }
  return dates;
}

/**
 * The trend between the first and the last point of the series: the
 * net movement of the figure across the reconstructed period. A single
 * point (a one-day range) has no movement, so it is flat.
 */
function trendBetween(
  first: number | undefined,
  last: number | undefined,
): BacklogTrend {
  if (first === undefined || last === undefined) {
    return "flat";
  }
  if (last > first) {
    return "up";
  }
  if (last < first) {
    return "down";
  }
  return "flat";
}

/**
 * The exclusion rows of the population summary (FR-066). An empty
 * exclusion list is returned when every task carried an estimate, so
 * the disclosure is present but empty rather than absent.
 */
function exclusionRows(count: number): ExcludedPopulationEntry[] {
  if (count <= 0) {
    return [];
  }
  return [{ reason: NO_ESTIMATE_REASON, count }];
}

/**
 * The drill-down key of one point (FR-067): the figure name and the
 * date it reconstructs.
 */
function drillDownKey(date: ISODate): string {
  return `${DRILL_DOWN_KEY_PREFIX}:${date}`;
}
