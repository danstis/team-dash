import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
} from "../../../../src/domain/types";
import { ActiveFiltersList } from "../../../../src/features/tasks/ActiveFiltersList";
import { FilterBar } from "../../../../src/features/tasks/FilterBar";
import {
  TaskTable,
  type TaskTableTask,
} from "../../../../src/features/tasks/TaskTable";

const NOW = new Date("2026-03-15T00:00:00.000Z");
const USERS = [
  { gid: "alice", name: "Alice" },
  { gid: "bob", name: "Bob" },
] as const;
const PROJECTS = [
  { gid: "apollo", name: "Apollo" },
  { gid: "borealis", name: "Borealis" },
] as const;

function day(value: string): ISODate {
  return value as ISODate;
}

function renderBar(criteria: FilterCriteria = {}) {
  const onChange = vi.fn<(next: FilterCriteria) => void>();
  render(
    <FilterBar
      criteria={criteria}
      onChange={onChange}
      users={USERS}
      projects={PROJECTS}
      now={NOW}
      timezone="utc"
    />,
  );
  return onChange;
}

function renderActiveFilters(criteria: FilterCriteria = {}) {
  const onClearAll = vi.fn();
  render(
    <ActiveFiltersList
      criteria={criteria}
      users={USERS}
      projects={PROJECTS}
      onClearAll={onClearAll}
      timezone="utc"
    />,
  );
  return onClearAll;
}

const TASKS: readonly TaskTableTask[] = [
  {
    gid: "first",
    name: "Draft brief",
    assigneeGid: "alice",
    projectGids: ["apollo", "borealis"],
    priorityOptionId: "high",
    createdAt: "2026-03-01T09:00:00.000Z" as ISODateTime,
    dueAt: "2026-03-20T00:00:00.000Z" as ISODateTime,
    completedAt: null,
    estimatedMinutes: 120,
    actualMinutes: 90,
  },
  {
    gid: "second",
    name: "Archive project",
    assigneeGid: null,
    projectGids: [],
    priorityOptionId: null,
    createdAt: "2026-02-01T09:00:00.000Z" as ISODateTime,
    dueAt: null,
    completedAt: "2026-02-03T10:00:00.000Z" as ISODateTime,
    estimatedMinutes: null,
    actualMinutes: "unavailable",
  },
];

function renderTable(criteria: FilterCriteria = {}, priorityLabels = {}) {
  render(
    <TaskTable
      tasks={TASKS}
      criteria={criteria}
      users={USERS}
      projects={PROJECTS}
      priorityLabels={priorityLabels}
      timezone="utc"
    />,
  );
}

afterEach(cleanup);

describe("FilterBar", () => {
  it("resolves a preset from its injected clock while preserving other criteria", () => {
    const onChange = renderBar({ projectGids: ["apollo"] });

    fireEvent.change(screen.getByLabelText("Date range"), {
      target: { value: "this_month" },
    });

    expect(onChange).toHaveBeenCalledWith({
      projectGids: ["apollo"],
      dateRange: {
        start: "2026-03-01",
        end: "2026-03-31",
        preset: "this_month",
      },
    });
    expect(
      screen.getByText("Tasks are matched on their due date."),
    ).toBeVisible();
  });

  it("clears a date range without clearing another filter", () => {
    const onChange = renderBar({
      dateRange: {
        start: day("2026-03-01"),
        end: day("2026-03-31"),
        preset: "this_month",
      },
      assigneeGids: ["alice"],
    });
    fireEvent.change(screen.getByLabelText("Date range"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({
      dateRange: undefined,
      assigneeGids: ["alice"],
    });
  });

  it("starts a custom range at the injected day and keeps existing custom bounds", () => {
    const onChange = renderBar();
    fireEvent.change(screen.getByLabelText("Date range"), {
      target: { value: "custom" },
    });
    expect(onChange).toHaveBeenCalledWith({
      dateRange: { start: "2026-03-15", end: "2026-03-15", preset: "custom" },
    });

    cleanup();
    const existing = renderBar({
      dateRange: {
        start: day("2026-03-04"),
        end: day("2026-03-12"),
        preset: "custom",
      },
    });
    expect(screen.getByLabelText("From")).toHaveValue("2026-03-04");
    expect(screen.getByLabelText("To")).toHaveValue("2026-03-12");
    fireEvent.change(screen.getByLabelText("Date range"), {
      target: { value: "custom" },
    });
    expect(existing).toHaveBeenCalledWith({
      dateRange: {
        start: day("2026-03-04"),
        end: day("2026-03-12"),
        preset: "custom",
      },
    });
  });

  it("keeps custom bounds ordered when either date crosses the other", () => {
    const onChange = renderBar({
      dateRange: {
        start: day("2026-03-04"),
        end: day("2026-03-12"),
        preset: "custom",
      },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-03-20" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      dateRange: { start: "2026-03-20", end: "2026-03-20", preset: "custom" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-03-01" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      dateRange: { start: "2026-03-01", end: "2026-03-01", preset: "custom" },
    });
  });

  it("makes named assignees and Unassigned mutually exclusive", () => {
    const onChange = renderBar({ assigneeGids: "unassigned" });
    expect(screen.getByLabelText("Unassigned")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Alice"));
    expect(onChange).toHaveBeenCalledWith({ assigneeGids: ["alice"] });

    cleanup();
    const fromNamed = renderBar({ assigneeGids: ["alice"] });
    fireEvent.click(screen.getByLabelText("Unassigned"));
    expect(fromNamed).toHaveBeenCalledWith({ assigneeGids: "unassigned" });
  });

  it("adds and removes named assignees, projects, and completion state", () => {
    const onChange = renderBar({
      assigneeGids: ["alice"],
      projectGids: ["apollo"],
    });
    fireEvent.click(screen.getByLabelText("Bob"));
    expect(onChange).toHaveBeenLastCalledWith({
      assigneeGids: ["alice", "bob"],
      projectGids: ["apollo"],
    });
    fireEvent.click(screen.getByLabelText("Alice"));
    expect(onChange).toHaveBeenLastCalledWith({
      assigneeGids: null,
      projectGids: ["apollo"],
    });
    fireEvent.click(screen.getByLabelText("Borealis"));
    expect(onChange).toHaveBeenLastCalledWith({
      assigneeGids: ["alice"],
      projectGids: ["apollo", "borealis"],
    });
    fireEvent.click(screen.getByLabelText("Apollo"));
    expect(onChange).toHaveBeenLastCalledWith({
      assigneeGids: ["alice"],
      projectGids: null,
    });
    fireEvent.change(screen.getByLabelText("Completion state"), {
      target: { value: "complete" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      assigneeGids: ["alice"],
      projectGids: ["apollo"],
      completionState: "complete",
    });
  });
});

describe("ActiveFiltersList", () => {
  it("keeps the empty state visible and disables clear-all", () => {
    const onClearAll = renderActiveFilters();
    expect(screen.getByText("No filters applied.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear all filters" }),
    ).toBeDisabled();
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it("lists each active dimension and hands clear-all to the owner", () => {
    const onClearAll = renderActiveFilters({
      dateRange: {
        start: day("2026-03-01"),
        end: day("2026-03-31"),
        preset: "this_month",
      },
      assigneeGids: ["alice", "bob"],
      projectGids: ["apollo", "borealis"],
      completionState: "incomplete",
    });
    expect(screen.getAllByTestId("active-filter-chip")).toHaveLength(4);
    expect(
      screen.getByText(/Due date: 1 Mar 2026 – 31 Mar 2026/),
    ).toBeVisible();
    expect(screen.getByText("Assignee: Alice, Bob")).toBeVisible();
    expect(screen.getByText("Project: Apollo, Borealis")).toBeVisible();
    expect(screen.getByText("Completion: Incomplete")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("describes custom and unassigned filters and names an unsupported dimension", () => {
    renderActiveFilters({
      dateRange: {
        start: day("2026-03-01"),
        end: day("2026-03-05"),
        preset: "custom",
      },
      assigneeGids: "unassigned",
    });
    expect(screen.getByText(/custom range/)).toBeVisible();
    expect(screen.getByText("Assignee: Unassigned")).toBeVisible();

    cleanup();
    renderActiveFilters({ blockedOnly: true });
    expect(screen.getByText("Filter: Applied")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Clear all filters" }),
    ).toBeEnabled();
  });
});

describe("TaskTable", () => {
  it("renders source fields and the full denominator", () => {
    renderTable();
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 2 of 2 tasks",
    );
    const rows = screen.getAllByTestId("task-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Draft brief")).toBeVisible();
    expect(within(rows[0]!).getByText("Alice")).toBeVisible();
    expect(within(rows[0]!).getByText("Apollo, Borealis")).toBeVisible();
    expect(within(rows[0]!).getByText("high").tagName).toBe("CODE");
    expect(within(rows[0]!).getByText("2 h")).toBeVisible();
    expect(within(rows[0]!).getByText("1 h 30 min")).toBeVisible();
    expect(within(rows[1]!).getByText("Unassigned")).toBeVisible();
    expect(within(rows[1]!).getByText("No project")).toBeVisible();
    expect(within(rows[1]!).getByText("No priority")).toBeVisible();
    expect(within(rows[1]!).getByText("No due date")).toBeVisible();
    expect(within(rows[1]!).getByText("Not estimated")).toBeVisible();
    expect(within(rows[1]!).getByText("Not available")).toBeVisible();
  });

  it("uses supplied priority names and exposes the narrowed denominator", () => {
    renderTable({ assigneeGids: ["alice"] }, { high: "High priority" });
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 1 of 2 tasks",
    );
    expect(screen.getAllByTestId("task-row")).toHaveLength(1);
    expect(screen.getByText("High priority")).toBeVisible();
    expect(screen.queryByText("Archive project")).toBeNull();
  });
});
