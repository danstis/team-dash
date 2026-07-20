# Contract: Local Storage Repositories (`src/data/db`)

Dexie schema and repository functions. This is the only place in the app
that writes to IndexedDB — `domain/` and `features/` never call Dexie
directly (enforced by the boundary lint rule, research.md §7).

## Dexie schema (versioned)

```
db.version(1).stores({
  workspaces:        'gid',
  projects:           'gid, workspaceGid, asanaTeamGid, archived',
  portfolios:          'gid, workspaceGid',
  asanaTeams:           'gid, workspaceGid',
  teamMappingOverrides:  'projectGid',
  personGroups:            'id, workspaceGid, kind',
  users:                     'gid, workspaceGid',
  priorityFields:              'projectGid',
  dependencies:                  '[taskGid+dependsOnTaskGid], taskGid',
  sections:                        'gid, projectGid',
  tasks:                             'gid, *projectGids, assigneeGid, parentTaskGid, completedAt, createdAt, outOfScopeReason',
  snapshots:                          '[workspaceGid+localCalendarDate]',
  refreshSessions:                      'id, workspaceGid, status, startedAt',
  credentials:                            'mode', // singleton row, mode is always the only key present
});
```

`*projectGids` is Dexie's multi-entry index syntax, required so a task can
be looked up by any one of its project memberships without a table scan —
this is what keeps single-project-view queries (US3) fast at 25,000 tasks
(NFR-001) without denormalising tasks per project.

**Migration rule (Principle V)**: every future schema change adds a new
`db.version(n+1).stores({...}).upgrade(tx => ...)` block; a version bump
MUST NEVER be edited in place once shipped, and every migration MUST have
a `tests/contract/db-migration.*.test.ts` that seeds the previous
version's shape and asserts the upgrade preserves credentials, cache, and
history without loss (Compliance Checklist: "does not silently discard
credentials or history").

## Repository functions

```
interface CacheRepository {
  // Upsert-only, keyed by gid — never a blind table replace.
  upsertProjects(rows: Project[]): Promise<void>;
  upsertTasks(rows: Task[]): Promise<void>;
  // ... one upsert* per entity type in the schema above

  // Positive-confirmation scope loss (FR-023) — separate from a plain upsert
  // so it can only be called with an explicit, reasoned outOfScopeReason.
  markTasksOutOfScope(gids: string[], reason: Task['outOfScopeReason']): Promise<void>;

  getInScopeTasks(workspaceGid: string): Promise<Task[]>; // applies the in-scope predicate (data-model.md) at the query layer
}

interface RefreshStagingRepository {
  // All writes during a running refresh go through a single staged
  // transaction; nothing here is visible to getInScopeTasks() until commit().
  beginStaging(sessionId: string): Promise<void>;
  stageUpsert<T>(store: DexieStoreName, rows: T[]): Promise<void>;
  commit(sessionId: string): Promise<void>;   // atomically applies the staged Dexie transaction + backfills/replaces the day's Snapshot
  discard(sessionId: string): Promise<void>;  // drops staged rows; committed cache is untouched
}

interface SnapshotRepository {
  getSnapshot(workspaceGid: string, date: ISODate): Promise<Snapshot | null>;
  backfillSnapshots(workspaceGid: string, dates: ISODate[], compute: (date: ISODate) => Snapshot): Promise<void>;
  // Only ever called from RefreshStagingRepository.commit(); never called
  // directly by UI code, so a snapshot can never exist without a
  // corresponding successful RefreshSession (FR-068).
}

interface TeamMappingRepository {
  getOverrides(): Promise<TeamMappingOverride[]>;
  setOverride(projectGid: string, reportingTeamGid: string): Promise<void>;
  removeOverride(projectGid: string): Promise<void>;
  // Never touched by RefreshStagingRepository — overrides are user data,
  // not Asana-sourced cache, and must survive every refresh untouched.
}

interface PersonGroupRepository {
  listNamed(workspaceGid: string): Promise<PersonGroup[]>;
  saveNamed(group: PersonGroup): Promise<void>; // kind: 'named' only — throws on 'adhoc'
  deleteNamed(id: string): Promise<void>;
  // Ad-hoc groups never touch this repository — they live in a React
  // Context/useState only (data-model.md: "MUST NOT be written to the
  // persisted personGroups store").
}

interface CredentialRepository {
  getCurrent(): Promise<CredentialRecord | null>;
  setSessionToken(token: string): Promise<void>;         // memory only, no Dexie write
  setPersistentToken(token: string): Promise<void>;       // encrypts via data/crypto, deletes any prior encrypted record first (FR-005a)
  clearToSessionOnly(): Promise<void>;                     // deletes encrypted record + key, keeps token in memory only
  clearAll(): Promise<void>;                                // FR-007: deletes credentials AND cache AND snapshots AND team mappings AND named person groups, in one transaction
}
```

## Full clear-data contract (FR-007)

`CredentialRepository.clearAll()` MUST be a single Dexie transaction
spanning every store in the schema above (credentials, all cache tables,
snapshots, team mapping overrides, named person groups) — a partial clear
(e.g., token cleared but cache retained, or vice versa) is a contract
violation, since the spec requires one explicit action that clears
"the token and all locally retained Asana data (cache, snapshots, team
mappings)" together.

## Test contract

`tests/contract/db-schema.test.ts` asserts the live Dexie schema matches
this document's store/index list. `tests/contract/refresh-staging.test.ts`
asserts: (a) a `discard()` leaves `getInScopeTasks()` byte-identical to
its pre-staging result; (b) a `commit()` after a simulated mid-batch
throw never partially applies — either the whole staged transaction lands
or none of it does (Dexie's native transaction atomicity is the
enforcement mechanism; the test proves the repository doesn't accidentally
split writes across multiple transactions).
