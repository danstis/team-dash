/**
 * T065 — `FilterCriteria` predicate unit tests (Red phase).
 *
 * Covers the composable filter contract every task-list surface depends on:
 *
 * - FR-047: composable filtering by date range, assignee (including the
 *   explicit "unassigned" option), project, priority (including the
 *   explicit "no priority" option), completion state, overdue/on-time
 *   state and estimated/unestimated state.
 * - FR-048: multiple filters combine simultaneously — one active
 *   dimension narrows the set further (AND across dimensions) while the
 *   values inside one dimension are alternatives (OR inside a dimension).
 * - FR-032 / FR-030: the date range is a closed interval evaluated under
 *   the active timezone basis.
 * - FR-033: the date basis is explicit — a range filters on the due date,
 *   the creation date or the completion date, never a blend.
 *
 * The tests MUST fail before `src/domain/filtering/filters.ts` is
 * implemented and pass after it, per Constitution Principle III. The
 * module lives under `src/domain/**` and therefore stays
 * presentation-free, browser-free, and network-free (ESLint boundary
 * rule, `eslint.config.js`) — no Dexie, no fetch, no React.
 *
 * Determinism
 * ------------
 * Local-timezone behaviour depends on the host's `TZ` environment
 * variable, so the file pins `TZ` to a fixed IANA zone exactly like
 * `tests/unit/domain/datetime/index.test.ts` does. Range assertions
 * additionally pass an explicit `timezone: "utc"` so they hold on every
 * host; the one local-mode assertion relies on the pinned zone.
 */
process.env.TZ = "Australia/Sydney";

import { describe, expect, it } from "vitest";
import type {
  DateRange,
  FilterCriteria,
  ISODate,
  ISODateTime,
} from "../../../../src/domain/types";
import {
  UnsupportedFilterDimensionError,
  andPredicates,
  createFilterPredicate,
  filterTasks,
  filterTasksByPredicates,
  hasActiveFilters,
  matchesAssignee,
  matchesCompletionState,
  matchesDateRange,
  matchesEstimateState,
  matchesFilterCriteria,
  matchesOverdueState,
  matchesPriority,
  matchesProject,
  orPredicates,
} from "../../../../src/domain/filtering/filters";
import type {
  FilterableTask,
  TaskPredicate,
} from "../../../../src/domain/filtering/filters";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A closed, custom date range (`FilterCriteria.dateRange` carries the
 * resolved bounds plus the preset label; `custom` marks a user-entered
 * pair per FR-032).
 */
const range = (start: string, end: string): DateRange => ({
  start: start as ISODate,
  end: end as ISODate,
  preset: "custom",
});

/**
 * Baseline task. Every field a predicate in this contract can read is
 * present so a test only has to state the ONE thing it changes.
 */
const BASE_TASK: FilterableTask = {
  gid: "task-1",
  assigneeGid: "user-1",
  projectGids: ["project-a"],
  createdAt: "2026-03-01T09:00:00.000Z" as ISODateTime,
  dueAt: "2026-03-10T09:00:00.000Z" as ISODateTime,
  completedAt: null,
  priorityOptionId: "priority-high",
  estimatedMinutes: 120,
};

const makeTask = (overrides: Partial<FilterableTask> = {}): FilterableTask => ({
  ...BASE_TASK,
  ...overrides,
});

/**
 * A small, realistic task set used by the combination tests: one task
 * satisfies every active dimension, one fails a single dimension, and
 * one is unassigned.
 */
const taskSet = (): FilterableTask[] => [
  makeTask({ gid: "task-a" }),
  makeTask({
    gid: "task-b",
    assigneeGid: "user-2",
    projectGids: ["project-b"],
    dueAt: "2026-03-20T09:00:00.000Z" as ISODateTime,
  }),
  makeTask({
    gid: "task-c",
    assigneeGid: null,
    projectGids: ["project-a"],
    dueAt: "2026-03-05T09:00:00.000Z" as ISODateTime,
  }),
  makeTask({
    gid: "task-d",
    projectGids: ["project-a", "project-b"],
    completedAt: "2026-03-02T09:00:00.000Z" as ISODateTime,
  }),
];

/* -------------------------------------------------------------------------- */
/* Date range (FR-032, FR-030, FR-033)                                        */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — date range", () => {
  it("keeps a task whose due date falls inside the range", () => {
    const predicate = matchesDateRange(range("2026-03-01", "2026-03-31"), {
      timezone: "utc",
    });

    expect(predicate(makeTask())).toBe(true);
  });

  it("drops a task whose due date falls before the range start", () => {
    // The task is due 2026-03-10; the range starts a week later.
    const predicate = matchesDateRange(range("2026-03-15", "2026-03-31"), {
      timezone: "utc",
    });

    expect(predicate(makeTask())).toBe(false);
  });

  it("drops a task whose due date falls after the range end", () => {
    const predicate = matchesDateRange(range("2026-03-01", "2026-03-05"), {
      timezone: "utc",
    });

    expect(predicate(makeTask())).toBe(false);
  });

  it("treats both range bounds as inclusive", () => {
    const startsOnStart = matchesDateRange(range("2026-03-10", "2026-03-20"), {
      timezone: "utc",
    });
    const endsOnEnd = matchesDateRange(range("2026-03-01", "2026-03-10"), {
      timezone: "utc",
    });

    expect(startsOnStart(makeTask())).toBe(true);
    expect(endsOnEnd(makeTask())).toBe(true);
  });

  it("drops a task with no due date under the default (due) basis", () => {
    const predicate = matchesDateRange(range("2026-03-01", "2026-03-31"), {
      timezone: "utc",
    });

    expect(predicate(makeTask({ dueAt: null }))).toBe(false);
  });

  it("filters on the creation date when the basis is 'created'", () => {
    const predicate = matchesDateRange(range("2026-02-01", "2026-02-28"), {
      basis: "created",
      timezone: "utc",
    });

    expect(predicate(makeTask())).toBe(false);
    expect(
      predicate(
        makeTask({ createdAt: "2026-02-14T09:00:00.000Z" as ISODateTime }),
      ),
    ).toBe(true);
  });

  it("filters on the completion date when the basis is 'completed'", () => {
    const predicate = matchesDateRange(range("2026-03-01", "2026-03-31"), {
      basis: "completed",
      timezone: "utc",
    });

    expect(predicate(makeTask())).toBe(false);
    expect(
      predicate(
        makeTask({
          completedAt: "2026-03-02T09:00:00.000Z" as ISODateTime,
        }),
      ),
    ).toBe(true);
  });

  it("evaluates the range bounds under the requested timezone", () => {
    // 2026-03-10T23:30Z is 2026-03-11 in the pinned local zone
    // (Australia/Sydney, UTC+11 in March) but 2026-03-10 in UTC, so the
    // same task must fall inside a one-day range under one basis and
    // outside it under the other (FR-030 / FR-034).
    const task = makeTask({ dueAt: "2026-03-10T23:30:00.000Z" as ISODateTime });
    const singleDay = range("2026-03-10", "2026-03-10");

    expect(matchesDateRange(singleDay, { timezone: "utc" })(task)).toBe(true);
    expect(matchesDateRange(singleDay, { timezone: "local" })(task)).toBe(
      false,
    );
    expect(
      matchesDateRange(range("2026-03-11", "2026-03-11"), {
        timezone: "local",
      })(task),
    ).toBe(true);
  });

  it("matches no task when the range is inverted (start after end)", () => {
    const predicate = matchesDateRange(range("2026-03-31", "2026-03-01"), {
      timezone: "utc",
    });

    expect(predicate(makeTask())).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Assignee (FR-047, explicit "unassigned" option)                             */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — assignee", () => {
  it("keeps a task assigned to the selected user", () => {
    expect(matchesAssignee(["user-1"])(makeTask())).toBe(true);
  });

  it("drops a task assigned to a different user", () => {
    expect(
      matchesAssignee(["user-1"])(makeTask({ assigneeGid: "user-2" })),
    ).toBe(false);
  });

  it("keeps a task assigned to ANY of the selected users (OR inside a dimension)", () => {
    const predicate = matchesAssignee(["user-1", "user-2"]);

    expect(predicate(makeTask({ assigneeGid: "user-1" }))).toBe(true);
    expect(predicate(makeTask({ assigneeGid: "user-2" }))).toBe(true);
    expect(predicate(makeTask({ assigneeGid: "user-3" }))).toBe(false);
  });

  it("is not affected by the order of the selected users", () => {
    const forwards = matchesAssignee(["user-1", "user-2"]);
    const backwards = matchesAssignee(["user-2", "user-1"]);

    expect(backwards(makeTask({ assigneeGid: "user-2" }))).toBe(
      forwards(makeTask({ assigneeGid: "user-2" })),
    );
  });

  it("'unassigned' keeps only tasks with no assignee", () => {
    const predicate = matchesAssignee("unassigned");

    expect(predicate(makeTask({ assigneeGid: null }))).toBe(true);
    expect(predicate(makeTask({ assigneeGid: "user-1" }))).toBe(false);
  });

  it("an empty or absent assignee selection does not filter", () => {
    expect(matchesAssignee([])(makeTask({ assigneeGid: "user-9" }))).toBe(true);
    expect(matchesAssignee(null)(makeTask({ assigneeGid: null }))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Project (FR-047)                                                            */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — project", () => {
  it("keeps a task that belongs to the selected project", () => {
    expect(matchesProject(["project-a"])(makeTask())).toBe(true);
  });

  it("drops a task that belongs only to other projects", () => {
    expect(
      matchesProject(["project-a"])(makeTask({ projectGids: ["project-b"] })),
    ).toBe(false);
  });

  it("keeps a multi-project task that belongs to ANY selected project", () => {
    const predicate = matchesProject(["project-a", "project-c"]);

    expect(
      predicate(makeTask({ projectGids: ["project-b", "project-c"] })),
    ).toBe(true);
    expect(predicate(makeTask({ projectGids: ["project-b"] }))).toBe(false);
  });

  it("is not affected by the order of the selected projects", () => {
    const forwards = matchesProject(["project-a", "project-b"]);
    const backwards = matchesProject(["project-b", "project-a"]);

    expect(backwards(makeTask({ projectGids: ["project-b"] }))).toBe(
      forwards(makeTask({ projectGids: ["project-b"] })),
    );
  });

  it("an empty or absent project selection does not filter", () => {
    expect(matchesProject([])(makeTask({ projectGids: [] }))).toBe(true);
    expect(matchesProject(null)(makeTask({ projectGids: ["project-z"] }))).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Completion state (FR-047)                                                   */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — completion state", () => {
  it("'complete' keeps only tasks with a completion timestamp", () => {
    const predicate = matchesCompletionState("complete");

    expect(
      predicate(
        makeTask({ completedAt: "2026-03-02T09:00:00.000Z" as ISODateTime }),
      ),
    ).toBe(true);
    expect(predicate(makeTask())).toBe(false);
  });

  it("'incomplete' keeps only tasks without a completion timestamp", () => {
    const predicate = matchesCompletionState("incomplete");

    expect(predicate(makeTask())).toBe(true);
    expect(
      predicate(
        makeTask({ completedAt: "2026-03-02T09:00:00.000Z" as ISODateTime }),
      ),
    ).toBe(false);
  });

  it("an absent completion state does not filter", () => {
    expect(matchesCompletionState(null)(makeTask())).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Priority, estimate and overdue states (FR-047)                              */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — priority, estimate, overdue", () => {
  it("'no_priority' keeps only tasks without a priority", () => {
    const predicate = matchesPriority("no_priority");

    expect(predicate(makeTask({ priorityOptionId: null }))).toBe(true);
    expect(predicate(makeTask())).toBe(false);
  });

  it("a priority selection keeps only tasks carrying that priority", () => {
    const predicate = matchesPriority(["priority-high"]);

    expect(predicate(makeTask())).toBe(true);
    expect(predicate(makeTask({ priorityOptionId: "priority-low" }))).toBe(
      false,
    );
  });

  it("'estimated' and 'unestimated' split on the estimate field", () => {
    expect(matchesEstimateState("estimated")(makeTask())).toBe(true);
    expect(
      matchesEstimateState("estimated")(makeTask({ estimatedMinutes: null })),
    ).toBe(false);
    expect(
      matchesEstimateState("unestimated")(makeTask({ estimatedMinutes: null })),
    ).toBe(true);
  });

  it("'overdue' keeps only incomplete tasks whose due date has passed", () => {
    const predicate = matchesOverdueState("overdue", {
      now: "2026-03-15T00:00:00.000Z" as ISODateTime,
    });

    expect(
      predicate(makeTask({ dueAt: "2026-03-10T09:00:00.000Z" as ISODateTime })),
    ).toBe(true);
    expect(
      predicate(makeTask({ dueAt: "2026-03-20T09:00:00.000Z" as ISODateTime })),
    ).toBe(false);
    expect(
      predicate(
        makeTask({
          dueAt: "2026-03-10T09:00:00.000Z" as ISODateTime,
          completedAt: "2026-03-11T09:00:00.000Z" as ISODateTime,
        }),
      ),
    ).toBe(false);
  });

  it("'no_due_date' keeps only tasks without a due date", () => {
    const predicate = matchesOverdueState("no_due_date", {
      now: "2026-03-15T00:00:00.000Z" as ISODateTime,
    });

    expect(predicate(makeTask({ dueAt: null }))).toBe(true);
    expect(predicate(makeTask())).toBe(false);
  });

  it("refuses to evaluate an overdue state without an explicit clock", () => {
    expect(() => matchesOverdueState("overdue")).toThrow(/now/);
  });
});

/* -------------------------------------------------------------------------- */
/* Combinations (FR-048)                                                      */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — combinations", () => {
  it("requires a task to satisfy EVERY active dimension (AND across dimensions)", () => {
    const criteria: FilterCriteria = {
      dateRange: range("2026-03-01", "2026-03-31"),
      assigneeGids: ["user-1"],
      projectGids: ["project-a"],
      completionState: "incomplete",
    };

    const matching = makeTask({ gid: "task-a" });
    const wrongAssignee = makeTask({ gid: "task-x", assigneeGid: "user-2" });
    const wrongProject = makeTask({
      gid: "task-y",
      projectGids: ["project-b"],
    });
    const completed = makeTask({
      gid: "task-z",
      completedAt: "2026-03-02T09:00:00.000Z" as ISODateTime,
    });

    expect(matchesFilterCriteria(matching, criteria, { timezone: "utc" })).toBe(
      true,
    );
    expect(
      matchesFilterCriteria(wrongAssignee, criteria, { timezone: "utc" }),
    ).toBe(false);
    expect(
      matchesFilterCriteria(wrongProject, criteria, { timezone: "utc" }),
    ).toBe(false);
    expect(
      matchesFilterCriteria(completed, criteria, { timezone: "utc" }),
    ).toBe(false);
  });

  it("returns only the tasks matching every active dimension", () => {
    const criteria: FilterCriteria = {
      dateRange: range("2026-03-01", "2026-03-31"),
      assigneeGids: ["user-1"],
      projectGids: ["project-a"],
    };

    const result = filterTasks(taskSet(), criteria, { timezone: "utc" });

    // `task-a` matches on every dimension; `task-d` matches too (it is
    // assigned to `user-1`, is due inside the range and belongs to
    // `project-a` alongside `project-b`); `task-b` fails the assignee and
    // project dimensions; `task-c` fails the assignee dimension.
    expect(result.map((task) => task.gid)).toEqual(["task-a", "task-d"]);
  });

  it("keeps the unassigned task when the assignee filter asks for 'unassigned'", () => {
    const criteria: FilterCriteria = { assigneeGids: "unassigned" };

    const result = filterTasks(taskSet(), criteria);

    expect(result.map((task) => task.gid)).toEqual(["task-c"]);
  });

  it("returns every task when no filter is active (clear-all)", () => {
    const result = filterTasks(taskSet(), {});

    expect(result).toHaveLength(taskSet().length);
  });

  it("combines two criteria objects so a task must satisfy both", () => {
    const byAssignee: FilterCriteria = { assigneeGids: ["user-1"] };
    const byProject: FilterCriteria = { projectGids: ["project-b"] };

    const result = filterTasksByPredicates(
      taskSet(),
      createFilterPredicate(byAssignee),
      createFilterPredicate(byProject),
    );

    expect(result.map((task) => task.gid)).toEqual(["task-d"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Composition order and idempotence                                           */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — composition is order-independent", () => {
  const datePredicate = matchesDateRange(range("2026-03-01", "2026-03-31"), {
    timezone: "utc",
  });
  const assigneePredicate = matchesAssignee(["user-1"]);
  const projectPredicate = matchesProject(["project-a"]);
  const completionPredicate = matchesCompletionState("incomplete");

  it("ANDs predicates identically whatever order they are composed in", () => {
    const forwards = andPredicates(
      datePredicate,
      assigneePredicate,
      projectPredicate,
      completionPredicate,
    );
    const backwards = andPredicates(
      completionPredicate,
      projectPredicate,
      assigneePredicate,
      datePredicate,
    );

    for (const task of taskSet()) {
      expect(forwards(task)).toBe(backwards(task));
    }
  });

  it("is idempotent — composing a predicate with itself changes nothing", () => {
    const once = andPredicates(assigneePredicate);
    const twice = andPredicates(assigneePredicate, assigneePredicate);

    for (const task of taskSet()) {
      expect(twice(task)).toBe(once(task));
    }
  });

  it("ORs predicates identically whatever order they are composed in", () => {
    const forwards = orPredicates(assigneePredicate, projectPredicate);
    const backwards = orPredicates(projectPredicate, assigneePredicate);

    for (const task of taskSet()) {
      expect(forwards(task)).toBe(backwards(task));
    }
  });

  it("treats an empty AND as matching everything and an empty OR as matching nothing", () => {
    expect(andPredicates()(makeTask())).toBe(true);
    expect(orPredicates()(makeTask())).toBe(false);
  });

  it("refuses to compose a value that is not a predicate", () => {
    expect(() => andPredicates(undefined as unknown as TaskPredicate)).toThrow(
      TypeError,
    );
    expect(() => orPredicates("nope" as unknown as TaskPredicate)).toThrow(
      TypeError,
    );
  });

  it("matches the explicit composition of its own dimension predicates", () => {
    const criteria: FilterCriteria = {
      dateRange: range("2026-03-01", "2026-03-31"),
      assigneeGids: ["user-1"],
      projectGids: ["project-a"],
      completionState: "incomplete",
    };

    for (const task of taskSet()) {
      expect(matchesFilterCriteria(task, criteria, { timezone: "utc" })).toBe(
        andPredicates(
          matchesDateRange(criteria.dateRange as DateRange, {
            timezone: "utc",
          }),
          matchesAssignee(criteria.assigneeGids),
          matchesProject(criteria.projectGids),
          matchesCompletionState(criteria.completionState),
        )(task),
      );
    }
  });

  it("combines two criteria objects identically whatever order they are composed in", () => {
    const byAssignee: FilterCriteria = { assigneeGids: ["user-1"] };
    const byProject: FilterCriteria = { projectGids: ["project-a"] };

    const forwards = andPredicates(
      createFilterPredicate(byAssignee),
      createFilterPredicate(byProject),
    );
    const backwards = andPredicates(
      createFilterPredicate(byProject),
      createFilterPredicate(byAssignee),
    );

    for (const task of taskSet()) {
      expect(forwards(task)).toBe(backwards(task));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Reserved dimensions and honesty about what is implemented                   */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — dimensions not yet implemented", () => {
  it("refuses to silently ignore a dimension it does not implement", () => {
    const criteria: FilterCriteria = { personGroupIds: ["group-1"] };

    expect(() => matchesFilterCriteria(makeTask(), criteria)).toThrow(
      UnsupportedFilterDimensionError,
    );
    expect(() => matchesFilterCriteria(makeTask(), criteria)).toThrow(
      /personGroupIds/,
    );
  });

  it("treats an empty reserved dimension as inactive", () => {
    const criteria: FilterCriteria = { personGroupIds: [], blockedOnly: false };

    expect(matchesFilterCriteria(makeTask(), criteria)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Purity (Constitution Principle VI)                                           */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — purity", () => {
  it("does not mutate the task or the criteria it is given", () => {
    const task = makeTask();
    const criteria: FilterCriteria = {
      assigneeGids: ["user-1"],
      projectGids: ["project-a"],
    };
    const taskSnapshot = { ...task };
    const criteriaSnapshot = { ...criteria };

    matchesFilterCriteria(task, criteria);

    expect(task).toEqual(taskSnapshot);
    expect(criteria).toEqual(criteriaSnapshot);
  });

  it("does not mutate the task list it filters", () => {
    const tasks = taskSet();
    const snapshot = [...tasks];

    filterTasks(tasks, { assigneeGids: ["user-1"] });

    expect(tasks).toEqual(snapshot);
  });
});

/* -------------------------------------------------------------------------- */
/* Active-filter reporting helper                                              */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — active filter reporting", () => {
  it("reports no active filter for empty criteria", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ assigneeGids: [], projectGids: null })).toBe(
      false,
    );
  });

  it("reports an active filter for every specified dimension", () => {
    expect(
      hasActiveFilters({ dateRange: range("2026-03-01", "2026-03-31") }),
    ).toBe(true);
    expect(hasActiveFilters({ assigneeGids: "unassigned" })).toBe(true);
    expect(hasActiveFilters({ completionState: "complete" })).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Type-level contract                                                        */
/* -------------------------------------------------------------------------- */

describe("T065 FilterCriteria predicates — predicate type contract", () => {
  it("accepts a plain predicate function as a composable unit", () => {
    const alwaysTrue: TaskPredicate = () => true;

    expect(
      andPredicates(alwaysTrue, matchesAssignee(["user-1"]))(makeTask()),
    ).toBe(true);
  });
});
