/**
 * T082 — `calculateBacklogCurrent` / `calculateBacklogDirection` unit
 * tests (Red phase).
 *
 * The P1 backlog metric (US5) answers two questions the dashboard has
 * to show: how big is the incomplete backlog RIGHT NOW (FR-063), and is
 * it growing, shrinking or stable (FR-064). Both answers come from ONE
 * reconstruction predicate — `createdAt <= d && (completedAt == null ||
 * completedAt > d)` (research.md §11) — so the history is available
 * from the very first refresh, with no snapshot cache and no days of
 * accumulated refreshes.
 *
 * Coverage
 * --------
 * - FR-063: the current count / effort / unestimated count is a
 *   point-in-time state, NOT an activity-in-range count — the selected
 *   date range does not narrow it.
 * - FR-064: the direction is reconstructed from the tasks' own
 *   creation / completion dates, and the count trend and the effort
 *   trend are reported separately (both can be `up` while only one of
 *   them is).
 * - FR-065: the figures are deduplicated across projects (FR-036), and
 *   the user's own filters apply on top of the in-scope task list.
 * - FR-066: unestimated incomplete tasks are counted SEPARATELY from
 *   the estimated effort total (a missing estimate must never make the
 *   backlog look smaller than it is), and the historical effort figure
 *   uses each task's CURRENT cached estimate applied retroactively — a
 *   documented limitation this suite pins on purpose.
 * - FR-067 / `contracts/metrics-engine.md` Shared Output Rule 5: every
 *   point of the series is drillable, and re-fetching the drill-down's
 *   tasks reproduces the displayed count and sum exactly (asserted
 *   through the shared `assertDrillDownMatchesSummary` helper).
 * - research.md §11: the predicate is implemented ONCE — the current
 *   state and every historical point go through the same code path, so
 *   the current figure equals the last point of the series.
 *
 * The tests MUST fail before `src/domain/metrics/backlog.ts` computes
 * anything and pass after it (Constitution Principle III). The module
 * lives under `src/domain/**` and therefore stays presentation-free,
 * browser-free and network-free (ESLint boundary rule) — no Dexie, no
 * fetch, no React.
 *
 * Determinism
 * -----------
 * Every assertion runs under the UTC timezone basis, so the figures hold
 * on every host regardless of the local clock; the one case that
 * exercises the local basis pins `TZ` to `Australia/Sydney` explicitly.
 */
process.env.TZ = "Australia/Sydney";

import { describe, expect, it } from "vitest";

import {
  BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE,
  NO_ESTIMATE_REASON,
  calculateBacklogCurrent,
  calculateBacklogDirection,
  type BacklogPoint,
  type BacklogPointSeries,
  type BacklogTask,
} from "../../../../src/domain/metrics/backlog";
import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
  MetricContext,
  MetricResult,
} from "../../../../src/domain/types";
import {
  assertDrillDownMatchesSummary,
  type ReaggregatedFigure,
} from "./support/assertDrillDownMatchesSummary";

/* -------------------------------------------------------------------------- */
/* The fixture                                                                 */
/* -------------------------------------------------------------------------- */

interface TaskSeed {
  readonly gid: string;
  readonly createdAt: string;
  readonly completedAt?: string | null;
  readonly estimatedMinutes?: number | null;
  readonly assigneeGid?: string | null;
  readonly projectGids?: readonly string[];
  readonly dueAt?: string | null;
  readonly priorityOptionId?: string | null;
}

/**
 * Builds a task row in the shape the metric reads. The metric's task
 * projection is the shared `FilterableTask` shape, so a cached task row
 * satisfies it without an adapter.
 */
function makeTask(seed: TaskSeed): BacklogTask {
  return {
    gid: seed.gid,
    assigneeGid: seed.assigneeGid ?? null,
    projectGids: seed.projectGids ?? ["project-1"],
    createdAt: seed.createdAt as ISODateTime,
    dueAt: (seed.dueAt ?? null) as ISODateTime | null,
    completedAt: (seed.completedAt ?? null) as ISODateTime | null,
    priorityOptionId: seed.priorityOptionId ?? null,
    estimatedMinutes: seed.estimatedMinutes ?? null,
  };
}

/**
 * The main fixture. Every figure the suite expects is HAND-COMPUTED
 * from these five tasks — never read back from the implementation.
 *
 * | task                | created    | completed   | estimate |
 * | ------------------- | ---------- | ----------- | -------- |
 * | `task-open`         | 2026-07-01 | —           | 60 min   |
 * | `task-closed`       | 2026-07-03 | 2026-07-05  | 30 min   |
 * | `task-unestimated`  | 2026-07-02 | —           | none     |
 * | `task-late`         | 2026-07-08 | —           | 120 min  |
 * | `task-early-closed` | 2026-06-01 | 2026-07-02  | 45 min   |
 */
const tasks: readonly BacklogTask[] = [
  makeTask({
    gid: "task-open",
    createdAt: "2026-07-01T09:00:00.000Z",
    estimatedMinutes: 60,
  }),
  makeTask({
    gid: "task-closed",
    createdAt: "2026-07-03T09:00:00.000Z",
    completedAt: "2026-07-05T09:00:00.000Z",
    estimatedMinutes: 30,
  }),
  makeTask({
    gid: "task-unestimated",
    createdAt: "2026-07-02T09:00:00.000Z",
  }),
  makeTask({
    gid: "task-late",
    createdAt: "2026-07-08T09:00:00.000Z",
    estimatedMinutes: 120,
  }),
  makeTask({
    gid: "task-early-closed",
    createdAt: "2026-06-01T09:00:00.000Z",
    completedAt: "2026-07-02T09:00:00.000Z",
    estimatedMinutes: 45,
  }),
];

/**
 * The hand-computed reconstruction of the fixture over
 * 2026-07-01 … 2026-07-10, one entry per calendar day.
 *
 * - 07-01: `task-open` + `task-early-closed` (still open on the 1st).
 * - 07-02: `task-early-closed` is completed ON the 2nd, so it leaves
 *   the backlog; `task-unestimated` enters.
 * - 07-03 / 07-04: `task-closed` is open from the 3rd until the day
 *   before it was completed.
 * - 07-05: `task-closed` was completed ON the 5th, so it is no longer
 *   incomplete on that day (the predicate's `completedAt > d` is
 *   strict).
 * - 07-08: `task-late` enters.
 */
const expectedPoints: readonly BacklogPoint[] = [
  {
    date: "2026-07-01" as ISODate,
    incompleteCount: 2,
    incompleteEffortMinutes: 105,
    unestimatedIncompleteCount: 0,
  },
  {
    date: "2026-07-02" as ISODate,
    incompleteCount: 2,
    incompleteEffortMinutes: 60,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-03" as ISODate,
    incompleteCount: 3,
    incompleteEffortMinutes: 90,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-04" as ISODate,
    incompleteCount: 3,
    incompleteEffortMinutes: 90,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-05" as ISODate,
    incompleteCount: 2,
    incompleteEffortMinutes: 60,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-06" as ISODate,
    incompleteCount: 2,
    incompleteEffortMinutes: 60,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-07" as ISODate,
    incompleteCount: 2,
    incompleteEffortMinutes: 60,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-08" as ISODate,
    incompleteCount: 3,
    incompleteEffortMinutes: 180,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-09" as ISODate,
    incompleteCount: 3,
    incompleteEffortMinutes: 180,
    unestimatedIncompleteCount: 1,
  },
  {
    date: "2026-07-10" as ISODate,
    incompleteCount: 3,
    incompleteEffortMinutes: 180,
    unestimatedIncompleteCount: 1,
  },
];

/* -------------------------------------------------------------------------- */
/* Metric inputs                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The injected clock and the reporting basis. `timezone: "utc"` keeps
 * every figure host-independent.
 */
const context: MetricContext = {
  now: "2026-07-31T12:00:00.000Z" as ISODateTime,
  timezone: "utc",
  weekStart: "monday",
  teamMapping: [],
};

const noFilters: FilterCriteria = {};

function range(start: string, end: string): { start: ISODate; end: ISODate } {
  return { start: start as ISODate, end: end as ISODate };
}

/**
 * The drill-down map of a result. The metric reports several figures
 * per point, so the drill-down uses the map form (a flat gid list
 * cannot say which point a task belongs to).
 */
function contributingMap(
  result: MetricResult<BacklogPointSeries> | MetricResult<unknown>,
): Record<string, string[]> {
  return result.contributingTaskGids as Record<string, string[]>;
}

/**
 * Re-aggregates a set of tasks the way the metric does, independently
 * of the metric's own code: every task in the set is incomplete on the
 * evaluated date, and only a task WITH an estimate joins the effort sum
 * (FR-066).
 */
function reaggregateIncomplete(
  tasks: readonly BacklogTask[],
): ReaggregatedFigure {
  return {
    count: tasks.length,
    effortMinutes: tasks.reduce(
      (sum, task) => sum + (task.estimatedMinutes ?? 0),
      0,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("calculateBacklogCurrent", () => {
  it("reports the current incomplete count, effort and unestimated count", () => {
    const result = calculateBacklogCurrent(tasks, noFilters, context);

    expect(result.series.incompleteCount).toBe(3);
    expect(result.series.incompleteEffortMinutes).toBe(180);
    expect(result.series.unestimatedIncompleteCount).toBe(1);
  });

  it("counts the state as of today, not the activity inside a date range", () => {
    // FR-063: the current backlog is a point-in-time state. A date
    // range scopes the DISPLAYED PERIOD (the trend chart), never the
    // current snapshot, so the same in-scope tasks produce the same
    // current figures under any range.
    const ranged = calculateBacklogCurrent(
      tasks,
      {
        dateRange: {
          start: "2026-07-25" as ISODate,
          end: "2026-07-27" as ISODate,
          preset: "custom",
        },
      },
      context,
    );

    expect(ranged.series).toEqual(
      calculateBacklogCurrent(tasks, noFilters, context).series,
    );
    expect(ranged.series.incompleteCount).toBe(3);
  });

  it("excludes a task completed before today and keeps one still open", () => {
    const result = calculateBacklogCurrent(tasks, noFilters, context);

    // `task-closed` was completed on 2026-07-05 and
    // `task-early-closed` on 2026-07-02 — both are out of the backlog
    // as of 2026-07-31; the three open tasks are in it.
    expect(contributingMap(result)["incomplete:2026-07-31"]).toEqual([
      "task-late",
      "task-open",
      "task-unestimated",
    ]);
  });

  it("discloses the unestimated tasks it left out of the effort total", () => {
    const result = calculateBacklogCurrent(tasks, noFilters, context);

    expect(result.population.total).toBe(3);
    expect(result.population.excluded).toEqual([
      { reason: NO_ESTIMATE_REASON, count: 1 },
    ]);
  });

  it("marks the result deduplicated and stamped with the injected clock", () => {
    const result = calculateBacklogCurrent(tasks, noFilters, context);

    expect(result.dedupApplied).toBe(true);
    expect(result.asOf).toBe(context.now);
  });

  it("reproduces its own displayed figures from the drill-down", () => {
    const result = calculateBacklogCurrent(tasks, noFilters, context);

    assertDrillDownMatchesSummary(
      {
        label: "incomplete:2026-07-31",
        displayedCount: result.series.incompleteCount,
        displayedEffortMinutes: result.series.incompleteEffortMinutes,
        contributingGids: contributingMap(result)["incomplete:2026-07-31"],
      },
      tasks,
      reaggregateIncomplete,
    );
  });
});

describe("calculateBacklogDirection", () => {
  it("reconstructs one point per calendar day of the range", () => {
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-10"),
    );

    expect(result.series.points).toHaveLength(10);
    expect(result.series.points[0]?.date).toBe("2026-07-01");
    expect(result.series.points[result.series.points.length - 1]?.date).toBe(
      "2026-07-10",
    );
  });

  it("matches the hand-computed reconstruction exactly", () => {
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-10"),
    );

    expect(result.series.points).toEqual(expectedPoints);
  });

  it("honours the reconstruction predicate at its boundaries", () => {
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-05"),
    );
    const byDate = new Map(
      result.series.points.map((point) => [point.date, point]),
    );

    // Created ON the date → incomplete on that date (`createdAt <= d`).
    expect(byDate.get("2026-07-03" as ISODate)?.incompleteCount).toBe(3);
    // Completed ON the date → NOT incomplete on that date, but still
    // incomplete the day before (`completedAt > d` is strict).
    expect(byDate.get("2026-07-04" as ISODate)?.incompleteCount).toBe(3);
    expect(byDate.get("2026-07-05" as ISODate)?.incompleteCount).toBe(2);
    // Created before the range → still counted while it is open.
    expect(byDate.get("2026-07-01" as ISODate)?.incompleteCount).toBe(2);
  });

  it("reports the count trend and the effort trend separately", () => {
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-10"),
    );

    expect(result.series.trend).toBe("up");
    expect(result.series.effortTrend).toBe("up");
  });

  it("reports a shrinking backlog as a down trend", () => {
    const shrinking = [
      makeTask({
        gid: "task-done",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: "2026-07-03T09:00:00.000Z",
        estimatedMinutes: 60,
      }),
    ];

    const result = calculateBacklogDirection(
      shrinking,
      noFilters,
      context,
      range("2026-07-01", "2026-07-04"),
    );

    expect(result.series.trend).toBe("down");
    expect(result.series.effortTrend).toBe("down");
    expect(result.series.points[0]?.incompleteCount).toBe(1);
    expect(result.series.points[3]?.incompleteCount).toBe(0);
  });

  it("reports a steady backlog as a flat trend", () => {
    const steady = [
      makeTask({
        gid: "task-steady",
        createdAt: "2026-07-01T09:00:00.000Z",
        estimatedMinutes: 60,
      }),
    ];

    const result = calculateBacklogDirection(
      steady,
      noFilters,
      context,
      range("2026-07-01", "2026-07-03"),
    );

    expect(result.series.trend).toBe("flat");
    expect(result.series.effortTrend).toBe("flat");
  });

  it("keeps the count trend and the effort trend apart", () => {
    // A task without an estimate grows the count but not the effort.
    const mixed = [
      makeTask({
        gid: "task-estimated",
        createdAt: "2026-07-01T09:00:00.000Z",
        estimatedMinutes: 60,
      }),
      makeTask({
        gid: "task-without-estimate",
        createdAt: "2026-07-03T09:00:00.000Z",
      }),
    ];

    const result = calculateBacklogDirection(
      mixed,
      noFilters,
      context,
      range("2026-07-01", "2026-07-04"),
    );

    expect(result.series.trend).toBe("up");
    expect(result.series.effortTrend).toBe("flat");
  });

  it("applies each task's CURRENT estimate to the days it was incomplete", () => {
    // FR-066: Asana does not expose historical estimate values, so the
    // historical effort figure uses the current cached estimate applied
    // retroactively. The limitation is disclosed, not hidden.
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-01"),
    );

    expect(result.series.points[0]?.incompleteEffortMinutes).toBe(105);
    expect(BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE).toContain("current");
  });

  it("counts an unestimated incomplete task separately from the effort", () => {
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-08", "2026-07-10"),
    );

    expect(result.series.points[0]?.incompleteCount).toBe(3);
    expect(result.series.points[0]?.incompleteEffortMinutes).toBe(180);
    expect(result.series.points[0]?.unestimatedIncompleteCount).toBe(1);
    expect(result.population.excluded).toEqual([
      { reason: NO_ESTIMATE_REASON, count: 1 },
    ]);
  });

  it("counts a task that belongs to two projects exactly once", () => {
    const multiProject = [
      makeTask({
        gid: "task-multi",
        createdAt: "2026-07-01T09:00:00.000Z",
        projectGids: ["project-1", "project-2"],
        estimatedMinutes: 60,
      }),
    ];

    const result = calculateBacklogDirection(
      multiProject,
      noFilters,
      context,
      range("2026-07-01", "2026-07-01"),
    );

    expect(result.series.points[0]?.incompleteCount).toBe(1);
    expect(result.series.points[0]?.incompleteEffortMinutes).toBe(60);
  });

  it("counts a duplicated task row exactly once", () => {
    const duplicated = [
      makeTask({
        gid: "task-duplicate",
        createdAt: "2026-07-01T09:00:00.000Z",
        estimatedMinutes: 60,
      }),
      makeTask({
        gid: "task-duplicate",
        createdAt: "2026-07-01T09:00:00.000Z",
        estimatedMinutes: 60,
      }),
    ];

    const result = calculateBacklogDirection(
      duplicated,
      noFilters,
      context,
      range("2026-07-01", "2026-07-01"),
    );

    expect(result.series.points[0]?.incompleteCount).toBe(1);
    expect(result.series.points[0]?.incompleteEffortMinutes).toBe(60);
  });

  it("applies the user's own filters on top of the in-scope task list", () => {
    const twoProjects = [
      makeTask({
        gid: "task-in-project-1",
        createdAt: "2026-07-01T09:00:00.000Z",
        projectGids: ["project-1"],
        estimatedMinutes: 60,
      }),
      makeTask({
        gid: "task-in-project-2",
        createdAt: "2026-07-01T09:00:00.000Z",
        projectGids: ["project-2"],
        estimatedMinutes: 30,
      }),
    ];

    const all = calculateBacklogDirection(
      twoProjects,
      noFilters,
      context,
      range("2026-07-01", "2026-07-01"),
    );
    const filtered = calculateBacklogDirection(
      twoProjects,
      { projectGids: ["project-2"] },
      context,
      range("2026-07-01", "2026-07-01"),
    );

    expect(all.series.points[0]?.incompleteCount).toBe(2);
    expect(filtered.series.points[0]?.incompleteCount).toBe(1);
    expect(filtered.series.points[0]?.incompleteEffortMinutes).toBe(30);
  });

  it("evaluates every point under the reporting timezone basis", () => {
    // FR-029 / FR-034: a task completed at 2026-07-31T20:00Z was
    // completed on the 31st in UTC but on the 1st of August in Sydney
    // (+10), so it was still incomplete on the 31st under the local
    // basis and already completed under the UTC basis.
    const lateCompletion = [
      makeTask({
        gid: "task-tz",
        createdAt: "2026-07-01T09:00:00.000Z",
        completedAt: "2026-07-31T20:00:00.000Z",
        estimatedMinutes: 15,
      }),
    ];

    const utc = calculateBacklogDirection(
      lateCompletion,
      noFilters,
      { ...context, timezone: "utc" },
      range("2026-07-31", "2026-07-31"),
    );
    const local = calculateBacklogDirection(
      lateCompletion,
      noFilters,
      { ...context, timezone: "local" },
      range("2026-07-31", "2026-07-31"),
    );

    expect(utc.series.points[0]?.incompleteCount).toBe(0);
    expect(local.series.points[0]?.incompleteCount).toBe(1);
    expect(local.series.points[0]?.incompleteEffortMinutes).toBe(15);
  });

  it("drills every point down to its exact contributing task list", () => {
    const result = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-10"),
    );
    const contributing = contributingMap(result);

    for (const point of result.series.points) {
      assertDrillDownMatchesSummary(
        {
          label: `incomplete:${point.date}`,
          displayedCount: point.incompleteCount,
          displayedEffortMinutes: point.incompleteEffortMinutes,
          contributingGids: contributing[`incomplete:${point.date}`],
        },
        tasks,
        reaggregateIncomplete,
      );
    }
  });

  it("reconstructs the current state as the last point of the series", () => {
    // research.md §11: ONE predicate. The current figure and every
    // historical point go through the same implementation, so the
    // current state can never drift from the series' last point.
    const current = calculateBacklogCurrent(tasks, noFilters, context);
    const series = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-31"),
    );
    const lastPoint = series.series.points[series.series.points.length - 1];

    expect(lastPoint?.incompleteCount).toBe(current.series.incompleteCount);
    expect(lastPoint?.incompleteEffortMinutes).toBe(
      current.series.incompleteEffortMinutes,
    );
    expect(lastPoint?.unestimatedIncompleteCount).toBe(
      current.series.unestimatedIncompleteCount,
    );
  });

  it("returns byte-identical output for identical inputs", () => {
    const first = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-10"),
    );
    const second = calculateBacklogDirection(
      tasks,
      noFilters,
      context,
      range("2026-07-01", "2026-07-10"),
    );

    expect(second).toEqual(first);
  });

  it("refuses a range whose end precedes its start", () => {
    expect(() =>
      calculateBacklogDirection(
        tasks,
        noFilters,
        context,
        range("2026-07-10", "2026-07-01"),
      ),
    ).toThrow(/range/i);
  });
});
