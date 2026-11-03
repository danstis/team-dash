import { describe, expect, it } from "vitest";

import type { FilterableTask } from "../../../../src/domain/filtering/filters";
import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
} from "../../../../src/domain/types";
import { filterTasksForReport } from "../../../../src/features/filters/reporting-scope";

function task(
  gid: string,
  createdAt: string,
  completedAt: string | null,
  dueAt: string | null = null,
  assigneeGid: string | null = null,
): FilterableTask {
  return {
    gid,
    assigneeGid,
    projectGids: [],
    createdAt: createdAt as ISODateTime,
    dueAt: dueAt as ISODateTime | null,
    completedAt: completedAt as ISODateTime | null,
    priorityOptionId: null,
    estimatedMinutes: null,
  };
}

const OPTIONS = {
  timezone: "utc",
  now: "2026-03-15T00:00:00.000Z" as ISODateTime,
} as const;

const WINDOW: FilterCriteria = {
  dateRange: {
    start: "2026-03-01" as ISODate,
    end: "2026-03-10" as ISODate,
    preset: "custom",
  },
};

describe("filterTasksForReport", () => {
  const tasks = [
    task("created-in", "2026-03-05T00:00:00.000Z", null),
    task(
      "completed-in",
      "2026-01-01T00:00:00.000Z",
      "2026-03-06T00:00:00.000Z",
    ),
    task("outside", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    // Due inside the window but neither created nor completed in it.
    task(
      "due-only",
      "2026-01-01T00:00:00.000Z",
      null,
      "2026-03-05T00:00:00.000Z",
    ),
  ];

  it("keeps tasks created or completed in the window, never by due date", () => {
    const kept = filterTasksForReport(tasks, WINDOW, OPTIONS).map((t) => t.gid);
    expect(kept).toEqual(["created-in", "completed-in"]);
  });

  it("combines the window with the other filters", () => {
    const withPeople = [
      task("a", "2026-03-05T00:00:00.000Z", null, null, "u1"),
      task("b", "2026-03-05T00:00:00.000Z", null, null, "u2"),
    ];
    const kept = filterTasksForReport(
      withPeople,
      { ...WINDOW, assigneeGids: ["u1"] },
      OPTIONS,
    );
    expect(kept.map((t) => t.gid)).toEqual(["a"]);
  });

  it("applies no window when the criteria carry none", () => {
    expect(filterTasksForReport(tasks, {}, OPTIONS)).toHaveLength(4);
  });
});
