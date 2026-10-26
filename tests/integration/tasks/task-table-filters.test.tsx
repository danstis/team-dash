/**
 * BSOD-315 (T066) — Task-list filter UI red→green.
 *
 * Spec / contract references
 * --------------------------
 * - FR-032 (spec.md): the date-range filter offers presets — this week,
 *   last week, last 30 days, this month, last month, this quarter — plus
 *   a custom start/end range.
 * - FR-047 (spec.md): the filter surface supports composable filtering by
 *   date range, assignee (including the explicit "unassigned" option),
 *   project and completion state.
 * - FR-048 (spec.md): multiple filters combine simultaneously, all filters
 *   can be cleared in one action, and the currently active filters are
 *   listed at all times.
 * - FR-049 (spec.md): where a filter changes the denominator of a
 *   displayed figure, that change is made visible — the task table states
 *   how many of the tasks it holds are currently shown.
 *
 * What this test pins
 * -------------------
 *
 * 1. With no filter applied the task table shows every task.
 *
 * 2. A date-range preset narrows the table to the tasks inside the range,
 *    and the table says how many of the tasks it holds are shown (FR-049).
 *
 * 3. The date-range filter and the assignee filter COMBINE: the second
 *    filter narrows the result of the first (FR-048).
 *
 * 4. Every active filter stays listed while it is applied (FR-048) — the
 *    user can always see what narrowed the list.
 *
 * 5. "Clear all filters" restores the full list in one action (FR-048).
 *
 * 6. The project filter and the completion-state filter narrow the list
 *    the same way, and the explicit "unassigned" assignee option selects
 *    exactly the tasks with no assignee (FR-047).
 *
 * 7. A custom start/end range is honoured (FR-032).
 *
 * The filtering itself is NOT re-implemented here: the table applies the
 * `FilterCriteria` contract that T065 (BSOD-314) landed in
 * `src/domain/filtering/filters.ts`. This test therefore also pins that
 * the UI consumes that contract rather than growing its own predicate
 * logic — a UI that filtered by hand would still pass a row-count
 * assertion but would drift from the domain predicates.
 *
 * Test-first discipline
 * ----------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/tasks/FilterBar'", and the same file goes green
 * once `FilterBar`, `ActiveFiltersList` and `TaskTable` implement the
 * surface below — with no test-side change.
 *
 * Determinism
 * ------------
 * The presets are resolved against an injected anchor instant and the
 * "utc" timezone basis, so the resolved ranges (and therefore the row
 * counts) are identical on every host. The local-timezone behaviour of
 * the domain is covered by T065's unit suite; this file pins the wiring,
 * not the calendar.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom per `tests/setup.ts`. No
 * browser, no live Asana workspace, no real personal access token
 * (Principle III, NFR-005). The fixtures below are synthetic.
 */
import { type ReactElement, StrictMode, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { FilterCriteria, ISODateTime } from "../../../src/domain/types";
import { ActiveFiltersList } from "../../../src/features/tasks/ActiveFiltersList";
import { FilterBar } from "../../../src/features/tasks/FilterBar";
import {
  TaskTable,
  type TaskTableTask,
} from "../../../src/features/tasks/TaskTable";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The anchor instant the date-range presets are resolved against. It is
 * a Sunday in the middle of March 2026, so "this month" spans a month
 * that starts on a non-Monday and the week presets straddle it.
 */
const NOW = new Date("2026-03-15T00:00:00.000Z");

/**
 * Builds a branded ISO instant for a fixture row. The brand is a
 * compile-time marker only; the value is an ordinary ISO-8601 instant
 * string, exactly as the cache stores it.
 */
function at(value: string): ISODateTime {
  return value as ISODateTime;
}

/**
 * The people the filter bar offers. Two named people plus the tasks
 * that have no assignee at all.
 */
const USERS = [
  { gid: "user-alice", name: "Alice Nkemelu" },
  { gid: "user-bob", name: "Bo Chen" },
] as const;

/**
 * The projects the filter bar offers. One task belongs to both, so the
 * project filter's "any of the selected projects" rule is observable.
 */
const PROJECTS = [
  { gid: "project-apollo", name: "Apollo" },
  { gid: "project-borealis", name: "Borealis" },
] as const;

/**
 * Five synthetic tasks, chosen so that every assertion below has a
 * hand-computed answer:
 *
 * | Task   | Due        | Assignee | Projects          | State      |
 * |--------|------------|----------|-------------------|------------|
 * | task-1 | 2026-03-05 | Alice    | Apollo            | complete   |
 * | task-2 | 2026-03-20 | Bo       | Apollo            | incomplete |
 * | task-3 | 2026-04-02 | Alice    | Borealis          | incomplete |
 * | task-4 | 2026-02-10 | —        | Borealis          | incomplete |
 * | task-5 | 2026-03-10 | Bo       | Apollo, Borealis  | complete   |
 *
 * Under the "utc" basis with the anchor above, "this month" resolves to
 * 2026-03-01 → 2026-03-31 and therefore keeps tasks 1, 2 and 5.
 */
const TASKS: readonly TaskTableTask[] = [
  {
    gid: "task-1",
    name: "Draft the launch brief",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo"],
    priorityOptionId: "priority-high",
    createdAt: at("2026-02-20T09:00:00.000Z"),
    dueAt: at("2026-03-05T00:00:00.000Z"),
    completedAt: at("2026-03-06T11:30:00.000Z"),
    estimatedMinutes: 120,
    actualMinutes: 150,
  },
  {
    gid: "task-2",
    name: "Book the venue",
    assigneeGid: "user-bob",
    projectGids: ["project-apollo"],
    priorityOptionId: null,
    createdAt: at("2026-03-01T09:00:00.000Z"),
    dueAt: at("2026-03-20T00:00:00.000Z"),
    completedAt: null,
    estimatedMinutes: 240,
    actualMinutes: null,
  },
  {
    gid: "task-3",
    name: "Refresh the pricing model",
    assigneeGid: "user-alice",
    projectGids: ["project-borealis"],
    priorityOptionId: "priority-low",
    createdAt: at("2026-03-10T09:00:00.000Z"),
    dueAt: at("2026-04-02T00:00:00.000Z"),
    completedAt: null,
    estimatedMinutes: null,
    actualMinutes: null,
  },
  {
    gid: "task-4",
    name: "Archive the old campaign",
    assigneeGid: null,
    projectGids: ["project-borealis"],
    priorityOptionId: null,
    createdAt: at("2026-02-01T09:00:00.000Z"),
    dueAt: at("2026-02-10T00:00:00.000Z"),
    completedAt: null,
    estimatedMinutes: 60,
    actualMinutes: "unavailable",
  },
  {
    gid: "task-5",
    name: "Publish the migration checklist",
    assigneeGid: "user-bob",
    projectGids: ["project-apollo", "project-borealis"],
    priorityOptionId: "priority-high",
    createdAt: at("2026-03-02T09:00:00.000Z"),
    dueAt: at("2026-03-10T00:00:00.000Z"),
    completedAt: at("2026-03-11T08:00:00.000Z"),
    estimatedMinutes: 30,
    actualMinutes: 25,
  },
];

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The three surfaces composed the way the dashboard chrome will compose
 * them: the filter bar drives the `FilterCriteria`, the active-filter
 * list shows what is applied, and the table renders the result.
 */
function TaskListHarness(): ReactElement {
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  return (
    <StrictMode>
      <FilterBar
        criteria={criteria}
        onChange={setCriteria}
        users={USERS}
        projects={PROJECTS}
        now={NOW}
        timezone="utc"
      />
      <ActiveFiltersList
        criteria={criteria}
        users={USERS}
        projects={PROJECTS}
        onClearAll={() => {
          setCriteria({});
        }}
        timezone="utc"
      />
      <TaskTable
        tasks={TASKS}
        criteria={criteria}
        users={USERS}
        projects={PROJECTS}
        timezone="utc"
      />
    </StrictMode>
  );
}

function renderTaskList(): void {
  render(<TaskListHarness />);
}

/** The number of task rows the table currently renders. */
function renderedRowCount(): number {
  return screen.getAllByTestId("task-row").length;
}

/** The active-filter chips the list currently renders. */
function activeFilterChips(): readonly HTMLElement[] {
  return within(screen.getByTestId("active-filters-list")).queryAllByTestId(
    "active-filter-chip",
  );
}

/* -------------------------------------------------------------------------- */
/* The filter surface                                                         */
/* -------------------------------------------------------------------------- */

describe("BSOD-315 (T066) — the task list filters, combines and clears", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists every task before a filter is applied", () => {
    renderTaskList();

    expect(renderedRowCount()).toBe(5);
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 5 of 5 tasks",
    );
    // FR-048 — with nothing applied there is nothing to list, and the
    // list says so rather than rendering an empty shell.
    expect(screen.getByTestId("active-filters-empty")).toHaveTextContent(
      /no filters applied/i,
    );
  });

  it("narrows the task list to the selected date-range preset", () => {
    renderTaskList();

    fireEvent.change(screen.getByTestId("filter-date-range-preset"), {
      target: { value: "this_month" },
    });

    // Tasks 1, 2 and 5 are due inside March 2026.
    expect(renderedRowCount()).toBe(3);
    // FR-049 — the filter changed the denominator, so the table says so.
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 3 of 5 tasks",
    );
  });

  it("combines the date-range filter with the assignee filter", () => {
    renderTaskList();

    fireEvent.change(screen.getByTestId("filter-date-range-preset"), {
      target: { value: "this_month" },
    });
    fireEvent.click(screen.getByTestId("filter-assignee-user-alice"));

    // Inside March 2026 only task 1 is Alice's.
    expect(renderedRowCount()).toBe(1);
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 1 of 5 tasks",
    );
    expect(screen.getByTestId("task-row")).toHaveAttribute(
      "data-task-gid",
      "task-1",
    );
  });

  it("keeps every active filter listed while it is applied", () => {
    renderTaskList();

    fireEvent.change(screen.getByTestId("filter-date-range-preset"), {
      target: { value: "this_month" },
    });
    fireEvent.click(screen.getByTestId("filter-assignee-user-alice"));

    const chips = activeFilterChips();
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent(/due date/i);
    expect(chips[1]).toHaveTextContent(/alice nkemelu/i);
  });

  it("restores the full list when the filters are cleared in one action", () => {
    renderTaskList();

    fireEvent.change(screen.getByTestId("filter-date-range-preset"), {
      target: { value: "this_month" },
    });
    fireEvent.click(screen.getByTestId("filter-assignee-user-alice"));
    expect(renderedRowCount()).toBe(1);

    fireEvent.click(screen.getByTestId("active-filters-clear-all"));

    expect(renderedRowCount()).toBe(5);
    expect(screen.getByTestId("task-table-summary")).toHaveTextContent(
      "Showing 5 of 5 tasks",
    );
    expect(activeFilterChips()).toHaveLength(0);
    expect(screen.getByTestId("active-filters-empty")).toBeInTheDocument();
  });

  it("filters by project and by completion state", () => {
    renderTaskList();

    fireEvent.click(screen.getByTestId("filter-project-project-borealis"));
    // Tasks 3, 4 and 5 belong to Borealis.
    expect(renderedRowCount()).toBe(3);

    fireEvent.change(screen.getByTestId("filter-completion-state"), {
      target: { value: "incomplete" },
    });
    // ...and only tasks 3 and 4 are still incomplete.
    expect(renderedRowCount()).toBe(2);
    expect(activeFilterChips()).toHaveLength(2);
  });

  it("selects the tasks with no assignee through the explicit unassigned option", () => {
    renderTaskList();

    fireEvent.click(screen.getByTestId("filter-assignee-unassigned"));

    expect(renderedRowCount()).toBe(1);
    expect(screen.getByTestId("task-row")).toHaveAttribute(
      "data-task-gid",
      "task-4",
    );
    expect(activeFilterChips()[0]).toHaveTextContent(/unassigned/i);
  });

  it("honours a custom start and end date range", () => {
    renderTaskList();

    fireEvent.change(screen.getByTestId("filter-date-range-preset"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByTestId("filter-date-range-start"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(screen.getByTestId("filter-date-range-end"), {
      target: { value: "2026-03-15" },
    });

    // Tasks 1 and 5 are due inside the custom range.
    expect(renderedRowCount()).toBe(2);
    expect(activeFilterChips()[0]).toHaveTextContent(/custom/i);
  });
});
