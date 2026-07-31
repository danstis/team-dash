import { db } from "../schema";
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
} from "../schema";

export type OutOfScopeReason = Exclude<Task["outOfScopeReason"], null>;

export interface CacheRepository {
  upsertWorkspaces(rows: Workspace[]): Promise<void>;
  upsertProjects(rows: Project[]): Promise<void>;
  upsertPortfolios(rows: Portfolio[]): Promise<void>;
  upsertAsanaTeams(rows: AsanaTeam[]): Promise<void>;
  upsertUsers(rows: User[]): Promise<void>;
  upsertPriorityFields(rows: PriorityField[]): Promise<void>;
  upsertDependencies(rows: Dependency[]): Promise<void>;
  upsertSections(rows: Section[]): Promise<void>;
  upsertTasks(rows: Task[]): Promise<void>;
  markTasksOutOfScope(gids: string[], reason: OutOfScopeReason): Promise<void>;
  getInScopeTasks(workspaceGid: string): Promise<Task[]>;
}

const OUT_OF_SCOPE_REASONS = new Set<OutOfScopeReason>([
  "deleted",
  "project_archived",
  "removed_from_projects",
]);

export const cacheRepository: CacheRepository = {
  async upsertWorkspaces(rows): Promise<void> {
    await db.workspaces.bulkPut(rows);
  },

  async upsertProjects(rows): Promise<void> {
    await db.projects.bulkPut(rows);
  },

  async upsertPortfolios(rows): Promise<void> {
    await db.portfolios.bulkPut(rows);
  },

  async upsertAsanaTeams(rows): Promise<void> {
    await db.asanaTeams.bulkPut(rows);
  },

  async upsertUsers(rows): Promise<void> {
    await db.users.bulkPut(rows);
  },

  async upsertPriorityFields(rows): Promise<void> {
    await db.priorityFields.bulkPut(rows);
  },

  async upsertDependencies(rows): Promise<void> {
    await db.dependencies.bulkPut(rows);
  },

  async upsertSections(rows): Promise<void> {
    await db.sections.bulkPut(rows);
  },

  async upsertTasks(rows): Promise<void> {
    await db.tasks.bulkPut(rows);
  },

  async markTasksOutOfScope(gids, reason): Promise<void> {
    if (!OUT_OF_SCOPE_REASONS.has(reason)) {
      throw new TypeError("A valid outOfScopeReason is required");
    }

    await db.tasks
      .where("gid")
      .anyOf(gids)
      .modify({ outOfScopeReason: reason });
  },

  async getInScopeTasks(workspaceGid): Promise<Task[]> {
    return db.transaction("r", [db.projects, db.tasks], async () => {
      const activeProjectGids = await db.projects
        .where("workspaceGid")
        .equals(workspaceGid)
        .filter(({ archived }) => !archived)
        .primaryKeys();

      if (activeProjectGids.length === 0) {
        return [];
      }

      const tasks = await db.tasks
        .where("projectGids")
        .anyOf(activeProjectGids)
        .distinct()
        .filter(
          ({ resourceSubtype, outOfScopeReason }) =>
            resourceSubtype === "default_task" && outOfScopeReason === null,
        )
        .toArray();

      return tasks.sort((left, right) => left.gid.localeCompare(right.gid));
    });
  },
};
