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

type UpsertRow =
  | AsanaTeam
  | Dependency
  | Portfolio
  | PriorityField
  | Project
  | Section
  | Task
  | User
  | Workspace;

async function bulkUpsert<T extends UpsertRow>(
  rows: readonly T[],
  write: (rows: readonly T[]) => Promise<unknown>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await write(rows);
}

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
  markTasksOutOfScope(
    gids: string[],
    reason: NonNullable<Task["outOfScopeReason"]>,
  ): Promise<void>;
  getInScopeTasks(workspaceGid: string): Promise<Task[]>;
}

export function createCacheRepository(): CacheRepository {
  return {
    async upsertWorkspaces(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.workspaces.bulkPut([...nextRows]);
      });
    },

    async upsertProjects(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.projects.bulkPut([...nextRows]);
      });
    },

    async upsertPortfolios(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.portfolios.bulkPut([...nextRows]);
      });
    },

    async upsertAsanaTeams(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.asanaTeams.bulkPut([...nextRows]);
      });
    },

    async upsertUsers(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.users.bulkPut([...nextRows]);
      });
    },

    async upsertPriorityFields(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.priorityFields.bulkPut([...nextRows]);
      });
    },

    async upsertDependencies(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.dependencies.bulkPut([...nextRows]);
      });
    },

    async upsertSections(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.sections.bulkPut([...nextRows]);
      });
    },

    async upsertTasks(rows): Promise<void> {
      await bulkUpsert(rows, async (nextRows) => {
        await db.tasks.bulkPut([...nextRows]);
      });
    },

    async markTasksOutOfScope(gids, reason): Promise<void> {
      if (reason == null) {
        throw new TypeError("markTasksOutOfScope requires an outOfScopeReason");
      }

      if (gids.length === 0) {
        return;
      }

      await db.tasks.where("gid").anyOf(gids).modify({
        outOfScopeReason: reason,
      });
    },

    async getInScopeTasks(workspaceGid): Promise<Task[]> {
      return db.transaction("r", db.projects, db.tasks, async () => {
        const inScopeProjectGids = new Set(
          (
            await db.projects
              .where("workspaceGid")
              .equals(workspaceGid)
              .and((project) => !project.archived)
              .toArray()
          ).map((project) => project.gid),
        );

        if (inScopeProjectGids.size === 0) {
          return [];
        }

        return db.tasks
          .where("projectGids")
          .anyOf([...inScopeProjectGids])
          .and(
            (task) =>
              task.resourceSubtype === "default_task" &&
              task.outOfScopeReason === null,
          )
          .distinct()
          .toArray();
      });
    },
  };
}

export const cacheRepository = createCacheRepository();
