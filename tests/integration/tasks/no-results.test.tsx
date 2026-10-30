/**
 * BSOD-317 (T068) — the no-results state.
 *
 * Spec / contract references
 * --------------------------
 * - FR-085 (spec.md): "The system MUST provide deliberately designed
 *   loading, empty, first-run, no-results, stale-cache, offline,
 *   invalid-token, insufficient-permission, rate-limited, and
 *   partial-data states, each with a clear explanation and, where
 *   applicable, a next action."
 * - FR-048 (spec.md): the system MUST let the user combine multiple
 *   filters simultaneously, clear all filters in one action, and see the
 *   currently active filters listed at all times.
 * - FR-047 (spec.md): the filters compose — a task must satisfy every
 *   active dimension to survive.
 *
 * What this test pins
 * -------------------
 *
 * 1. A filter combination that matches NOTHING shows an explicit
 *    no-results state — a heading, an explanation and a next action —
 *    instead of a blank table (FR-085). A table with no rows and no
 *    explanation reads as "you have no work", which is a different
 *    (and wrong) claim.
 *
 * 2. The no-results state lists the filters that narrowed the list
 *    (FR-048). The user must be able to see WHAT emptied the table
 *    while they are looking at the empty table.
 *
 * 3. The clear-all action inside the no-results state restores the
 *    full list in one action (FR-048). The next action has to be
 *    reachable from the state itself, not only from the filter bar
 *    above it.
 *
 * 4. The no-results state never claims that filters narrowed the list
 *    when no filter was applied. With nothing applied, an empty list
 *    means there is no data at all — the empty-dashboard surface's case
 *    (T062 / BSOD-310), not this one's. Pointing the user at filters
 *    that were never applied is the misleading report Principle VII
 *    forbids.
 *
 * The filtering itself is NOT re-implemented here: the harness applies
 * the `FilterCriteria` contract that T065 (BSOD-314) landed in
 * `src/domain/filtering/filters.ts`, exactly as the dashboard chrome
 * will. This file therefore also pins that the no-results surface is
 * driven by the domain's predicates rather than by a UI-local count.
 *
 * Test-first discipline
 * ----------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/tasks/NoResultsState'", and the same file goes
 * green once `NoResultsState` implements the surface below — with no
 * test-side change.
 *
 * Determinism
 * ------------
 * The date-range presets are resolved against an injected anchor instant
 * and the "utc" timezone basis, so the resolved ranges (and therefore
 * the row counts) are identical on every host. The local-timezone
 * behaviour of the domain is covered by T065's unit suite; this file
 * pins the wiring, not the calendar.
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

import { filterTasks } from "../../../src/domain/filtering/filters";
import type { FilterCriteria, ISODateTime } from "../../../src/domain/types";
import { ActiveFiltersList } from "../../../src/features/tasks/ActiveFiltersList";
import { FilterBar } from "../../../src/features/tasks/FilterBar";
import { NoResultsState } from "../../../src/features/tasks/NoResultsState";
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
 * that starts on a non-Monday.
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
 * The projects the filter bar offers.
 */
const PROJECTS = [
  { gid: "project-apollo", name: "Apollo" },
  { gid: "project-borealis", name: "Borealis" },
] as const;

/**
 * Three synthetic tasks, chosen so that every assertion below has a
 * hand-computed answer:
 *
 * | Task   | Due        | Assignee | Projects | State      |
 * |--------|------------|----------|----------|------------|
 * | task-1 | 2026-03-05 | Alice    | Apollo   | complete   |
 * | task-2 | 2026-03-20 | Bo       | Apollo   | incomplete |
 * | task-3 | 2026-04-02 | Alice    | Borealis | incomplete |
 *
 * Under the "utc" basis with the anchor above, "this month" resolves to
 * 2026-03-01 → 2026-03-31 and therefore keeps tasks 1 and 2. Task 3 is
 * due in April, so adding the Borealis project filter to "this month"
 * leaves NOTHING: no task is both due in March and in Borealis. That
 * combination is the zero-match case this file pins.
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
    actualMinutes: "unavailable",
  },
];

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The task-list chrome the way the dashboard will compose it: the
 * filter bar drives the `FilterCriteria`, and the list shows either the
 * filtered table or the no-results state.
 *
 * The chrome owns the decision (a filter combination that matches
 * nothing, against data that exists); the surfaces own their own
 * rendering. The "there is data at all" half of the decision belongs to
 * the empty-dashboard surface (T062 / BSOD-310) — with no tasks cached
 * and no filter applied, the honest state is "run a refresh", not "your
 * filters matched nothing".
 */
function TaskListHarness(): ReactElement {
  const [criteria, setCriteria] = useState<FilterCriteria>({});

  const hasData = TASKS.length > 0;
  const hasResults =
    filterTasks(TASKS, criteria, { timezone: "utc" }).length > 0;
  const showNoResults = hasData && !hasResults;

  const clearAll = (): void => {
    setCriteria({});
  };

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
      {showNoResults ? (
        <NoResultsState
          criteria={criteria}
          users={USERS}
          projects={PROJECTS}
          onClearAll={clearAll}
          timezone="utc"
        />
      ) : (
        <>
          <ActiveFiltersList
            criteria={criteria}
            users={USERS}
            projects={PROJECTS}
            onClearAll={clearAll}
            timezone="utc"
          />
          <TaskTable
            tasks={TASKS}
            criteria={criteria}
            users={USERS}
            projects={PROJECTS}
            timezone="utc"
          />
        </>
      )}
    </StrictMode>
  );
}

function renderTaskList(): void {
  render(<TaskListHarness />);
}

/** Applies the "this month" date-range preset to the rendered filter bar. */
function applyThisMonth(): void {
  fireEvent.change(screen.getByTestId("filter-date-range-preset"), {
    target: { value: "this_month" },
  });
}

/** Applies the Borealis project filter to the rendered filter bar. */
function applyBorealis(): void {
  fireEvent.click(screen.getByTestId("filter-project-project-borealis"));
}

/* -------------------------------------------------------------------------- */
/* The no-results state                                                       */
/* -------------------------------------------------------------------------- */

describe("BSOD-317 (T068) — the no-results state", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an explicit no-results state when the filters match nothing", () => {
    renderTaskList();

    // The date range alone keeps two tasks, so the list is showing
    // results and no no-results state is claimed.
    applyThisMonth();
    expect(screen.getAllByTestId("task-row")).toHaveLength(2);
    expect(screen.queryByTestId("no-results-state")).not.toBeInTheDocument();

    // Adding the project filter leaves nothing: no task is both due in
    // March and in Borealis.
    applyBorealis();

    const state = screen.getByTestId("no-results-state");
    expect(state).toBeInTheDocument();
    // FR-085 — the state is a designed status region, not a blank
    // table: it explains itself and names the next action.
    expect(state).toHaveAttribute("role", "status");
    expect(
      within(state).getByRole("heading", { name: /no tasks match/i }),
    ).toBeInTheDocument();
    const explanation = within(state).getByTestId("no-results-explanation");
    expect(explanation).toHaveTextContent(/no tasks match/i);
    expect(explanation).toHaveTextContent(/clear all filters/i);
    // The empty list is not left to speak for itself.
    expect(screen.queryAllByTestId("task-row")).toHaveLength(0);
  });

  it("lists the filters that narrowed the list inside the no-results state", () => {
    renderTaskList();

    applyThisMonth();
    applyBorealis();

    const chips = within(screen.getByTestId("no-results-state")).getAllByTestId(
      "active-filter-chip",
    );

    // FR-048 — every applied filter is still listed, so the user can
    // see WHAT emptied the table.
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent(/due date/i);
    expect(chips[1]).toHaveTextContent(/borealis/i);
  });

  it("restores the full list when the filters are cleared from the no-results state", () => {
    renderTaskList();

    applyThisMonth();
    applyBorealis();
    expect(screen.getByTestId("no-results-state")).toBeInTheDocument();

    // FR-048 — the clear-all action is reachable from the state itself.
    fireEvent.click(
      within(screen.getByTestId("no-results-state")).getByTestId(
        "active-filters-clear-all",
      ),
    );

    expect(screen.queryByTestId("no-results-state")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("task-row")).toHaveLength(3);
  });

  it("never claims that filters narrowed the list when no filter is applied", () => {
    // With nothing applied, an empty list means there is no data at all
    // — the empty-dashboard surface's case (T062), not this one's. This
    // surface refuses to point the user at filters that were never
    // applied.
    render(
      <NoResultsState
        criteria={{}}
        users={USERS}
        projects={PROJECTS}
        onClearAll={() => {
          /* nothing to clear */
        }}
        timezone="utc"
      />,
    );

    expect(screen.queryByTestId("no-results-state")).not.toBeInTheDocument();
  });
});
