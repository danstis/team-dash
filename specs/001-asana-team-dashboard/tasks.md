---

description: "Task list for Asana Team Performance & Workload Dashboard"
---

# Tasks: Asana Team Performance & Workload Dashboard

**Input**: Design documents from `/specs/001-asana-team-dashboard/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/asana-client.md, contracts/metrics-engine.md, contracts/storage-repository.md, quickstart.md

**Tests**: Included. Constitution Principle III ("Test-First Quality and Mandatory Automation") makes Red/Green/Refactor and a comprehensive CI gate mandatory for every behaviour-changing task in this repository, so test tasks are not optional here.

**Organization**: Tasks are grouped by user story (P1: US1–US5 form the MVP vertical slice; P2: US6–US10 layer on afterward), matching spec.md's priorities and plan.md's `src/` structure.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task in the same phase)
- **[Story]**: Maps the task to its user story (US1–US10)
- Every task names its exact file path(s)

## Path Conventions

Single frontend project per plan.md: `src/`, `tests/`, `fixtures/`, `docker/` at repository root. No backend/`api` split — the browser calls Asana directly and Docker only serves the static build.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the runnable repository foundation per Constitution Principle I ("CI quality gates, local development workflow, production build, and Docker execution MUST be established before substantial dashboard functionality is added").

- [x] [BSOD-129] T001 Create the source tree per plan.md Project Structure: `src/app/`, `src/features/{credentials,refresh,tasks,metrics,team-mapping,person-groups}/`, `src/domain/{metrics,filtering,dedup,datetime}/`, `src/data/{asana,db,crypto}/`, `src/shared/`, `tests/{unit,contract,integration,e2e}/`, `fixtures/{asana,generators}/`, `docker/`
- [x] [BSOD-130] T002 Initialize `package.json` (name, `"type": "module"`, `engines.node: "24.x"`) and `.nvmrc` pinned to Node 24
- [x] [BSOD-131] T003 Install all runtime and dev dependencies per research.md: `react@19.2`, `react-dom`, `react-router@7`, `dexie@4.4`, `dexie-react-hooks`, `recharts@3.9`, `zod@4.4`, `vite@8.1`, `vite-plugin-pwa@1.3`, `typescript@6.0`, `vitest@4.1`, `@testing-library/react`, `@testing-library/jest-dom`, `msw@2.15`, `@playwright/test@1.61`, `eslint@10.1`, `eslint-plugin-boundaries`, `prettier` — commits `package-lock.json`
- [x] [BSOD-132] T004 [P] Configure `tsconfig.json`: strict mode, ES2022 target, path aliases matching the `src/` layout
- [x] [BSOD-133] T005 [P] Configure `vite.config.ts` with `vite-plugin-pwa` (manifest, service-worker caching strategy placeholder for US2's offline requirement)
- [x] [BSOD-134] T006 [P] Configure `eslint.config.js` (ESLint 10 flat config only) including the `eslint-plugin-boundaries` rule blocking `src/domain/**` from importing `src/features/**`, `react`, or `src/data/asana/**` (research.md §7)
- [x] [BSOD-135] T007 [P] Configure `.prettierrc` and `.prettierignore`
- [x] [BSOD-136] T008 [P] Configure `vitest.config.ts` (jsdom environment) and `tests/setup.ts` (Testing Library matchers, MSW server lifecycle hooks)
- [x] [BSOD-137] T009 [P] Configure `playwright.config.ts` pointing at `tests/e2e/`
- [x] [BSOD-138] T010 [P] Create `index.html` and app entry point `src/main.tsx`
- [x] [BSOD-139] T011 [P] Create `docker/Dockerfile` (multi-stage: `node:24` build stage → `nginx:1.31-alpine` runtime stage)
- [x] [BSOD-140] T012 [P] Create `docker/nginx.conf` (SPA fallback routing; service-worker file served `Cache-Control: no-cache`; hashed assets long-cache)
- [x] [BSOD-141] T013 Add npm scripts to `package.json`: `dev`, `build`, `lint`, `format:check`, `typecheck`, `test:unit`, `test:contract`, `test:e2e`
- [x] [BSOD-142] T014 [P] Create `.github/workflows/ci.yml` running, per Principle III: install → lint → format:check → typecheck → test:unit → test:contract → build → PWA/service-worker output check → docker build → test:e2e
- [x] [BSOD-261] T014.1 [P] Parallelise `.github/workflows/ci.yml` so the Principle III gate fans out: 6 jobs off `install` (lint, format:check, typecheck, test:unit, test:contract, build), 2 jobs off `build` (pwa-check, docker-build) with `test:e2e` also waiting for `docker-build` (artifact dependency), then `sonar` → quality-gate — preserves all artifact wiring and SHA pins from T014, no `continue-on-error` / `if: always()` on required jobs
- [x] [BSOD-295] T014a [P] Wire `tests/integration/**` into CI: add the `test:integration` npm script, insert a required `test-integration` job into the parallelised workflow (peers with `test-unit`/`test-contract`/`build`, `needs: install`), include it in `sonar`'s `needs:`, and document the gate in `specs/001-asana-team-dashboard/quickstart.md`
- [x] [BSOD-143] T015 [P] Write `README.md` covering product boundary, prerequisites, PAT risks, local dev, testing, Docker deployment, browser-storage implications, offline limitations, data-clearing steps, and troubleshooting (Constitution Principle VIII)

**Checkpoint**: `npm run dev` serves an empty shell; `npm run lint`/`typecheck`/`build` all pass on a trivial app.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, storage schema, the Asana client boundary, and encryption — nothing in any user story compiles without these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] [BSOD-144] T016 [P] Define cross-cutting domain types (`FilterCriteria`, `MetricContext`, `MetricResult<T>`, `ViewState`, `DataQualityFlag`) per data-model.md in `src/domain/types.ts`
- [x] [BSOD-145] T017 [P] Implement `dedupeByGid` helper in `src/domain/dedup/dedupeByGid.ts`
- [x] [BSOD-146] T018 [P] Implement datetime helpers (local/UTC timezone basis, Monday week-start, date-bucket width selection) in `src/domain/datetime/index.ts`
- [x] [BSOD-147] T019 [P] Unit tests for `dedupeByGid` in `tests/unit/domain/dedup/dedupeByGid.test.ts`
- [x] [BSOD-148] T020 [P] Unit tests for datetime helpers (timezone switch recalculation, Monday week-start, bucket-width determinism) in `tests/unit/domain/datetime/index.test.ts`
- [x] [BSOD-149] T021 Define the full Dexie schema (`workspaces`, `projects`, `portfolios`, `asanaTeams`, `teamMappingOverrides`, `personGroups`, `users`, `priorityFields`, `dependencies`, `sections`, `tasks`, `snapshots`, `refreshSessions`, `credentials`) exactly per contracts/storage-repository.md in `src/data/db/schema.ts`
- [x] [BSOD-150] T022 [P] Contract test asserting the live Dexie schema matches contracts/storage-repository.md in `tests/contract/db-schema.test.ts`
- [x] [BSOD-151] T023 [P] Define Asana Zod resource schemas (workspace, project, portfolio, team, task incl. custom fields, user, section, dependency) in `src/data/asana/schemas.ts`
- [x] [BSOD-152] T024 [P] Define the `AsanaClientResult<T>` outcome union in `src/data/asana/types.ts`
- [x] [BSOD-153] T025 Implement the base Asana HTTP client (per-call token parameter, `Authorization: Bearer` header only, Zod validation boundary before returning `ok`, `429`→`rate_limited` with parsed `Retry-After`, offset-pagination passthrough) in `src/data/asana/client.ts`
- [x] [BSOD-154] T026 [P] Contract test asserting no exported client function issues `POST`/`PUT`/`PATCH`/`DELETE` (static export scan + MSW request-log inspection) in `tests/contract/asana-client.readonly.test.ts`
- [x] [BSOD-155] T027 [P] Implement token encrypt/decrypt via Web Crypto AES-GCM with a non-extractable `generateKey` in `src/data/crypto/token-crypto.ts`
- [x] [BSOD-156] T028 [P] Unit tests for token-crypto round-trip and decrypt-failure fallback behaviour in `tests/unit/data/crypto/token-crypto.test.ts`
- [x] [BSOD-157] T029 [P] Create MSW request handlers and the small fixture dataset (workspaces, projects, tasks incl. a multi-project task, a subtask, and tasks with/without estimates) in `fixtures/asana/small-dataset/`
- [x] [BSOD-158] T030 [P] Wire the MSW server for dev and tests in `src/mocks/browser.ts`, `src/mocks/server.ts`
- [x] [BSOD-159] T031 Implement the app shell: routing, layout, and top-level credential/workspace context providers in `src/app/App.tsx`, `src/app/router.tsx`
- [x] [BSOD-160] T032 [P] Implement shared `ViewState`-driven UI primitives (loading/empty/first-run/no-results/stale/offline/invalid-token/insufficient-permission/rate-limited/partial-data) in `src/shared/states/`
- [x] [BSOD-161] T033 [P] Implement shared formatting helpers (duration → human-friendly units retaining internal precision, date formatting) in `src/shared/format/`

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Connect to Asana safely and choose a workspace (Priority: P1) 🎯 MVP

**Goal**: Validated-token → workspace-selection entry point; nothing else in the product is reachable without it.

**Independent Test**: Using MSW, enter a token, get a successful "test token" result, choose session-only mode, select a workspace, land on the empty/first-run dashboard.

### Tests for User Story 1

- [x] [BSOD-162] T034 [P] [US1] Contract test `testToken`/`listWorkspaces` success and failure outcomes (invalid token, network error, insufficient permission) via MSW in `tests/contract/asana-client.auth.test.ts`
- [x] [BSOD-163] T035 [P] [US1] Integration test: first-run screen blocks reporting screens until token+workspace are set in `tests/integration/credentials/first-run.test.tsx`
- [x] [BSOD-164] T036 [P] [US1] Integration test: persistent-storage risk disclosure requires explicit confirmation; declining falls back to session-only in `tests/integration/credentials/persistent-storage-confirmation.test.tsx`
- [x] [BSOD-165] T037 [P] [US1] Integration test: Settings panel retest/replace/switch-mode/clear-all actions in `tests/integration/credentials/settings-panel.test.tsx`
- [x] [BSOD-166] T038 [P] [US1] Integration test: token is never rendered, logged, or embedded in a URL — only a masked identifier appears in `tests/integration/credentials/token-masking.test.tsx`

### Implementation for User Story 1

- [x] [BSOD-167] T039 [US1] Implement `testToken` and `listWorkspaces` client functions in `src/data/asana/client.ts`
- [x] [BSOD-168] T040 [US1] Implement `CredentialRepository` (`getCurrent`, `setSessionToken`, `setPersistentToken` w/ FR-005a immediate deletion of the prior encrypted record, `clearToSessionOnly`, `clearAll` spanning every store in one transaction per FR-007) in `src/data/db/repositories/credential.repository.ts`
- [x] [BSOD-169] T041 [US1] Implement `TokenEntryForm` and `TestTokenButton` in `src/features/credentials/TokenEntry.tsx`
- [x] [BSOD-170] T042 [US1] Implement `StorageModeSelector` with risk disclosure and explicit confirmation step in `src/features/credentials/StorageModeSelector.tsx`
- [x] [BSOD-171] T043 [US1] Implement `WorkspaceSelector` (single-select from the validated token's accessible workspaces) in `src/features/credentials/WorkspaceSelector.tsx`
- [x] [BSOD-172] T044 [US1] Implement the shared masked-token display component (last-4-characters only) in `src/shared/components/MaskedToken.tsx`
- [x] [BSOD-173] T045 [US1] Implement the Settings credentials panel (retest, replace, switch storage mode, single clear-all action) in `src/features/credentials/SettingsCredentialsPanel.tsx`
- [x] [BSOD-174] T046 [US1] Wire a route guard in `src/app/router.tsx` blocking reporting routes until token+workspace are validated

**Checkpoint**: User Story 1 fully functional and independently testable.

---

## Phase 4: User Story 2 - Retrieve and cache workspace data with transparent refresh status (Priority: P1)

**Goal**: Manual refresh retrieves and caches Asana data with visible progress/outcome/freshness at every stage, and a failed/partial refresh never corrupts the existing cache.

**Independent Test**: Trigger Refresh against MSW, verify progress feedback and a success state with timestamp; reload and see the same cached data marked "cached"; simulate a mid-refresh network failure and verify the previous good cache remains intact.

### User Story 2 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

- [x] [BSOD-301] T047 [P] [US2] `RefreshStagingRepository` red→green — write the `discard()`/`commit()` contract test in `tests/contract/refresh-staging.test.ts` (asserting `discard()` leaves `getInScopeTasks()` byte-identical to pre-staging state and `commit()` after a simulated mid-batch throw never partially applies); confirm it fails for the intended reason; then implement `RefreshStagingRepository` (`beginStaging`/`stageUpsert`/`commit`/`discard`, single Dexie transaction) in `src/data/db/repositories/refresh-staging.repository.ts` so the test passes. **Sequential prerequisite: T055** (the `getInScopeTasks()` the test asserts against must exist).
- [ ] [BSOD-302] T048 [P] [US2] Asana client pagination + events-since red→green — write the pagination and `fetchEventsSince` stale/invalid-state contract test in `tests/contract/asana-client.pagination.test.ts` (validation error, `412`, no prior sync token) via MSW; confirm it fails; then implement `fetchProjectsPage`, `fetchTasksPage`, `fetchTaskDetail`, `fetchEventsSince` in `src/data/asana/client.ts` so all cases pass.
- [ ] [BSOD-303] T049 [US2] Refresh success outcome red→green — write the refresh-success integration test in `tests/integration/refresh/refresh-success.test.tsx` (progress then success state with completion timestamp); confirm it fails; then implement `RefreshButton`, `ProgressIndicator`, and the success / partial-failure rendering of `OutcomeBanner` in `src/features/refresh/RefreshControls.tsx` so the test passes. **Sequential: T049 must close before T051** (T051 extends `OutcomeBanner` with the failure-reason rendering and shares the same file).
- [ ] [BSOD-304] T050 [P] [US2] `FreshnessBanner` + offline-disabled Refresh red→green — write the cached-reload integration test in `tests/integration/refresh/cached-reload.test.tsx` (cached data labelled, last-refresh time); confirm it fails; then implement `FreshnessBanner` (cached-vs-fresh, last-refresh timestamp) and the offline-disabled Refresh state in `src/features/refresh/FreshnessBanner.tsx` so the test passes.
- [ ] [BSOD-305] T051 [US2] Refresh failure integrity red→green — write the failure-mid-refresh integration test in `tests/integration/refresh/refresh-failure-integrity.test.tsx` (network failure / auth failure / rate-limit / user-cancel each report the specific reason and the previous complete cache is fully intact); confirm it fails; then implement the orchestrator's failure semantics in `src/data/refresh/refresh-orchestrator.ts` (pagination loop, incremental/full fallback on stale sync state per FR-024, live progress counter, staged-commit-on-success-only per data-model.md's `RefreshSession`) and the failure-reason rendering in `OutcomeBanner` (cancelled / auth-failure / permission-failure / rate-limited). **Sequential after T049.**
- [ ] [BSOD-306] T052 [P] [US2] `SnapshotRepository` red→green — write the same-day-snapshot replacement integration test in `tests/integration/refresh/same-day-snapshot.test.tsx` (a second successful refresh the same local calendar day replaces, not duplicates, that day's snapshot); confirm it fails; then implement `SnapshotRepository` (`getSnapshot`, `backfillSnapshots`), callable only from `RefreshStagingRepository.commit()`, in `src/data/db/repositories/snapshot.repository.ts` so the test passes.
- [ ] [BSOD-307] T053 [P] [US2] Service-worker offline caching red→green — write the offline-reload e2e in `tests/e2e/offline.spec.ts` (last cached dashboard shown, Refresh visibly disabled and explained); confirm it fails; then configure service-worker offline caching of the app shell and last complete cache via `vite-plugin-pwa` in `vite.config.ts`.
- [x] [BSOD-308] T055 [US2] `CacheRepository` red→green — write the `CacheRepository` contract test in `tests/contract/cache.repository.test.ts` (in-scope predicate, `markTasksOutOfScope` requiring an explicit reasoned `outOfScopeReason`, `getInScopeTasks` applying the in-scope predicate, upsert by `gid`); confirm it fails; then implement `CacheRepository` (`upsertProjects`/`upsertTasks`/... per entity, `markTasksOutOfScope`, `getInScopeTasks`) in `src/data/db/repositories/cache.repository.ts` so the test passes. **Sequential prerequisite for T047** — T047's contract test asserts `discard()` leaves `getInScopeTasks()` byte-identical, which requires T055's `getInScopeTasks()` to exist.
- [ ] [BSOD-309] T058 [P] [US2] Subtask project-membership resolution red→green — write the integration test (e.g. `tests/integration/data/subtask-resolution.test.tsx` or unit test `tests/unit/data/asana/normalise.test.ts`) asserting a subtask's `projectGids` are resolved from its parent task's `projectGids` at ingestion time per FR-014; confirm it fails; then implement the resolution in `src/data/asana/normalise.ts` so the test passes.
- [ ] [BSOD-310] T062 [P] [US2] Empty-dashboard first-run state red→green — write the integration test in `tests/integration/refresh/empty-dashboard.test.tsx` (first-run / empty dashboard directs the user to run a refresh); confirm it fails; then implement `EmptyDashboard` in `src/features/refresh/EmptyDashboard.tsx` so the test passes.
- [ ] [BSOD-311] T064 [P] [US2] FR-084 data-quality summary red→green — write the integration test in `tests/integration/refresh/data-quality-summary.test.tsx` (counts of `validation_error` issues from the most recent refresh are surfaced); confirm it fails; then implement `DataQualitySummary` in `src/features/refresh/DataQualitySummary.tsx` so the test passes.

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Browse and filter the task list with drill-down (Priority: P1)

**Goal**: A filterable, verifiable task table with full drill-down to source task detail — the trust anchor for every summary metric.

**Independent Test**: Open the task table, apply date-range + assignee filters together, confirm row count changes and filters stay listed, clear filters, open a multi-project task's detail.

### User Story 3 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

- [ ] [BSOD-314] T065 [P] [US3] `FilterCriteria` predicates red→green — write the composable-predicate unit tests in `tests/unit/domain/filtering/filters.test.ts` (date range, assignee incl. "unassigned", project, completion state, combinations); confirm they fail for the intended reason; then implement the composable `FilterCriteria` predicates in `src/domain/filtering/filters.ts` so all cases pass.
- [ ] [BSOD-315] T066 [P] [US3] Task-list filter UI red→green — write the combined-filter integration test in `tests/integration/tasks/task-table-filters.test.tsx` (combined date-range + assignee filter updates row count, active filters remain listed, clear-all restores the full list); confirm it fails; then implement `TaskTable` (name, assignee, project(s), priority, dates, completion state, estimate/actual) in `src/features/tasks/TaskTable.tsx`, `FilterBar` (date-range presets incl. custom, assignee, project, completion state) in `src/features/tasks/FilterBar.tsx`, and `ActiveFiltersList` (clear-all action) in `src/features/tasks/ActiveFiltersList.tsx` so the test passes.
- [ ] [BSOD-316] T067 [P] [US3] `TaskDetailDrawer` red→green — write the task-detail integration test in `tests/integration/tasks/task-detail-drilldown.test.tsx` (all project memberships, dependencies, Open-in-Asana link with no token in URL/request); confirm it fails; then implement `TaskDetailDrawer` (all project memberships, dependencies, Open-in-Asana link builder that never embeds the token) in `src/features/tasks/TaskDetailDrawer.tsx` so the test passes.
- [ ] [BSOD-317] T068 [P] [US3] `NoResultsState` red→green — write the no-results integration test in `tests/integration/tasks/no-results.test.tsx` (zero-match filter combination shows explicit no-results state); confirm it fails; then implement `NoResultsState` in `src/features/tasks/NoResultsState.tsx` so the test passes.

**Checkpoint**: User Stories 1–3 all work independently.

---

## Phase 6: User Story 4 - See work added versus work completed over time (Priority: P1)

**Goal**: The MVP's primary reporting outcome — created vs. completed tasks/effort over time, grouped and drillable.

**Independent Test**: Select "last 30 days," verify created/completed counts and effort sums against a hand-computed fixture, switch to the effort view, group by team member, drill into one chart point.

### User Story 4 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

- [ ] [BSOD-318] T075 [P] [US4] `calculateWorkAddedVsCompleted` metric + reference fixture red→green — create `fixtures/asana/small-dataset/expected-metrics.json` with hand-computed reference values for quickstart.md step 8 / SC-005; write the `calculateWorkAddedVsCompleted` unit test in `tests/unit/domain/metrics/workAddedCompleted.test.ts` (exact figures against the hand-computed fixture, dedup for a multi-project task, drill-down parity, unestimated-exclusion disclosure, `groupBy` incl. explicit `unassigned`/`no_priority` keys); confirm it fails for the intended reason; then implement `calculateWorkAddedVsCompleted` per contracts/metrics-engine.md (auto-sized buckets, independent created/completed scans, `groupBy`, `dedupeByGid`-backed dedup) in `src/domain/metrics/workAddedCompleted.ts` so the test passes.
- [ ] [BSOD-319] T076 [P] [US4] `WorkAddedCompletedChart` integration red→green — write the integration test in `tests/integration/metrics/work-added-completed.test.tsx` (chart renders created/completed per bucket, count↔effort toggle, `groupBy` split, drill-down list matches the displayed figure); confirm it fails; then implement `WorkAddedCompletedChart` (Recharts, paired with an accessible data-table alternative) in `src/features/metrics/WorkAddedCompletedChart.tsx` so the test passes.
- [ ] [BSOD-320] T080 [P] [US4] `ChartControls` red→green — write the chart-controls integration test in `tests/integration/metrics/chart-controls.test.tsx` (count↔effort toggle and `groupBy` selector render and dispatch the right state changes; reused by US5 backlog and US8 delivery views); confirm it fails; then implement `CountEffortToggle` and `GroupBySelector` (assignee/team/project/portfolio/priority) in `src/features/metrics/ChartControls.tsx` so the test passes.
- [ ] [BSOD-321] T081 [P] [US4] `DrillDownPanel` red→green — write the integration test in `tests/integration/metrics/drill-down-panel.test.tsx` (chart-point/series drill-down panel reuses `TaskTable`/`TaskDetailDrawer` and the rendered list matches the displayed figure); confirm it fails; then implement `DrillDownPanel` in `src/features/metrics/DrillDownPanel.tsx` so the test passes.

**Checkpoint**: User Stories 1–4 all work independently.

---

## Phase 7: User Story 5 - Track backlog size and direction (Priority: P1)

**Goal**: Current incomplete count/effort plus a reconstructed growth/shrink/flat trend, available from the very first refresh.

**Independent Test**: With a single completed refresh, load the backlog view, confirm current incomplete count/effort, confirm the trend reconstructs from task dates alone, filter to one project, confirm unestimated backlog is shown separately.

### User Story 5 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

- [ ] [BSOD-322] T082 [P] [US5] Backlog metric red→green — write the unit test in `tests/unit/domain/metrics/backlog.test.ts` for `calculateBacklogCurrent` and `calculateBacklogDirection` (reconstruction predicate `createdAt <= d && (completedAt == null || completedAt > d)`, retroactive-current-estimate disclosure, up/down/flat trend, dedup, per-point drill-down parity); confirm it fails for the intended reason; then implement both calculators as the single reconstruction-predicate implementation (research.md §11) in `src/domain/metrics/backlog.ts` so the test passes.
- [ ] [BSOD-323] T085 [P] [US5] `SnapshotRepository.backfillSnapshots` wiring red→green — write the contract test in `tests/contract/snapshot-backfill.test.ts` (a successful commit on `RefreshStagingRepository` invokes `backfillSnapshots`, which calls `calculateBacklogDirection` as its sole computation path — no parallel reimplementation); confirm it fails; then wire `SnapshotRepository.backfillSnapshots` to call `calculateBacklogDirection` in `src/data/db/repositories/snapshot.repository.ts` so the test passes. **Sequential after T082** — the wiring needs the metric to exist.
- [ ] [BSOD-324] T087 [P] [US5] `BacklogDrillDown` red→green — write the integration test in `tests/integration/metrics/backlog-drill-down.test.tsx` (per-point contributing incomplete-task list renders with working drill-back to `TaskDetailDrawer`); confirm it fails; then implement `BacklogDrillDown` in `src/features/metrics/BacklogDrillDown.tsx` so the test passes. **Sequential after T082** — uses the metric's data shape.
- [ ] [BSOD-325] T083 [US5] `BacklogView` integration red→green — write the integration test in `tests/integration/metrics/backlog.test.tsx` (a single completed refresh shows current count/effort, unestimated-separate figure, and a reconstructed trend with no prior-day refresh required; project filter works; drill-down works); confirm it fails; then implement `BacklogView` (current count/effort cards, unestimated-separate figure, directional trend chart, workspace/reporting-team/Asana-team/project/portfolio/assignee scoping) in `src/features/metrics/BacklogView.tsx` so the test passes. **Sequential after T082, T085, T087.**

**Checkpoint**: P1 vertical slice (User Stories 1–5) complete — MVP ready to demo.

---

## Phase 8: User Story 6 - Configure reporting team mappings (Priority: P2)

**Goal**: Local override of the Asana-team-owns-project default so team-level reporting matches how the organisation actually operates.

**Independent Test**: Override one project's reporting team, confirm team-level charts immediately reflect it, confirm "locally overridden" labelling, confirm persistence after reload.

### User Story 6 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

- [ ] [BSOD-327] T088 [P] [US6] Reporting-team resolution red→green — write the unit test in `tests/unit/domain/team-mapping.test.ts` (override precedence over Asana default, synthetic "No Asana Team" fallback bucket); confirm it fails for the intended reason; then implement the reporting-team resolution helper (`override?.reportingTeamGid ?? project.asanaTeamGid`, with `source: 'asana' | 'override'`) in `src/domain/team-mapping.ts` so the test passes.
- [ ] [BSOD-328] T090 [P] [US6] `TeamMappingRepository` red→green — write the contract test in `tests/contract/team-mapping-repository.test.ts` (`getOverrides`/`setOverride`/`removeOverride`; the repo is never touched by `RefreshStagingRepository.commit()`); confirm it fails; then implement `TeamMappingRepository` in `src/data/db/repositories/team-mapping.repository.ts` so the test passes.
- [ ] [BSOD-329] T089 [P] [US6] `TeamMappingSettings` integration red→green — write the integration test in `tests/integration/team-mapping/override.test.tsx` (setting/removing an override updates team-level charts immediately, labels the source correctly, and persists across reload); confirm it fails; then implement the Team Mapping settings UI (per-project override list with source labels) in `src/features/team-mapping/TeamMappingSettings.tsx` so the test passes.

**Checkpoint**: User Stories 1–6 all work independently.

---

## Phase 9: User Story 7 - Review current assigned workload per person (Priority: P2)

**Goal**: Per-team-member current incomplete count/effort, including an explicit "Unassigned" bucket.

**Independent Test**: Open the workload view, confirm each assignee's count/effort (incl. Unassigned) matches the fixture, drill into one assignee.

### User Story 7 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

- [ ] [BSOD-330] T093 [P] [US7] `calculateAssignedWorkload` red→green — write the unit test in `tests/unit/domain/metrics/assignedWorkload.test.ts` (per-assignee count/effort, explicit Unassigned bucket, dedup, drill-down); confirm it fails for the intended reason; then implement `calculateAssignedWorkload` per the shared metric contract in `src/domain/metrics/assignedWorkload.ts` so the test passes.
- [ ] [BSOD-331] T094 [P] [US7] `WorkloadView` integration red→green — write the integration test in `tests/integration/metrics/workload.test.tsx` (workload view matches fixture figures incl. Unassigned row, per-assignee drill-down); confirm it fails; then implement `WorkloadView` (per-assignee cards/table incl. Unassigned, drill-down) in `src/features/metrics/WorkloadView.tsx` so the test passes. **Sequential after T093** — the integration test exercises the metric.

**Checkpoint**: User Stories 1–7 all work independently.

---

## Phase 10: User Story 8 - Analyse completed work, on-time delivery, and priority breakdown (Priority: P2)

**Goal**: Completed-over-time, overdue, on-time-rate, and priority-breakdown views extending the P1 delivery story.

**Independent Test**: With on-time/overdue/no-due-date fixture tasks, verify overdue only counts incomplete-past-due tasks, verify the on-time-rate denominator excludes no-due-date tasks, verify priority-grouped totals sum to the ungrouped total.

### User Story 8 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

The four delivery calculators all live in `src/domain/metrics/delivery.ts`, so the calculator rows form a sequential chain — each row adds one calculator to the existing module. T097 ships first; subsequent calculators can only land once their predecessors have closed.

- [ ] [BSOD-332] T097 [P] [US8] `calculateCompletedOverTime` red→green — write the unit test in `tests/unit/domain/metrics/completedOverTime.test.ts` (mirrors Work Completed definition); confirm it fails; then implement `calculateCompletedOverTime` in `src/domain/metrics/delivery.ts` so the test passes.
- [ ] [BSOD-333] T098 [P] [US8] `calculateOverdue` red→green — write the unit test in `tests/unit/domain/metrics/overdue.test.ts` (incomplete + due-date-in-past under selected timezone only; completed tasks never overdue); confirm it fails; then implement `calculateOverdue` in `src/domain/metrics/delivery.ts` so the test passes. **Sequential after T097.**
- [ ] [BSOD-334] T099 [P] [US8] `calculateOnTimeRate` red→green — write the unit test in `tests/unit/domain/metrics/onTimeRate.test.ts` (denominator = completed-with-due-date, excluded no-due-date count shown, `{ notApplicable: true }` on zero denominator); confirm it fails; then implement `calculateOnTimeRate` in `src/domain/metrics/delivery.ts` so the test passes. **Sequential after T098.**
- [ ] [BSOD-335] T100 [P] [US8] `calculateCompletedByPriority` red→green — write the unit test in `tests/unit/domain/metrics/completedByPriority.test.ts` ("No priority" group, group sums equal the ungrouped total); confirm it fails; then implement `calculateCompletedByPriority` in `src/domain/metrics/delivery.ts` so the test passes. **Sequential after T099.**
- [ ] [BSOD-336] T101 [P] [US8] `DeliveryQualityViews` integration red→green — write the integration test in `tests/integration/metrics/delivery-quality.test.tsx` (completed/overdue/on-time-rate/priority-breakdown views render fixture-expected figures); confirm it fails; then implement `CompletedOverTimeView`, `OverdueView`, `OnTimeRateView`, `PriorityBreakdownView` in `src/features/metrics/DeliveryQualityViews.tsx` so the test passes. **Sequential after T100.**

**Checkpoint**: User Stories 1–8 all work independently.

---

## Phase 11: User Story 9 - Investigate estimate accuracy, blocked work, and stalled work (Priority: P2)

**Goal**: Estimate-vs-actual variance, blocked-work, and stalled-work diagnostics.

**Independent Test**: Verify variance handling of matching/over/under/zero/missing estimates, verify dependency-based blocked flagging, verify configurable stalled threshold.

### User Story 9 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

The three diagnostics calculators all live in `src/domain/metrics/diagnostics.ts`, so the calculator rows form a sequential chain — each row adds one calculator to the existing module. T104 ships first; subsequent calculators can only land once their predecessors have closed.

- [ ] [BSOD-337] T104 [P] [US9] `calculateEstimateVariance` red→green — write the unit test in `tests/unit/domain/metrics/estimateVariance.test.ts` (absolute/percentage variance, `'not comparable'` for zero/missing estimate or actual, excluded from averages but counted in totals); confirm it fails; then implement `calculateEstimateVariance` in `src/domain/metrics/diagnostics.ts` so the test passes.
- [ ] [BSOD-338] T105 [P] [US9] `calculateBlocked` red→green — write the unit test in `tests/unit/domain/metrics/blocked.test.ts` (incomplete dependency triggers blocked; a dependency outside token access/scope is conservatively treated as still-blocking and disclosed); confirm it fails; then implement `calculateBlocked` in `src/domain/metrics/diagnostics.ts` so the test passes. **Sequential after T104.**
- [ ] [BSOD-339] T106 [P] [US9] `calculateStalled` red→green — write the unit test in `tests/unit/domain/metrics/stalled.test.ts` (configurable threshold, documented default of 14 days, re-evaluates when the threshold changes); confirm it fails; then implement `calculateStalled` in `src/domain/metrics/diagnostics.ts` so the test passes. **Sequential after T105.**
- [ ] [BSOD-340] T107 [P] [US9] `DiagnosticsViews` integration red→green — write the integration test in `tests/integration/metrics/diagnostics.test.tsx` (variance/blocked/stalled views plus the configurable stalled-threshold control render fixture-expected figures and re-evaluate when the threshold changes); confirm it fails; then implement `EstimateVarianceView`, `BlockedWorkView`, `StalledWorkView`, and the stalled-threshold setting control in `src/features/metrics/DiagnosticsViews.tsx` so the test passes. **Sequential after T106.**

**Checkpoint**: User Stories 1–9 all work independently.

---

## Phase 12: User Story 10 - Review task age, cycle time, and data-quality gaps (Priority: P2)

**Goal**: Average incomplete-task age, completed-task cycle time, and a data-quality gap summary.

**Independent Test**: Verify average-age and cycle-time figures against hand calculations; verify the data-quality panel matches a manual tally of fixture gaps.

### User Story 10 — single-task red→green delivery

Each row below is one atomic deliverable: write the failing test for the intended reason, then implement so the test passes. The whole row closes as one PR with CI green at every commit. Cross-task "stub to unblock CI" commits are forbidden per `plan.md:51` and `constitution.md:248–253`.

The three task-health calculators all live in `src/domain/metrics/taskHealth.ts`, so the calculator rows form a sequential chain — each row adds one calculator to the existing module. T110 ships first; subsequent calculators can only land once their predecessors have closed.

- [ ] [BSOD-341] T110 [P] [US10] `calculateAverageAge` red→green — write the unit test in `tests/unit/domain/metrics/averageAge.test.ts` (mean of now − creation date, dedup); confirm it fails; then implement `calculateAverageAge` in `src/domain/metrics/taskHealth.ts` so the test passes.
- [ ] [BSOD-342] T111 [P] [US10] `calculateCycleTime` red→green — write the unit test in `tests/unit/domain/metrics/cycleTime.test.ts` (completion date − creation date, dedup); confirm it fails; then implement `calculateCycleTime` in `src/domain/metrics/taskHealth.ts` so the test passes. **Sequential after T110.**
- [ ] [BSOD-343] T112 [P] [US10] `calculateDataQuality` red→green — write the unit test in `tests/unit/domain/metrics/dataQuality.test.ts` (counts of missing assignee/estimate/priority/due-date/actual-time, each drillable); confirm it fails; then implement `calculateDataQuality` in `src/domain/metrics/taskHealth.ts` so the test passes. **Sequential after T111.**
- [ ] [BSOD-344] T113 [P] [US10] `TaskHealthViews` integration red→green — write the integration test in `tests/integration/metrics/task-health.test.tsx` (average-age, cycle-time, and data-quality panel render fixture-expected figures with working drill-down); confirm it fails; then implement `AverageAgeView`, `CycleTimeView`, `DataQualityPanel` in `src/features/metrics/TaskHealthViews.tsx` so the test passes. **Sequential after T112.**

**Checkpoint**: All ten user stories independently functional.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Person Groups (a cross-cutting filter/grouping dimension spanning FR-042a–e, not its own prioritised user story), performance validation at scale, accessibility, and final end-to-end verification.

- [ ] [BSOD-244] T116 [P] Implement `PersonGroupRepository` (`listNamed`/`saveNamed`/`deleteNamed`; throws on `kind: 'adhoc'`) in `src/data/db/repositories/person-group.repository.ts`
- [ ] [BSOD-245] T117 [P] Unit test Person Group multi-membership attribution (FR-042e, mirroring the FR-045 multi-team rule; workspace totals stay deduplicated) in `tests/unit/domain/person-groups.test.ts`
- [ ] [BSOD-246] T118 Implement the ad-hoc Person Group session context (add/remove members, resets on reload, never persisted per FR-042c) in `src/features/person-groups/AdhocPersonGroupContext.tsx`
- [ ] [BSOD-247] T119 Implement named Person Group management UI (save/rename/edit-membership/delete, scoped to the current workspace) in `src/features/person-groups/PersonGroupSettings.tsx`
- [ ] [BSOD-248] T120 Wire Person Group as a filter and grouping dimension into `FilterBar`, `GroupBySelector`, and every metric calculator's `groupBy` union in `src/domain/filtering/filters.ts` and `src/features/metrics/ChartControls.tsx`
- [ ] [BSOD-249] T121 [P] Generate the 25,000-task performance fixture in `fixtures/generators/large-dataset.ts` and `fixtures/asana/large-dataset/`
- [ ] [BSOD-250] T122 Verify performance budgets against the 25k fixture (SC-002 ≤2s cached load, SC-003 ≤1s filter/group update, SC-004 non-freezing refresh with continuous progress) and record the results
- [ ] [BSOD-251] T123 [P] Accessibility pass: keyboard operability, ARIA labels, contrast, non-colour-only chart distinctions, tabular alternatives (FR-088) verified via Playwright + axe in `tests/e2e/accessibility.spec.ts`
- [ ] [BSOD-252] T124 [P] e2e test: full first-run → refresh → dashboard flow in `tests/e2e/first-run-flow.spec.ts`
- [ ] [BSOD-253] T125 [P] e2e test: PWA install and service-worker activation in `tests/e2e/pwa-install.spec.ts`
- [ ] [BSOD-254] T126 Run quickstart.md steps 1–7 end-to-end and confirm every "Done-when" checklist item passes
- [ ] [BSOD-255] T127 Validate the Docker image build and run against quickstart.md step 6 (identical first-run flow through the built container)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Stories (Phase 3–12)**: All depend on Foundational completion.
  - P1 stories (US1–US5, Phases 3–7) should be completed in priority order since each later P1 story's manual verification assumes the earlier ones work (US2 needs a workspace from US1; US4/US5 need cached data from US2; US3's task table underlies US4/US5's drill-down), even though each story's automated tests are independently fixture-driven.
  - P2 stories (US6–US10, Phases 8–12) can proceed in any order, or in parallel by different developers, once Phase 7 (the P1 slice) is complete.
- **Polish (Phase 13)**: Depends on all desired user stories being complete; T121–T122 (performance) and T126–T127 (final verification) should run last.

### User Story Dependencies

- **US1 (P1)**: No dependencies beyond Foundational.
- **US2 (P1)**: Functionally needs a selected workspace (US1) to have data to refresh; automated tests use MSW fixtures independently of US1's UI.
- **US3 (P1)**: Needs cached data (US2) to have tasks to browse; filter/table logic itself is independently testable against a fixture.
- **US4 (P1)**: Needs cached data (US2); reuses US3's task table/detail components for drill-down.
- **US5 (P1)**: Needs cached data (US2); independent of US3/US4 metric logic but shares drill-down UI patterns.
- **US6–US10 (P2)**: Each depends on Foundational + the relevant P1 metric/data groundwork (e.g., US6 depends on Project/AsanaTeam data from Foundational; US7–US10 depend on Task cache fields already modelled in Foundational/US2) but not on each other.

### Within Each User Story

- Tests MUST be written and FAIL before implementation (Constitution Principle III).
- Repositories/domain calculators before the UI components that consume them.
- Story complete and its checkpoint verified before moving to the next priority.

### Parallel Opportunities

- All `[P]`-marked Setup tasks (T004–T012, T014–T015) can run in parallel once T001–T003 land.
- All `[P]`-marked Foundational tasks can run in parallel once T001–T015 land, subject to same-file ordering (T021 schema before T022's contract test can be written but not passed).
- All test tasks within a user story phase marked `[P]` can run in parallel with each other.
- Once Phase 7 (P1 slice) completes, US6–US10 (Phases 8–12) can be staffed and run in parallel by different developers.

---

## Parallel Example: User Story 4

```bash
# Launch all tests for User Story 4 together:
Task: "Unit test calculateWorkAddedVsCompleted in tests/unit/domain/metrics/workAddedCompleted.test.ts"
Task: "Integration test work-added-completed chart in tests/integration/metrics/work-added-completed.test.tsx"
Task: "Create fixtures/asana/small-dataset/expected-metrics.json"
```

---

## Implementation Strategy

### MVP First (User Stories 1–5 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phases 3–7: User Stories 1–5 in priority order.
4. **STOP and VALIDATE**: run quickstart.md steps 1–4 and 7; confirm SC-001, SC-005, SC-006, SC-007.
5. Demo the P1 vertical slice.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → US2 → US3 → US4 → US5, each checkpointed → P1 MVP demoable.
3. US6–US10 added incrementally in any order, each independently checkpointed.
4. Phase 13 polish (Person Groups, performance at 25k scale, accessibility, final e2e) closes out the release.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. One or two developers take US1→US2→US3→US4→US5 sequentially (the P1 slice has real data dependencies between stories).
3. Once the P1 slice is done, additional developers take US6–US10 in parallel, one story each.
