/** Unit coverage for the backlog drill-down surface reported to SonarCloud. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../../../../src/data/db/schema";
import {
  BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE,
  type BacklogCurrentValue,
  type BacklogPointSeries,
} from "../../../../src/domain/metrics/backlog";
import type {
  ISODate,
  ISODateTime,
  MetricResult,
  TimezoneSetting,
} from "../../../../src/domain/types";
import {
  BacklogDrillDown,
  type BacklogDrillDownFigure,
} from "../../../../src/features/metrics/BacklogDrillDown";
import { assertDrillDownMatchesSummary } from "../../domain/metrics/support/assertDrillDownMatchesSummary";

const day = (value: string): ISODate => value as ISODate;

function task(gid: string, name: string, estimatedMinutes: number): Task {
  return {
    gid,
    name,
    assigneeGid: null,
    projectGids: [],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-03-01T00:00:00.000Z",
    modifiedAt: "2026-03-09T00:00:00.000Z",
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-03-09T00:00:00.000Z",
    outOfScopeReason: null,
  };
}

const TASKS: readonly Task[] = [
  task("task-1", "Draft the brief", 120),
  task("task-2", "Book the venue", 60),
];
const TODAY = day("2026-03-09");
const HISTORICAL = day("2026-03-04");
const EMPTY = day("2026-03-02");

const CURRENT: MetricResult<BacklogCurrentValue> = {
  population: { total: 2 },
  series: {
    incompleteCount: 2,
    incompleteEffortMinutes: 180,
    unestimatedIncompleteCount: 0,
  },
  contributingTaskGids: { [`incomplete:${TODAY}`]: ["task-1", "task-2"] },
  dedupApplied: true,
  asOf: "2026-03-09T00:30:00.000Z" as ISODateTime,
};

const SERIES: MetricResult<BacklogPointSeries> = {
  population: { total: 2 },
  series: {
    points: [
      {
        date: EMPTY,
        incompleteCount: 0,
        incompleteEffortMinutes: 0,
        unestimatedIncompleteCount: 0,
      },
      {
        date: HISTORICAL,
        incompleteCount: 1,
        incompleteEffortMinutes: 120,
        unestimatedIncompleteCount: 0,
      },
    ],
    trend: "up",
    effortTrend: "up",
  },
  contributingTaskGids: {
    [`incomplete:${EMPTY}`]: [],
    [`incomplete:${HISTORICAL}`]: ["task-1"],
  },
  dedupApplied: true,
  asOf: CURRENT.asOf,
};

function renderDrillDown(
  figure: BacklogDrillDownFigure,
  options: {
    current?: MetricResult<BacklogCurrentValue>;
    series?: MetricResult<BacklogPointSeries>;
    onClose?: () => void;
    timezone?: TimezoneSetting;
  } = {},
): void {
  render(
    <BacklogDrillDown
      figure={figure}
      current={options.current ?? CURRENT}
      series={options.series ?? SERIES}
      tasks={TASKS}
      users={[]}
      projects={[]}
      timezone={options.timezone ?? "utc"}
      onClose={options.onClose}
    />,
  );
}

function listedGids(): string[] {
  return screen
    .queryAllByTestId("task-row")
    .map((row) => row.getAttribute("data-task-gid") ?? "");
}

describe("BacklogDrillDown", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("shows the current count and its exact task set, with parity and no retroactive disclosure", () => {
    renderDrillDown({ kind: "current", view: "count" });

    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog today — 9 Mar 2026",
    );
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("2 tasks");
    expect(listedGids()).toEqual(["task-1", "task-2"]);
    expect(
      screen.queryByTestId("backlog-drill-down-disclosure"),
    ).not.toBeInTheDocument();

    assertDrillDownMatchesSummary(
      {
        label: "current backlog",
        displayedCount: CURRENT.series.incompleteCount,
        displayedEffortMinutes: CURRENT.series.incompleteEffortMinutes,
        contributingGids: listedGids(),
      },
      TASKS,
      (rows) => ({
        count: rows.length,
        effortMinutes: rows.reduce(
          (sum, row) => sum + (row.estimatedMinutes ?? 0),
          0,
        ),
      }),
    );
  });

  it("shows the current effort without a retroactive disclosure", () => {
    renderDrillDown({ kind: "current", view: "effort" });

    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("3 h");
    expect(listedGids()).toEqual(["task-1", "task-2"]);
    expect(
      screen.queryByTestId("backlog-drill-down-disclosure"),
    ).not.toBeInTheDocument();
  });

  it("resolves the metric clock in the requested timezone", () => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    const localDay = day("2026-03-08");
    renderDrillDown(
      { kind: "current", view: "count" },
      {
        current: {
          ...CURRENT,
          contributingTaskGids: {
            [`incomplete:${localDay}`]: ["task-1", "task-2"],
          },
        },
        timezone: "local",
      },
    );

    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog today — 8 Mar 2026",
    );
    expect(listedGids()).toEqual(["task-1", "task-2"]);
  });

  it("shows a historical count without the effort disclosure", () => {
    renderDrillDown({ kind: "historical", view: "count", date: HISTORICAL });

    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Backlog on 4 Mar 2026",
    );
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("1 task");
    expect(listedGids()).toEqual(["task-1"]);
    expect(
      screen.queryByTestId("backlog-drill-down-disclosure"),
    ).not.toBeInTheDocument();
  });

  it("shows historical effort and its retroactive-estimate disclosure", () => {
    renderDrillDown({ kind: "historical", view: "effort", date: HISTORICAL });

    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("2 h");
    expect(listedGids()).toEqual(["task-1"]);
    expect(
      screen.getByTestId("backlog-drill-down-disclosure"),
    ).toHaveTextContent(BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE);
  });

  it("passes the close action through in the resolved state", () => {
    const onClose = vi.fn();
    renderDrillDown({ kind: "current", view: "count" }, { onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("names an unavailable date and offers the close action", () => {
    const onClose = vi.fn();
    renderDrillDown(
      { kind: "historical", view: "count", date: day("2026-02-01") },
      { onClose },
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Backlog on 1 Feb 2026",
    );
    expect(
      screen.getByTestId("backlog-drill-down-unavailable"),
    ).toHaveTextContent("That date is not part of the reconstructed backlog");
    expect(screen.queryByTestId("drill-down-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a reconstructed zero-task point as an empty figure", () => {
    renderDrillDown({ kind: "historical", view: "count", date: EMPTY });

    expect(
      screen.queryByTestId("backlog-drill-down-unavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("0 tasks");
    expect(screen.getByTestId("drill-down-panel-empty")).toBeInTheDocument();
    expect(listedGids()).toEqual([]);
  });

  it("omits the close action when the caller did not supply one", () => {
    renderDrillDown({
      kind: "historical",
      view: "count",
      date: day("2026-02-01"),
    });

    expect(
      screen.queryByRole("button", { name: "Close details" }),
    ).not.toBeInTheDocument();
  });

  it("does not guess a date's tasks from a flat contributing list", () => {
    renderDrillDown(
      { kind: "current", view: "count" },
      { current: { ...CURRENT, contributingTaskGids: ["task-1"] } },
    );

    expect(listedGids()).toEqual([]);
    expect(screen.getByTestId("drill-down-panel-empty")).toBeInTheDocument();
  });
});
