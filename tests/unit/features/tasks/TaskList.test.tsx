import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ISODateTime } from "../../../../src/domain/types";
import { TaskList } from "../../../../src/features/tasks/TaskList";
import type { TaskTableTask } from "../../../../src/features/tasks/TaskTable";

const TASKS: readonly TaskTableTask[] = [
  {
    gid: "task-1",
    name: "Draft brief",
    assigneeGid: null,
    projectGids: ["apollo"],
    priorityOptionId: null,
    createdAt: "2026-03-01T00:00:00.000Z" as ISODateTime,
    dueAt: null,
    completedAt: null,
    estimatedMinutes: null,
    actualMinutes: null,
  },
];

const PROJECTS = [
  { gid: "apollo", name: "Apollo" },
  { gid: "borealis", name: "Borealis" },
] as const;

function renderTaskList(tasks: readonly TaskTableTask[] = TASKS): void {
  render(
    <TaskList
      tasks={tasks}
      users={[]}
      projects={PROJECTS}
      now={new Date("2026-03-15T00:00:00.000Z")}
    />,
  );
}

describe("TaskList", () => {
  afterEach(cleanup);

  it("selects the shared no-results surface for a zero-match filter and restores the table on clear", () => {
    renderTaskList();
    expect(screen.getByTestId("task-row")).toHaveTextContent("Draft brief");

    fireEvent.click(screen.getByTestId("filter-project-borealis"));

    const state = screen.getByTestId("no-results-state");
    expect(screen.queryByTestId("task-table")).not.toBeInTheDocument();
    expect(within(state).getAllByTestId("active-filter-chip")).toHaveLength(1);
    expect(screen.getAllByTestId("active-filters-list")).toHaveLength(1);

    fireEvent.click(within(state).getByTestId("active-filters-clear-all"));
    expect(screen.queryByTestId("no-results-state")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-row")).toHaveTextContent("Draft brief");
  });

  it("does not report filter misses when there are no source tasks", () => {
    renderTaskList([]);
    fireEvent.click(screen.getByTestId("filter-project-borealis"));

    expect(screen.queryByTestId("no-results-state")).not.toBeInTheDocument();
  });

  it("renders an accessible task selection button and reports its gid", () => {
    const onSelectTask = vi.fn();
    render(
      <TaskList
        tasks={TASKS}
        users={[]}
        projects={PROJECTS}
        now={new Date("2026-03-15T00:00:00.000Z")}
        onSelectTask={onSelectTask}
      />,
    );
    const button = screen.getByRole("button", { name: "Draft brief" });
    expect(button).toHaveAttribute("data-testid", "task-row-select");
    expect(
      within(screen.getByTestId("task-row")).getByRole("rowheader"),
    ).toContainElement(button);
    fireEvent.click(button);
    expect(onSelectTask).toHaveBeenCalledExactlyOnceWith("task-1");
  });
});
