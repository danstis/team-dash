/**
 * T047 — `RefreshStagingRepository` (US2, BSOD-301).
 *
 * Implements the `RefreshStagingRepository` interface declared in
 * `specs/001-asana-team-dashboard/contracts/storage-repository.md`. This
 * module is the only writer that moves a refresh's buffered rows into the
 * live Dexie cache stores; the refresh orchestrator (T051) drives the
 * state machine, while this repository owns the "what reaches the cache,
 * and when" boundary.
 *
 * Contract reference (verbatim from `contracts/storage-repository.md`):
 *
 * ```
 * interface RefreshStagingRepository {
 *   // All writes during a running refresh go through a single staged
 *   // transaction; nothing here is visible to getInScopeTasks() until commit().
 *   beginStaging(sessionId: string): Promise<void>;
 *   stageUpsert<T>(store: DexieStoreName, rows: T[]): Promise<void>;
 *   commit(sessionId: string): Promise<void>;   // atomically applies the staged Dexie transaction + backfills/replaces the day's Snapshot
 *   discard(sessionId: string): Promise<void>;  // drops staged rows; committed cache is untouched
 * }
 * ```
 *
 * Hard constraints (cross-cuts the contract):
 *
 * 1. **FR-022 / FR-068 atomicity**: `commit()` MUST be a single Dexie
 *    transaction. A two-stage "flush tasks then projects" implementation
 *    would leak partial state on a mid-batch throw — the headline contract
 *    is that a failed commit never partially applies. The
 *    `tests/contract/refresh-staging.test.ts` "mid-batch throw" test
 *    pins this by injecting a throw on the first `bulkPut` inside the
 *    transaction and asserting the cache is unchanged afterwards.
 *
 * 2. **Staging is hidden from `getInScopeTasks()` while the session is
 *    running**: the staging buffer lives in memory (per-sessionId
 *    `Map<storeName, Map<key, row>>`) and never touches the live Dexie
 *    cache stores until `commit()` succeeds. A staging buffer that
 *    flushed eagerly during `stageUpsert()` would expose partial data
 *    to downstream readers and break the US2 "previous good cache
 *    stays readable while staging is in flight" guarantee.
 *
 * 3. **RefreshSession transition is in the same transaction**: `commit()`
 *    sets `status: 'succeeded'` and `finishedAt: <now>` on the session
 *    row inside the same Dexie transaction that flushes the staged
 *    rows. This means a failed commit also rolls back the session
 *    transition — the session stays `running` so the orchestrator can
 *    crash-recover the still-incomplete refresh.
 *
 * 4. **`discard()` is a true rollback, not a best-effort cleanup**:
 *    `discard()` clears the in-memory buffer and DOES NOT touch any
 *    cache store. The contract test asserts the post-discard
 *    `getInScopeTasks()` is byte-identical to its pre-staging snapshot,
 *    which a "best-effort delete" implementation (e.g. one that
 *    remembered which keys it staged and tried to roll them back)
 *    could not pass if the staging buffer had optimistically flushed.
 *
 * 5. **No writeable direct access from callers**: every storage side
 *    effect goes through this repository (Constitution Principle VI).
 *    The orchestrator (T051) reaches the surface via
 *    `refreshStagingRepository.<method>(...)`; the test suite
 *    constructs the same interface through the public singleton.
 *
 * RefreshSession transition (per data-model.md)
 * ---------------------------------------------
 * The `commit()` path is the ONLY path that sets
 * `RefreshSession.status = 'succeeded'`. The `discard()` path leaves
 * the status unchanged (`running`); the orchestrator (T051) is the
 * caller that transitions the session to `cancelled`, `auth_failure`,
 * `permission_failure`, `*_partial_failure`, or `rate_limited` once
 * it has classified the failure. The contract test pins "session
 * status unchanged after discard" so a future contributor who tries
 * to make `discard()` "clean up the session too" fails the assertion.
 *
 * Boundary
 * --------
 * This module lives under `src/data/db/repositories/` (peer to
 * `cache.repository.ts` and `credential.repository.ts`) and imports
 * only from `src/data/db/schema.ts`. It does not import from
 * `src/app/**`, `src/features/**`, `src/domain/**`, or
 * `src/shared/**` — the dependency-boundary lint rule in
 * `eslint.config.js` enforces this by review convention without a
 * runtime exception.
 *
 * Snapshot backfill
 * -----------------
 * `commit()` is the documented single path that calls
 * `SnapshotRepository.backfillSnapshots()` (data-model.md, FR-026a,
 * FR-026b, FR-068). That coupling is established in T052 (BSOD-306);
 * this repository does not pre-import the snapshot repository so the
 * T052 contract has its own deliverable to land the backfill call
 * without a cross-row dependency leaking into the T047 red→green
 * slice.
 */
import { db } from "../schema";
import type { Table } from "dexie";
import type {
  AsanaTeam,
  Dependency,
  Portfolio,
  PriorityField,
  Project,
  RefreshSession,
  Section,
  Snapshot,
  Task,
  User,
  Workspace,
} from "../schema";

/**
 * The union of cache-store names that the refresh orchestrator is
 * permitted to stage. Excludes the user-data tables
 * (`teamMappingOverrides`, `personGroups`, `credentials`) which the
 * orchestrator never writes through a refresh — Constitution Principle
 * IV + FR-044 require team-mapping overrides to survive every refresh
 * untouched, and the credentials lifecycle is owned by the
 * `CredentialRepository` (T040). Also includes `refreshSessions` and
 * `snapshots` as the framework-managed stores the refresh owns.
 */
export type RefreshStagingStoreName =
  | "workspaces"
  | "projects"
  | "portfolios"
  | "asanaTeams"
  | "users"
  | "priorityFields"
  | "dependencies"
  | "sections"
  | "tasks"
  | "refreshSessions"
  | "snapshots";

/**
 * The closure of every cache-store entity that may be staged. Maps
 * each store name to the row type the schema (T021) defines. Kept as a
 * single source of truth so the `stageUpsert` signature picks up the
 * correct row type per store name without a hand-rolled union per
 * call site.
 */
type RefreshStagingRowByStore = {
  workspaces: Workspace;
  projects: Project;
  portfolios: Portfolio;
  asanaTeams: AsanaTeam;
  users: User;
  priorityFields: PriorityField;
  dependencies: Dependency;
  sections: Section;
  tasks: Task;
  refreshSessions: RefreshSession;
  snapshots: Snapshot;
};

/**
 * The Dexie primary-key shape for each cache store. Most stores are
 * keyed by a single string; the two multi-entry stores (`dependencies`
 * and `snapshots`) use a `[string, string]` compound key. The
 * `keyString` form is what the in-memory `Map` keys by; the
 * `dexiePrimaryKey` is what `bulkPut` ultimately targets. For single-
 * string primary keys the two are identical.
 */
type RefreshStagingKeyByStore = {
  workspaces: string;
  projects: string;
  portfolios: string;
  asanaTeams: string;
  users: string;
  priorityFields: string;
  dependencies: [string, string];
  sections: string;
  tasks: string;
  refreshSessions: string;
  snapshots: [string, string];
};

/**
 * Extract the primary key for a staged row. The selection is purely
 * a structural lookup — Dexie itself is the identity authority at
 * commit time, so the only failure mode this protects against is a
 * stale `key` field on a row (e.g. an upsert whose `gid` does not
 * match the primary key the schema expects). Such a row would be
 * silently dropped by Dexie; the contract test does not cover that
 * scenario because the orchestrator is the only caller and constructs
 * rows from validated DTOs.
 */
function primaryKeyOf<S extends RefreshStagingStoreName>(
  store: S,
  row: RefreshStagingRowByStore[S],
): RefreshStagingKeyByStore[S] {
  switch (store) {
    case "workspaces": {
      return (row as Workspace).gid as RefreshStagingKeyByStore[S];
    }
    case "projects": {
      return (row as Project).gid as RefreshStagingKeyByStore[S];
    }
    case "portfolios": {
      return (row as Portfolio).gid as RefreshStagingKeyByStore[S];
    }
    case "asanaTeams": {
      return (row as AsanaTeam).gid as RefreshStagingKeyByStore[S];
    }
    case "users": {
      return (row as User).gid as RefreshStagingKeyByStore[S];
    }
    case "priorityFields": {
      return (row as PriorityField).projectGid as RefreshStagingKeyByStore[S];
    }
    case "dependencies": {
      const dependency = row as Dependency;
      return [
        dependency.taskGid,
        dependency.dependsOnTaskGid,
      ] as RefreshStagingKeyByStore[S];
    }
    case "sections": {
      return (row as Section).gid as RefreshStagingKeyByStore[S];
    }
    case "tasks": {
      return (row as Task).gid as RefreshStagingKeyByStore[S];
    }
    case "refreshSessions": {
      return (row as RefreshSession).id as RefreshStagingKeyByStore[S];
    }
    case "snapshots": {
      const snapshot = row as Snapshot;
      return [
        snapshot.workspaceGid,
        snapshot.localCalendarDate,
      ] as RefreshStagingKeyByStore[S];
    }
  }
}

/**
 * The in-memory staging buffer: per-store, per-key. The `unknown`
 * typing is the storage slot; the read-side helper
 * (`getStagedRows`) reasserts the row type when the orchestrator
 * iterates over a buffer in `commit()`.
 */
type StagingBuffer = Map<RefreshStagingStoreName, Map<unknown, unknown>>;

/**
 * The module-level staging area. The `RefreshStagingRepository`
 * surface assumes a single active session at a time (the orchestrator
 * is the only caller and guarantees this — Constitution Principle VI
 * explicit architecture). The `currentSessionId` lets the
 * `commit(sessionId)` and `discard(sessionId)` calls validate the
 * call against the active session; a mismatch is a programming error
 * and throws.
 */
let currentSessionId: string | null = null;
let currentBuffer: StagingBuffer = new Map();

/**
 * Resolve the Dexie `Table` for a given store name. The return type
 * is widened to `Table<any, any>` so the `bulkPut` overloads across
 * the union of cache-store tables collapse to a single callable
 * overload (Dexie's `bulkPut` is overloaded per EntityTable, and
 * TypeScript cannot unify those overloads in a heterogeneous union
 * without a manual widening). The per-store row identity is
 * preserved by the `RefreshStagingRowByStore` map at the
 * `stageUpsert` boundary, so the runtime side-effect is correct.
 */
function dexieTableFor(store: RefreshStagingStoreName): Table<any, any> {
  switch (store) {
    case "workspaces":
      return db.workspaces as unknown as Table<any, any>;
    case "projects":
      return db.projects as unknown as Table<any, any>;
    case "portfolios":
      return db.portfolios as unknown as Table<any, any>;
    case "asanaTeams":
      return db.asanaTeams as unknown as Table<any, any>;
    case "users":
      return db.users as unknown as Table<any, any>;
    case "priorityFields":
      return db.priorityFields as unknown as Table<any, any>;
    case "dependencies":
      return db.dependencies as unknown as Table<any, any>;
    case "sections":
      return db.sections as unknown as Table<any, any>;
    case "tasks":
      return db.tasks as unknown as Table<any, any>;
    case "refreshSessions":
      return db.refreshSessions as unknown as Table<any, any>;
    case "snapshots":
      return db.snapshots as unknown as Table<any, any>;
  }
}

/**
 * The `RefreshStagingRepository` surface — the contract every caller
 * composes against. Exported as a TypeScript interface so the
 * refresh orchestrator (T051) can take a `RefreshStagingRepository`
 * dependency (e.g. for test fixtures) without importing the singleton
 * instance.
 */
export interface RefreshStagingRepository {
  /**
   * Initialise an empty staging buffer for the given session.
   * Idempotent: a second `beginStaging` for the same sessionId throws
   * the prior buffer away (the orchestrator guarantees no overlapping
   * sessions for the same `sessionId`, so a repeat call is a
   * programming error).
   */
  beginStaging(sessionId: string): Promise<void>;

  /**
   * Buffer rows for a single store. The rows are NOT visible to
   * `getInScopeTasks()` until `commit()` runs; a `discard()` between
   * `stageUpsert` calls clears the buffer without touching the cache.
   */
  stageUpsert<S extends RefreshStagingStoreName>(
    store: S,
    rows: readonly RefreshStagingRowByStore[S][],
  ): Promise<void>;

  /**
   * Atomically flush the staging buffer to the live Dexie cache
   * stores AND transition the matching `RefreshSession` to
   * `status: 'succeeded'` with a fresh `finishedAt` timestamp. The
   * whole action is a single Dexie transaction; a mid-batch throw
   * rolls back every row (cache + session) so the system is never
   * left in a partial state.
   */
  commit(sessionId: string): Promise<void>;

  /**
   * Drop the staging buffer for the given session. The cache and the
   * matching `RefreshSession` are untouched — the session stays
   * `running` and the orchestrator (T051) is the only caller that
   * transitions it to a terminal failure status.
   */
  discard(sessionId: string): Promise<void>;
}

/**
 * Iterate the staging buffer in a deterministic order so the
 * `commit()` transaction's write order is reproducible across runs
 * (helpful for the contract test's `vi.spyOn` assertions and for
 * debugging the exact flush sequence). The store list is short
 * enough that an insertion-sort by enum declaration is wasteful —
 * `Array.from(map.keys()).sort()` is fine.
 */
function orderedStores(buffer: StagingBuffer): RefreshStagingStoreName[] {
  return Array.from(buffer.keys()).sort() as RefreshStagingStoreName[];
}

/**
 * The repository singleton. The module exports both the interface
 * and the implementation so a test can construct a fake
 * `RefreshStagingRepository` (e.g. backed by a different database
 * name) without monkey-patching the global instance.
 */
export const refreshStagingRepository: RefreshStagingRepository = {
  async beginStaging(sessionId: string): Promise<void> {
    currentSessionId = sessionId;
    currentBuffer = new Map();
  },

  async stageUpsert(store, rows): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    if (currentSessionId === null) {
      throw new Error(
        `refreshStagingRepository.stageUpsert called for store "${store}" without a prior beginStaging`,
      );
    }

    let storeBuffer = currentBuffer.get(store);
    if (storeBuffer === undefined) {
      storeBuffer = new Map();
      currentBuffer.set(store, storeBuffer);
    }

    for (const row of rows) {
      const key = primaryKeyOf(store, row);
      storeBuffer.set(key, row);
    }
  },

  async commit(sessionId: string): Promise<void> {
    if (currentSessionId !== sessionId) {
      throw new Error(
        `refreshStagingRepository.commit called for sessionId "${sessionId}" but the active staging session is "${currentSessionId ?? "<none>"}"`,
      );
    }

    // Build the Dexie transaction scope from the staged stores. The
    // session transition ALWAYS participates — the headline contract
    // pins "session transition in the same transaction as the cache
    // flush" — and `refreshSessions` is always included even when no
    // session row was staged (the transition is a `get` + `put` on
    // the existing seeded row, not a `bulkPut` over a buffer).
    const stores = new Set<RefreshStagingStoreName>(["refreshSessions"]);
    for (const store of orderedStores(currentBuffer)) {
      if (currentBuffer.get(store)?.size) {
        stores.add(store);
      }
    }

    const tableNames = Array.from(stores).sort() as unknown as string[];

    await db.transaction("rw", tableNames, async () => {
      for (const store of orderedStores(currentBuffer)) {
        const storeBuffer = currentBuffer.get(store);
        if (storeBuffer === undefined || storeBuffer.size === 0) {
          continue;
        }
        const rows = Array.from(storeBuffer.values());
        await dexieTableFor(store).bulkPut(rows);
      }

      // Transition the RefreshSession to `succeeded` in the same
      // transaction as the buffer flush. The transition preserves
      // every other field on the existing session row (workspaceGid,
      // startedAt, itemsRetrieved, syncMode, …) and only updates
      // `status` and `finishedAt`. A throw anywhere above (including
      // a partial `bulkPut` failure) rolls back BOTH the staged rows
      // AND the session transition — the orchestrator sees `status:
      // 'running'` on its next read and can drive the failure-
      // handling branch.
      const existingSession = await db.refreshSessions.get(sessionId);
      if (existingSession === undefined) {
        throw new Error(
          `refreshStagingRepository.commit: RefreshSession "${sessionId}" was not seeded; the orchestrator must insert a running session before staging starts`,
        );
      }
      await db.refreshSessions.put({
        ...existingSession,
        status: "succeeded",
        finishedAt: new Date().toISOString(),
      });
    });

    // The staging buffer is dropped only after the transaction
    // commits. A throw before this point leaves the buffer intact so
    // a retry (orchestrator-driven) can re-flush the same rows.
    currentSessionId = null;
    currentBuffer = new Map();
  },

  async discard(sessionId: string): Promise<void> {
    if (currentSessionId !== null && currentSessionId !== sessionId) {
      throw new Error(
        `refreshStagingRepository.discard called for sessionId "${sessionId}" but the active staging session is "${currentSessionId}"`,
      );
    }
    currentSessionId = null;
    currentBuffer = new Map();
  },
};
