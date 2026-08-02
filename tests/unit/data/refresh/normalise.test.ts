/**
 * `src/data/refresh/normalise` unit tests.
 *
 * Pins the wire-to-cache normalisation layer (the FR-014 / FR-081 /
 * FR-082 boundary per decision D001). The tests are pure-function
 * tests; no Dexie, no MSW, no fetches. Each test exercises one
 * documented behaviour of a single normaliser or helper so a future
 * contributor who breaks the inheritance rule, the priority
 * extraction, or any per-resource normaliser sees a targeted
 * failure pointing at the broken function.
 *
 * Coverage:
 *
 * - `normaliseProject` — workspace/team flattening, archived pass-through.
 * - `normaliseUser` — email nullable handling, workspaceGid from caller.
 * - `normaliseAsanaTeam` (via `deriveAsanaTeams`) — dedupe by gid,
 *   workspaceGid injection, null team exclusion.
 * - `normalisePortfolio` — anchor fields only (projectGids empty).
 * - `normaliseSection` — caller-supplied projectGid.
 * - `normaliseWorkspace` — selectedAt pass-through.
 * - `extractEstimatedMinutes` — present, absent, no value, no field.
 * - `extractPriorityOptionId` — present, absent, enum_value null,
 *   field name strictness.
 * - `normaliseTask` — per-field mapping, defaults for missing wire
 *   references.
 * - `applySubtaskProjectInheritance` — FR-014 inheritance rule:
 *   subtasks inherit parent's projects when their own is empty;
 *   subtasks with their own projects keep their own; orphan subtasks
 *   stay empty.
 * - `buildPriorityField` — FR-081/082: missing (no Priority field
 *   across tasks), malformed (mixed), ok (consistent presence).
 * - `buildDependencyEdges` — per-edge cache row, accessibility flag
 *   from in-scope set.
 */
import { describe, expect, it } from "vitest";

import type {
  AsanaTeam,
  Project,
  Task,
  User,
} from "../../../../src/data/db/schema";
import {
  applySubtaskProjectInheritance,
  buildDependencyEdges,
  buildPriorityField,
  deriveAsanaTeams,
  extractEstimatedMinutes,
  extractPriorityOptionId,
  ESTIMATED_MINUTES_CUSTOM_FIELD_NAME,
  normalisePortfolio,
  normaliseProject,
  normaliseSection,
  normaliseTask,
  normaliseUser,
  normaliseWorkspace,
  PRIORITY_CUSTOM_FIELD_NAME,
} from "../../../../src/data/refresh/normalise";
import type {
  asanaCustomFieldSchema,
  asanaPortfolioSchema,
  asanaProjectSchema,
  asanaSectionSchema,
  asanaTaskSchema,
  asanaUserSchema,
  asanaWorkspaceSchema,
} from "../../../../src/data/asana/schemas";
import type { z } from "zod";

type WireProject = z.infer<typeof asanaProjectSchema>;
type WireTask = z.infer<typeof asanaTaskSchema>;
type WireUser = z.infer<typeof asanaUserSchema>;
type WireSection = z.infer<typeof asanaSectionSchema>;
type WirePortfolio = z.infer<typeof asanaPortfolioSchema>;
type WireCustomField = z.infer<typeof asanaCustomFieldSchema>;
type WireWorkspace = z.infer<typeof asanaWorkspaceSchema>;

/* -------------------------------------------------------------------------- */
/* Wire-shape fixtures                                                        */
/* -------------------------------------------------------------------------- */

function makeWireProject(
  overrides: Partial<WireProject> = {},
): WireProject {
  return {
    gid: "project-1",
    name: "Project 1",
    resource_type: "project",
    archived: false,
    ...overrides,
  };
}

function makeWireTask(
  overrides: Partial<WireTask> = {},
): WireTask {
  return {
    gid: "task-1",
    name: "Task 1",
    resource_type: "task",
    resource_subtype: "default_task",
    created_at: "2026-07-01T09:00:00.000Z",
    modified_at: "2026-07-15T09:00:00.000Z",
    ...overrides,
  };
}

function makeWireUser(
  overrides: Partial<WireUser> = {},
): WireUser {
  return {
    gid: "user-1",
    name: "Alex Kim",
    resource_type: "user",
    ...overrides,
  };
}

function makeWireSection(
  overrides: Partial<WireSection> = {},
): WireSection {
  return {
    gid: "section-1",
    name: "Section 1",
    resource_type: "section",
    ...overrides,
  };
}

function makeWirePortfolio(
  overrides: Partial<WirePortfolio> = {},
): WirePortfolio {
  return {
    gid: "portfolio-1",
    name: "Portfolio 1",
    resource_type: "portfolio",
    ...overrides,
  };
}

function makeWireWorkspace(
  overrides: Partial<WireWorkspace> = {},
): WireWorkspace {
  return {
    gid: "workspace-1",
    name: "Workspace 1",
    resource_type: "workspace",
    ...overrides,
  };
}

function makeWireCustomField(
  overrides: Partial<WireCustomField>,
): WireCustomField {
  return {
    gid: "cf-1",
    name: "Priority",
    type: "enum",
    ...overrides,
  };
}

function makeTaskRow(
  overrides: Partial<Task> = {},
): Task {
  return {
    gid: "task-1",
    name: "Task 1",
    assigneeGid: null,
    projectGids: [],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-01T09:00:00.000Z",
    modifiedAt: "2026-07-15T09:00:00.000Z",
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
    outOfScopeReason: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* normaliseProject                                                           */
/* -------------------------------------------------------------------------- */

describe("normaliseProject", () => {
  it("flattens workspace/team references into scalar fields", () => {
    const project = normaliseProject(
      makeWireProject({
        gid: "p-1",
        name: "Project",
        workspace: { gid: "w-1", name: "Workspace" },
        team: { gid: "t-1", name: "Team" },
        archived: false,
      }),
    );

    expect(project).toEqual<Project>({
      gid: "p-1",
      name: "Project",
      workspaceGid: "w-1",
      asanaTeamGid: "t-1",
      portfolioGids: [],
      archived: false,
    });
  });

  it("uses empty string workspaceGid when the reference is missing", () => {
    const project = normaliseProject(
      makeWireProject({
        gid: "p-2",
        workspace: undefined,
        team: null,
      }),
    );
    expect(project.workspaceGid).toBe("");
    expect(project.asanaTeamGid).toBeNull();
  });

  it("preserves archived=true verbatim", () => {
    const project = normaliseProject(
      makeWireProject({ archived: true }),
    );
    expect(project.archived).toBe(true);
  });

  it("leaves portfolioGids empty (T02 owns portfolio→project edges)", () => {
    const project = normaliseProject(makeWireProject({}));
    expect(project.portfolioGids).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* normaliseUser                                                              */
/* -------------------------------------------------------------------------- */

describe("normaliseUser", () => {
  it("maps a fully-populated user", () => {
    const user = normaliseUser(
      makeWireUser({ gid: "u-1", name: "Alex Kim", email: "alex@example.com" }),
      "workspace-1",
    );
    expect(user).toEqual<User>({
      gid: "u-1",
      name: "Alex Kim",
      email: "alex@example.com",
      workspaceGid: "workspace-1",
    });
  });

  it("coerces missing email to null (tracked, missing vs tracked, empty)", () => {
    const user = normaliseUser(
      makeWireUser({ email: undefined }),
      "workspace-1",
    );
    expect(user.email).toBeNull();
  });

  it("preserves an explicit null email verbatim", () => {
    const user = normaliseUser(
      makeWireUser({ email: null }),
      "workspace-1",
    );
    expect(user.email).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* deriveAsanaTeams                                                           */
/* -------------------------------------------------------------------------- */

describe("deriveAsanaTeams", () => {
  const workspaceGid = "workspace-1";

  function makeProject(
    overrides: Partial<Project> = {},
  ): Project {
    return {
      gid: "p",
      name: "Project",
      workspaceGid,
      asanaTeamGid: null,
      portfolioGids: [],
      archived: false,
      ...overrides,
    };
  }

  it("returns one AsanaTeam row per unique non-null asanaTeamGid", () => {
    const teams = deriveAsanaTeams(
      [
        makeProject({ gid: "p-1", asanaTeamGid: "team-a" }),
        makeProject({ gid: "p-2", asanaTeamGid: "team-a" }),
        makeProject({ gid: "p-3", asanaTeamGid: "team-b" }),
      ],
      workspaceGid,
    );

    expect(teams).toEqual<AsanaTeam[]>([
      { gid: "team-a", name: "", workspaceGid },
      { gid: "team-b", name: "", workspaceGid },
    ]);
  });

  it("excludes projects with a null asanaTeamGid (no Asana team fallback)", () => {
    const teams = deriveAsanaTeams(
      [
        makeProject({ gid: "p-1", asanaTeamGid: null }),
        makeProject({ gid: "p-2", asanaTeamGid: "team-a" }),
      ],
      workspaceGid,
    );
    expect(teams).toHaveLength(1);
    expect(teams[0]?.gid).toBe("team-a");
  });

  it("returns an empty array when every project has no team", () => {
    expect(
      deriveAsanaTeams(
        [makeProject({ asanaTeamGid: null })],
        workspaceGid,
      ),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* normalisePortfolio                                                         */
/* -------------------------------------------------------------------------- */

describe("normalisePortfolio", () => {
  it("maps name and workspaceGid, leaves projectGids empty", () => {
    const portfolio = normalisePortfolio(
      makeWirePortfolio({ gid: "port-1", name: "Q3" }),
      "workspace-1",
    );
    expect(portfolio).toEqual({
      gid: "port-1",
      name: "Q3",
      workspaceGid: "workspace-1",
      projectGids: [],
    });
  });
});

/* -------------------------------------------------------------------------- */
/* normaliseSection                                                           */
/* -------------------------------------------------------------------------- */

describe("normaliseSection", () => {
  it("uses caller-supplied projectGid", () => {
    const section = normaliseSection(
      makeWireSection({ gid: "s-1", name: "Backlog" }),
      "project-1",
    );
    expect(section).toEqual({
      gid: "s-1",
      projectGid: "project-1",
      name: "Backlog",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* normaliseWorkspace                                                         */
/* -------------------------------------------------------------------------- */

describe("normaliseWorkspace", () => {
  it("passes the selectedAt anchor through verbatim", () => {
    const ws = normaliseWorkspace(
      makeWireWorkspace({ gid: "w-1", name: "Workspace" }),
      "2026-08-01T00:00:00.000Z",
    );
    expect(ws).toEqual({
      gid: "w-1",
      name: "Workspace",
      selectedAt: "2026-08-01T00:00:00.000Z",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Custom-field extractors                                                    */
/* -------------------------------------------------------------------------- */

describe("extractEstimatedMinutes", () => {
  it("returns null when custom_fields is undefined", () => {
    expect(extractEstimatedMinutes(undefined)).toBeNull();
  });

  it("returns the number_value when the Estimated Time field is present", () => {
    expect(
      extractEstimatedMinutes([
        makeWireCustomField({
          name: ESTIMATED_MINUTES_CUSTOM_FIELD_NAME,
          number_value: 90,
        }),
      ]),
    ).toBe(90);
  });

  it("returns null when the field is present but number_value is null", () => {
    expect(
      extractEstimatedMinutes([
        makeWireCustomField({
          name: ESTIMATED_MINUTES_CUSTOM_FIELD_NAME,
          number_value: null,
        }),
      ]),
    ).toBeNull();
  });

  it("returns null when no Estimated Time field exists", () => {
    expect(
      extractEstimatedMinutes([
        makeWireCustomField({ name: "Priority", number_value: 5 }),
      ]),
    ).toBeNull();
  });

  it("ignores other number-typed custom fields", () => {
    expect(
      extractEstimatedMinutes([
        makeWireCustomField({ name: "Story Points", number_value: 8 }),
      ]),
    ).toBeNull();
  });
});

describe("extractPriorityOptionId", () => {
  it("returns null when custom_fields is undefined", () => {
    expect(extractPriorityOptionId(undefined)).toBeNull();
  });

  it("returns the enum_value.gid when the Priority field is present", () => {
    expect(
      extractPriorityOptionId([
        makeWireCustomField({
          name: PRIORITY_CUSTOM_FIELD_NAME,
          enum_value: { gid: "high-priority" },
        }),
      ]),
    ).toBe("high-priority");
  });

  it("returns null when the Priority field's enum_value is null", () => {
    expect(
      extractPriorityOptionId([
        makeWireCustomField({
          name: PRIORITY_CUSTOM_FIELD_NAME,
          enum_value: null,
        }),
      ]),
    ).toBeNull();
  });

  it("returns null when the Priority field has no enum_value key", () => {
    expect(
      extractPriorityOptionId([
        makeWireCustomField({
          name: PRIORITY_CUSTOM_FIELD_NAME,
        }),
      ]),
    ).toBeNull();
  });

  it("returns null when the Priority field's enum_value.gid is empty", () => {
    expect(
      extractPriorityOptionId([
        makeWireCustomField({
          name: PRIORITY_CUSTOM_FIELD_NAME,
          enum_value: { gid: "" },
        }),
      ]),
    ).toBeNull();
  });

  it("ignores other enum-typed custom fields", () => {
    expect(
      extractPriorityOptionId([
        makeWireCustomField({
          name: "Severity",
          enum_value: { gid: "sev-high" },
        }),
      ]),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* normaliseTask                                                              */
/* -------------------------------------------------------------------------- */

describe("normaliseTask", () => {
  const lastSeenAt = "2026-07-31T09:00:00.000Z";

  it("maps a fully-populated task", () => {
    const wire = makeWireTask({
      gid: "t-1",
      name: "Task",
      assignee: { gid: "u-1", name: "Alex" },
      parent: { gid: "parent-1", name: "Parent" },
      projects: [
        { gid: "p-1", name: "Project 1" },
        { gid: "p-2", name: "Project 2" },
      ],
      completed_at: "2026-07-15T09:00:00.000Z",
      due_at: "2026-08-01T17:00:00.000Z",
      custom_fields: [
        makeWireCustomField({
          name: PRIORITY_CUSTOM_FIELD_NAME,
          enum_value: { gid: "high" },
        }),
        makeWireCustomField({
          name: ESTIMATED_MINUTES_CUSTOM_FIELD_NAME,
          number_value: 60,
        }),
      ],
      dependencies: [{ gid: "dep-1" }, { gid: "dep-2" }],
    });

    const task = normaliseTask(wire, { lastSeenAt });

    expect(task).toEqual<Task>({
      gid: "t-1",
      name: "Task",
      assigneeGid: "u-1",
      projectGids: ["p-1", "p-2"],
      parentTaskGid: "parent-1",
      resourceSubtype: "default_task",
      createdAt: "2026-07-01T09:00:00.000Z",
      modifiedAt: "2026-07-15T09:00:00.000Z",
      completedAt: "2026-07-15T09:00:00.000Z",
      dueAt: "2026-08-01T17:00:00.000Z",
      priorityOptionId: "high",
      estimatedMinutes: 60,
      actualMinutes: null,
      dependsOnTaskGids: ["dep-1", "dep-2"],
      lastSeenInScopeAt: lastSeenAt,
      outOfScopeReason: null,
    });
  });

  it("coerces missing references to null", () => {
    const task = normaliseTask(makeWireTask({}), { lastSeenAt });
    expect(task.assigneeGid).toBeNull();
    expect(task.parentTaskGid).toBeNull();
    expect(task.completedAt).toBeNull();
    expect(task.dueAt).toBeNull();
    expect(task.priorityOptionId).toBeNull();
    expect(task.estimatedMinutes).toBeNull();
    expect(task.actualMinutes).toBeNull();
    expect(task.projectGids).toEqual([]);
    expect(task.dependsOnTaskGids).toEqual([]);
  });

  it("preserves the explicit parent gid for subtasks (FR-014 inheritance is a separate pass)", () => {
    const task = normaliseTask(
      makeWireTask({
        parent: { gid: "parent-1" },
        projects: [],
      }),
      { lastSeenAt },
    );
    expect(task.parentTaskGid).toBe("parent-1");
    expect(task.projectGids).toEqual([]);
  });

  it("passes through milestones and approvals (exclusion is the getInScopeTasks predicate)", () => {
    const milestone = normaliseTask(
      makeWireTask({ resource_subtype: "milestone" }),
      { lastSeenAt },
    );
    expect(milestone.resourceSubtype).toBe("milestone");
    const approval = normaliseTask(
      makeWireTask({ resource_subtype: "approval" }),
      { lastSeenAt },
    );
    expect(approval.resourceSubtype).toBe("approval");
  });

  it("stamps lastSeenInScopeAt from the supplied context on every task", () => {
    const task = normaliseTask(makeWireTask({}), {
      lastSeenAt: "2026-08-02T00:00:00.000Z",
    });
    expect(task.lastSeenInScopeAt).toBe("2026-08-02T00:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------- */
/* applySubtaskProjectInheritance (FR-014)                                    */
/* -------------------------------------------------------------------------- */

describe("applySubtaskProjectInheritance", () => {
  it("inherits parent projects when subtask's projectGids is empty", () => {
    const parent = makeTaskRow({
      gid: "parent-1",
      parentTaskGid: null,
      projectGids: ["p-1", "p-2"],
    });
    const subtask = makeTaskRow({
      gid: "subtask-1",
      parentTaskGid: "parent-1",
      projectGids: [],
    });

    const result = applySubtaskProjectInheritance([parent, subtask]);
    expect(result.find((t) => t.gid === "subtask-1")?.projectGids).toEqual([
      "p-1",
      "p-2",
    ]);
  });

  it("uses the subtask's own projects when present (FR-014 inheritance is opt-out)", () => {
    const parent = makeTaskRow({
      gid: "parent-1",
      parentTaskGid: null,
      projectGids: ["p-1"],
    });
    const subtask = makeTaskRow({
      gid: "subtask-1",
      parentTaskGid: "parent-1",
      projectGids: ["p-2"],
    });

    const result = applySubtaskProjectInheritance([parent, subtask]);
    expect(result.find((t) => t.gid === "subtask-1")?.projectGids).toEqual([
      "p-2",
    ]);
  });

  it("leaves an orphan subtask's projectGids empty (parent not found)", () => {
    const subtask = makeTaskRow({
      gid: "subtask-1",
      parentTaskGid: "missing-parent",
      projectGids: [],
    });
    const result = applySubtaskProjectInheritance([subtask]);
    expect(result[0]?.projectGids).toEqual([]);
  });

  it("does not treat subtasks themselves as parents (resolves against the top-most parent)", () => {
    const grandParent = makeTaskRow({
      gid: "grandparent-1",
      parentTaskGid: null,
      projectGids: ["p-1"],
    });
    const middle = makeTaskRow({
      gid: "middle-1",
      parentTaskGid: "grandparent-1",
      projectGids: ["p-2"],
    });
    const leaf = makeTaskRow({
      gid: "leaf-1",
      parentTaskGid: "middle-1",
      projectGids: [],
    });

    const result = applySubtaskProjectInheritance([
      grandParent,
      middle,
      leaf,
    ]);
    // The leaf's parent is `middle-1`, which has projectGids ["p-2"];
    // inheritance resolves to `middle-1`'s projects (the immediate
    // parent), not the grandparent's.
    expect(result.find((t) => t.gid === "leaf-1")?.projectGids).toEqual([
      "p-2",
    ]);
  });

  it("does not mutate rows that are not subtasks with empty projectGids", () => {
    const task = makeTaskRow({ gid: "task-1", projectGids: ["p-1"] });
    const result = applySubtaskProjectInheritance([task]);
    expect(result[0]).toBe(task);
  });
});

/* -------------------------------------------------------------------------- */
/* buildPriorityField (FR-081 / FR-082)                                       */
/* -------------------------------------------------------------------------- */

describe("buildPriorityField", () => {
  it("returns status=missing when no task carries a priority", () => {
    expect(
      buildPriorityField("p-1", [
        makeTaskRow({ gid: "t-1", priorityOptionId: null }),
        makeTaskRow({ gid: "t-2", priorityOptionId: null }),
      ]),
    ).toEqual({
      projectGid: "p-1",
      expectedOptionIds: null,
      status: "missing",
    });
  });

  it("returns status=ok when every task has a priority and the options are consistent", () => {
    expect(
      buildPriorityField("p-1", [
        makeTaskRow({ gid: "t-1", priorityOptionId: "high" }),
        makeTaskRow({ gid: "t-2", priorityOptionId: "low" }),
      ]),
    ).toEqual({
      projectGid: "p-1",
      expectedOptionIds: ["high", "low"],
      status: "ok",
    });
  });

  it("returns status=malformed when some tasks have priority and others do not", () => {
    expect(
      buildPriorityField("p-1", [
        makeTaskRow({ gid: "t-1", priorityOptionId: "high" }),
        makeTaskRow({ gid: "t-2", priorityOptionId: null }),
      ]),
    ).toEqual({
      projectGid: "p-1",
      expectedOptionIds: ["high"],
      status: "malformed",
    });
  });

  it("dedupes the observed option ids into the expectedOptionIds list", () => {
    expect(
      buildPriorityField("p-1", [
        makeTaskRow({ gid: "t-1", priorityOptionId: "high" }),
        makeTaskRow({ gid: "t-2", priorityOptionId: "high" }),
        makeTaskRow({ gid: "t-3", priorityOptionId: "low" }),
      ]).expectedOptionIds,
    ).toEqual(["high", "low"]);
  });

  it("returns status=missing for an empty task collection", () => {
    expect(buildPriorityField("p-1", [])).toEqual({
      projectGid: "p-1",
      expectedOptionIds: null,
      status: "missing",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* buildDependencyEdges                                                       */
/* -------------------------------------------------------------------------- */

describe("buildDependencyEdges", () => {
  const wire = makeWireTask({
    gid: "task-1",
    dependencies: [
      { gid: "dep-1" },
      { gid: "dep-2" },
      { gid: "dep-3" },
    ],
  });

  it("creates one cache row per dependency reference", () => {
    const edges = buildDependencyEdges(wire, new Set());
    expect(edges).toEqual([
      {
        taskGid: "task-1",
        dependsOnTaskGid: "dep-1",
        dependsOnTaskAccessible: false,
      },
      {
        taskGid: "task-1",
        dependsOnTaskGid: "dep-2",
        dependsOnTaskAccessible: false,
      },
      {
        taskGid: "task-1",
        dependsOnTaskGid: "dep-3",
        dependsOnTaskAccessible: false,
      },
    ]);
  });

  it("marks dependencies as accessible when the depended-on task is in the in-scope set", () => {
    const edges = buildDependencyEdges(wire, new Set(["dep-1", "dep-3"]));
    expect(edges.find((e) => e.dependsOnTaskGid === "dep-1")?.dependsOnTaskAccessible).toBe(true);
    expect(edges.find((e) => e.dependsOnTaskGid === "dep-2")?.dependsOnTaskAccessible).toBe(false);
    expect(edges.find((e) => e.dependsOnTaskGid === "dep-3")?.dependsOnTaskAccessible).toBe(true);
  });

  it("returns an empty array when the wire task has no dependencies", () => {
    expect(buildDependencyEdges(makeWireTask({}), new Set())).toEqual([]);
  });

  it("returns an empty array when the wire task's dependencies field is undefined", () => {
    const wireWithoutDependencies = makeWireTask({ dependencies: undefined });
    expect(buildDependencyEdges(wireWithoutDependencies, new Set())).toEqual(
      [],
    );
  });
});
