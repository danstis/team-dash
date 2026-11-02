import { describe, expect, it } from "vitest";
import type { Project, Task } from "../../../../src/data/db/schema";
import type { ISODateTime } from "../../../../src/domain/types";
import {
  buildGroupLabels,
  deriveDataQualityFlags,
  deriveTeamMapping,
  toMetricTasks,
} from "../../../../src/features/dashboard/dashboard-derivations";

const NOW = "2026-11-01T00:00:00.000Z" as ISODateTime;

function project(gid: string, overrides: Partial<Project> = {}): Project {
  return {
    gid,
    name: gid,
    workspaceGid: "ws",
    asanaTeamGid: "team-default",
    portfolioGids: [],
    archived: false,
    ...overrides,
  };
}

function task(gid: string, overrides: Partial<Task> = {}): Task {
  return {
    gid,
    name: gid,
    assigneeGid: null,
    projectGids: ["p1"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: NOW,
    modifiedAt: NOW,
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: NOW,
    outOfScopeReason: null,
    ...overrides,
  };
}

describe("dashboard cache derivations", () => {
  it("derives default teams, lets overrides supply a missing Asana team, and skips unmapped projects", () => {
    const projects = [
      project("p1"),
      project("p2", { asanaTeamGid: "team-two" }),
      project("p3", { asanaTeamGid: null }),
      project("p4", { asanaTeamGid: null }),
    ];
    const overrides = [
      {
        projectGid: "p2",
        reportingTeamGid: "team-override",
        updatedAt: "2026-10-01T00:00:00.000Z" as ISODateTime,
      },
      {
        projectGid: "p3",
        reportingTeamGid: "team-manual",
        updatedAt: "2026-10-02T00:00:00.000Z" as ISODateTime,
      },
    ];
    expect(deriveTeamMapping(projects, overrides, NOW)).toEqual([
      { projectGid: "p1", reportingTeamGid: "team-default", updatedAt: NOW },
      {
        projectGid: "p2",
        reportingTeamGid: "team-override",
        updatedAt: overrides[0]?.updatedAt,
      },
      {
        projectGid: "p3",
        reportingTeamGid: "team-manual",
        updatedAt: overrides[1]?.updatedAt,
      },
    ]);
  });

  it("maps cached tasks into metric rows with deduplicated portfolio memberships", () => {
    const row = task("t1", {
      projectGids: ["p1", "p2", "missing"],
      dueAt: NOW,
      completedAt: NOW,
      estimatedMinutes: 90,
    });
    const [result] = toMetricTasks(
      [row],
      [
        project("p1", { portfolioGids: ["portfolio-a", "portfolio-b"] }),
        project("p2", { portfolioGids: ["portfolio-a"] }),
      ],
    );
    expect(result).toMatchObject({
      gid: "t1",
      dueAt: NOW,
      completedAt: NOW,
      estimatedMinutes: 90,
      portfolioGids: ["portfolio-a", "portfolio-b"],
    });
    expect(toMetricTasks([task("t2")], [])).toMatchObject([
      { gid: "t2", dueAt: null, completedAt: null, portfolioGids: [] },
    ]);
  });

  it("labels each supported chart grouping from its corresponding lookup", () => {
    const users = [
      { gid: "u1", name: "Alice", email: "a@example.test", workspaceGid: "ws" },
    ];
    const projects = [project("p1", { name: "Apollo" })];
    const portfolios = [
      {
        gid: "portfolio",
        name: "Portfolio",
        workspaceGid: "ws",
        projectGids: ["p1"],
      },
    ];
    const teams = [{ gid: "team", name: "Team", workspaceGid: "ws" }];
    expect(
      buildGroupLabels("assignee", users, projects, portfolios, teams),
    ).toEqual({ u1: "Alice" });
    expect(
      buildGroupLabels("project", users, projects, portfolios, teams),
    ).toEqual({ p1: "Apollo" });
    expect(
      buildGroupLabels("portfolio", users, projects, portfolios, teams),
    ).toEqual({ portfolio: "Portfolio" });
    expect(
      buildGroupLabels("reportingTeam", users, projects, portfolios, teams),
    ).toEqual({ team: "Team" });
    expect(
      buildGroupLabels("priority", users, projects, portfolios, teams),
    ).toEqual({});
    expect(
      buildGroupLabels(undefined, users, projects, portfolios, teams),
    ).toEqual({});
  });

  it("reports task gids and counts for the three cached data gaps", () => {
    expect(
      deriveDataQualityFlags([
        task("all-missing"),
        task("complete", {
          assigneeGid: "u1",
          estimatedMinutes: 60,
          priorityOptionId: "high",
        }),
        task("missing-estimate", {
          assigneeGid: "u1",
          priorityOptionId: "high",
        }),
      ]),
    ).toEqual([
      { kind: "missing_assignee", taskGids: ["all-missing"], count: 1 },
      {
        kind: "missing_estimate",
        taskGids: ["all-missing", "missing-estimate"],
        count: 2,
      },
      { kind: "missing_priority", taskGids: ["all-missing"], count: 1 },
    ]);
  });
});
