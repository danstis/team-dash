import { db } from "../schema";
import type {
  AsanaTeam,
  Dependency,
  Portfolio,
  PriorityField,
  Project,
  Section,
  Task,
  TeamMappingOverride,
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
  listUsers(workspaceGid: string): Promise<User[]>;
  listProjects(workspaceGid: string): Promise<Project[]>;
  listPortfolios(workspaceGid: string): Promise<Portfolio[]>;
  listAsanaTeams(workspaceGid: string): Promise<AsanaTeam[]>;
  listTeamMappingOverrides(): Promise<TeamMappingOverride[]>;
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

    /**
     * The people of the workspace — the lookup rows the dashboard's
     * assignee filter and the task table's assignee column resolve a
     * `gid` against.
     */
    listUsers(workspaceGid): Promise<User[]> {
      return db.users.where("workspaceGid").equals(workspaceGid).toArray();
    },

    /**
     * The workspace's ACTIVE projects — the same scope
     * `getInScopeTasks` uses, so the dashboard's project filter and its
     * scope summary can never offer a project the cached tasks exclude.
     */
    listProjects(workspaceGid): Promise<Project[]> {
      return db.projects
        .where("workspaceGid")
        .equals(workspaceGid)
        .and((project) => !project.archived)
        .toArray();
    },

    /** The portfolios of the workspace, for the portfolio grouping. */
    listPortfolios(workspaceGid): Promise<Portfolio[]> {
      return db.portfolios.where("workspaceGid").equals(workspaceGid).toArray();
    },

    /** The Asana teams of the workspace, for the reporting-team grouping. */
    listAsanaTeams(workspaceGid): Promise<AsanaTeam[]> {
      return db.asanaTeams.where("workspaceGid").equals(workspaceGid).toArray();
    },

    /**
     * The locally overridden project → reporting-team mappings. The
     * schema keys the store by project, and the rows are workspace-
     * independent, so the whole store is the current mapping.
     */
    listTeamMappingOverrides(): Promise<TeamMappingOverride[]> {
      return db.teamMappingOverrides.toArray();
    },
  };
}

export const cacheRepository = createCacheRepository();
