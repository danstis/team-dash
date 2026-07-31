import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheRepository } from "../../src/data/db/repositories/cache.repository";
import { TeamDashDatabase, db } from "../../src/data/db/schema";
import type {
  AsanaTeam,
  Dependency,
  Portfolio,
  PriorityField,
  Project,
  Section,
  Task,
  User,
  Workspace,
} from "../../src/data/db/schema";

const WORKSPACE_GID = "ws-1";
const OTHER_WORKSPACE_GID = "ws-2";
const ACTIVE_PROJECT_GID = "proj-active";
const SECOND_ACTIVE_PROJECT_GID = "proj-active-2";
const ARCHIVED_PROJECT_GID = "proj-archived";
const OTHER_WORKSPACE_PROJECT_GID = "proj-other-workspace";

function makeWorkspace(
  overrides: Partial<Workspace> & Pick<Workspace, "gid">,
): Workspace {
  return {
    name: "Workspace",
    selectedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<Project> & Pick<Project, "gid">,
): Project {
  return {
    name: "Project",
    workspaceGid: WORKSPACE_GID,
    asanaTeamGid: "team-1",
    portfolioGids: [],
    archived: false,
    ...overrides,
  };
}

function makePortfolio(
  overrides: Partial<Portfolio> & Pick<Portfolio, "gid">,
): Portfolio {
  return {
    name: "Portfolio",
    workspaceGid: WORKSPACE_GID,
    projectGids: [ACTIVE_PROJECT_GID],
    ...overrides,
  };
}

function makeAsanaTeam(
  overrides: Partial<AsanaTeam> & Pick<AsanaTeam, "gid">,
): AsanaTeam {
  return {
    name: "Team",
    workspaceGid: WORKSPACE_GID,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> & Pick<User, "gid">): User {
  return {
    name: "User",
    email: "user@example.com",
    workspaceGid: WORKSPACE_GID,
    ...overrides,
  };
}

function makePriorityField(
  overrides: Partial<PriorityField> & Pick<PriorityField, "projectGid">,
): PriorityField {
  return {
    expectedOptionIds: ["p1"],
    status: "ok",
    ...overrides,
  };
}

function makeDependency(
  overrides: Partial<Dependency> &
    Pick<Dependency, "taskGid" | "dependsOnTaskGid">,
): Dependency {
  return {
    dependsOnTaskAccessible: true,
    ...overrides,
  };
}

function makeSection(
  overrides: Partial<Section> & Pick<Section, "gid">,
): Section {
  return {
    projectGid: ACTIVE_PROJECT_GID,
    name: "Section",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> & Pick<Task, "gid">): Task {
  return {
    name: "Task",
    assigneeGid: null,
    projectGids: [ACTIVE_PROJECT_GID],
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

async function clearCacheStores(): Promise<void> {
  await db.workspaces.clear();
  await db.projects.clear();
  await db.portfolios.clear();
  await db.asanaTeams.clear();
  await db.users.clear();
  await db.priorityFields.clear();
  await db.dependencies.clear();
  await db.sections.clear();
  await db.tasks.clear();
}

async function seedInScopeProjects(): Promise<void> {
  await cacheRepository.upsertProjects([
    makeProject({ gid: ACTIVE_PROJECT_GID }),
    makeProject({ gid: SECOND_ACTIVE_PROJECT_GID }),
    makeProject({ gid: ARCHIVED_PROJECT_GID, archived: true }),
    makeProject({
      gid: OTHER_WORKSPACE_PROJECT_GID,
      workspaceGid: OTHER_WORKSPACE_GID,
    }),
  ]);
}

describe("T055 CacheRepository (contracts/storage-repository.md)", () => {
  beforeEach(async () => {
    await clearCacheStores();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearCacheStores();
  });

  describe("upsert cache entities by key without clearing unrelated rows", () => {
    it("replaces the same-key row and preserves unrelated workspace rows", async () => {
      await cacheRepository.upsertWorkspaces([
        makeWorkspace({ gid: WORKSPACE_GID, name: "Workspace before" }),
        makeWorkspace({ gid: OTHER_WORKSPACE_GID, name: "Other workspace" }),
      ]);

      await cacheRepository.upsertWorkspaces([
        makeWorkspace({ gid: WORKSPACE_GID, name: "Workspace after" }),
      ]);

      await expect(db.workspaces.orderBy("gid").toArray()).resolves.toEqual([
        makeWorkspace({ gid: WORKSPACE_GID, name: "Workspace after" }),
        makeWorkspace({ gid: OTHER_WORKSPACE_GID, name: "Other workspace" }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated project rows", async () => {
      await cacheRepository.upsertProjects([
        makeProject({ gid: ACTIVE_PROJECT_GID, name: "Project before" }),
        makeProject({
          gid: SECOND_ACTIVE_PROJECT_GID,
          name: "Other project",
          asanaTeamGid: "team-2",
        }),
      ]);

      await cacheRepository.upsertProjects([
        makeProject({
          gid: ACTIVE_PROJECT_GID,
          name: "Project after",
          archived: true,
        }),
      ]);

      await expect(db.projects.orderBy("gid").toArray()).resolves.toEqual([
        makeProject({
          gid: ACTIVE_PROJECT_GID,
          name: "Project after",
          archived: true,
        }),
        makeProject({
          gid: SECOND_ACTIVE_PROJECT_GID,
          name: "Other project",
          asanaTeamGid: "team-2",
        }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated portfolio rows", async () => {
      await cacheRepository.upsertPortfolios([
        makePortfolio({ gid: "portfolio-1", name: "Portfolio before" }),
        makePortfolio({ gid: "portfolio-2", name: "Other portfolio" }),
      ]);

      await cacheRepository.upsertPortfolios([
        makePortfolio({
          gid: "portfolio-1",
          name: "Portfolio after",
          projectGids: [SECOND_ACTIVE_PROJECT_GID],
        }),
      ]);

      await expect(db.portfolios.orderBy("gid").toArray()).resolves.toEqual([
        makePortfolio({
          gid: "portfolio-1",
          name: "Portfolio after",
          projectGids: [SECOND_ACTIVE_PROJECT_GID],
        }),
        makePortfolio({ gid: "portfolio-2", name: "Other portfolio" }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated Asana team rows", async () => {
      await cacheRepository.upsertAsanaTeams([
        makeAsanaTeam({ gid: "team-1", name: "Team before" }),
        makeAsanaTeam({ gid: "team-2", name: "Other team" }),
      ]);

      await cacheRepository.upsertAsanaTeams([
        makeAsanaTeam({ gid: "team-1", name: "Team after" }),
      ]);

      await expect(db.asanaTeams.orderBy("gid").toArray()).resolves.toEqual([
        makeAsanaTeam({ gid: "team-1", name: "Team after" }),
        makeAsanaTeam({ gid: "team-2", name: "Other team" }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated user rows", async () => {
      await cacheRepository.upsertUsers([
        makeUser({ gid: "user-1", name: "User before" }),
        makeUser({ gid: "user-2", name: "Other user" }),
      ]);

      await cacheRepository.upsertUsers([
        makeUser({
          gid: "user-1",
          name: "User after",
          email: "updated@example.com",
        }),
      ]);

      await expect(db.users.orderBy("gid").toArray()).resolves.toEqual([
        makeUser({
          gid: "user-1",
          name: "User after",
          email: "updated@example.com",
        }),
        makeUser({ gid: "user-2", name: "Other user" }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated priority field rows", async () => {
      await cacheRepository.upsertPriorityFields([
        makePriorityField({
          projectGid: ACTIVE_PROJECT_GID,
          expectedOptionIds: ["p0"],
        }),
        makePriorityField({
          projectGid: SECOND_ACTIVE_PROJECT_GID,
          expectedOptionIds: ["p9"],
        }),
      ]);

      await cacheRepository.upsertPriorityFields([
        makePriorityField({
          projectGid: ACTIVE_PROJECT_GID,
          expectedOptionIds: ["p1", "p2"],
          status: "missing",
        }),
      ]);

      await expect(db.priorityFields.orderBy("projectGid").toArray()).resolves.toEqual([
        makePriorityField({
          projectGid: ACTIVE_PROJECT_GID,
          expectedOptionIds: ["p1", "p2"],
          status: "missing",
        }),
        makePriorityField({
          projectGid: SECOND_ACTIVE_PROJECT_GID,
          expectedOptionIds: ["p9"],
        }),
      ]);
    });

    it("replaces the same compound-key dependency row and preserves unrelated dependencies", async () => {
      await cacheRepository.upsertDependencies([
        makeDependency({
          taskGid: "task-1",
          dependsOnTaskGid: "task-2",
          dependsOnTaskAccessible: false,
        }),
        makeDependency({
          taskGid: "task-3",
          dependsOnTaskGid: "task-4",
        }),
      ]);

      await cacheRepository.upsertDependencies([
        makeDependency({
          taskGid: "task-1",
          dependsOnTaskGid: "task-2",
          dependsOnTaskAccessible: true,
        }),
      ]);

      await expect(
        db.dependencies
          .orderBy("[taskGid+dependsOnTaskGid]")
          .toArray(),
      ).resolves.toEqual([
        makeDependency({
          taskGid: "task-1",
          dependsOnTaskGid: "task-2",
          dependsOnTaskAccessible: true,
        }),
        makeDependency({
          taskGid: "task-3",
          dependsOnTaskGid: "task-4",
        }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated section rows", async () => {
      await cacheRepository.upsertSections([
        makeSection({ gid: "section-1", name: "Section before" }),
        makeSection({ gid: "section-2", name: "Other section" }),
      ]);

      await cacheRepository.upsertSections([
        makeSection({
          gid: "section-1",
          name: "Section after",
          projectGid: SECOND_ACTIVE_PROJECT_GID,
        }),
      ]);

      await expect(db.sections.orderBy("gid").toArray()).resolves.toEqual([
        makeSection({
          gid: "section-1",
          name: "Section after",
          projectGid: SECOND_ACTIVE_PROJECT_GID,
        }),
        makeSection({ gid: "section-2", name: "Other section" }),
      ]);
    });

    it("replaces the same-key row and preserves unrelated task rows", async () => {
      await cacheRepository.upsertTasks([
        makeTask({ gid: "task-1", name: "Task before" }),
        makeTask({ gid: "task-2", name: "Other task" }),
      ]);

      await cacheRepository.upsertTasks([
        makeTask({
          gid: "task-1",
          name: "Task after",
          projectGids: [SECOND_ACTIVE_PROJECT_GID],
          estimatedMinutes: 120,
        }),
      ]);

      await expect(db.tasks.orderBy("gid").toArray()).resolves.toEqual([
        makeTask({
          gid: "task-1",
          name: "Task after",
          projectGids: [SECOND_ACTIVE_PROJECT_GID],
          estimatedMinutes: 120,
        }),
        makeTask({ gid: "task-2", name: "Other task" }),
      ]);
    });
  });

  describe("markTasksOutOfScope", () => {
    it("requires an explicit outOfScopeReason", async () => {
      await expect(
        cacheRepository.markTasksOutOfScope(["task-1"], null as never),
      ).rejects.toThrow("markTasksOutOfScope requires an outOfScopeReason");
    });

    it("marks only the requested tasks out of scope", async () => {
      await cacheRepository.upsertTasks([
        makeTask({ gid: "task-1", outOfScopeReason: null }),
        makeTask({ gid: "task-2", outOfScopeReason: null }),
      ]);

      await cacheRepository.markTasksOutOfScope(
        ["task-1"],
        "project_archived",
      );

      await expect(db.tasks.orderBy("gid").toArray()).resolves.toEqual([
        makeTask({ gid: "task-1", outOfScopeReason: "project_archived" }),
        makeTask({ gid: "task-2", outOfScopeReason: null }),
      ]);
    });
  });

  describe("getInScopeTasks", () => {
    it("returns only default tasks that still belong to an active project in the requested workspace", async () => {
      await seedInScopeProjects();
      await cacheRepository.upsertTasks([
        makeTask({ gid: "active-task" }),
        makeTask({ gid: "subtask", parentTaskGid: "parent-task" }),
        makeTask({
          gid: "multi-project-task",
          projectGids: [ACTIVE_PROJECT_GID, SECOND_ACTIVE_PROJECT_GID],
        }),
        makeTask({
          gid: "archived-project-task",
          projectGids: [ARCHIVED_PROJECT_GID],
        }),
        makeTask({
          gid: "other-workspace-task",
          projectGids: [OTHER_WORKSPACE_PROJECT_GID],
        }),
        makeTask({
          gid: "milestone-task",
          resourceSubtype: "milestone",
        }),
        makeTask({
          gid: "approval-task",
          resourceSubtype: "approval",
        }),
        makeTask({
          gid: "removed-task",
          outOfScopeReason: "removed_from_projects",
        }),
      ]);

      const result = await cacheRepository.getInScopeTasks(WORKSPACE_GID);

      const gids = result.map((task) => task.gid);
      expect(gids).toEqual(
        expect.arrayContaining([
          "active-task",
          "subtask",
          "multi-project-task",
        ]),
      );
      expect(gids).toHaveLength(3);
      expect(gids.filter((gid) => gid === "multi-project-task")).toHaveLength(1);
    });

    it("reads projects and tasks from one readonly Dexie snapshot", async () => {
      await cacheRepository.upsertProjects([
        makeProject({ gid: ACTIVE_PROJECT_GID, archived: false }),
      ]);
      await cacheRepository.upsertTasks([
        makeTask({ gid: "snapshot-task", projectGids: [ACTIVE_PROJECT_GID] }),
      ]);

      const writerDb = new TeamDashDatabase(db.name);
      let writerPromise: Promise<unknown> | undefined;
      const originalWhere = db.projects.where.bind(db.projects) as (...args: any[]) => any;

      vi.spyOn(db.projects as any, "where").mockImplementation((...args: unknown[]) => {
        const index = args[0];
        const collection = originalWhere(index) as any;
        if (index !== "workspaceGid") {
          return collection;
        }

        const originalEquals = collection.equals.bind(collection);
        collection.equals = (value: string) => {
          const scoped = originalEquals(value);
          const originalAnd = scoped.and.bind(scoped);

          scoped.and = (predicate: (project: Project) => boolean) => {
            const filtered = originalAnd(predicate);
            const originalToArray = filtered.toArray.bind(filtered);

            filtered.toArray = (async () => {
              const rows = await originalToArray();
              writerPromise ??= writerDb.projects.update(ACTIVE_PROJECT_GID, {
                archived: true,
              });
              return rows;
            }) as typeof filtered.toArray;

            return filtered;
          };

          return scoped;
        };

        return collection;
      });

      const result = await cacheRepository.getInScopeTasks(WORKSPACE_GID);
      await writerPromise;

      expect(result.map((task) => task.gid)).toEqual(["snapshot-task"]);
      await expect(db.projects.get(ACTIVE_PROJECT_GID)).resolves.toMatchObject({
        archived: true,
      });
      writerDb.close();
    });
  });
});
