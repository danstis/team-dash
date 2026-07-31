import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheRepository,
  type OutOfScopeReason,
} from "../../src/data/db/repositories/cache.repository";
import { db, type Task } from "../../src/data/db/schema";

const NOW = "2026-07-31T10:00:00.000Z";

function task({ gid, ...overrides }: Partial<Task> & Pick<Task, "gid">): Task {
  return {
    gid,
    name: gid,
    assigneeGid: null,
    projectGids: ["project-active"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-01T09:00:00.000Z",
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

async function clearCacheStores(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.workspaces,
      db.projects,
      db.portfolios,
      db.asanaTeams,
      db.users,
      db.priorityFields,
      db.dependencies,
      db.sections,
      db.tasks,
    ],
    async () => {
      await db.workspaces.clear();
      await db.projects.clear();
      await db.portfolios.clear();
      await db.asanaTeams.clear();
      await db.users.clear();
      await db.priorityFields.clear();
      await db.dependencies.clear();
      await db.sections.clear();
      await db.tasks.clear();
    },
  );
}

describe("T055 CacheRepository (contracts/storage-repository.md)", () => {
  beforeEach(clearCacheStores);
  afterEach(clearCacheStores);

  it("upserts every Asana cache entity by its schema primary key without replacing unrelated rows", async () => {
    await cacheRepository.upsertWorkspaces([
      { gid: "workspace-1", name: "Original", selectedAt: NOW },
      { gid: "workspace-2", name: "Other", selectedAt: NOW },
    ]);
    await cacheRepository.upsertProjects([
      {
        gid: "project-1",
        name: "Original",
        workspaceGid: "workspace-1",
        asanaTeamGid: "team-1",
        portfolioGids: [],
        archived: false,
      },
      {
        gid: "project-2",
        name: "Other",
        workspaceGid: "workspace-2",
        asanaTeamGid: "team-2",
        portfolioGids: [],
        archived: false,
      },
    ]);
    await cacheRepository.upsertPortfolios([
      {
        gid: "portfolio-1",
        name: "Original",
        workspaceGid: "workspace-1",
        projectGids: ["project-1"],
      },
      {
        gid: "portfolio-2",
        name: "Other",
        workspaceGid: "workspace-2",
        projectGids: ["project-2"],
      },
    ]);
    await cacheRepository.upsertAsanaTeams([
      { gid: "team-1", name: "Original", workspaceGid: "workspace-1" },
      { gid: "team-2", name: "Other", workspaceGid: "workspace-2" },
    ]);
    await cacheRepository.upsertUsers([
      {
        gid: "user-1",
        name: "Original",
        email: "alex@example.com",
        workspaceGid: "workspace-1",
      },
      {
        gid: "user-2",
        name: "Other",
        email: null,
        workspaceGid: "workspace-2",
      },
    ]);
    await cacheRepository.upsertPriorityFields([
      {
        projectGid: "project-1",
        expectedOptionIds: ["high"],
        status: "ok",
      },
      {
        projectGid: "project-2",
        expectedOptionIds: null,
        status: "missing",
      },
    ]);
    await cacheRepository.upsertDependencies([
      {
        taskGid: "task-1",
        dependsOnTaskGid: "task-2",
        dependsOnTaskAccessible: true,
      },
      {
        taskGid: "task-2",
        dependsOnTaskGid: "task-3",
        dependsOnTaskAccessible: true,
      },
    ]);
    await cacheRepository.upsertSections([
      { gid: "section-1", projectGid: "project-1", name: "Original" },
      { gid: "section-2", projectGid: "project-2", name: "Other" },
    ]);
    await cacheRepository.upsertTasks([
      task({ gid: "task-1", name: "Original" }),
      task({ gid: "task-2", name: "Other" }),
    ]);

    await cacheRepository.upsertWorkspaces([
      { gid: "workspace-1", name: "Updated", selectedAt: NOW },
    ]);
    await cacheRepository.upsertProjects([
      {
        gid: "project-1",
        name: "Updated",
        workspaceGid: "workspace-1",
        asanaTeamGid: "team-1",
        portfolioGids: [],
        archived: false,
      },
    ]);
    await cacheRepository.upsertPortfolios([
      {
        gid: "portfolio-1",
        name: "Updated",
        workspaceGid: "workspace-1",
        projectGids: ["project-1"],
      },
    ]);
    await cacheRepository.upsertAsanaTeams([
      { gid: "team-1", name: "Updated", workspaceGid: "workspace-1" },
    ]);
    await cacheRepository.upsertUsers([
      {
        gid: "user-1",
        name: "Updated",
        email: "alex@example.com",
        workspaceGid: "workspace-1",
      },
    ]);
    await cacheRepository.upsertPriorityFields([
      {
        projectGid: "project-1",
        expectedOptionIds: ["urgent"],
        status: "malformed",
      },
    ]);
    await cacheRepository.upsertDependencies([
      {
        taskGid: "task-1",
        dependsOnTaskGid: "task-2",
        dependsOnTaskAccessible: false,
      },
    ]);
    await cacheRepository.upsertSections([
      { gid: "section-1", projectGid: "project-1", name: "Updated" },
    ]);
    await cacheRepository.upsertTasks([
      task({ gid: "task-1", name: "Updated" }),
    ]);

    expect(await db.workspaces.count()).toBe(2);
    expect((await db.workspaces.get("workspace-1"))?.name).toBe("Updated");
    expect(await db.projects.count()).toBe(2);
    expect((await db.projects.get("project-1"))?.name).toBe("Updated");
    expect(await db.portfolios.count()).toBe(2);
    expect((await db.portfolios.get("portfolio-1"))?.name).toBe("Updated");
    expect(await db.asanaTeams.count()).toBe(2);
    expect((await db.asanaTeams.get("team-1"))?.name).toBe("Updated");
    expect(await db.users.count()).toBe(2);
    expect((await db.users.get("user-1"))?.name).toBe("Updated");
    expect(await db.priorityFields.count()).toBe(2);
    expect((await db.priorityFields.get("project-1"))?.status).toBe(
      "malformed",
    );
    expect(await db.dependencies.count()).toBe(2);
    expect(
      (await db.dependencies.get(["task-1", "task-2"]))
        ?.dependsOnTaskAccessible,
    ).toBe(false);
    expect(await db.sections.count()).toBe(2);
    expect((await db.sections.get("section-1"))?.name).toBe("Updated");
    expect(await db.tasks.count()).toBe(2);
    expect((await db.tasks.get("task-1"))?.name).toBe("Updated");
  });

  it("returns only default tasks with no scope-loss reason in an active project in the selected workspace", async () => {
    await cacheRepository.upsertProjects([
      {
        gid: "project-active",
        name: "Active",
        workspaceGid: "workspace-1",
        asanaTeamGid: null,
        portfolioGids: [],
        archived: false,
      },
      {
        gid: "project-active-2",
        name: "Second active",
        workspaceGid: "workspace-1",
        asanaTeamGid: null,
        portfolioGids: [],
        archived: false,
      },
      {
        gid: "project-archived",
        name: "Archived",
        workspaceGid: "workspace-1",
        asanaTeamGid: null,
        portfolioGids: [],
        archived: true,
      },
      {
        gid: "project-other-workspace",
        name: "Other workspace",
        workspaceGid: "workspace-2",
        asanaTeamGid: null,
        portfolioGids: [],
        archived: false,
      },
    ]);
    await cacheRepository.upsertTasks([
      task({
        gid: "multi-project-task",
        projectGids: ["project-archived", "project-active", "project-active-2"],
      }),
      task({
        gid: "subtask",
        parentTaskGid: "multi-project-task",
        projectGids: ["project-active"],
      }),
      task({ gid: "archived-only", projectGids: ["project-archived"] }),
      task({
        gid: "other-workspace",
        projectGids: ["project-other-workspace"],
      }),
      task({ gid: "personal-task", projectGids: [] }),
      task({ gid: "milestone", resourceSubtype: "milestone" }),
      task({ gid: "approval", resourceSubtype: "approval" }),
      task({ gid: "deleted", outOfScopeReason: "deleted" }),
      task({
        gid: "archived-reason",
        outOfScopeReason: "project_archived",
      }),
      task({
        gid: "removed-reason",
        outOfScopeReason: "removed_from_projects",
      }),
    ]);

    const transactionSpy = vi.spyOn(db, "transaction");
    const result = await cacheRepository.getInScopeTasks("workspace-1");

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    const transactionCall = transactionSpy.mock.calls[0];
    expect(transactionCall?.[0]).toBe("r");
    const transactionTables = transactionCall?.[1] as unknown as Array<{
      name: string;
    }>;
    expect(transactionTables.map(({ name }) => name).sort()).toEqual([
      "projects",
      "tasks",
    ]);
    transactionSpy.mockRestore();

    expect(result.map(({ gid }) => gid).sort()).toEqual([
      "multi-project-task",
      "subtask",
    ]);
  });

  it("requires a non-null reason when marking tasks out of scope", async () => {
    await cacheRepository.upsertTasks([task({ gid: "task-1" })]);
    const markWithoutRequiredReason = cacheRepository.markTasksOutOfScope as (
      gids: string[],
      reason?: OutOfScopeReason | null,
    ) => Promise<void>;

    await expect(markWithoutRequiredReason(["task-1"])).rejects.toThrow(
      "outOfScopeReason",
    );
    await expect(markWithoutRequiredReason(["task-1"], null)).rejects.toThrow(
      "outOfScopeReason",
    );
    expect((await db.tasks.get("task-1"))?.outOfScopeReason).toBeNull();
  });

  it.each<OutOfScopeReason>([
    "deleted",
    "project_archived",
    "removed_from_projects",
  ])(
    "marks matching tasks out of scope with the explicit %s reason",
    async (reason) => {
      await cacheRepository.upsertTasks([
        task({ gid: "task-1" }),
        task({ gid: "task-2" }),
      ]);

      await cacheRepository.markTasksOutOfScope(["task-1"], reason);

      expect((await db.tasks.get("task-1"))?.outOfScopeReason).toBe(reason);
      expect((await db.tasks.get("task-2"))?.outOfScopeReason).toBeNull();
    },
  );
});
