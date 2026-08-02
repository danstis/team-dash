import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  DataQualitySummary,
  deriveDataQualityFlags,
} from "../../../../src/features/refresh/DataQualitySummary";
import type { PriorityField, Task } from "../../../../src/data/db/schema";
import type { DataQualityFlag } from "../../../../src/domain/types";

/* -------------------------------------------------------------------------- */
/* Pure-derivation fixtures                                                   */
/* -------------------------------------------------------------------------- */

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    gid: "task-default",
    name: "Default task",
    assigneeGid: "user-assigned",
    projectGids: ["project-1"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-08-01T09:00:00.000Z",
    modifiedAt: "2026-08-02T09:00:00.000Z",
    completedAt: null,
    dueAt: "2026-08-10T17:00:00.000Z",
    priorityOptionId: "opt-high",
    estimatedMinutes: 60,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-08-02T09:00:00.000Z",
    outOfScopeReason: null,
    ...overrides,
  };
}

function buildPriorityField(
  overrides: Partial<PriorityField> = {},
): PriorityField {
  return {
    projectGid: "project-1",
    expectedOptionIds: null,
    status: "missing",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* deriveDataQualityFlags (pure)                                              */
/* -------------------------------------------------------------------------- */

describe("deriveDataQualityFlags", () => {
  it("returns an empty array for an empty task set", () => {
    expect(deriveDataQualityFlags([], [])).toEqual([]);
  });

  it("flags missing_assignee when assigneeGid === null", () => {
    const flags = deriveDataQualityFlags(
      [buildTask({ gid: "task-a", assigneeGid: null })],
      [],
    );
    expect(flags).toEqual<DataQualityFlag[]>([
      { kind: "missing_assignee", taskGids: ["task-a"], count: 1 },
    ]);
  });

  it("flags missing_estimate when estimatedMinutes === null", () => {
    const flags = deriveDataQualityFlags(
      [buildTask({ gid: "task-a", estimatedMinutes: null })],
      [],
    );
    expect(flags).toEqual<DataQualityFlag[]>([
      { kind: "missing_estimate", taskGids: ["task-a"], count: 1 },
    ]);
  });

  it("flags missing_priority when priorityOptionId === null", () => {
    const flags = deriveDataQualityFlags(
      [buildTask({ gid: "task-a", priorityOptionId: null })],
      [],
    );
    expect(flags).toEqual<DataQualityFlag[]>([
      { kind: "missing_priority", taskGids: ["task-a"], count: 1 },
    ]);
  });

  it("flags missing_due_date when dueAt === null", () => {
    const flags = deriveDataQualityFlags(
      [buildTask({ gid: "task-a", dueAt: null })],
      [],
    );
    expect(flags).toEqual<DataQualityFlag[]>([
      { kind: "missing_due_date", taskGids: ["task-a"], count: 1 },
    ]);
  });

  it("flags malformed_priority when ANY project on the task has a malformed PriorityField", () => {
    const flags = deriveDataQualityFlags(
      [
        buildTask({
          gid: "task-a",
          projectGids: ["project-1", "project-2"],
        }),
      ],
      [buildPriorityField({ projectGid: "project-2", status: "malformed" })],
    );
    const malformed = flags.find(
      (flag) => flag.kind === "malformed_priority",
    );
    expect(malformed).toBeDefined();
    expect(malformed?.taskGids).toEqual(["task-a"]);
    expect(malformed?.count).toBe(1);
  });

  it("does NOT flag malformed_priority when every project's PriorityField is 'ok' or 'missing'", () => {
    const flags = deriveDataQualityFlags(
      [buildTask({ gid: "task-a", projectGids: ["project-1", "project-2"] })],
      [
        buildPriorityField({ projectGid: "project-1", status: "ok" }),
        buildPriorityField({ projectGid: "project-2", status: "missing" }),
      ],
    );
    expect(flags.find((flag) => flag.kind === "malformed_priority")).toBeUndefined();
  });

  it("excludes milestone / approval tasks (FR-015) from every flag", () => {
    const milestone = buildTask({
      gid: "task-milestone",
      resourceSubtype: "milestone",
      assigneeGid: null,
      estimatedMinutes: null,
      priorityOptionId: null,
      dueAt: null,
      projectGids: ["project-malformed"],
    });
    const approval = buildTask({
      gid: "task-approval",
      resourceSubtype: "approval",
      assigneeGid: null,
      estimatedMinutes: null,
      priorityOptionId: null,
      dueAt: null,
    });
    const flags = deriveDataQualityFlags(
      [milestone, approval],
      [buildPriorityField({ status: "malformed" })],
    );
    expect(flags).toEqual([]);
  });

  it("aggregates multiple tasks with the same flag kind into one DataQualityFlag", () => {
    const flags = deriveDataQualityFlags(
      [
        buildTask({ gid: "task-a", assigneeGid: null }),
        buildTask({ gid: "task-b", assigneeGid: null }),
        buildTask({ gid: "task-c", assigneeGid: null }),
      ],
      [],
    );
    expect(flags).toEqual<DataQualityFlag[]>([
      {
        kind: "missing_assignee",
        taskGids: ["task-a", "task-b", "task-c"],
        count: 3,
      },
    ]);
  });

  it("skips malformed priority fields referenced by no task", () => {
    // The summary is the surface truth — derived from tasks. A
    // standalone PriorityField row that no task belongs to is
    // irrelevant to the per-task flag aggregation.
    const flags = deriveDataQualityFlags(
      [buildTask({ gid: "task-a" })],
      [buildPriorityField({ projectGid: "orphan-project", status: "malformed" })],
    );
    expect(flags.find((flag) => flag.kind === "malformed_priority")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* DataQualitySummary component                                                */
/* -------------------------------------------------------------------------- */

describe("DataQualitySummary", () => {
  it("renders data-quality-empty='true' when no flags are observed", () => {
    render(<DataQualitySummary flags={[]} />);
    const summary = screen.getByTestId("data-quality-summary");
    expect(summary).toHaveAttribute("data-quality-empty", "true");
    expect(summary).toHaveAttribute("role", "status");
    expect(
      screen.getByTestId("data-quality-summary-empty"),
    ).toHaveTextContent(/no data-quality issues observed/i);
  });

  it("renders data-quality-empty='false' and a list when flags are present", () => {
    const flags: DataQualityFlag[] = [
      { kind: "missing_assignee", taskGids: ["a", "b", "c"], count: 3 },
    ];
    render(<DataQualitySummary flags={flags} />);
    const summary = screen.getByTestId("data-quality-summary");
    expect(summary).toHaveAttribute("data-quality-empty", "false");
    expect(summary).toHaveAttribute("role", "alert");
    // Per the S01 contract the per-kind count attrs live on the
    // summary element itself (not on the inner <li>s). Pin both
    // surfaces — the summary attribute and the rendered list item.
    expect(summary).toHaveAttribute(
      "data-quality-flag-missing_assignee",
      "3",
    );
    expect(screen.getByTestId("data-quality-item-missing_assignee"))
      .toBeInTheDocument();
    expect(screen.getByTestId("data-quality-count-missing_assignee"))
      .toHaveTextContent("3");
  });

  it("renders one data-quality-flag-<kind> attribute per flag kind", () => {
    const flags: DataQualityFlag[] = [
      { kind: "missing_assignee", taskGids: ["a"], count: 1 },
      { kind: "missing_estimate", taskGids: ["b"], count: 1 },
      { kind: "malformed_priority", taskGids: ["c", "d"], count: 2 },
    ];
    render(<DataQualitySummary flags={flags} />);
    const summary = screen.getByTestId("data-quality-summary");
    expect(summary).toHaveAttribute(
      "data-quality-flag-missing_assignee",
      "1",
    );
    expect(summary).toHaveAttribute(
      "data-quality-flag-missing_estimate",
      "1",
    );
    expect(summary).toHaveAttribute(
      "data-quality-flag-malformed_priority",
      "2",
    );
    // `data-quality-summary-list` is the rendered <ul> for the
    // drill-down; pins the non-empty path independently of copy.
    expect(screen.getByTestId("data-quality-summary-list")).toBeInTheDocument();
  });

  it("accepts a custom attributePrefix for tests that strip it", () => {
    const flags: DataQualityFlag[] = [
      { kind: "missing_priority", taskGids: ["a"], count: 1 },
    ];
    render(
      <DataQualitySummary flags={flags} attributePrefix="dq-" />,
    );
    expect(screen.getByTestId("data-quality-summary")).toHaveAttribute(
      "dq-missing_priority",
      "1",
    );
  });
});
