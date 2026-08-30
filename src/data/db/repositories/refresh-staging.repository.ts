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
 * 5. **Buffer dedup is by stringified key, including for compound-key
 *    stores**: JavaScript `Map` keys object/array values by reference,
 *    not by value. The two compound-key stores (`dependencies` keyed
 *    by `[taskGid, dependsOnTaskGid]`, `snapshots` keyed by
 *    `[workspaceGid, localCalendarDate]`) would accumulate as
 *    separate entries across paginated `stageUpsert` calls if the
 *    raw array literal were used as the Map key, breaking the
 *    "upsert-keyed" invariant and risking unbounded memory growth at
 *    the 25k-task NFR-001 scale. The buffer therefore keys every
 *    store by a stringified form (`` `${taskGid}\0${dependsOnTaskGid}` ``)
 *    with a reserved separator byte between the two opaque identity
 *    components. The contract test
 *    `tests/contract/refresh-staging.test.ts` "compound-key staging
 *    dedupes successive stageUpsert calls" pins this.
 *
 * 6. **No writeable direct access from callers**: every storage side
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
 * The buffer's `Map<key, row>` key. Always a string so the in-memory
 * buffer dedupes across paginated `stageUpsert` calls for every
 * store — including the compound-key stores (`dependencies`,
 * `snapshots`) whose schema primary key is `[string, string]`.
 * Compound-key stores encode the ordered pair with `JSON.stringify`
 * so opaque identity components remain unambiguous even when they
 * contain embedded delimiters, quotes, or multibyte characters.
 */
function bufferKeyOf<S extends RefreshStagingStoreName>(
  store: S,
  row: RefreshStagingRowByStore[S],
): string {
  switch (store) {
    case "workspaces":
      return (row as Workspace).gid;
    case "projects":
      return (row as Project).gid;
    case "portfolios":
      return (row as Portfolio).gid;
    case "asanaTeams":
      return (row as AsanaTeam).gid;
    case "users":
      return (row as User).gid;
    case "priorityFields":
      return (row as PriorityField).projectGid;
    case "dependencies":
      return JSON.stringify([
        (row as Dependency).taskGid,
        (row as Dependency).dependsOnTaskGid,
      ]);
    case "sections":
      return (row as Section).gid;
    case "tasks":
      return (row as Task).gid;
    case "refreshSessions":
      return (row as RefreshSession).id;
    case "snapshots":
      return JSON.stringify([
        (row as Snapshot).workspaceGid,
        (row as Snapshot).localCalendarDate,
      ]);
  }
}

/**
 * The in-memory staging buffer: per-store, per-key. The key is the
 * stringified form (`bufferKeyOf`) so the two compound-key stores
 * dedupe correctly; the row is the staged entity verbatim.
 */
type StagingBuffer = Map<
  RefreshStagingStoreName,
  Map<string, RefreshStagingRowByStore[RefreshStagingStoreName]>
>;

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
 * Flush a store's staged rows to the live Dexie table. The per-store
 * switch restores the per-store `EntityTable` typing — each branch
 * calls the concretely-typed `bulkPut` directly, so the staging
 * repository never needs to widen the heterogeneous union of cache
 * tables to a single `Table<any, any>` shape (`typescript:S2871`
 * resolved without losing the single-helper ergonomics).
 *
 * The row types are accepted as `readonly RefreshStagingRowByStore[S][]`
 * at the call site (the calling loop already narrowed the store's
 * row type) and re-casted to the concrete store's row type inside
 * each branch — TypeScript cannot prove the union narrowing through
 * the generic alias across the switch, so the casts are the narrowest
 * possible bridge.
 */
async function flushStoreRows<S extends RefreshStagingStoreName>(
  store: S,
  rows: readonly RefreshStagingRowByStore[S][],
): Promise<void> {
  switch (store) {
    case "workspaces":
      await db.workspaces.bulkPut(rows as readonly Workspace[]);
      break;
    case "projects":
      await db.projects.bulkPut(rows as readonly Project[]);
      break;
    case "portfolios":
      await db.portfolios.bulkPut(rows as readonly Portfolio[]);
      break;
    case "asanaTeams":
      await db.asanaTeams.bulkPut(rows as readonly AsanaTeam[]);
      break;
    case "users":
      await db.users.bulkPut(rows as readonly User[]);
      break;
    case "priorityFields":
      await db.priorityFields.bulkPut(rows as readonly PriorityField[]);
      break;
    case "dependencies":
      await db.dependencies.bulkPut(rows as readonly Dependency[]);
      break;
    case "sections":
      await db.sections.bulkPut(rows as readonly Section[]);
      break;
    case "tasks":
      await db.tasks.bulkPut(rows as readonly Task[]);
      break;
    case "refreshSessions":
      await db.refreshSessions.bulkPut(rows as readonly RefreshSession[]);
      break;
    case "snapshots":
      await db.snapshots.bulkPut(rows as readonly Snapshot[]);
      break;
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
   * Initialise an empty staging buffer for the given session. The
   * orchestrator guarantees no overlapping sessions for the same
   * `sessionId`; a repeat call for the same sessionId re-initialises
   * the buffer (the previous buffer is discarded as part of the
   * switch, which is what the orchestrator wants when it begins the
   * next chunk of a multi-batch refresh).
   */
  beginStaging(sessionId: string): Promise<void>;

  /**
   * Buffer rows for a single store. The rows are NOT visible to
   * `getInScopeTasks()` until `commit()` runs; a `discard()` between
   * `stageUpsert` calls clears the buffer without touching the cache.
   * Empty `rows` arrays are a no-op.
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
 * String compare function for ordered store lists. Explicit
 * comparator satisfies `typescript:S2871` (the default Array#sort
 * without a comparator coerces entries to strings and falls back to
 * alphabetical lexicographic order, which is fragile under locale
 * settings and undefined entries).
 */
function compareStoreNames(
  a: RefreshStagingStoreName,
  b: RefreshStagingStoreName,
): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Iterate the staging buffer in a deterministic order so the
 * `commit()` transaction's write order is reproducible across runs
 * (helpful for the contract test's `vi.spyOn` assertions and for
 * debugging the exact flush sequence). The store list is short
 * enough that an insertion-sort by enum declaration is wasteful —
 * `Array.from(map.keys()).sort(compareStoreNames)` is fine.
 */
function orderedStores(buffer: StagingBuffer): RefreshStagingStoreName[] {
  return Array.from(buffer.keys()).sort(compareStoreNames);
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
      const key = bufferKeyOf(store, row);
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

    const tableNames = Array.from(stores).sort(compareStoreNames);

    await db.transaction("rw", tableNames, async () => {
      for (const store of orderedStores(currentBuffer)) {
        const storeBuffer = currentBuffer.get(store);
        if (storeBuffer === undefined || storeBuffer.size === 0) {
          continue;
        }
        const rows = Array.from(
          storeBuffer.values(),
        ) as RefreshStagingRowByStore[RefreshStagingStoreName][];
        await flushStoreRows(store, rows);
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
