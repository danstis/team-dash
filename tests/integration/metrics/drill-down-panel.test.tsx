/**
 * BSOD-321 (T081) — `DrillDownPanel` integration red→green.
 *
 * Spec / contract references
 * --------------------------
 * - FR-052 (spec.md): "Every summary card, chart series, table row, and
 *   ranked result MUST support drill-down to its contributing tasks
 *   wherever that is practical for the metric." The panel IS that
 *   drill-down surface, and it is generic: the per-metric drill panels
 *   of US5 (backlog), US7 (delivery quality), US8 (diagnostics) and
 *   US9 (task health) reuse it.
 * - FR-053 (spec.md): the task detail reached via drill-down MUST show
 *   sufficient source fields — project memberships, dates, assignee,
 *   priority, completion state, estimate/actual, dependencies — for the
 *   user to verify why a task was included in, or excluded from, the
 *   metric they drilled from.
 * - FR-037 (spec.md): a drill-down MUST show ALL of a task's project
 *   memberships, not the first one.
 * - FR-062 (spec.md): every created/completed figure of the US4 chart
 *   is drillable to its exact contributing task list.
 * - FR-058 (spec.md): the effort sums leave out the tasks that carry no
 *   estimate, and the exclusion is disclosed rather than hidden.
 * - Constitution Principle III (Test-First Quality) and Principle VII
 *   (Honest UX — drill parity).
 *
 * What this test pins
 * -------------------
 *
 * 1. The panel reuses the shared task table (`TaskTable`, T066): the
 *    contributing tasks are listed as table rows, with the source
 *    fields the user verifies the metric against (FR-053).
 *
 * 2. The panel reuses the shared task detail drawer (`TaskDetailDrawer`,
 *    T067): choosing a listed task opens its detail, and the detail
 *    shows EVERY project membership of that task (FR-037).
 *
 * 3. The rendered list matches the displayed figure — the same tasks,
 *    the same item count, and the same effort once the listed tasks are
 *    re-aggregated (drill parity).
 *
 * 4. The tasks left out of an effort figure are disclosed (FR-058), so
 *    the list and the figure can be compared honestly.
 *
 * 5. A figure and a list that do not agree are disclosed as such. The
 *    panel never claims a match it has not checked (Principle VII).
 *
 * 6. The panel takes the drill-down the US4 chart emits and lists
 *    exactly the chart's tasks, so the list behind a bar is the bar's
 *    own list — not a re-count (FR-062).
 *
 * Test-first discipline
 * ---------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/metrics/DrillDownPanel'", and the same file
 * goes green once the panel implements the surface below — with no
 * test-side change.
 *
 * The metric is NOT re-implemented here. The panel consumes the output
 * of `calculateWorkAddedVsCompleted` (T075 / BSOD-318) and the drill
 * requests `WorkAddedCompletedChart` (T076 / BSOD-319) emits; the
 * chart's own figures are the ones the list is compared against.
 *
 * Determinism
 * ------------
 * The reporting range, the injected clock and the timezone basis are
 * fixed, so the bucketing and every figure are identical on every host.
 * The fixtures below are synthetic: no browser, no live Asana
 * workspace, no real personal access token.
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
  calculateWorkAddedVsCompleted,
  type WorkAddedCompletedGroupBy,
  type WorkAddedCompletedSeries,
} from "../../../src/domain/metrics/workAddedCompleted";
import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
  MetricContext,
  MetricResult,
} from "../../../src/domain/types";
import {
  CountEffortToggle,
  type ChartView,
} from "../../../src/features/metrics/ChartControls";
import {
  DrillDownPanel,
  type DrillDownFigure,
} from "../../../src/features/metrics/DrillDownPanel";
import {
  WorkAddedCompletedChart,
  type WorkAddedCompletedChartGroup,
  type WorkAddedCompletedDrillDownRequest,
} from "../../../src/features/metrics/WorkAddedCompletedChart";
import { formatDuration } from "../../../src/shared/format";

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
 * the panel resolves the drill-down gids against. Every field of the
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
 * Six synthetic tasks, chosen so that every figure below has a
 * hand-computed answer:
 *
 * | Task   | Created         | Completed       | Estimate | Assignee | Notes                          |
 * |--------|-----------------|-----------------|----------|----------|--------------------------------|
 * | task-1 | Mon 2 Mar 09:00 | —               | 120 min  | Alice    | two project memberships        |
 * | task-2 | Tue 3 Mar 09:00 | —               | 60 min   | Bo       |                                |
 * | task-3 | Wed 4 Mar 09:00 | Fri 6 Mar 09:00 | none     | Alice    | not estimated                  |
 * | task-4 | Wed 4 Mar 14:00 | Wed 4 Mar 16:00 | 30 min   | Bo       | added and completed the same day|
 * | task-5 | Fri 20 Feb 09:00| Sat 7 Mar 09:00 | 90 min   | Alice    | added before the range          |
 * | task-6 | Mon 9 Mar 09:00 | —               | 45 min   | Bo       | added after the range           |
 *
 * So: four tasks were added inside the range (task-1, task-2, task-3,
 * task-4) and four were completed inside it (task-1, task-3, task-4,
 * task-5) — two independent scans, and task-1 and task-3 are in both.
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

/**
 * The reporting period: Monday 2 March 2026 to Sunday 8 March 2026 —
 * seven daily buckets, one ISO week.
 */
const RANGE = {
  start: day("2026-03-02"),
  end: day("2026-03-08"),
  preset: "custom",
} as const;

/** The user's active filters: the reporting period and nothing else. */
const CRITERIA: FilterCriteria = { dateRange: RANGE };

/**
 * The injected clock, the timezone basis and the current team mapping.
 * The basis is UTC so the buckets land on the same calendar days on
 * every host.
 */
const CONTEXT: MetricContext = {
  now: at("2026-03-09T00:00:00.000Z"),
  timezone: "utc",
  weekStart: "monday",
  teamMapping: [],
};

/** The people the panel may name. */
const USERS = [
  { gid: "user-alice", name: "Alice Nkemelu" },
  { gid: "user-bo", name: "Bo Chen" },
] as const;

/** The projects the panel may name. */
const PROJECTS = [
  { gid: "project-apollo", name: "Apollo" },
  { gid: "project-borealis", name: "Borealis" },
] as const;

/** The human names of the priority options, keyed by their option id. */
const PRIORITY_LABELS = {
  "priority-high": "High",
  "priority-low": "Low",
} as const;

/** The names behind the group keys, so the chart can label its groups. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  "user-alice": "Alice Nkemelu",
  "user-bo": "Bo Chen",
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The metric's task projection: the cached row's own fields, with the
 * branded instants the domain contract uses. The cache already stores
 * ISO instants, so nothing is converted — only the brand is added.
 */
function metricTask(task: Task): {
  readonly gid: string;
  readonly assigneeGid: string | null;
  readonly projectGids: readonly string[];
  readonly createdAt: ISODateTime;
  readonly dueAt: ISODateTime | null;
  readonly completedAt: ISODateTime | null;
  readonly priorityOptionId: string | null;
  readonly estimatedMinutes: number | null;
} {
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

/** The metric results the chart draws — the domain's own output. */
function chartGroups(
  groupBy: WorkAddedCompletedGroupBy | undefined,
): readonly WorkAddedCompletedChartGroup[] {
  const metricTasks = TASKS.map(metricTask);
  if (groupBy === undefined) {
    return [
      {
        groupKey: undefined,
        result: calculateWorkAddedVsCompleted(metricTasks, CRITERIA, CONTEXT),
      },
    ];
  }
  const grouped = calculateWorkAddedVsCompleted(
    metricTasks,
    CRITERIA,
    CONTEXT,
    groupBy,
  );
  return Object.entries(grouped).map(([groupKey, result]) => ({
    groupKey,
    result,
  }));
}

/**
 * The figure the dashboard hands the panel: the number the chart
 * displayed for the drilled cell, read from the metric result rather
 * than counted by the panel.
 */
function figureFor(
  result: MetricResult<WorkAddedCompletedSeries>,
  request: WorkAddedCompletedDrillDownRequest,
): DrillDownFigure {
  const bucket = result.series.buckets.find(
    (candidate) => candidate.bucketStart === request.bucketStart,
  );
  if (bucket === undefined) {
    throw new Error(`No bucket ${request.bucketStart} in the metric result`);
  }
  const count =
    request.measure === "created" ? bucket.createdCount : bucket.completedCount;
  const minutes =
    request.measure === "created"
      ? bucket.createdEffortMinutes
      : bucket.completedEffortMinutes;
  const value = request.view === "count" ? count : minutes;
  return {
    label: request.measure === "created" ? "Items added" : "Items completed",
    value,
    unit: request.view === "count" ? "count" : "minutes",
  };
}

/** The drill-down button of one figure in the chart's data table. */
function drillDownButton(
  bucketStart: string,
  measure: "created" | "completed",
): HTMLElement {
  const row = document.querySelector(
    `[data-testid="work-added-completed-row"][data-bucket-start="${bucketStart}"]`,
  );
  if (row === null) {
    throw new Error(`No chart row for bucket ${bucketStart}`);
  }
  const cell = row.querySelector(
    `[data-testid="work-added-completed-figure"][data-measure="${measure}"]`,
  );
  if (cell === null) {
    throw new Error(`No ${measure} figure for bucket ${bucketStart}`);
  }
  return within(cell as HTMLElement).getByTestId(
    "work-added-completed-drill-down",
  );
}

/** The number the chart states for one figure, as text. */
function chartFigureText(
  bucketStart: string,
  measure: "created" | "completed",
): string {
  const row = document.querySelector(
    `[data-testid="work-added-completed-row"][data-bucket-start="${bucketStart}"]`,
  );
  if (row === null) {
    throw new Error(`No chart row for bucket ${bucketStart}`);
  }
  const cell = row.querySelector(
    `[data-testid="work-added-completed-figure"][data-measure="${measure}"]`,
  );
  if (cell === null) {
    throw new Error(`No ${measure} figure for bucket ${bucketStart}`);
  }
  return (
    within(cell as HTMLElement).getByTestId("work-added-completed-value")
      .textContent ?? ""
  );
}

/** The gids of the rows the panel's task table lists. */
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
 * The panel on its own: the dashboard hands it the figure the user
 * drilled into and the exact contributing task list behind it.
 */
function renderPanel(
  figure: DrillDownFigure,
  taskGids: readonly string[],
): void {
  render(
    <StrictMode>
      <DrillDownPanel
        title="Items added — 4 Mar 2026"
        figure={figure}
        taskGids={taskGids}
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
 * The dashboard: the US4 chart, the shared controls (T080) and the
 * drill-down panel (T081), wired the way the app will wire them. The
 * figure handed to the panel is read from the metric result — the
 * panel never counts anything of its own.
 */
function DashboardHarness(): ReactElement {
  const [view, setView] = useState<ChartView>("count");
  const [request, setRequest] =
    useState<WorkAddedCompletedDrillDownRequest | null>(null);

  const groups = useMemo(() => chartGroups(undefined), []);
  const result = groups[0]?.result;

  return (
    <StrictMode>
      <CountEffortToggle value={view} onChange={setView} />

      <WorkAddedCompletedChart
        groups={groups}
        view={view}
        groupLabels={GROUP_LABELS}
        onDrillDown={setRequest}
      />

      {request !== null && result !== undefined ? (
        <DrillDownPanel
          title={`Items ${
            request.measure === "created" ? "added" : "completed"
          } — ${request.bucketStart}`}
          figure={figureFor(result, request)}
          taskGids={request.taskGids}
          tasks={TASKS}
          users={USERS}
          projects={PROJECTS}
          priorityLabels={PRIORITY_LABELS}
          timezone="utc"
        />
      ) : null}
    </StrictMode>
  );
}

/* -------------------------------------------------------------------------- */
/* The drill-down panel                                                       */
/* -------------------------------------------------------------------------- */

describe("BSOD-321 (T081) — the drill-down panel", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists the contributing tasks through the shared task table", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-3",
      "task-4",
    ]);

    // FR-052 — the drill-down reuses the shared task table, and it holds
    // exactly the tasks behind the figure.
    expect(screen.getByTestId("task-table")).toBeInTheDocument();
    expect(listedTaskGids()).toEqual(["task-3", "task-4"]);
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 2 of 2 tasks",
    );

    // FR-053 — the rows carry the source fields the user verifies the
    // metric against.
    const rows = screen.getAllByTestId("task-row");
    expect(rows[0]).toHaveTextContent("Refresh the pricing model");
    expect(rows[0]).toHaveTextContent("Borealis");
    expect(rows[0]).toHaveTextContent("Alice Nkemelu");
    expect(rows[0]).toHaveTextContent("Not estimated");
    expect(rows[1]).toHaveTextContent("Archive the old campaign");
    expect(rows[1]).toHaveTextContent("30 min");
  });

  it("opens the shared task detail drawer for a listed task", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-3",
      "task-4",
    ]);

    // The drawer is not open until a task is chosen.
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();

    fireEvent.click(taskButton("task-4"));

    // FR-053 — the shared drawer describes the chosen task.
    expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-name")).toHaveTextContent(
      "Archive the old campaign",
    );
    expect(screen.getByTestId("task-detail-estimate")).toHaveTextContent(
      "30 min",
    );

    // FR-037 — every project membership of the task is shown, and the
    // Asana link carries no token (FR-054).
    const memberships = within(
      screen.getByTestId("task-detail-projects"),
    ).getAllByTestId("task-detail-project");
    expect(memberships.map((item) => item.textContent)).toEqual(["Borealis"]);
    expect(screen.getByTestId("task-detail-asana-link")).toHaveAttribute(
      "href",
      "https://app.asana.com/0/0/task-4",
    );

    // The drawer closes again on the user's word.
    fireEvent.click(screen.getByTestId("task-detail-close"));
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
  });

  it("shows every project membership of the task it opens", () => {
    renderPanel({ label: "Items added", value: 1, unit: "count" }, ["task-1"]);

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

  it("states the figure the list stands for", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-3",
      "task-4",
    ]);

    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Items added — 4 Mar 2026",
    );
    expect(screen.getByTestId("drill-down-panel-figure")).toHaveTextContent(
      "Items added",
    );
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("2 tasks");
  });

  it("keeps the rendered list in step with the displayed figure", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-3",
      "task-4",
    ]);

    // Drill parity — the list holds the tasks the figure counts, and the
    // panel says so.
    expect(listedTaskGids()).toHaveLength(2);
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These are the same 2 tasks the figure counts.",
    );
  });

  it("keeps the rendered list in step with an effort figure", () => {
    // The effort figure of the 4 March bucket is 30 minutes: task-3
    // carries no estimate and is left out of the sum (FR-058).
    renderPanel({ label: "Effort added", value: 30, unit: "minutes" }, [
      "task-3",
      "task-4",
    ]);

    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent(formatDuration(30));
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These estimates add up to the same 30 min the figure shows.",
    );

    // FR-058 — the task left out of the sum is disclosed, so the reader
    // can tell why the list holds two tasks and the figure holds 30
    // minutes.
    expect(screen.getByTestId("drill-down-panel-exclusion")).toHaveTextContent(
      "1 of the 2 listed tasks carries no estimate",
    );
  });

  it("discloses a figure the list does not match", () => {
    // A figure of five tasks with a list of two: the panel says so
    // rather than claiming a match it has not checked (Principle VII).
    renderPanel({ label: "Items added", value: 5, unit: "count" }, [
      "task-3",
      "task-4",
    ]);

    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "This list holds 2 tasks; the figure counts 5.",
    );
    expect(screen.getByTestId("drill-down-panel-parity")).not.toHaveTextContent(
      "These are the",
    );
  });

  it("shows an empty state when no task is behind the figure", () => {
    renderPanel({ label: "Items added", value: 0, unit: "count" }, []);

    expect(screen.getByTestId("drill-down-panel-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("task-table")).not.toBeInTheDocument();
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "The figure counts no tasks, and this list is empty.",
    );
  });

  it("lists the chart's own tasks behind the chart's own figure", () => {
    render(<DashboardHarness />);

    // FR-062 — the chart's drill action opens the panel with the chart's
    // exact contributing list.
    fireEvent.click(drillDownButton("2026-03-04", "created"));

    expect(listedTaskGids()).toEqual(["task-3", "task-4"]);
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent(chartFigureText("2026-03-04", "created"));
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These are the same 2 tasks the figure counts.",
    );
  });

  it("lists the chart's own tasks behind the chart's own effort figure", () => {
    render(<DashboardHarness />);

    // FR-061 — the effort view is a separate view of the same bucket,
    // and its drill-down lists the same tasks.
    fireEvent.click(screen.getByLabelText("Estimated effort"));
    fireEvent.click(drillDownButton("2026-03-04", "created"));

    expect(listedTaskGids()).toEqual(["task-3", "task-4"]);
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent(chartFigureText("2026-03-04", "created"));
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These estimates add up to the same 30 min the figure shows.",
    );
  });
});
