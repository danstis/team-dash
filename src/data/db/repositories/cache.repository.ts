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

/**
 * The closed union of cache-store names every `upsertX` method on the
 * repository writes to. Mirrors the `CacheRepository` interface one-for-one
 * (a future contributor who adds a tenth `upsertX` method without adding
 * its store here fails `tsc` immediately because the union is exhaustive
 * over the dispatch table below). The union exists as a single source of
 * truth so the dispatch table (`CACHE_STORE_UPSERT`) and the
 * `upsertIntoTable` helper share the same key set without re-deriving the
 * literal list at two call sites.
 */
type CacheStoreName =
  | "workspaces"
  | "projects"
  | "portfolios"
  | "asanaTeams"
  | "users"
  | "priorityFields"
  | "dependencies"
  | "sections"
  | "tasks";

/**
 * Per-store row type, indexed by `CacheStoreName`. Mirrors the
 * `TeamDashDatabase` field types in `src/data/db/schema.ts` so a future
 * schema change that widens a row shape updates the `CacheStoreRowByName`
 * map (or breaks `tsc` here) before it can ship.
 */
type CacheStoreRowByName = {
  workspaces: Workspace;
  projects: Project;
  portfolios: Portfolio;
  asanaTeams: AsanaTeam;
  users: User;
  priorityFields: PriorityField;
  dependencies: Dependency;
  sections: Section;
  tasks: Task;
};

/**
 * The per-store `bulkPut` invocation the `upsertX` methods dispatch
 * through. Each entry is a thin closure that performs the empty-rows
 * no-op guard (preserving the original `bulkUpsert` short-circuit at the
 * call site) and the `[...rows]` fresh allocation that decouples the
 * Dexie write from any caller-side mutation of the source array. Storing
 * the closures rather than the raw `EntityTable` instances sidesteps the
 * per-table primary-key typing variance (`db.dependencies` carries a
 * `[string, string]` compound primary key while every other cache table
 * carries a single-string `gid` / `projectGid` key) so the dispatch
 * shape stays uniform regardless of how the schema's primary keys vary.
 *
 * The `satisfies` annotation is the binding half of the lockstep
 * contract: structural assignment to `Record<CacheStoreName, BulkPutFn>`
 * requires every member of `CacheStoreName` to appear as a key, so
 * adding a store name without a matching entry here fails the build.
 *
 * The per-entry function type uses `readonly any[]` rather than the row
 * union because TypeScript function parameter types are contravariant —
 * a `(rows: readonly any[]) => …` signature accepts every narrower row
 * array, while a heterogeneous union across the table entries would
 * either reject the assignments or require widening each per-store
 * closure's row array to a union that no longer matches `bulkPut`'s
 * concrete `TInsertType[]` shape. The `any[]` row-typing keeps each
 * entry's closure strongly-typed at the `bulkPut` call site (so the
 * row shape stays pinned by Dexie's generic resolution) while the
 * dispatch table stays uniform.
 */
type BulkPutFn = (rows: readonly any[]) => Promise<unknown>;

const CACHE_STORE_UPSERT = {
  workspaces: (rows: readonly Workspace[]) =>
    rows.length === 0 ? Promise.resolve() : db.workspaces.bulkPut([...rows]),
  projects: (rows: readonly Project[]) =>
    rows.length === 0 ? Promise.resolve() : db.projects.bulkPut([...rows]),
  portfolios: (rows: readonly Portfolio[]) =>
    rows.length === 0 ? Promise.resolve() : db.portfolios.bulkPut([...rows]),
  asanaTeams: (rows: readonly AsanaTeam[]) =>
    rows.length === 0 ? Promise.resolve() : db.asanaTeams.bulkPut([...rows]),
  users: (rows: readonly User[]) =>
    rows.length === 0 ? Promise.resolve() : db.users.bulkPut([...rows]),
  priorityFields: (rows: readonly PriorityField[]) =>
    rows.length === 0
      ? Promise.resolve()
      : db.priorityFields.bulkPut([...rows]),
  dependencies: (rows: readonly Dependency[]) =>
    rows.length === 0 ? Promise.resolve() : db.dependencies.bulkPut([...rows]),
  sections: (rows: readonly Section[]) =>
    rows.length === 0 ? Promise.resolve() : db.sections.bulkPut([...rows]),
  tasks: (rows: readonly Task[]) =>
    rows.length === 0 ? Promise.resolve() : db.tasks.bulkPut([...rows]),
} as const satisfies Record<CacheStoreName, BulkPutFn>;

/**
 * The single helper every public `upsertX` method delegates to. The
 * empty-rows short-circuit and the `[...rows]` spread both live inside
 * the dispatch entry (`CACHE_STORE_UPSERT`), so this helper is a one-line
 * dispatch. Kept as a named function (rather than calling
 * `CACHE_STORE_UPSERT[store]` directly from each public method) so the
 * call-site shape stays a stable surface a future contributor can extend
 * without re-deriving the dispatch-key narrowing at nine call sites.
 */
async function upsertIntoTable<S extends CacheStoreName>(
  store: S,
  rows: readonly CacheStoreRowByName[S][],
): Promise<void> {
  const dispatch: BulkPutFn = CACHE_STORE_UPSERT[store];
  await dispatch(rows);
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
      await upsertIntoTable("workspaces", rows);
    },

    async upsertProjects(rows): Promise<void> {
      await upsertIntoTable("projects", rows);
    },

    async upsertPortfolios(rows): Promise<void> {
      await upsertIntoTable("portfolios", rows);
    },

    async upsertAsanaTeams(rows): Promise<void> {
      await upsertIntoTable("asanaTeams", rows);
    },

    async upsertUsers(rows): Promise<void> {
      await upsertIntoTable("users", rows);
    },

    async upsertPriorityFields(rows): Promise<void> {
      await upsertIntoTable("priorityFields", rows);
    },

    async upsertDependencies(rows): Promise<void> {
      await upsertIntoTable("dependencies", rows);
    },

    async upsertSections(rows): Promise<void> {
      await upsertIntoTable("sections", rows);
    },

    async upsertTasks(rows): Promise<void> {
      await upsertIntoTable("tasks", rows);
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
