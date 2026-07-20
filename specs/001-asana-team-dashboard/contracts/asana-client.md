# Contract: Asana API Client (`src/data/asana`)

This is the app's only outbound network boundary. It is read-only by
construction (NFR-004): the module MUST expose no function capable of
issuing a `POST`/`PUT`/`DELETE` against a mutating Asana endpoint. This
contract is what `fixtures/asana/*` (MSW handlers) and `tests/contract/`
validate against.

## Endpoints consumed (all `GET`)

| Purpose | Asana endpoint (representative) | Used for |
|---|---|---|
| Token identity check | `GET /users/me` | "Test token" (FR-004), also confirms auth validity |
| List accessible workspaces | `GET /workspaces` | Workspace selection (FR-011) |
| List projects in workspace | `GET /projects?workspace={gid}&archived=false` | Project scope (FR-012) — `archived=false` requested explicitly; response is still re-validated for `archived` per-item since Asana may return recently-archived items in edge cases |
| Project detail (team, portfolio membership) | `GET /projects/{gid}` | Project→AsanaTeam mapping (FR-041) |
| List portfolios | `GET /portfolios?workspace={gid}` | Portfolio grouping (FR-039) |
| Portfolio items | `GET /portfolios/{gid}/items` | Portfolio→project membership |
| List teams | `GET /teams?workspace={gid}` (or `organizations/{gid}/teams`) | Asana Team roster |
| List/paginate tasks per project | `GET /projects/{gid}/tasks?opt_fields=...` | Task retrieval (FR-014) |
| Task detail (subtask, dependency, custom fields) | `GET /tasks/{gid}?opt_fields=...` | Estimated Time, dependencies, subtask parent (FR-014, FR-016) |
| Subtasks of a task | `GET /tasks/{gid}/subtasks` | Subtask enumeration |
| Task dependencies | `GET /tasks/{gid}/dependencies` | Blocked-work data (FR-016, US9) |
| Users in workspace | `GET /workspace_memberships` or `GET /users?workspace={gid}` | Assignee roster |
| Sections in project | `GET /projects/{gid}/sections` | Section data (FR-016) |
| Incremental sync (where supported) | Asana Events API `GET /events?resource={gid}&sync={token}` | FR-024 incremental retrieval |

`opt_fields` MUST always explicitly list every field the app consumes
(including custom fields for Estimated Time and Priority, and
`resource_subtype`) — never rely on Asana's default field set, since an
Asana-side default change must not silently start/stop populating a field
the app depends on.

## Client function contract

```
type AsanaClientResult<T> =
  | { outcome: 'ok'; data: T }
  | { outcome: 'auth_failure' }
  | { outcome: 'permission_failure'; resource?: string }
  | { outcome: 'rate_limited'; retryAfterMs: number }
  | { outcome: 'network_error'; message: string }
  | { outcome: 'validation_error'; issues: ZodIssue[] };
```

Every exported client function (`testToken`, `listWorkspaces`,
`fetchProjectsPage`, `fetchTasksPage`, `fetchTaskDetail`, `fetchEventsSince`,
…) returns this union — never throws for expected failure modes — so
`RefreshSession` status transitions (data-model.md) map 1:1 onto it
without ad-hoc try/catch branching scattered through the refresh
orchestrator.

- **Pagination**: every list function accepts and returns Asana's
  `offset`-based pagination token; the caller (refresh orchestrator) is
  responsible for looping until exhausted — the client itself is stateless
  per call, which keeps it independently testable one page at a time.
- **Rate limiting**: a `429` response is mapped to `rate_limited` with the
  `Retry-After` header parsed into `retryAfterMs`; the client performs
  no automatic retry — retry/backoff policy is an orchestrator concern
  (kept out of the client so tests can assert orchestrator retry behaviour
  deterministically without real timers leaking into client tests).
- **Validation boundary**: every successful HTTP response is parsed
  through the resource's Zod schema before being returned as `ok`; a
  schema mismatch produces `validation_error` with structured issues (used
  to populate `DataQualityFlag`s and `PriorityField.status`, data-model.md)
  rather than throwing or silently coercing (FR-081/082/083).
- **Token handling**: the client receives the current token via a
  function parameter on each call (never a module-level/global mutable),
  so it never needs to know the credential's storage mode, and cannot
  itself become a place where a token is retained longer than one request.
- **URL/log safety**: the client MUST send the token only as an
  `Authorization: Bearer` header, never as a query parameter, and MUST
  NOT include the token in any thrown error, logged message, or the
  `AsanaClientResult` union's `message`/`issues` fields (FR-008, FR-010).

## Incremental sync fallback contract

`fetchEventsSince(syncToken)` returns `{ outcome: 'ok', data: { events, newSyncToken } }`
on success. The orchestrator MUST treat the following as "stale/invalid
incremental state" requiring a full reconciliation, per FR-024:

- `outcome: 'validation_error'` on the events response,
- Asana's documented `412 Precondition Failed` (expired sync token),
- absence of any previously stored sync token for the current workspace.

Falling back to full reconciliation MUST reuse the same staged-commit path
as a normal full refresh (data-model.md `RefreshSession`), so a fallback
that itself fails mid-way cannot corrupt the existing cache.

## Read-only guarantee (test-verifiable)

`tests/contract/asana-client.readonly.test.ts` MUST assert, by static
scan of the module's exports and by MSW request-log inspection during the
full contract test suite, that no request is issued with method
`POST`, `PUT`, `PATCH`, or `DELETE`. This test is the automated backstop
for NFR-004 and Principle IV's "no Asana API call capable of creating,
editing, completing, assigning, or deleting a resource."
