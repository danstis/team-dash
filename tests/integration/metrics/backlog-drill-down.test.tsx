/**
 * BSOD-324 (T087) — `BacklogDrillDown` integration red→green.
 *
 * Spec / contract references
 * --------------------------
 * - FR-067 (spec.md): "The system MUST make each backlog figure
 *   drillable to its exact contributing incomplete-task list, including
 *   historical points where the drill-down reflects tasks currently
 *   known to have been incomplete on that date." This surface IS that
 *   drill-down for US5.
 * - FR-063 (spec.md): the current backlog is a point-in-time state, so
 *   its drill-down lists the tasks that are incomplete today.
 * - FR-066 (spec.md): a historical effort figure uses each task's
 *   CURRENT cached estimate applied retroactively, and that limitation
 *   is disclosed rather than hidden.
 * - FR-058 (spec.md): the tasks left out of an effort sum are disclosed,
 *   so a list of four tasks can be compared with a figure honestly.
 * - FR-037 (spec.md): a drill-down shows ALL of a task's project
 *   memberships.
 * - FR-052 / FR-053 (spec.md): the drill-down reuses the shared task
 *   table and the shared task detail drawer.
 * - Constitution Principle III (Test-First Quality) and Principle VII
 *   (Honest UX — drill parity).
 *
 * What this test pins
 * -------------------
 *
 * 1. A historical backlog point opens a drill-down listing EXACTLY the
 *    tasks that were incomplete on that date — the reconstruction
 *    predicate's answer, not a recount (FR-067).
 *
 * 2. The current backlog figure opens a drill-down listing today's
 *    incomplete tasks (FR-063).
 *
 * 3. The listed tasks re-aggregate to the figure the user clicked —
 *    drill parity, checked with the SHARED `assertDrillDownMatchesSummary`
 *    helper rather than a second copy of the rule.
 *
 * 4. Picking a task opens the shared `TaskDetailDrawer` (T067), and the
 *    detail shows every project membership of that task (FR-037).
 *
 * 5. A historical effort figure discloses the retroactive-estimate
 *    limitation (FR-066) and the tasks left out of the sum (FR-058).
 *
 * Test-first discipline
 * ---------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/metrics/BacklogDrillDown'", and the same file
 * goes green once the component implements the surface below — with no
 * test-side change.
 *
 * The metric is NOT re-implemented here. The drill-down consumes the
 * output of `calculateBacklogCurrent` and `calculateBacklogDirection`
 * (T082 / BSOD-322) — the metric's own drill-down sets, in the metric's
 * own order.
 *
 * Determinism
 * ------------
 * The injected clock, the timezone basis and the reporting range are
 * fixed, so every figure is identical on every host. The fixtures below
 * are synthetic: no browser, no live Asana workspace, no real personal
 * access token.
 */
import { type ReactElement, StrictMode, useMemo, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Task } from "../../../src/data/db/schema";
import {
  BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE,
  calculateBacklogCurrent,
  calculateBacklogDirection,
  type BacklogCurrentValue,
  type BacklogPointSeries,
  type BacklogTask,
} from "../../../src/domain/metrics/backlog";
import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
  MetricContext,
  MetricResult,
} from "../../../src/domain/types";
import {
  BacklogDrillDown,
  type BacklogDrillDownFigure,
} from "../../../src/features/metrics/BacklogDrillDown";
import { formatDuration } from "../../../src/shared/format";
import {
  assertDrillDownMatchesSummary,
  type ReaggregatedFigure,
} from "../../unit/domain/metrics/support/assertDrillDownMatchesSummary";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A branded ISO instant for a fixture row. */
function at(value: string): ISODateTime {
  return value as ISODateTime;
}

/** A branded calendar date for a fixture row. */
function day(value: string): ISODate {
  return value as ISODate;
}

/**
 * Builds a cached task row — the shape the drawer reads, and the shape
 * the drill-down resolves the metric's gids against. Every field of the
 * cache record is supplied, so the fixture is a real `Task`.
 */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    gid: "task-1",
    name: "Draft the launch brief",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-03-02T09:00:00.000Z",
    modifiedAt: "2026-03-11T08:00:00.000Z",
    completedAt: null,
    dueAt: "2026-03-06T00:00:00.000Z",
    priorityOptionId: "priority-high",
    estimatedMinutes: 120,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-03-15T00:00:00.000Z",
    outOfScopeReason: null,
    ...overrides,
  };
}

/**
 * Six synthetic tasks, chosen so that every backlog figure below has a
 * hand-computed answer. The reconstruction predicate is
 * `createdAt <= d && (completedAt == null || completedAt > d)`, so a
 * task completed ON a day was already out of the backlog on that day.
 *
 * | Task   | Created          | Completed        | Estimate | Notes                          |
 * |--------|------------------|------------------|----------|--------------------------------|
 * | task-1 | Mon 2 Mar 09:00  | —                | 120 min  | two project memberships        |
 * | task-2 | Tue 3 Mar 09:00  | —                | 60 min   |                                |
 * | task-3 | Wed 4 Mar 09:00  | Fri 6 Mar 09:00  | none     | not estimated                  |
 * | task-4 | Wed 4 Mar 14:00  | Wed 4 Mar 16:00  | 30 min   | created and completed same day |
 * | task-5 | Fri 20 Feb 09:00 | Sat 7 Mar 09:00  | 90 min   | open before the range           |
 * | task-6 | Mon 9 Mar 09:00  | —                | 45 min   | open on the reporting day      |
 *
 * The hand-computed reconstruction over 2 – 9 March 2026 (the
 * reporting day is 9 March):
 *
 * | Date       | Incomplete tasks     | Count | Effort | Unestimated |
 * |------------|----------------------|-------|--------|-------------|
 * | 2 Mar      | task-1, task-5       | 2     | 210    | 0           |
 * | 3 Mar      | task-1, task-2, t-5  | 3     | 270    | 0           |
 * | 4 Mar      | task-1, t-2, t-3, t-5| 4     | 270    | 1 (task-3) |
 * | 5 Mar      | task-1, t-2, t-3, t-5| 4     | 270    | 1 (task-3) |
 * | 6 Mar      | task-1, task-2, t-5  | 3     | 270    | 0           |
 * | 7 Mar      | task-1, task-2       | 2     | 180    | 0           |
 * | 8 Mar      | task-1, task-2       | 2     | 180    | 0           |
 * | 9 Mar (now)| task-1, task-2, t-6 | 3     | 225    | 0           |
 *
 * task-4 never appears: it was created and completed on the same day,
 * so it was never incomplete on a day of its own.
 */
const TASKS: readonly Task[] = [
  makeTask({
    gid: "task-1",
    name: "Draft the launch brief",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo", "project-borealis"],
    priorityOptionId: "priority-high",
    createdAt: "2026-03-02T09:00:00.000Z",
    dueAt: "2026-03-06T00:00:00.000Z",
    completedAt: null,
    estimatedMinutes: 120,
  }),
  makeTask({
    gid: "task-2",
    name: "Book the venue",
    assigneeGid: "user-bo",
    projectGids: ["project-apollo"],
    priorityOptionId: null,
    createdAt: "2026-03-03T09:00:00.000Z",
    dueAt: "2026-03-20T00:00:00.000Z",
    completedAt: null,
    estimatedMinutes: 60,
  }),
  makeTask({
    gid: "task-3",
    name: "Refresh the pricing model",
    assigneeGid: "user-alice",
    projectGids: ["project-borealis"],
    priorityOptionId: "priority-low",
    createdAt: "2026-03-04T09:00:00.000Z",
    dueAt: null,
    completedAt: "2026-03-06T09:00:00.000Z",
    estimatedMinutes: null,
  }),
  makeTask({
    gid: "task-4",
    name: "Archive the old campaign",
    assigneeGid: "user-bo",
    projectGids: ["project-borealis"],
    priorityOptionId: null,
    createdAt: "2026-03-04T14:00:00.000Z",
    dueAt: null,
    completedAt: "2026-03-04T16:00:00.000Z",
    estimatedMinutes: 30,
  }),
  makeTask({
    gid: "task-5",
    name: "Publish the migration checklist",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo"],
    priorityOptionId: "priority-high",
    createdAt: "2026-02-20T09:00:00.000Z",
    dueAt: null,
    completedAt: "2026-03-07T09:00:00.000Z",
    estimatedMinutes: 90,
  }),
  makeTask({
    gid: "task-6",
    name: "Renew the domain registration",
    assigneeGid: "user-bo",
    projectGids: ["project-borealis"],
    priorityOptionId: null,
    createdAt: "2026-03-09T09:00:00.000Z",
    dueAt: null,
    completedAt: null,
    estimatedMinutes: 45,
  }),
];

/** The reporting period: Monday 2 March 2026 to Monday 9 March 2026. */
const RANGE = {
  start: day("2026-03-02"),
  end: day("2026-03-09"),
  preset: "custom",
} as const;

/** The user's active filters: the reporting period and nothing else. */
const CRITERIA: FilterCriteria = { dateRange: RANGE };

/**
 * The injected clock, the timezone basis and the current team mapping.
 * The basis is UTC, so the calendar days land on the same dates on
 * every host. The clock says 9 March 2026 — the reporting day.
 */
const CONTEXT: MetricContext = {
  now: at("2026-03-09T00:00:00.000Z"),
  timezone: "utc",
  weekStart: "monday",
  teamMapping: [],
};

/** The people the drill-down may name. */
const USERS = [
  { gid: "user-alice", name: "Alice Nkemelu" },
  { gid: "user-bo", name: "Bo Chen" },
] as const;

/** The projects the drill-down may name. */
const PROJECTS = [
  { gid: "project-apollo", name: "Apollo" },
  { gid: "project-borealis", name: "Borealis" },
] as const;

/** The human names of the priority options, keyed by their option id. */
const PRIORITY_LABELS = {
  "priority-high": "High",
  "priority-low": "Low",
} as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The metric's task projection: the cached row's own fields, with the
 * branded instants the domain contract uses. The cache already stores
 * ISO instants, so nothing is converted — only the brand is added.
 */
function metricTask(task: Task): BacklogTask {
  return {
    gid: task.gid,
    assigneeGid: task.assigneeGid,
    projectGids: task.projectGids,
    createdAt: task.createdAt as ISODateTime,
    dueAt: task.dueAt === null ? null : (task.dueAt as ISODateTime),
    completedAt:
      task.completedAt === null ? null : (task.completedAt as ISODateTime),
    priorityOptionId: task.priorityOptionId,
    estimatedMinutes: task.estimatedMinutes,
  };
}

/** The metric's own task list. */
const METRIC_TASKS: readonly BacklogTask[] = TASKS.map(metricTask);

/** The current backlog state — the metric's own result (FR-063). */
const CURRENT: MetricResult<BacklogCurrentValue> = calculateBacklogCurrent(
  METRIC_TASKS,
  CRITERIA,
  CONTEXT,
);

/** The reconstructed backlog series — the metric's own result (FR-064). */
const SERIES: MetricResult<BacklogPointSeries> = calculateBacklogDirection(
  METRIC_TASKS,
  CRITERIA,
  CONTEXT,
  { start: RANGE.start, end: RANGE.end },
);

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

/** The gids the drill-down's table lists, in the order it lists them. */
function listedTaskGids(): readonly string[] {
  return screen
    .getAllByTestId("task-row")
    .map((row) => row.getAttribute("data-task-gid") ?? "");
}

/** The button that opens the detail of one listed task. */
function taskButton(gid: string): HTMLElement {
  const button = document.querySelector(
    `[data-testid="drill-down-panel-task"][data-task-gid="${gid}"]`,
  );
  if (button === null) {
    throw new Error(`No task button for ${gid}`);
  }
  return button as HTMLElement;
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The drill-down on its own: the figure the user drilled into, the
 * metric results it came from, and the cached task rows the list is
 * resolved against.
 */
function renderDrillDown(figure: BacklogDrillDownFigure): void {
  render(
    <StrictMode>
      <BacklogDrillDown
        figure={figure}
        current={CURRENT}
        series={SERIES}
        tasks={TASKS}
        users={USERS}
        projects={PROJECTS}
        priorityLabels={PRIORITY_LABELS}
        timezone="utc"
      />
    </StrictMode>,
  );
}

/**
 * The page the drill-down will live on: a backlog point and a current
 * backlog figure the user can click, and the drill-down that opens for
 * whichever one they picked. The backlog view itself lands with the
 * next row of this phase; this harness stands in for it so the
 * drill-down's own contract is pinned now.
 */
function BacklogHarness(): ReactElement {
  const [figure, setFigure] = useState<BacklogDrillDownFigure | null>(null);
  const points = useMemo(() => SERIES.series.points, []);

  return (
    <StrictMode>
      <ul>
        {points.map((point) => (
          <li key={point.date}>
            <button
              type="button"
              data-testid="backlog-point"
              data-date={point.date}
              onClick={() => {
                setFigure({
                  kind: "historical",
                  view: "count",
                  date: point.date,
                });
              }}
            >
              {point.date}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            data-testid="backlog-current"
            onClick={() => {
              setFigure({ kind: "current", view: "count" });
            }}
          >
            Current backlog
          </button>
        </li>
      </ul>

      {figure === null ? null : (
        <BacklogDrillDown
          figure={figure}
          current={CURRENT}
          series={SERIES}
          tasks={TASKS}
          users={USERS}
          projects={PROJECTS}
          priorityLabels={PRIORITY_LABELS}
          timezone="utc"
        />
      )}
    </StrictMode>
  );
}

/* -------------------------------------------------------------------------- */
/* The backlog drill-down                                                     */
/* -------------------------------------------------------------------------- */

describe("BSOD-324 (T087) — the backlog drill-down", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists the exact incomplete tasks of a historical backlog point", () => {
    renderDrillDown({
      kind: "historical",
      view: "count",
      date: day("2026-03-04"),
    });

    // FR-067 — the drill-down of a historical point lists the tasks
    // that were incomplete on THAT date: task-3 (completed on the 6th)
    // and task-5 (completed on the 7th) were still open on the 4th, and
    // task-4 (created and completed on the 4th) never was.
    expect(listedTaskGids()).toEqual(["task-1", "task-2", "task-3", "task-5"]);
    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog on 4 Mar 2026",
    );
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("4 tasks");
  });

  it("keeps the listed tasks in step with the figure they were drilled from", () => {
    renderDrillDown({
      kind: "historical",
      view: "count",
      date: day("2026-03-04"),
    });

    // Drill parity (Principle VII) — the panel states the comparison
    // instead of implying it.
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These are the same 4 tasks the figure counts.",
    );

    // The same rule as the metric's own suite, applied to what the
    // SURFACE rendered: the listed tasks re-aggregate to the figure the
    // metric displayed for that date.
    const point = SERIES.series.points.find(
      (candidate) => candidate.date === day("2026-03-04"),
    );
    if (point === undefined) {
      throw new Error("No point for 2026-03-04 in the reconstructed series");
    }
    assertDrillDownMatchesSummary(
      {
        label: "incomplete:2026-03-04",
        displayedCount: point.incompleteCount,
        displayedEffortMinutes: point.incompleteEffortMinutes,
        contributingGids: listedTaskGids(),
      },
      METRIC_TASKS,
      reaggregateIncomplete,
    );
  });

  it("opens the shared task detail drawer for a listed task", () => {
    renderDrillDown({
      kind: "historical",
      view: "count",
      date: day("2026-03-04"),
    });

    // The drawer is not open until a task is chosen.
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();

    fireEvent.click(taskButton("task-3"));

    // FR-052 / FR-053 — the shared drawer describes the chosen task.
    expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-name")).toHaveTextContent(
      "Refresh the pricing model",
    );

    // FR-037 — every project membership of the task is shown.
    const memberships = within(
      screen.getByTestId("task-detail-projects"),
    ).getAllByTestId("task-detail-project");
    expect(memberships.map((item) => item.textContent)).toEqual(["Borealis"]);

    // The drawer closes again on the user's word.
    fireEvent.click(screen.getByTestId("task-detail-close"));
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
  });

  it("shows every project membership of the task it opens", () => {
    renderDrillDown({
      kind: "historical",
      view: "count",
      date: day("2026-03-04"),
    });

    fireEvent.click(taskButton("task-1"));

    // FR-037 — task-1 belongs to two projects, and the drill-down shows
    // both of them.
    const memberships = within(
      screen.getByTestId("task-detail-projects"),
    ).getAllByTestId("task-detail-project");
    expect(memberships.map((item) => item.textContent)).toEqual([
      "Apollo",
      "Borealis",
    ]);
  });

  it("lists today's incomplete tasks for the current backlog figure", () => {
    renderDrillDown({ kind: "current", view: "count" });

    // FR-063 / FR-067 — the current state is a point-in-time state, so
    // its drill-down holds the tasks that are open today: task-3 and
    // task-5 were completed before the reporting day, and task-6 was
    // created on it.
    expect(listedTaskGids()).toEqual(["task-1", "task-2", "task-6"]);
    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog today",
    );
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("3 tasks");
  });

  it("keeps a historical effort figure in step with the listed estimates", () => {
    renderDrillDown({
      kind: "historical",
      view: "effort",
      date: day("2026-03-04"),
    });

    // The 4 March effort is 270 minutes: task-3 carries no estimate and
    // is left out of the sum (FR-058 / FR-066).
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent(formatDuration(270));
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These estimates add up to the same 4 h 30 min the figure shows.",
    );
    expect(screen.getByTestId("drill-down-panel-exclusion")).toHaveTextContent(
      "1 of the 4 listed tasks carries no estimate",
    );
  });

  it("discloses the retroactive-estimate limitation of a historical effort figure", () => {
    renderDrillDown({
      kind: "historical",
      view: "effort",
      date: day("2026-03-04"),
    });

    // FR-066 — a historical effort figure uses each task's CURRENT
    // estimate, and the user is told so.
    expect(
      screen.getByTestId("backlog-drill-down-disclosure"),
    ).toHaveTextContent(BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE);
  });

  it("says when a date is not part of the reconstructed backlog", () => {
    renderDrillDown({
      kind: "historical",
      view: "count",
      date: day("2026-02-01"),
    });

    // The reconstructed series starts on 2 March, so 1 February has no
    // point and no contributing tasks. The surface says so rather than
    // showing an empty list against a figure it never had (Principle
    // VII).
    expect(
      screen.getByTestId("backlog-drill-down-unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("drill-down-panel")).not.toBeInTheDocument();
  });

  it("opens the drill-down from a clicked backlog point", () => {
    render(<BacklogHarness />);

    expect(screen.queryByTestId("drill-down-panel")).not.toBeInTheDocument();

    fireEvent.click(
      document.querySelector(
        '[data-testid="backlog-point"][data-date="2026-03-04"]',
      ) as HTMLElement,
    );

    // FR-067 — the clicked point opens its own drill-down, with that
    // date's incomplete tasks behind it.
    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog on 4 Mar 2026",
    );
    expect(listedTaskGids()).toEqual(["task-1", "task-2", "task-3", "task-5"]);
  });

  it("opens the drill-down from the clicked current backlog figure", () => {
    render(<BacklogHarness />);

    fireEvent.click(screen.getByTestId("backlog-current"));

    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog today",
    );
    expect(listedTaskGids()).toEqual(["task-1", "task-2", "task-6"]);
  });
});
