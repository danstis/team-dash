/**
 * Unit tests for `src/features/metrics/DrillDownPanel.tsx`.
 *
 * These are the panel's own unit tests: they pin the surface in
 * isolation — the figure it states, the comparison it publishes, the
 * disclosures it makes and the two shared surfaces it composes —
 * without a chart around it. The end-to-end wiring (the US4 chart's
 * drill request opening the panel, and the panel's list matching the
 * chart's own figure) is pinned by the integration suite in
 * `tests/integration/metrics/drill-down-panel.test.tsx`.
 *
 * The unit suite exists beside the integration suite because the
 * SonarCloud new-code coverage gate reads the `test:unit` and
 * `test:contract` lcov reports only; integration coverage does not
 * count towards it (same reason as the `WorkAddedCompletedChart` and
 * `ChartControls` unit suites).
 *
 * Boundary: no network, no IndexedDB, no credentials — the panel is a
 * pure presentation layer over the figure and the task rows it is
 * given.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../../../../src/data/db/schema";
import {
  DrillDownPanel,
  type DrillDownFigure,
} from "../../../../src/features/metrics/DrillDownPanel";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Builds a cached task row — every field of the cache record is
 * supplied, so the fixture is a real `Task`.
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

/** The task set the panel is handed. */
const TASKS: readonly Task[] = [
  makeTask({
    gid: "task-1",
    name: "Draft the launch brief",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo", "project-borealis"],
    estimatedMinutes: 120,
  }),
  makeTask({
    gid: "task-2",
    name: "Book the venue",
    assigneeGid: "user-bo",
    projectGids: ["project-borealis"],
    priorityOptionId: null,
    estimatedMinutes: 60,
  }),
  makeTask({
    gid: "task-3",
    name: "Refresh the pricing model",
    assigneeGid: "user-alice",
    projectGids: ["project-borealis"],
    priorityOptionId: "priority-low",
    estimatedMinutes: null,
  }),
];

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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Renders the panel with the given figure and drill-down set. */
function renderPanel(
  figure: DrillDownFigure,
  taskGids: readonly string[],
  priorityLabels: Readonly<Record<string, string>> = PRIORITY_LABELS,
  onClose?: () => void,
): void {
  render(
    <DrillDownPanel
      title="Items added — 4 Mar 2026"
      figure={figure}
      taskGids={taskGids}
      tasks={TASKS}
      users={USERS}
      projects={PROJECTS}
      priorityLabels={priorityLabels}
      timezone="utc"
      onClose={onClose}
    />,
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
/* The figure                                                                 */
/* -------------------------------------------------------------------------- */

describe("DrillDownPanel — the figure it states", () => {
  afterEach(() => {
    cleanup();
  });

  it("names the figure and its value", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-1",
      "task-2",
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

  it("offers a close action when the caller supplies one", () => {
    const onClose = vi.fn();
    renderPanel(
      { label: "Items added", value: 1, unit: "count" },
      ["task-1"],
      PRIORITY_LABELS,
      onClose,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("speaks of a single task in the singular", () => {
    renderPanel({ label: "Items added", value: 1, unit: "count" }, ["task-1"]);

    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("1 task");
  });

  it("states an effort figure as a duration", () => {
    renderPanel({ label: "Effort added", value: 90, unit: "minutes" }, [
      "task-1",
      "task-2",
    ]);

    expect(
      screen.getByTestId("drill-down-panel-figure-value"),
    ).toHaveTextContent("1 h 30 min");
  });
});

/* -------------------------------------------------------------------------- */
/* The comparison                                                              */
/* -------------------------------------------------------------------------- */

describe("DrillDownPanel — the comparison it publishes", () => {
  afterEach(() => {
    cleanup();
  });

  it("states that the list matches the count figure", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-1",
      "task-2",
    ]);

    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These are the same 2 tasks the figure counts.",
    );
  });

  it("states that the list matches the effort figure", () => {
    renderPanel({ label: "Effort added", value: 180, unit: "minutes" }, [
      "task-1",
      "task-2",
    ]);

    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These estimates add up to the same 3 h the figure shows.",
    );
  });

  it("states that the list does not match the count figure", () => {
    renderPanel({ label: "Items added", value: 5, unit: "count" }, [
      "task-1",
      "task-2",
    ]);

    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "This list holds 2 tasks; the figure counts 5.",
    );
  });

  it("states that the list does not match the effort figure", () => {
    renderPanel({ label: "Effort added", value: 60, unit: "minutes" }, [
      "task-1",
      "task-2",
    ]);

    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "These estimates add up to 3 h; the figure shows 1 h.",
    );
  });

  it("discloses the tasks left out of an effort figure", () => {
    renderPanel({ label: "Effort added", value: 60, unit: "minutes" }, [
      "task-1",
      "task-3",
    ]);

    // task-3 carries no estimate: it is in the list, and out of the sum.
    expect(screen.getByTestId("drill-down-panel-exclusion")).toHaveTextContent(
      "1 of the 2 listed tasks carries no estimate and is left out of the effort figure.",
    );
  });

  it("says nothing about estimates in the count view", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-1",
      "task-3",
    ]);

    expect(
      screen.queryByTestId("drill-down-panel-exclusion"),
    ).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* The list                                                                   */
/* -------------------------------------------------------------------------- */

describe("DrillDownPanel — the list behind the figure", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists the contributing tasks in the metric's own order", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-2",
      "task-1",
    ]);

    expect(listedTaskGids()).toEqual(["task-2", "task-1"]);
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 2 of 2 tasks",
    );
  });

  it("lists a task once, however many times the set names it", () => {
    renderPanel({ label: "Items added", value: 1, unit: "count" }, [
      "task-1",
      "task-1",
    ]);

    expect(listedTaskGids()).toEqual(["task-1"]);
  });

  it("shows the source fields the user verifies the task against", () => {
    renderPanel({ label: "Items added", value: 1, unit: "count" }, ["task-1"]);

    const row = screen.getByTestId("task-row");
    expect(row).toHaveTextContent("Draft the launch brief");
    expect(row).toHaveTextContent("Alice Nkemelu");
    // Both memberships of the task, not the first one.
    expect(row).toHaveTextContent("Apollo, Borealis");
    expect(row).toHaveTextContent("High");
    expect(row).toHaveTextContent("2 h");
  });

  it("shows the raw priority id when the caller names no priority", () => {
    renderPanel(
      { label: "Items added", value: 1, unit: "count" },
      ["task-1"],
      {},
    );

    const row = screen.getByTestId("task-row");
    expect(row).toHaveTextContent("priority-high");
  });

  it("shows an empty state when no task is behind the figure", () => {
    renderPanel({ label: "Items added", value: 0, unit: "count" }, []);

    expect(screen.getByTestId("drill-down-panel-empty")).toHaveTextContent(
      "No tasks are behind this figure.",
    );
    expect(screen.queryByTestId("task-table")).not.toBeInTheDocument();
    expect(screen.getByTestId("drill-down-panel-parity")).toHaveTextContent(
      "The figure counts no tasks, and this list is empty.",
    );
  });

  it("discloses a drill-down task the local cache does not hold", () => {
    renderPanel({ label: "Items added", value: 2, unit: "count" }, [
      "task-1",
      "task-9",
    ]);

    expect(screen.getByTestId("drill-down-panel-missing")).toHaveTextContent(
      "1 task behind this figure could not be found in the local cache.",
    );
    expect(listedTaskGids()).toEqual(["task-1"]);
  });
});

/* -------------------------------------------------------------------------- */
/* The detail                                                                 */
/* -------------------------------------------------------------------------- */

describe("DrillDownPanel — the task detail", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the shared drawer for the task the user chooses", () => {
    renderPanel({ label: "Items added", value: 1, unit: "count" }, ["task-1"]);

    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();

    fireEvent.click(taskButton("task-1"));

    expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-name")).toHaveTextContent(
      "Draft the launch brief",
    );
  });

  it("closes the drawer on the user's word", () => {
    renderPanel({ label: "Items added", value: 1, unit: "count" }, ["task-1"]);

    fireEvent.click(taskButton("task-1"));
    fireEvent.click(screen.getByTestId("task-detail-close"));

    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
  });

  it("shows the task's dependencies by name", () => {
    render(
      <DrillDownPanel
        title="Items added — 4 Mar 2026"
        figure={{ label: "Items added", value: 1, unit: "count" }}
        taskGids={["task-1"]}
        tasks={[
          ...TASKS,
          makeTask({
            gid: "task-1",
            name: "Draft the launch brief",
            dependsOnTaskGids: ["task-2", "task-9"],
          }),
        ]}
        users={USERS}
        projects={PROJECTS}
        timezone="utc"
      />,
    );

    // The dependency the cache knows is named; the one it does not know
    // is shown by its raw id rather than dropped.
    fireEvent.click(taskButton("task-1"));
    const dependencies = within(
      screen.getByTestId("task-detail-dependencies"),
    ).getAllByTestId("task-detail-dependency");
    expect(dependencies.map((item) => item.textContent)).toEqual([
      "Book the venue",
      "task-9",
    ]);
  });
});
