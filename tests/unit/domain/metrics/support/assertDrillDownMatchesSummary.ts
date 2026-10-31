/**
 * `assertDrillDownMatchesSummary` — the shared drill-down parity
 * assertion every metric's unit suite reuses
 * (`contracts/metrics-engine.md`, Shared Output Rule 5).
 *
 * The rule: `MetricResult.contributingTaskGids`, when re-fetched and
 * re-aggregated, MUST reproduce exactly the count/sum the metric
 * displayed. The assertion logic lives here, once, so no metric test
 * file re-implements it (the same reason `domain/dedup`'s
 * `dedupeByGid` exists as the single dedup helper).
 *
 * The metric-specific part is the *re-aggregation*: how a set of tasks
 * turns back into the displayed figure. Each metric test passes its own
 * `reaggregate` callback for that, and this helper owns everything
 * else — re-fetching the gids from the source task list, failing loudly
 * when a drill-down references a task that is not there, and asserting
 * the re-aggregated figures against the displayed ones.
 */

import { expect } from "vitest";

/**
 * The minimum a task row needs for a drill-down to be re-fetched: the
 * `gid` the drill-down returns.
 */
export interface DrillDownTask {
  readonly gid: string;
}

/**
 * One displayed figure and the drill-down set behind it.
 */
export interface DrillDownFigure {
  /**
   * A label for the figure (a bucket key, a group key, …) used in the
   * failure message, so a mismatch says *which* figure drifted.
   */
  readonly label: string;
  /** The item count the metric displayed for the figure. */
  readonly displayedCount: number;
  /**
   * The estimated-effort minutes the metric displayed for the figure.
   * Omit for a metric that has no effort view.
   */
  readonly displayedEffortMinutes?: number;
  /** The gids the drill-down hands back for the figure. */
  readonly contributingGids: readonly string[];
}

/**
 * The figures a re-aggregation produces for a set of tasks.
 */
export interface ReaggregatedFigure {
  readonly count: number;
  readonly effortMinutes?: number;
}

/**
 * Asserts drill-down parity for one displayed figure.
 *
 * @param figure - The displayed figure and its drill-down set.
 * @param sourceTasks - The task list the metric was computed from; the
 *   drill-down's gids are re-fetched from it.
 * @param reaggregate - Turns the re-fetched tasks back into the figure
 *   the metric would display for exactly that task set.
 */
export function assertDrillDownMatchesSummary<T extends DrillDownTask>(
  figure: DrillDownFigure,
  sourceTasks: readonly T[],
  reaggregate: (tasks: readonly T[]) => ReaggregatedFigure,
): void {
  const byGid = new Map<string, T>();
  for (const task of sourceTasks) {
    if (!byGid.has(task.gid)) {
      byGid.set(task.gid, task);
    }
  }

  const refetched = figure.contributingGids.map((gid) => {
    const task = byGid.get(gid);
    if (task === undefined) {
      throw new Error(
        `assertDrillDownMatchesSummary: the drill-down for "${figure.label}" references gid "${gid}", which is not in the source task list.`,
      );
    }
    return task;
  });

  const reaggregated = reaggregate(refetched);

  expect(
    reaggregated.count,
    `drill-down parity for "${figure.label}": the contributing tasks re-aggregate to ${reaggregated.count} item(s), but the metric displayed ${figure.displayedCount}.`,
  ).toBe(figure.displayedCount);

  if (figure.displayedEffortMinutes !== undefined) {
    expect(
      reaggregated.effortMinutes,
      `drill-down parity for "${figure.label}": the contributing tasks re-aggregate to ${String(reaggregated.effortMinutes)} minute(s), but the metric displayed ${figure.displayedEffortMinutes}.`,
    ).toBe(figure.displayedEffortMinutes);
  }
}
