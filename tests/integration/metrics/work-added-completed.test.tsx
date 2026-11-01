/**
 * BSOD-319 (T076) — `WorkAddedCompletedChart` integration red→green.
 *
 * Spec / contract references
 * --------------------------
 * - FR-056 / FR-057 (spec.md): the tasks *created* inside the selected
 *   range and the tasks *completed* inside it are two independent
 *   populations, so a task can appear in both.
 * - FR-058 (spec.md): the effort sums exclude the tasks that carry no
 *   estimate, and the exclusion is disclosed rather than hidden.
 * - FR-059 (spec.md): the created and the completed measure are charted
 *   over the time buckets of the selected range.
 * - FR-060 (spec.md): the metric can be split by group — team member,
 *   team, project, portfolio, priority.
 * - FR-061 (spec.md): the item-count view and the estimated-effort view
 *   are two separate views of the same bucket, never one blended
 *   number.
 * - FR-062 (spec.md): every created/completed figure is drillable to
 *   its exact contributing task list.
 * - FR-088 (spec.md): the visualisation carries a programmatic label and
 *   a tabular alternative to the chart itself.
 *
 * What this test pins
 * -------------------
 *
 * 1. The chart draws a created and a completed figure for every bucket
 *    of the range (FR-059), and the accessible data table states the
 *    same figures in text (FR-088).
 *
 * 2. The count↔effort switch swaps which of the two figures is shown,
 *    and the two views are never blended into one number (FR-061).
 *
 * 3. A `groupBy` split shows each group's own figures, side by side
 *    with the group's own drill-down sets (FR-060).
 *
 * 4. The drill-down list behind a figure matches the figure that is
 *    displayed: the same tasks, the same item count, and the same
 *    effort once the listed tasks are re-aggregated (FR-062).
 *
 * 5. The tasks left out of the effort sums are disclosed (FR-058), and
 *    the chart carries a programmatic label (FR-088).
 *
 * The metric is NOT re-implemented here. The chart consumes the output
 * of `calculateWorkAddedVsCompleted` (T075 / BSOD-318), which owns the
 * bucketing, the deduplication and the drill-down sets. This suite
 * therefore also pins that the presentation layer consumes the domain
 * contract rather than counting anything of its own — a chart that
 * counted by hand could agree on one figure and drift on the next.
 *
 * Test-first discipline
 * ---------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/metrics/WorkAddedCompletedChart'", and the
 * same file goes green once the chart implements the surface below —
 * with no test-side change.
 *
 * The stand-ins
 * -------------
 * `ChartControls` (T080 / BSOD-320) and `DrillDownPanel` (T081 /
 * BSOD-321) are not merged yet, so this file stands in for both: a
 * small count↔effort switch that owns the view state, and a list that
 * renders the drill-down request the chart emits. Both are deliberately
 * thin, because the chart is a *controlled* surface: the dashboard owns
 * the view state and the drill-down panel, and hands the chart the
 * result of the metric. Wiring the real controls to the same props is
 * T080's and T081's work, not this row's.
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

import {
  calculateWorkAddedVsCompleted,
  type WorkAddedCompletedGroupBy,
  type WorkAddedCompletedTask,
} from "../../../src/domain/metrics/workAddedCompleted";
import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
  MetricContext,
} from "../../../src/domain/types";
import {
  WorkAddedCompletedChart,
  type WorkAddedCompletedChartGroup,
  type WorkAddedCompletedDrillDownRequest,
  type WorkAddedCompletedMeasure,
  type WorkAddedCompletedView,
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
 * A fixture task: the domain's task projection plus the name the
 * drill-down list shows.
 */
interface ChartTask extends WorkAddedCompletedTask {
  readonly name: string;
}

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

/**
 * Six synthetic tasks, chosen so that every figure below has a
 * hand-computed answer:
 *
 * | Task   | Created         | Completed       | Estimate | Assignee | Notes                          |
 * |--------|-----------------|-----------------|----------|----------|--------------------------------|
 * | task-1 | Mon 2 Mar 09:00 | Thu 5 Mar 10:00 | 120 min  | Alice    |                                |
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
const TASKS: readonly ChartTask[] = [
  {
    gid: "task-1",
    name: "Draft the launch brief",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo"],
    priorityOptionId: "priority-high",
    createdAt: at("2026-03-02T09:00:00.000Z"),
    dueAt: at("2026-03-06T00:00:00.000Z"),
    completedAt: at("2026-03-05T10:00:00.000Z"),
    estimatedMinutes: 120,
  },
  {
    gid: "task-2",
    name: "Book the venue",
    assigneeGid: "user-bob",
    projectGids: ["project-apollo"],
    priorityOptionId: null,
    createdAt: at("2026-03-03T09:00:00.000Z"),
    dueAt: at("2026-03-20T00:00:00.000Z"),
    completedAt: null,
    estimatedMinutes: 60,
  },
  {
    gid: "task-3",
    name: "Refresh the pricing model",
    assigneeGid: "user-alice",
    projectGids: ["project-borealis"],
    priorityOptionId: "priority-low",
    createdAt: at("2026-03-04T09:00:00.000Z"),
    dueAt: null,
    completedAt: at("2026-03-06T09:00:00.000Z"),
    estimatedMinutes: null,
  },
  {
    gid: "task-4",
    name: "Archive the old campaign",
    assigneeGid: "user-bob",
    projectGids: ["project-borealis"],
    priorityOptionId: null,
    createdAt: at("2026-03-04T14:00:00.000Z"),
    dueAt: null,
    completedAt: at("2026-03-04T16:00:00.000Z"),
    estimatedMinutes: 30,
  },
  {
    gid: "task-5",
    name: "Publish the migration checklist",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo"],
    priorityOptionId: "priority-high",
    createdAt: at("2026-02-20T09:00:00.000Z"),
    dueAt: null,
    completedAt: at("2026-03-07T09:00:00.000Z"),
    estimatedMinutes: 90,
  },
  {
    gid: "task-6",
    name: "Renew the domain registration",
    assigneeGid: "user-bob",
    projectGids: ["project-borealis"],
    priorityOptionId: null,
    createdAt: at("2026-03-09T09:00:00.000Z"),
    dueAt: null,
    completedAt: null,
    estimatedMinutes: 45,
  },
];

/**
 * The hand-computed item counts per bucket (FR-056 / FR-057). The
 * figures are written out literally rather than derived, so the test
 * fails when the chart and the domain disagree.
 */
const CREATED_COUNTS: Readonly<Record<string, number>> = {
  "2026-03-02": 1,
  "2026-03-03": 1,
  "2026-03-04": 2,
  "2026-03-05": 0,
  "2026-03-06": 0,
  "2026-03-07": 0,
  "2026-03-08": 0,
};

const COMPLETED_COUNTS: Readonly<Record<string, number>> = {
  "2026-03-02": 0,
  "2026-03-03": 0,
  "2026-03-04": 1,
  "2026-03-05": 1,
  "2026-03-06": 1,
  "2026-03-07": 1,
  "2026-03-08": 0,
};

/**
 * The hand-computed effort sums per bucket (FR-058): task-3 carries no
 * estimate, so it is counted but left out of the sums.
 */
const CREATED_EFFORT: Readonly<Record<string, number>> = {
  "2026-03-02": 120,
  "2026-03-03": 60,
  "2026-03-04": 30,
  "2026-03-05": 0,
  "2026-03-06": 0,
  "2026-03-07": 0,
  "2026-03-08": 0,
};

const COMPLETED_EFFORT: Readonly<Record<string, number>> = {
  "2026-03-02": 0,
  "2026-03-03": 0,
  "2026-03-04": 30,
  "2026-03-05": 120,
  "2026-03-06": 0,
  "2026-03-07": 90,
  "2026-03-08": 0,
};

/**
 * The same hand-computed figures for Alice's tasks alone (task-1,
 * task-3, task-5) — the `groupBy: "assignee"` split.
 */
const ALICE_CREATED_COUNTS: Readonly<Record<string, number>> = {
  "2026-03-02": 1,
  "2026-03-03": 0,
  "2026-03-04": 1,
  "2026-03-05": 0,
  "2026-03-06": 0,
  "2026-03-07": 0,
  "2026-03-08": 0,
};

const ALICE_COMPLETED_COUNTS: Readonly<Record<string, number>> = {
  "2026-03-02": 0,
  "2026-03-03": 0,
  "2026-03-04": 0,
  "2026-03-05": 1,
  "2026-03-06": 1,
  "2026-03-07": 1,
  "2026-03-08": 0,
};

/** The same hand-computed figures for Bo's tasks alone (task-2, task-4). */
const BO_CREATED_COUNTS: Readonly<Record<string, number>> = {
  "2026-03-02": 0,
  "2026-03-03": 1,
  "2026-03-04": 1,
  "2026-03-05": 0,
  "2026-03-06": 0,
  "2026-03-07": 0,
  "2026-03-08": 0,
};

const BO_COMPLETED_COUNTS: Readonly<Record<string, number>> = {
  "2026-03-02": 0,
  "2026-03-03": 0,
  "2026-03-04": 1,
  "2026-03-05": 0,
  "2026-03-06": 0,
  "2026-03-07": 0,
  "2026-03-08": 0,
};

/** The names behind the group keys, so the chart can label its groups. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  "user-alice": "Alice Nkemelu",
  "user-bob": "Bo Chen",
};

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The chart's props, as the dashboard will hand them over: the metric
 * results (one per group, or a single workspace-level result), the
 * view the count↔effort switch is on, and the drill-down handler.
 */
interface HarnessProps {
  readonly groupBy?: WorkAddedCompletedGroupBy;
  readonly initialView?: WorkAddedCompletedView;
}

/**
 * The metric results the chart draws — the domain's own output, never
 * a number this file computed.
 */
function chartGroups(
  groupBy: WorkAddedCompletedGroupBy | undefined,
): readonly WorkAddedCompletedChartGroup[] {
  if (groupBy === undefined) {
    return [
      {
        groupKey: undefined,
        result: calculateWorkAddedVsCompleted(TASKS, CRITERIA, CONTEXT),
      },
    ];
  }

  const grouped = calculateWorkAddedVsCompleted(
    TASKS,
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
 * The stand-in for T081's `DrillDownPanel`: it renders the tasks the
 * chart named, and nothing else. The parity assertions below re-derive
 * the displayed figure from the tasks this list shows.
 */
function DrillDownList({
  request,
}: {
  readonly request: WorkAddedCompletedDrillDownRequest;
}): ReactElement {
  return (
    <ul data-testid="drill-down-list" aria-label="Contributing tasks">
      {request.taskGids.map((gid) => {
        const task = TASKS.find((candidate) => candidate.gid === gid);
        return (
          <li key={gid} data-testid="drill-down-item" data-task-gid={gid}>
            {task?.name ?? gid}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The chart, the stand-in for T080's `ChartControls` and the stand-in
 * for T081's drill-down panel, composed the way the dashboard will
 * compose them.
 */
function ChartHarness({
  groupBy,
  initialView = "count",
}: HarnessProps): ReactElement {
  const [view, setView] = useState<WorkAddedCompletedView>(initialView);
  const [drillDown, setDrillDown] =
    useState<WorkAddedCompletedDrillDownRequest | null>(null);

  const groups = useMemo(() => chartGroups(groupBy), [groupBy]);

  return (
    <StrictMode>
      <fieldset data-testid="chart-controls">
        <legend>Show</legend>
        <label>
          <input
            type="radio"
            name="view"
            value="count"
            checked={view === "count"}
            onChange={() => {
              setView("count");
            }}
          />
          Items
        </label>
        <label>
          <input
            type="radio"
            name="view"
            value="effort"
            checked={view === "effort"}
            onChange={() => {
              setView("effort");
            }}
          />
          Estimated effort
        </label>
      </fieldset>

      <WorkAddedCompletedChart
        groups={groups}
        view={view}
        groupBy={groupBy}
        groupLabels={GROUP_LABELS}
        onDrillDown={setDrillDown}
      />

      {drillDown !== null ? <DrillDownList request={drillDown} /> : null}
    </StrictMode>
  );
}

/**
 * Renders the harness and returns the chart's container, so the
 * assertions can look inside the Recharts surface.
 */
function renderChart(props: HarnessProps = {}): HTMLElement {
  const { container } = render(<ChartHarness {...props} />);
  return container;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The data table of one group (the workspace-level table when no group
 * key is given).
 */
function tableFor(groupKey?: string): HTMLElement {
  const tables = screen.getAllByTestId("work-added-completed-table");
  if (groupKey === undefined) {
    const table = tables[0];
    expect(table).toBeDefined();
    return table;
  }
  const table = tables.find(
    (candidate) => candidate.getAttribute("data-group-key") === groupKey,
  );
  if (table === undefined) {
    throw new Error(`No data table for group "${groupKey}"`);
  }
  return table;
}

/**
 * The cell holding one figure — one measure of one bucket of one
 * group.
 */
function figureCell(
  groupKey: string | undefined,
  bucketStart: string,
  measure: WorkAddedCompletedMeasure,
): HTMLElement {
  const scope = groupKey === undefined ? document.body : tableFor(groupKey);
  const cell = scope.querySelector(
    `[data-testid="work-added-completed-row"][data-bucket-start="${bucketStart}"] ` +
      `[data-testid="work-added-completed-figure"][data-measure="${measure}"]`,
  );
  if (cell === null) {
    throw new Error(
      `No ${measure} figure for bucket ${bucketStart} in group ${groupKey ?? "—"}`,
    );
  }
  return cell as HTMLElement;
}

/** The number the chart states for one figure, as text. */
function figureText(
  groupKey: string | undefined,
  bucketStart: string,
  measure: WorkAddedCompletedMeasure,
): string {
  return (
    within(figureCell(groupKey, bucketStart, measure)).getByTestId(
      "work-added-completed-value",
    ).textContent ?? ""
  );
}

/** The drill-down action of one figure. */
function drillDownButton(
  groupKey: string | undefined,
  bucketStart: string,
  measure: WorkAddedCompletedMeasure,
): HTMLElement {
  return within(figureCell(groupKey, bucketStart, measure)).getByTestId(
    "work-added-completed-drill-down",
  );
}

/** The number of bars the chart draws for one series. */
function barCount(container: HTMLElement, seriesIndex: number): number {
  const series = container.querySelectorAll(".recharts-bar")[seriesIndex];
  expect(series).toBeDefined();
  return series.querySelectorAll(".recharts-bar-rectangle").length;
}

/** The tasks the drill-down list currently shows. */
function drillDownTaskGids(): readonly string[] {
  return screen
    .getAllByTestId("drill-down-item")
    .map((item) => item.getAttribute("data-task-gid") ?? "");
}

/**
 * Re-aggregates the listed tasks into the effort the figure stands for
 * — the drill-down parity rule of `contracts/metrics-engine.md`
 * (Shared Output Rule 5), applied to what the user can actually see.
 */
function effortOfListedTasks(): number {
  return drillDownTaskGids().reduce((total, gid) => {
    const task = TASKS.find((candidate) => candidate.gid === gid);
    return total + (task?.estimatedMinutes ?? 0);
  }, 0);
}

/* -------------------------------------------------------------------------- */
/* The chart surface                                                          */
/* -------------------------------------------------------------------------- */

describe("BSOD-319 (T076) — the work added / work completed chart", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws the created and completed figure of every bucket", () => {
    const container = renderChart();

    // FR-059 — one created bar and one completed bar per bucket, and
    // the table states the same figures in text (FR-088).
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(2);
    for (const [bucketStart, count] of Object.entries(CREATED_COUNTS)) {
      expect(figureText(undefined, bucketStart, "created")).toBe(String(count));
    }
    for (const [bucketStart, count] of Object.entries(COMPLETED_COUNTS)) {
      expect(figureText(undefined, bucketStart, "completed")).toBe(
        String(count),
      );
    }

    // The bars themselves carry the same figures: a bucket with no
    // figure of a measure draws no bar for it.
    expect(barCount(container, 0)).toBe(3);
    expect(barCount(container, 1)).toBe(4);

    // FR-088 — the chart is labelled, and the table beside it is the
    // textual alternative.
    const surface = container.querySelector(".recharts-surface");
    expect(surface).not.toBeNull();
    expect(surface?.getAttribute("role")).toBe("img");
    expect(surface?.getAttribute("aria-label")).toMatch(/added/i);
    expect(
      screen.getByTestId("work-added-completed-table"),
    ).toBeInTheDocument();
  });

  it("swaps between the count view and the effort view without blending them", () => {
    renderChart();

    // The count view states the item counts.
    expect(figureText(undefined, "2026-03-04", "created")).toBe("2");
    expect(figureText(undefined, "2026-03-04", "completed")).toBe("1");

    // FR-061 — the switch swaps which figure is shown. The two views
    // are never combined into one number.
    fireEvent.click(screen.getByLabelText("Estimated effort"));

    expect(figureText(undefined, "2026-03-04", "created")).toBe("30 min");
    expect(figureText(undefined, "2026-03-04", "completed")).toBe("30 min");
    expect(figureText(undefined, "2026-03-02", "created")).toBe("2 h");
    expect(figureText(undefined, "2026-03-07", "completed")).toBe("1 h 30 min");
    // task-3 is completed on 6 March but carries no estimate, so the
    // effort figure for that bucket is nothing.
    expect(figureText(undefined, "2026-03-06", "completed")).toBe("0 min");

    // Every bucket states its hand-computed effort sum.
    for (const [bucketStart, minutes] of Object.entries(CREATED_EFFORT)) {
      expect(figureText(undefined, bucketStart, "created")).toBe(
        formatDuration(minutes),
      );
    }
    for (const [bucketStart, minutes] of Object.entries(COMPLETED_EFFORT)) {
      expect(figureText(undefined, bucketStart, "completed")).toBe(
        formatDuration(minutes),
      );
    }
    // The item counts are gone from the table, not shown beside the
    // effort.
    expect(figureText(undefined, "2026-03-04", "created")).not.toBe("2");

    // FR-061 — the chart says which view it is showing.
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/estimated effort/i);

    // The bars follow the view: the completed bucket of 6 March has an
    // item count but no effort, so it draws no bar in the effort view.
    const container = document.body;
    expect(barCount(container, 0)).toBe(3);
    expect(barCount(container, 1)).toBe(3);

    // And back again.
    fireEvent.click(screen.getByLabelText("Items"));
    expect(figureText(undefined, "2026-03-04", "created")).toBe("2");
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/items/i);
  });

  it("splits the figures by group", () => {
    const container = renderChart({ groupBy: "assignee" });

    // FR-060 — two groups, each with its own created/completed pair.
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(4);
    expect(screen.getAllByTestId("work-added-completed-table")).toHaveLength(2);

    // Alice's own figures …
    for (const [bucketStart, count] of Object.entries(ALICE_CREATED_COUNTS)) {
      expect(figureText("user-alice", bucketStart, "created")).toBe(
        String(count),
      );
    }
    for (const [bucketStart, count] of Object.entries(ALICE_COMPLETED_COUNTS)) {
      expect(figureText("user-alice", bucketStart, "completed")).toBe(
        String(count),
      );
    }

    // … and Bo's, which are not Alice's.
    for (const [bucketStart, count] of Object.entries(BO_CREATED_COUNTS)) {
      expect(figureText("user-bob", bucketStart, "created")).toBe(
        String(count),
      );
    }
    for (const [bucketStart, count] of Object.entries(BO_COMPLETED_COUNTS)) {
      expect(figureText("user-bob", bucketStart, "completed")).toBe(
        String(count),
      );
    }

    // The groups are named, so the reader knows which series is which.
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/alice nkemelu/i);
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/bo chen/i);
  });

  it("drills a figure down to the tasks behind it", () => {
    renderChart();

    // FR-062 — the drill-down request names the bucket and the measure.
    fireEvent.click(drillDownButton(undefined, "2026-03-04", "created"));

    expect(drillDownTaskGids()).toEqual(["task-3", "task-4"]);

    // Drill-down parity: the list matches the figure that is displayed.
    expect(figureText(undefined, "2026-03-04", "created")).toBe(
      String(drillDownTaskGids().length),
    );
  });

  it("keeps the drill-down list in step with the effort figure", () => {
    renderChart({ initialView: "effort" });

    fireEvent.click(drillDownButton(undefined, "2026-03-04", "created"));

    // The listed tasks re-aggregate to the displayed effort: task-3
    // carries no estimate and is left out of the sum (FR-058), and
    // task-4's 30 minutes are all that is left.
    expect(drillDownTaskGids()).toEqual(["task-3", "task-4"]);
    expect(effortOfListedTasks()).toBe(30);
    expect(figureText(undefined, "2026-03-04", "created")).toBe(
      formatDuration(effortOfListedTasks()),
    );
  });

  it("drills a grouped figure down to that group's tasks only", () => {
    renderChart({ groupBy: "assignee" });

    fireEvent.click(drillDownButton("user-alice", "2026-03-04", "created"));

    // Alice's task-3 only — Bo's task-4 was added in the same bucket
    // but belongs to another group.
    expect(drillDownTaskGids()).toEqual(["task-3"]);
    expect(figureText("user-alice", "2026-03-04", "created")).toBe("1");
  });

  it("discloses the tasks left out of the effort sums", () => {
    renderChart();

    // FR-058 — task-3 was added and completed inside the range but
    // carries no estimate, so it is counted and left out of the sums.
    expect(
      screen.getByTestId("work-added-completed-exclusion"),
    ).toHaveTextContent(/no estimate/i);
  });
});
