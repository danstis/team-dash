/**
 * BSOD-320 (T080) — `ChartControls` integration red→green.
 *
 * Spec / contract references
 * --------------------------
 * - FR-050 (spec.md): the system MUST support grouping and comparison
 *   across at least team member, team, project, portfolio and priority.
 * - FR-060 (spec.md): the work-added / work-completed metric can be
 *   split by team member, team, project, portfolio and priority.
 * - FR-061 (spec.md): the item-count view and the estimated-effort view
 *   are two separate views of the same figure, never one blended
 *   number — so the switch between them is a first-class control.
 * - FR-088 (spec.md): the controls are operable from the keyboard,
 *   carry programmatic labels and do not distinguish their state by
 *   colour alone.
 *
 * What this test pins
 * -------------------
 *
 * 1. The count↔effort toggle renders both views, marks the one in
 *    force, and reports the view the user picked (FR-061).
 *
 * 2. The `groupBy` selector renders the grouping dimensions, marks the
 *    one in force, and reports the dimension the user picked (FR-050,
 *    FR-060) — using the domain's own vocabulary (`reportingTeam`,
 *    not `team`).
 *
 * 3. Both controls are CONTROLLED: they render the state they are
 *    given and report every change; they never hold a selection of
 *    their own, so the dashboard stays the single source of truth.
 *
 * 4. The controls drive the chart T076 merged: the same toggle and the
 *    same selector change what `WorkAddedCompletedChart` shows, with
 *    no adapter in between. This is the seam the two rows share.
 *
 * 5. The controls are generic enough for the other metric views: the
 *    backlog view (US5) groups by other dimensions, and the delivery
 *    view (US8) shares the same screen as the US4 chart — two toggles
 *    on one page must not share a radio group.
 *
 * 6. FR-088: every control carries a programmatic label, is built from
 *    native keyboard-operable elements, and keeps its state in text
 *    rather than in colour.
 *
 * Test-first discipline
 * ---------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/metrics/ChartControls'", and the same file
 * goes green once the controls implement the surface below — with no
 * test-side change.
 *
 * Determinism
 * ------------
 * The reporting range, the injected clock and the timezone basis are
 * fixed, so every figure is identical on every host. The fixtures
 * below are synthetic: no browser, no live Asana workspace, no real
 * personal access token.
 */
import { type ReactElement, StrictMode, useMemo, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  CountEffortToggle,
  GroupBySelector,
  type ChartGroupBy,
  type ChartGroupByOption,
  type ChartView,
} from "../../../src/features/metrics/ChartControls";
import {
  WorkAddedCompletedChart,
  type WorkAddedCompletedChartGroup,
  type WorkAddedCompletedView,
} from "../../../src/features/metrics/WorkAddedCompletedChart";

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
 * Three synthetic tasks, chosen so that the chart has something to show
 * in both views and two assignee groups:
 *
 * | Task   | Created         | Completed       | Estimate | Assignee |
 * |--------|-----------------|-----------------|----------|----------|
 * | task-1 | Mon 2 Mar 09:00 | Thu 5 Mar 10:00 | 120 min  | Alice    |
 * | task-2 | Tue 3 Mar 09:00 | —               | 60 min   | Bo       |
 * | task-3 | Wed 4 Mar 09:00 | Fri 6 Mar 09:00 | none     | Alice    |
 */
const TASKS: readonly WorkAddedCompletedTask[] = [
  {
    gid: "task-1",
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
    assigneeGid: "user-alice",
    projectGids: ["project-borealis"],
    priorityOptionId: "priority-low",
    createdAt: at("2026-03-04T09:00:00.000Z"),
    dueAt: null,
    completedAt: at("2026-03-06T09:00:00.000Z"),
    estimatedMinutes: null,
  },
];

/** The names behind the group keys, so the chart can label its groups. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  "user-alice": "Alice Nkemelu",
  "user-bob": "Bo Chen",
};

/**
 * The backlog view's own grouping dimensions (FR-065): a workspace
 * view, the reporting team, the Asana team, and the project /
 * portfolio / assignee splits. They are not the US4 set, and the
 * selector has to serve them without a rewrite.
 */
type BacklogGroupBy =
  | "workspace"
  | "reportingTeam"
  | "asanaTeam"
  | "project"
  | "portfolio"
  | "assignee";

const BACKLOG_OPTIONS: readonly ChartGroupByOption<BacklogGroupBy>[] = [
  { value: "workspace", label: "Workspace" },
  { value: "reportingTeam", label: "Reporting team" },
  { value: "asanaTeam", label: "Asana team" },
  { value: "project", label: "Project" },
  { value: "portfolio", label: "Portfolio" },
  { value: "assignee", label: "Team member" },
];

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The controls over a state the harness owns: the view, the grouping
 * dimension, and a readout of both. The readout is what proves the
 * controls *dispatched* a change rather than only redrawing.
 */
function ControlsHarness({
  initialView = "count",
  initialGroupBy,
}: {
  readonly initialView?: ChartView;
  readonly initialGroupBy?: ChartGroupBy | undefined;
}): ReactElement {
  const [view, setView] = useState<ChartView>(initialView);
  const [groupBy, setGroupBy] = useState<ChartGroupBy | undefined>(
    initialGroupBy,
  );

  return (
    <StrictMode>
      <CountEffortToggle value={view} onChange={setView} />
      <GroupBySelector value={groupBy} onChange={setGroupBy} />
      <p data-testid="view-state">{view}</p>
      <p data-testid="group-by-state">{groupBy ?? "none"}</p>
    </StrictMode>
  );
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
 * The dashboard's composition: the shared controls over the state the
 * page owns, and the chart T076 merged reading that same state.
 */
function ChartHarness(): ReactElement {
  const [view, setView] = useState<WorkAddedCompletedView>("count");
  const [groupBy, setGroupBy] = useState<WorkAddedCompletedGroupBy | undefined>(
    undefined,
  );

  const groups = useMemo(() => chartGroups(groupBy), [groupBy]);

  return (
    <StrictMode>
      <CountEffortToggle value={view} onChange={setView} />
      <GroupBySelector value={groupBy} onChange={setGroupBy} />
      <WorkAddedCompletedChart
        groups={groups}
        view={view}
        groupBy={groupBy}
        groupLabels={GROUP_LABELS}
      />
    </StrictMode>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The count↔effort radio of the given view. */
function radioFor(view: ChartView): HTMLElement {
  return screen.getByRole("radio", {
    name: view === "count" ? "Items" : "Estimated effort",
  });
}

/** The grouping selector. */
function groupBySelector(): HTMLElement {
  return screen.getByRole("combobox", { name: "Group by" });
}

/* -------------------------------------------------------------------------- */
/* The controls                                                               */
/* -------------------------------------------------------------------------- */

describe("BSOD-320 (T080) — the shared chart controls", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the count and effort views and marks the one in force", () => {
    render(<ControlsHarness initialView="count" />);

    // FR-061 — the two views of a figure are two choices, and the
    // control says which one is on show.
    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(radioFor("count")).toBeChecked();
    expect(radioFor("effort")).not.toBeChecked();
    expect(screen.getByTestId("view-state")).toHaveTextContent("count");
  });

  it("dispatches the view the user picked", () => {
    render(<ControlsHarness initialView="count" />);

    // FR-061 — picking the effort view reports it to the owner of the
    // state, which then re-renders the control with the new view.
    fireEvent.click(radioFor("effort"));

    expect(screen.getByTestId("view-state")).toHaveTextContent("effort");
    expect(radioFor("effort")).toBeChecked();
    expect(radioFor("count")).not.toBeChecked();

    fireEvent.click(radioFor("count"));

    expect(screen.getByTestId("view-state")).toHaveTextContent("count");
    expect(radioFor("count")).toBeChecked();
  });

  it("is controlled: the caller owns the view", () => {
    const onChange = vi.fn();
    render(<CountEffortToggle value="count" onChange={onChange} />);

    fireEvent.click(radioFor("effort"));

    // The change is reported …
    expect(onChange).toHaveBeenCalledWith("effort");
    // … and the control still shows the state it was given: it holds
    // no selection of its own, so the page stays the single source of
    // truth (DESIGN.md › The State Is One Source Rule).
    expect(radioFor("count")).toBeChecked();
    expect(radioFor("effort")).not.toBeChecked();
  });

  it("renders the grouping dimensions and marks the one in force", () => {
    render(<ControlsHarness initialGroupBy="reportingTeam" />);

    // FR-050 / FR-060 — the dimensions the metric can be split by, in
    // the domain's own vocabulary.
    const select = groupBySelector();
    const options = within(select).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      "",
      "assignee",
      "reportingTeam",
      "project",
      "portfolio",
      "priority",
    ]);
    expect(options.map((option) => option.textContent)).toEqual([
      "No grouping",
      "Team member",
      "Team",
      "Project",
      "Portfolio",
      "Priority",
    ]);
    expect(select).toHaveValue("reportingTeam");
    expect(screen.getByTestId("group-by-state")).toHaveTextContent(
      "reportingTeam",
    );
  });

  it("dispatches the dimension the user picked", () => {
    render(<ControlsHarness />);

    // The dimension is reported with the domain's vocabulary, so the
    // metric can be asked for that split without a translation layer.
    fireEvent.change(groupBySelector(), {
      target: { value: "reportingTeam" },
    });
    expect(screen.getByTestId("group-by-state")).toHaveTextContent(
      "reportingTeam",
    );

    fireEvent.change(groupBySelector(), { target: { value: "assignee" } });
    expect(screen.getByTestId("group-by-state")).toHaveTextContent("assignee");

    fireEvent.change(groupBySelector(), { target: { value: "priority" } });
    expect(screen.getByTestId("group-by-state")).toHaveTextContent("priority");

    // The explicit "no grouping" choice is reported as such — the
    // chart reads an absent dimension as the workspace-level view.
    fireEvent.change(groupBySelector(), { target: { value: "" } });
    expect(screen.getByTestId("group-by-state")).toHaveTextContent("none");
  });

  it("drives the work added / work completed chart", () => {
    render(<ChartHarness />);

    // The chart T076 merged starts on the count view, ungrouped.
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/number of items/i);
    expect(screen.getAllByTestId("work-added-completed-table")).toHaveLength(1);

    // FR-061 — the shared toggle swaps the chart's view.
    fireEvent.click(radioFor("effort"));
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/estimated effort/i);

    // FR-060 — the shared selector splits the chart by the dimension
    // it reports, with no adapter in between.
    fireEvent.change(groupBySelector(), { target: { value: "assignee" } });
    expect(screen.getAllByTestId("work-added-completed-table")).toHaveLength(2);
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/split by team member/i);
  });

  it("serves the other metric views, which group differently", () => {
    function BacklogHarness(): ReactElement {
      const [groupBy, setGroupBy] = useState<BacklogGroupBy | undefined>(
        "workspace",
      );
      return (
        <StrictMode>
          <GroupBySelector<BacklogGroupBy>
            value={groupBy}
            onChange={setGroupBy}
            options={BACKLOG_OPTIONS}
          />
          <p data-testid="backlog-group-by">{groupBy ?? "none"}</p>
        </StrictMode>
      );
    }

    render(<BacklogHarness />);

    // The backlog view groups by other dimensions (FR-065): the
    // selector offers them and reports them, without the control
    // being rewritten for that view.
    const select = screen.getByRole("combobox", { name: "Group by" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Workspace",
      "Reporting team",
      "Asana team",
      "Project",
      "Portfolio",
      "Team member",
    ]);
    expect(select).toHaveValue("workspace");

    fireEvent.change(select, { target: { value: "asanaTeam" } });
    expect(screen.getByTestId("backlog-group-by")).toHaveTextContent(
      "asanaTeam",
    );
  });

  it("keeps two toggles on one page independent", () => {
    // The US8 delivery view shares the screen with the US4 chart, so
    // two toggles can be on the page at once. They are separate radio
    // groups: choosing in one must not clear the other.
    render(
      <StrictMode>
        <CountEffortToggle value="count" onChange={vi.fn()} />
        <CountEffortToggle value="effort" onChange={vi.fn()} />
      </StrictMode>,
    );

    const radios = screen.getAllByRole("radio");
    const names = new Set(
      radios.map((radio) => radio.getAttribute("name") ?? ""),
    );
    expect(names.size).toBe(2);

    // Each toggle shows its own state: the first is on the count view,
    // the second on the effort view.
    const toggles = screen.getAllByRole("group", { name: "Show" });
    expect(toggles).toHaveLength(2);
    expect(
      within(toggles[0]).getByRole("radio", { name: "Items" }),
    ).toBeChecked();
    expect(
      within(toggles[1]).getByRole("radio", { name: "Estimated effort" }),
    ).toBeChecked();
  });

  it("names every control and keeps it on the keyboard path (FR-088)", () => {
    render(<ControlsHarness />);

    // The toggle is a labelled group of native radios — the browser's
    // own arrow-key and space handling is the keyboard path.
    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(radioFor("count")).toHaveAccessibleName("Items");
    expect(radioFor("effort")).toHaveAccessibleName("Estimated effort");

    // The selector is a native select with a programmatic name.
    const select = groupBySelector();
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveAccessibleName("Group by");

    // Nothing is taken out of the keyboard path.
    expect(document.querySelectorAll('[tabindex="-1"]')).toHaveLength(0);

    // The state is stated in text, not in colour: the choices are
    // named, and the selected one is the checked radio — no colour is
    // the only carrier of the meaning (FR-088).
    expect(radioFor("count")).toBeChecked();
    expect(radioFor("effort")).not.toBeChecked();
    expect(select).toHaveValue("");
  });
});
