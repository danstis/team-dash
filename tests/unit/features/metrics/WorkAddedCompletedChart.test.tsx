/**
 * Unit tests for `src/features/metrics/WorkAddedCompletedChart.tsx`.
 *
 * These are the component's own unit tests: they pin the surface in
 * isolation — the mirrored line diagram, the summary line, the legend,
 * the data table, the exclusion disclosure, the drill-down request and
 * the empty state — without a dashboard around it. The end-to-end
 * wiring (the chart driven by the real metric, the view switch and the
 * group split) is pinned by the integration suite in
 * `tests/integration/metrics/work-added-completed.test.tsx`.
 *
 * The unit suite exists beside the integration suite because the
 * SonarCloud new-code coverage gate reads the `test:unit` and
 * `test:contract` lcov reports only; integration coverage does not
 * count towards it (same reason as the `NoResultsState` unit suite).
 *
 * The metric results below are hand-written literals rather than the
 * output of the calculator: this suite is about the presentation, and
 * a literal makes the expected figure obvious.
 *
 * The trend's own arithmetic is pinned by the suite beside it,
 * `tests/unit/features/metrics/net-work-trend.test.ts`; this suite
 * pins what the chart does with it — the reading it states, the unit it
 * states it in, and the line it draws.
 *
 * Boundary: no network, no IndexedDB, no credentials — the surface is a
 * pure presentation component.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import type { WorkAddedCompletedSeries } from "../../../../src/domain/metrics/workAddedCompleted";
import type {
  ISODate,
  ISODateTime,
  MetricResult,
} from "../../../../src/domain/types";
import {
  WorkAddedCompletedChart,
  type WorkAddedCompletedChartGroup,
  type WorkAddedCompletedDrillDownRequest,
} from "../../../../src/features/metrics/WorkAddedCompletedChart";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** Brands a plain date string as the domain's `ISODate`. */
function day(value: string): ISODate {
  return value as ISODate;
}

/** Brands a plain instant string as the domain's `ISODateTime`. */
function at(value: string): ISODateTime {
  return value as ISODateTime;
}

/**
 * Two buckets: the first has one task added and none completed, the
 * second has one task completed and none added. The third task carries
 * no estimate, so the effort figures leave it out.
 */
const RESULT: MetricResult<WorkAddedCompletedSeries> = {
  population: {
    total: 3,
    excluded: [
      { reason: "no_estimate_created", count: 1 },
      { reason: "no_estimate_completed", count: 1 },
    ],
  },
  series: {
    buckets: [
      {
        bucketStart: day("2026-03-02"),
        bucketEnd: day("2026-03-02"),
        createdCount: 1,
        completedCount: 0,
        createdEffortMinutes: 60,
        completedEffortMinutes: 0,
      },
      {
        bucketStart: day("2026-03-03"),
        bucketEnd: day("2026-03-03"),
        createdCount: 1,
        completedCount: 1,
        createdEffortMinutes: 0,
        completedEffortMinutes: 120,
      },
    ],
    createdUnestimatedCount: 1,
    completedUnestimatedCount: 1,
  },
  contributingTaskGids: {
    "created:2026-03-02": ["task-1"],
    "completed:2026-03-03": ["task-2"],
    "created:2026-03-03": ["task-3"],
  },
  dedupApplied: true,
  asOf: at("2026-03-09T00:00:00.000Z"),
};

/** The same result with nothing added and nothing completed. */ const EMPTY_RESULT: MetricResult<WorkAddedCompletedSeries> =
  {
    population: { total: 0, excluded: [] },
    series: {
      buckets: [
        {
          bucketStart: day("2026-03-02"),
          bucketEnd: day("2026-03-02"),
          createdCount: 0,
          completedCount: 0,
          createdEffortMinutes: 0,
          completedEffortMinutes: 0,
        },
      ],
      createdUnestimatedCount: 0,
      completedUnestimatedCount: 0,
    },
    contributingTaskGids: {},
    dedupApplied: true,
    asOf: at("2026-03-09T00:00:00.000Z"),
  };

/**
 * A result whose net work change climbs over the period: three items
 * added and one completed, then four added and one completed. The net
 * change of the two buckets is +2 and +3, so the running net goes 2,
 * 5 and the fitted line rises by 3 items per bucket.
 */
const RISING_RESULT: MetricResult<WorkAddedCompletedSeries> = {
  ...RESULT,
  series: {
    buckets: [
      {
        bucketStart: day("2026-03-02"),
        bucketEnd: day("2026-03-02"),
        createdCount: 3,
        completedCount: 1,
        createdEffortMinutes: 180,
        completedEffortMinutes: 60,
      },
      {
        bucketStart: day("2026-03-03"),
        bucketEnd: day("2026-03-03"),
        createdCount: 4,
        completedCount: 1,
        createdEffortMinutes: 240,
        completedEffortMinutes: 60,
      },
    ],
    createdUnestimatedCount: 0,
    completedUnestimatedCount: 0,
  },
  contributingTaskGids: {},
};

/** The workspace-level group: no key. */
const GROUPS: readonly WorkAddedCompletedChartGroup[] = [
  { groupKey: undefined, result: RESULT },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Renders the chart and returns the drill-down spy and the container. */
function renderChart(
  props: Partial<ComponentProps<typeof WorkAddedCompletedChart>> = {},
): {
  readonly onDrillDown: ReturnType<typeof vi.fn>;
  readonly container: HTMLElement;
} {
  const onDrillDown = vi.fn();
  const { container } = render(
    <WorkAddedCompletedChart
      groups={GROUPS}
      view="count"
      onDrillDown={onDrillDown}
      {...props}
    />,
  );
  return { onDrillDown, container };
}

/** The value the chart states for one figure. */
function figureText(
  bucketStart: string,
  measure: "created" | "completed",
): string {
  const cell = document.querySelector(
    `[data-testid="work-added-completed-row"][data-bucket-start="${bucketStart}"] ` +
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

/**
 * The vertical position of every point of one of the two series, in
 * pixels. A circle carries its centre in `cy`, a square carries its
 * top edge in `y` and its height — so the square's centre is half its
 * height further down.
 */
function pointCentres(testId: string): readonly number[] {
  return screen.getAllByTestId(testId).map((point) => {
    if (point.getAttribute("cy") !== null) {
      return Number(point.getAttribute("cy"));
    }
    return (
      Number(point.getAttribute("y")) + Number(point.getAttribute("height")) / 2
    );
  });
}

/**
 * The vertical position of the zero baseline, in pixels. In SVG the
 * y axis grows downwards, so a point above the baseline has a smaller
 * y than the baseline.
 */
function zeroLineY(): number {
  const line = document.querySelector(
    ".td-work-added-completed__zero .recharts-reference-line-line",
  );
  if (line === null) {
    throw new Error("The chart draws no zero baseline");
  }
  return Number(line.getAttribute("y1"));
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                 */
/* -------------------------------------------------------------------------- */

describe("WorkAddedCompletedChart", () => {
  afterEach(() => {
    cleanup();
  });

  it("states the item count of every bucket", () => {
    renderChart();

    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/number of items/i);
    expect(figureText("2026-03-02", "created")).toBe("1");
    expect(figureText("2026-03-02", "completed")).toBe("0");
    expect(figureText("2026-03-03", "created")).toBe("1");
    expect(figureText("2026-03-03", "completed")).toBe("1");
  });

  it("states the estimated effort of every bucket", () => {
    renderChart({ view: "effort" });

    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/estimated effort/i);
    expect(figureText("2026-03-02", "created")).toBe("1 h");
    // The task added on 3 March carries no estimate, so the effort
    // figure for that bucket is nothing (FR-058).
    expect(figureText("2026-03-03", "created")).toBe("0 min");
    expect(figureText("2026-03-03", "completed")).toBe("2 h");
  });

  it("names both measures in the legend", () => {
    renderChart();

    const legend = screen.getByTestId("work-added-completed-legend");
    expect(within(legend).getByText(/items added/i)).toBeInTheDocument();
    expect(within(legend).getByText(/items completed/i)).toBeInTheDocument();
  });

  it("names the group a split belongs to", () => {
    renderChart({
      groups: [{ groupKey: "user-alice", result: RESULT }],
      groupBy: "assignee",
      groupLabels: { "user-alice": "Alice Nkemelu" },
    });

    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/split by team member: alice nkemelu/i);
    const named = within(
      screen.getByTestId("work-added-completed-legend"),
    ).getAllByText(/alice nkemelu/i);
    expect(named).toHaveLength(2);
    expect(named[0]).toHaveTextContent(/added — alice nkemelu/i);
  });

  it("shows a raw group key as a raw value", () => {
    renderChart({
      groups: [{ groupKey: "user-alice", result: RESULT }],
      groupBy: "assignee",
    });

    const legend = screen.getByTestId("work-added-completed-legend");
    const rawKeys = within(legend).getAllByText("user-alice");
    expect(rawKeys).toHaveLength(2);
    expect(rawKeys.every((key) => key.tagName === "CODE")).toBe(true);
  });

  it("draws one table per group", () => {
    renderChart({
      groups: [
        { groupKey: "user-alice", result: RESULT },
        { groupKey: "user-bob", result: RESULT },
      ],
      groupBy: "assignee",
    });

    const tables = screen.getAllByTestId("work-added-completed-table");
    expect(tables).toHaveLength(2);
    expect(tables[0]).toHaveAttribute("data-group-key", "user-alice");
    expect(tables[1]).toHaveAttribute("data-group-key", "user-bob");
  });

  it("names the explicit unassigned and no-priority groups", () => {
    renderChart({
      groups: [
        { groupKey: "unassigned", result: RESULT },
        { groupKey: "no_priority", result: RESULT },
      ],
      groupBy: "priority",
    });

    const legend = screen.getByTestId("work-added-completed-legend");
    expect(within(legend).getAllByText(/unassigned/i)).toHaveLength(2);
    expect(within(legend).getAllByText(/no priority/i)).toHaveLength(2);
  });

  it("names a bucket that spans several days", () => {
    const weekly: MetricResult<WorkAddedCompletedSeries> = {
      ...RESULT,
      series: {
        ...RESULT.series,
        buckets: [
          {
            bucketStart: day("2026-03-02"),
            bucketEnd: day("2026-03-08"),
            createdCount: 2,
            completedCount: 1,
            createdEffortMinutes: 90,
            completedEffortMinutes: 60,
          },
        ],
      },
    };

    renderChart({ groups: [{ groupKey: undefined, result: weekly }] });

    const row = screen.getByTestId("work-added-completed-row");
    expect(row).toHaveTextContent("2 Mar 2026 – 8 Mar 2026");
  });

  it("discloses the tasks left out of the effort sums", () => {
    renderChart();

    const note = screen.getByTestId("work-added-completed-exclusion");
    expect(note).toHaveTextContent(
      /1 added task and 1 completed task have no estimate/i,
    );
    expect(note).toHaveTextContent(/left out of the effort figures/i);
  });

  it("shows an empty state when nothing was added or completed", () => {
    renderChart({ groups: [{ groupKey: undefined, result: EMPTY_RESULT }] });

    expect(screen.getByTestId("work-added-completed-empty")).toHaveTextContent(
      /no tasks were added or completed/i,
    );
    expect(
      screen.queryByTestId("work-added-completed-legend"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-added-completed-table"),
    ).not.toBeInTheDocument();
  });

  it("discloses a single excluded task in the singular", () => {
    const single: MetricResult<WorkAddedCompletedSeries> = {
      ...RESULT,
      population: {
        total: 1,
        excluded: [{ reason: "no_estimate_created", count: 1 }],
      },
    };

    renderChart({ groups: [{ groupKey: undefined, result: single }] });

    expect(
      screen.getByTestId("work-added-completed-exclusion"),
    ).toHaveTextContent(
      /1 added task has no estimate: it is counted in the item figures/i,
    );
  });

  it("discloses an exclusion it does not know about", () => {
    const other: MetricResult<WorkAddedCompletedSeries> = {
      ...RESULT,
      population: {
        total: 1,
        excluded: [{ reason: "milestone_excluded", count: 1 }],
      },
    };

    renderChart({ groups: [{ groupKey: undefined, result: other }] });

    expect(
      screen.getByTestId("work-added-completed-exclusion"),
    ).toHaveTextContent(/1 other task is left out of the figures/i);
  });

  it("emits the drill-down request of the figure that was drilled into", () => {
    const { onDrillDown } = renderChart();

    const cell = document.querySelector(
      '[data-testid="work-added-completed-row"][data-bucket-start="2026-03-02"] ' +
        '[data-testid="work-added-completed-figure"][data-measure="created"]',
    );
    fireEvent.click(
      within(cell as HTMLElement).getByTestId(
        "work-added-completed-drill-down",
      ),
    );

    const request = onDrillDown.mock
      .calls[0][0] as WorkAddedCompletedDrillDownRequest;
    expect(request).toEqual({
      groupKey: undefined,
      measure: "created",
      view: "count",
      bucketStart: day("2026-03-02"),
      bucketEnd: day("2026-03-02"),
      taskGids: ["task-1"],
    });
  });

  it("emits the drill-down request of the point that was clicked", () => {
    const onDrillDown = vi.fn();
    render(
      <WorkAddedCompletedChart
        groups={GROUPS}
        view="count"
        onDrillDown={onDrillDown}
      />,
    );

    const point = screen.getAllByTestId(
      "work-added-completed-point-added",
    )[0] as Element;
    fireEvent.click(point);

    const request = onDrillDown.mock
      .calls[0][0] as WorkAddedCompletedDrillDownRequest;
    expect(request.measure).toBe("created");
    expect(request.bucketStart).toBe(day("2026-03-02"));
    expect(request.taskGids).toEqual(["task-1"]);
  });

  it("emits the drill-down request of the completed point that was clicked", () => {
    const onDrillDown = vi.fn();
    render(
      <WorkAddedCompletedChart
        groups={GROUPS}
        view="count"
        onDrillDown={onDrillDown}
      />,
    );

    const points = screen.getAllByTestId(
      "work-added-completed-point-completed",
    );
    fireEvent.click(points[1] as Element);

    const request = onDrillDown.mock
      .calls[0][0] as WorkAddedCompletedDrillDownRequest;
    expect(request.measure).toBe("completed");
    expect(request.bucketStart).toBe(day("2026-03-03"));
    expect(request.taskGids).toEqual(["task-2"]);
  });

  it("emits an empty task list for a figure with no contributors", () => {
    const { onDrillDown } = renderChart();

    // The completed figure of the first bucket has no contributing task
    // in the metric result, so the request carries an empty list.
    const cell = document.querySelector(
      '[data-testid="work-added-completed-row"][data-bucket-start="2026-03-02"] ' +
        '[data-testid="work-added-completed-figure"][data-measure="completed"]',
    );
    fireEvent.click(
      within(cell as HTMLElement).getByTestId(
        "work-added-completed-drill-down",
      ),
    );

    const request = onDrillDown.mock
      .calls[0][0] as WorkAddedCompletedDrillDownRequest;
    expect(request.taskGids).toEqual([]);
  });

  it("draws no drill-down action when nothing can receive the request", () => {
    renderChart({ onDrillDown: undefined });

    expect(
      screen.queryByTestId("work-added-completed-drill-down"),
    ).not.toBeInTheDocument();

    // Clicking a point without a handler is a no-op, not a crash.
    const point = screen.getAllByTestId(
      "work-added-completed-point-added",
    )[0] as Element;
    expect(() => {
      fireEvent.click(point);
    }).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* The mirrored line diagram                                                    */
/* -------------------------------------------------------------------------- */

describe("the mirrored line diagram", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws the added measure, the completed measure and the trend line", () => {
    const { container } = renderChart();

    // Three lines: the added measure, the completed measure and the
    // trend of the net work change. The grouped bars are gone.
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(3);
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(0);
  });

  it("draws an explicit zero baseline", () => {
    const { container } = renderChart();

    expect(container.querySelectorAll(".recharts-reference-line")).toHaveLength(
      1,
    );
  });

  it("draws the added measure above the zero line and the completed measure below it", () => {
    renderChart();

    const zero = zeroLineY();
    const added = pointCentres("work-added-completed-point-added");
    const completed = pointCentres("work-added-completed-point-completed");

    expect(added).toHaveLength(2);
    expect(completed).toHaveLength(2);

    // In SVG the y axis grows downwards, so "above the line" is a
    // smaller y than the baseline.
    expect(added.every((y) => y <= zero)).toBe(true);
    expect(added.some((y) => y < zero)).toBe(true);
    expect(completed.every((y) => y >= zero)).toBe(true);
    expect(completed.some((y) => y > zero)).toBe(true);
  });

  it("states the reading of the trend in the summary", () => {
    renderChart();

    // The net change of the two buckets is +1 and 0, so the running
    // net holds at 1: the trend is flat.
    const summary = screen.getByTestId("work-added-completed-summary");
    expect(summary).toHaveTextContent(/net work change over the period/i);
    expect(summary).toHaveTextContent(/the net is flat/i);
    expect(summary).toHaveTextContent(/net trend: 0 items per day/i);
    expect(summary).toHaveTextContent(
      /net work change at the end of the period: \+1 item\./i,
    );
  });

  it("states the reading of a rising trend in the summary", () => {
    renderChart({ groups: [{ groupKey: undefined, result: RISING_RESULT }] });

    const summary = screen.getByTestId("work-added-completed-summary");
    expect(summary).toHaveTextContent(/the net is rising/i);
    expect(summary).toHaveTextContent(/net trend: \+3 items per day/i);
    expect(summary).toHaveTextContent(
      /net work change at the end of the period: \+5 items\./i,
    );
  });

  it("states the direction and the rate of the trend in the legend", () => {
    renderChart({ groups: [{ groupKey: undefined, result: RISING_RESULT }] });

    const legend = screen.getByTestId("work-added-completed-legend");
    expect(legend).toHaveTextContent(
      /net work change trend — rising, \+3 items per day/i,
    );
  });

  it("states the trend in the unit of the active view", () => {
    renderChart({ view: "effort" });

    // The effort net change of the two buckets is +60 and −120
    // minutes, so the running net goes 60, −60 and the fitted line
    // falls by 120 minutes per bucket.
    const summary = screen.getByTestId("work-added-completed-summary");
    expect(summary).toHaveTextContent(/the net is falling/i);
    expect(summary).toHaveTextContent(/net trend: −2 h per day/i);
    expect(summary).toHaveTextContent(
      /net work change at the end of the period: −1 h\./i,
    );
  });

  it("names the halves and their colours in the legend", () => {
    renderChart();

    const legend = screen.getByTestId("work-added-completed-legend");
    expect(legend).toHaveTextContent(
      /items added — above the zero line \(red\)/i,
    );
    expect(legend).toHaveTextContent(
      /items completed — below the zero line \(green\)/i,
    );
  });

  it("names the unit of the active view on the value axis", () => {
    const { container } = renderChart();

    const label = container.querySelector(
      ".td-work-added-completed__axis-label",
    );
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent(/items — added above, completed below/i);
  });

  it("names the unit of the effort view on the value axis", () => {
    const { container } = renderChart({ view: "effort" });

    const label = container.querySelector(
      ".td-work-added-completed__axis-label",
    );
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent(
      /estimated effort — added above, completed below/i,
    );
  });

  it("keeps the grouped view on the grouped bars", () => {
    const { container } = renderChart({
      groups: [{ groupKey: "user-alice", result: RESULT }],
      groupBy: "assignee",
    });

    // The grouped view keeps the form it had: a bar per measure per
    // group, and no trend line to read.
    expect(container.querySelectorAll(".recharts-bar")).toHaveLength(2);
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(0);
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).not.toHaveTextContent(/net work change over the period/i);
  });
});
