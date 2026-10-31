import { describe, it } from "vitest";

import { assertDrillDownMatchesSummary } from "./assertDrillDownMatchesSummary";

describe("assertDrillDownMatchesSummary", () => {
  it("re-fetches the first occurrence when source tasks share a gid", () => {
    const sourceTasks = [
      { gid: "task-1", estimatedMinutes: 30 },
      { gid: "task-1", estimatedMinutes: 90 },
    ];

    assertDrillDownMatchesSummary(
      {
        label: "created:2026-07-01",
        displayedCount: 1,
        displayedEffortMinutes: 30,
        contributingGids: ["task-1"],
      },
      sourceTasks,
      (tasks) => ({
        count: tasks.length,
        effortMinutes: tasks.reduce(
          (sum, task) => sum + task.estimatedMinutes,
          0,
        ),
      }),
    );
  });
});
