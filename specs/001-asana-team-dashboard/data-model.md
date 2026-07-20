# Phase 1 Data Model: Asana Team Performance & Workload Dashboard

Types are documented conceptually (field name : type — meaning); concrete
TypeScript interfaces and Dexie schema live in `src/data/db/schema.ts` at
implementation time and MUST match this document. All `gid` fields are
opaque strings (FR-017) — never parsed, compared numerically, or assumed to
follow any particular format.

## Cache entities (upserted by `gid`, sourced from Asana)

### Workspace

- `gid: string` — Asana workspace id; identifies the single selected scope.
- `name: string`
- `selectedAt: ISODateTime` — when the user chose this workspace (FR-011).

Only one Workspace record is "active" at a time. Switching workspaces does
not delete another workspace's cached rows — they simply stop being read
(Assumptions: "Snapshot scope").

### Project

- `gid: string`
- `name: string`
- `workspaceGid: string`
- `asanaTeamGid: string | null` — owning Asana team (default reporting-team source, FR-041).
- `portfolioGids: string[]` — portfolios containing this project.
- `archived: boolean` — archived projects are excluded at the retrieval layer entirely (FR-012); this field exists only to detect a project transitioning to archived between refreshes so its tasks can be correctly dropped from scope.

**Validation**: A project missing an `asanaTeamGid` still requires a
reporting team resolution — falls back to a synthetic "No Asana Team"
reporting-team bucket, visibly labelled, never silently merged into another
team's totals.

### Portfolio

- `gid: string`
- `name: string`
- `projectGids: string[]`

### AsanaTeam

- `gid: string`
- `name: string`

### ReportingTeam (derived, not stored as its own upserted entity)

Computed per project as: `teamMappingOverride[project.gid]?.reportingTeamGid ?? project.asanaTeamGid`. Always carries a `source: 'asana' | 'override'` flag (FR-043).

### TeamMappingOverride

- `projectGid: string` (key)
- `reportingTeamGid: string` — the reporting-team id this project is mapped to (may be an existing Asana team gid or a user-defined reporting-team label id).
- `updatedAt: ISODateTime`

Persisted in IndexedDB (FR-044), independent of the Local Cache's
upsert-from-Asana lifecycle — never overwritten by a refresh.

### PersonGroup

- `id: string` (local UUID; ad-hoc groups use a transient session id, never persisted)
- `workspaceGid: string` — scoping (FR-042b).
- `name: string | null` — `null` for ad-hoc/unnamed.
- `kind: 'adhoc' | 'named'`
- `memberUserGids: string[]`
- `createdAt / updatedAt: ISODateTime`

**Validation**: `kind: 'adhoc'` records MUST NOT be written to the
persisted `personGroups` Dexie store — they live only in in-memory/session
UI state (FR-042c) and are represented by this same shape purely for type
reuse between ad-hoc and named grouping/filtering code paths.

### User

- `gid: string`
- `name: string`
- `email: string | null`

`Unassigned` is represented as a sentinel (`assigneeGid: null` on Task), not a User row (spec: "Unassigned is a valid explicit state, not an omission").

### PriorityField

- `projectGid: string`
- `expectedOptionIds: string[] | null` — the templated option set, if resolvable.
- `status: 'ok' | 'missing' | 'malformed'` — result of the FR-081 validation.

Drives the data-quality panel (FR-084) and the "flag rather than silently
absent" rule (FR-081).

### Dependency

- `taskGid: string`
- `dependsOnTaskGid: string` — the task being waited on ("blocked by").
- `dependsOnTaskAccessible: boolean` — `false` when the target task is outside the token's access or out of scope; treated as still-blocking per the documented conservative rule (Assumptions: "Blocked-work definition").

### Section

- `gid: string`
- `projectGid: string`
- `name: string`

### Task

- `gid: string`
- `name: string`
- `assigneeGid: string | null`
- `projectGids: string[]` — all project memberships, including out-of-scope ones filtered at the reporting layer, not the storage layer, so FR-037 ("show all project memberships" on drill-down) always has full data.
- `parentTaskGid: string | null` — set for subtasks.
- `resourceSubtype: 'default_task' | 'milestone' | 'approval'` — used to exclude milestones/approvals from reportable work (FR-015); only `default_task` rows (standard tasks and subtasks) participate in metrics.
- `createdAt: ISODateTime`
- `modifiedAt: ISODateTime`
- `completedAt: ISODateTime | null`
- `dueAt: ISODateTime | null` (date-only due dates are normalised to a documented time boundary under the active timezone, FR-030)
- `priorityOptionId: string | null` — `null` means "No priority", distinct from `priorityFieldStatus: 'missing' | 'malformed'` at the project level.
- `estimatedMinutes: number | null` — from Asana's "Estimated Time" custom field, normalised to minutes internally regardless of display units (Assumptions: "Human-friendly duration units").
- `actualMinutes: number | null | 'unavailable'` — `'unavailable'` marks a workspace without Time Tracking enabled (Assumptions: "Estimated/Actual time source"), distinct from `null` (tracked but not entered — treated the same as missing for variance purposes, always "not comparable" either way).
- `dependsOnTaskGids: string[]`
- `lastSeenInScopeAt: ISODateTime` — updated every refresh the task is still retrieved in; used to determine "reliably out of scope" (FR-023) rather than inferring loss-of-scope from mere absence in one retrieval pass — see Refresh Session below.
- `outOfScopeReason: 'deleted' | 'project_archived' | 'removed_from_projects' | null` — set only once a refresh positively confirms one of these conditions (never inferred from a single missing appearance).

**In-scope predicate** (applied everywhere "in-scope" is referenced):
`resourceSubtype === 'default_task' AND outOfScopeReason === null AND projectGids.some(pg => isProjectInScope(pg))`.

**Subtask resolution** (FR-014): a subtask's `projectGids` are resolved
from its parent task's `projectGids` at ingestion time in `data/asana`,
since Asana does not always repeat project metadata on the subtask record
— this normalisation happens once, at write time, so `domain/` never needs
parent-lookup logic.

## Derived / local-only entities

### Snapshot

- `workspaceGid: string`
- `localCalendarDate: 'YYYY-MM-DD'` (key, per FR-026a — one row per local day, replaced not appended on same-day re-refresh)
- `incompleteCount: number`
- `incompleteEstimatedMinutes: number`
- `unestimatedIncompleteCount: number`
- `computedFromRefreshId: string` — the Refresh Session that produced/replaced this row.
- `computedAt: ISODateTime`

Snapshots hold **no** team/project/assignee breakdown — reporting-team,
project, and assignee views recompute from live Task rows filtered to
`createdAt <= date`, applying the *current* team mapping (FR-046), so a
mapping change is reflected immediately without invalidating the snapshot
cache. The snapshot exists solely to avoid re-scanning all tasks for the
workspace-level trend line on every render (research.md §11).

### RefreshSession

State machine, one active record at a time plus a bounded history for
"last successful refresh" display:

```
idle → running → { succeeded | partialFailure | cancelled | authFailure | permissionFailure | rateLimited }
```

- `id: string`
- `workspaceGid: string`
- `startedAt: ISODateTime`
- `finishedAt: ISODateTime | null`
- `status: 'running' | 'succeeded' | 'partial_failure' | 'cancelled' | 'auth_failure' | 'permission_failure' | 'rate_limited'`
- `itemsRetrieved: number` — live progress counter (FR-021, NFR-002).
- `errorDetail: string | null`
- `syncMode: 'full' | 'incremental'`

**Commit rule (Principle V / FR-022 / FR-068)**: all writes performed
during a `running` session go to a staging area (an in-memory batch plus a
Dexie transaction) that is only committed — upserting Task/Project/etc.
rows and producing/backfilling Snapshot rows — if the session reaches
`succeeded`. Any other terminal status discards the staged batch entirely;
the previously committed cache and its Snapshots are untouched. This is
the mechanism that satisfies "failed/cancelled/partial refresh MUST NOT
replace a complete cache with partial data."

### CredentialRecord

- `mode: 'session' | 'persistent'`
- `plaintextToken: string` — held only in memory when `mode === 'session'`; never written to IndexedDB.
- `encryptedTokenRecord: { ciphertext: ArrayBuffer; iv: ArrayBuffer; keyRef: CryptoKey } | null` — present only when `mode === 'persistent'` (FR-002a).
- `maskedIdentifier: string` — e.g. last 4 characters, the only representation ever rendered (FR-008).
- `lastValidatedAt: ISODateTime | null`
- `lastValidationResult: 'valid' | 'invalid' | 'network_error' | 'insufficient_permission' | null`

**Transitions**: switching `persistent → session`, or replacing the token
in either mode, MUST synchronously delete the prior
`encryptedTokenRecord` and its `CryptoKey` from IndexedDB before or as part
of the same operation that establishes the new state (FR-005a) — this is
not deferred to the FR-007 full clear-data action. A decrypt failure on
launch (missing/corrupted key or ciphertext) transitions the app straight
to the first-run credential screen, equivalent to `mode` being unset
(FR-002b) — it is not a distinct stored state.

## Cross-cutting reporting types (not persisted — computed in `domain/`)

### FilterCriteria

Composable, all fields optional/combinable (FR-047/FR-048):

- `dateRange: { start: ISODate; end: ISODate; preset: DateRangePreset | 'custom' }`
- `assigneeGids: string[] | 'unassigned' | null`
- `reportingTeamIds: string[] | null`
- `asanaTeamGids: string[] | null`
- `personGroupIds: string[] | null`
- `projectGids: string[] | null`
- `portfolioGids: string[] | null`
- `priorityOptionIds: string[] | 'no_priority' | null`
- `completionState: 'incomplete' | 'complete' | null`
- `overdueState: 'overdue' | 'on_time' | 'no_due_date' | null`
- `estimateState: 'estimated' | 'unestimated' | null`
- `blockedOnly: boolean`
- `stalledOnly: boolean`

`DateRangePreset = 'this_week' | 'last_week' | 'last_30_days' | 'this_month' | 'last_month' | 'this_quarter'` (FR-032), weeks starting Monday (FR-031), evaluated under the active `TimezoneSetting`.

### MetricResult\<TSeries\>

Generic shape every `domain/metrics` calculator returns, so every UI
surface gets drill-down and denominator-visibility for free:

- `population: { total: number; excluded?: { reason: string; count: number }[] }` — e.g. "312 tasks excluded from effort sum: no estimate" (FR-058, FR-049).
- `series: TSeries` — metric-specific payload (e.g. per-bucket counts, per-group totals).
- `contributingTaskGids: string[] | Record<string, string[]>` — exact drill-down set, keyed by bucket/group where the metric is grouped (FR-052, FR-062, FR-067).
- `dedupApplied: true` — literal marker asserting FR-036 was applied; metric unit tests assert this field is present as a lint-visible reminder.
- `asOf: ISODateTime` — the cache's last-successful-refresh timestamp the figure was computed from (feeds FR-090's freshness labelling).

### ViewState

Enumerates every required UI state (FR-085) as a single discriminated
union so a feature component cannot compile against an unhandled case:

`'loading' | 'first_run' | 'empty' | 'cached_stale' | 'offline' | 'invalid_token' | 'insufficient_permission' | 'rate_limited' | 'partial_data' | 'no_results' | 'ready'`

### DataQualityFlag

- `kind: 'missing_assignee' | 'missing_estimate' | 'missing_priority' | 'malformed_priority' | 'missing_due_date' | 'missing_actual_time'`
- `taskGids: string[]`
- `count: number`

Feeds both the FR-084 refresh-summary panel and the FR-079 P2
data-quality-indicators metric from the same underlying scan.

## Relationships summary

```
Workspace 1─* Project *─* Portfolio
Project *─1 AsanaTeam
Project 1─0..1 TeamMappingOverride
Project 1─* Section
Project *─* Task (via Task.projectGids)
Task 0..1─* Task (parentTaskGid → subtasks)
Task *─0..1 User (assigneeGid)
Task 1─* Dependency (outgoing "waiting on")
Task 1─1 PriorityField (via its project; validity resolved per project)
PersonGroup *─* User (memberUserGids)
Workspace 1─* Snapshot (one per local calendar day)
Workspace 1─* RefreshSession
```

## Validation rules index (cross-reference to FRs)

| Rule | Enforced at | FR |
|---|---|---|
| `gid` never parsed/compared as number | `data/asana`, `domain/dedup` types (`string` only) | FR-017 |
| Task never marked out-of-scope from a single missing retrieval | `RefreshSession` commit logic (`outOfScopeReason` only set on positive confirmation) | FR-023 |
| Archived project ⇒ its tasks excluded from retrieval & all reporting | Project.archived checked in `data/asana` ingestion and in-scope predicate | FR-012 |
| Milestones/approvals excluded from reportable metrics | `resourceSubtype` filter in in-scope predicate | FR-015 |
| Effort sums exclude unestimated tasks but disclose the exclusion count | `MetricResult.population.excluded` | FR-058, FR-066 |
| Priority field validated per project, flagged not defaulted | `PriorityField.status` | FR-081, FR-082 |
| Failed/partial refresh cannot corrupt existing cache | `RefreshSession` staged-commit rule | FR-022, FR-068 |
| Token never persisted in plaintext; deleted immediately on mode switch/replace | `CredentialRecord` transitions | FR-002a, FR-005a |
