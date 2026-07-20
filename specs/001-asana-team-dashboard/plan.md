# Implementation Plan: Asana Team Performance & Workload Dashboard

**Branch**: `001-asana-team-dashboard` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-asana-team-dashboard/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A self-hosted, single-user, local-first Progressive Web App that connects
read-only to a user-selected Asana workspace via a user-supplied personal
access token, retrieves all in-scope tasks/subtasks (excluding archived
projects and milestone/approval items) into a browser-local IndexedDB cache,
and provides transparent, drillable, deduplicated reporting on workload,
delivery (work added vs. completed), and backlog size/direction as the P1
vertical slice — with team-mapping, workload, completion-quality, and
diagnostic metrics layered on afterward as independently shippable P2
slices. All computation, storage, and credentials remain in the browser;
the Docker image serves only static build output with no backend service
or shared database, per Constitution Principle IV (NFR-003).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict mode), targeting ES2022; Node.js 24 (Active LTS, supported through Apr 2028) for build/dev tooling only (no server runtime in production). TypeScript is deliberately pinned at 6.0 rather than the newer 7.0 (Go-native compiler, released 2026-07-09) — see research.md §1a; this is a "current, not bleeding-edge-broken" choice, not a stale one.

**Primary Dependencies**: React 19.2 (UI), Vite 8.1 + `vite-plugin-pwa` 1.3 /Workbox (build, service worker, installable PWA — first vite-plugin-pwa release with a Vite 8 peer range), Dexie.js 4.4 (typed, versioned IndexedDB access and schema migrations), Recharts 3.9 (SVG charting with tabular-alternative-friendly data model), React Router 7 (view navigation), Zod 4.4 (runtime validation of Asana API responses so malformed/missing fields are flagged per FR-081/FR-082 instead of silently coerced), MSW 2.15 — Mock Service Worker (deterministic Asana API fixtures for dev and tests per NFR-005).

**Storage**: Browser-local IndexedDB only, via Dexie (object stores for cache entities, derived snapshots, credentials, team mappings, named Person Groups). No server-side or shared database (NFR-003).

**Testing**: Vitest 4.1 + React Testing Library (unit and component tests, domain/metric logic isolated from React per Principle VI), Vitest + MSW fixture suites (Asana-client and storage "contract" tests), Playwright 1.61 (browser-based smoke tests: offline mode, PWA install/service-worker behaviour, credential flows) — all deterministic, none requiring a live Asana workspace or real token (Principle III, NFR-005).

**Target Platform**: Evergreen desktop browsers (Chrome/Edge/Firefox current) as the primary target, installable as a PWA; usable on tablet/narrow viewports as a secondary target (FR-089). Deployed via a local dev server or a self-hosted Docker container (nginx 1.30 stable-branch base image) that serves the static production build (NFR-006).

**Project Type**: Single-page web application (frontend-only PWA). There is no backend service — the browser calls the Asana API directly and owns all persistence; the Docker image is a static file server only.

**Performance Goals**: Cached dashboard visible within 2s of launch, before network activity completes (SC-002); filter/group/re-render updates within 1s against a 25,000-task cache (SC-003); a full 25,000-task refresh completes with continuous, non-freezing progress feedback (SC-004, NFR-002).

**Constraints**: Local-first only, no shared server-side reporting database (NFR-003, Principle IV); Asana access strictly read-only, no write-capable calls (FR-009, NFR-004); token never appears in URLs/logs/exports and is encrypted at rest when persisted (FR-002a, FR-008); full offline viewing of the last cache with refresh disabled (FR-087); must stay correct and responsive up to 25,000 in-scope tasks (NFR-001, FR-018).

**Scale/Scope**: Single user per deployed instance, one Asana workspace selected at a time, up to ~25,000 in-scope tasks. 10 user stories (5 × P1, 5 × P2), 90 functional requirements, 14 documented metrics (4 P1 + 10 P2). This plan designs the full architecture but details Phase 1 contracts primarily for the P1 vertical slice (User Stories 1–5); P2 metrics (US6–10) follow the same established contracts and are elaborated at their own implementation time, per Constitution Principle I (incremental, independently demonstrable slices).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Gate | Status |
|---|-----------|------|--------|
| I | Runnable Vertical Slices | Phase 1 architecture isolates the P1 path (US1–5: token → workspace → refresh → cache status → filters → task table → 1 chart) as the first deliverable; P2 metrics (US6–10) are additive slices on the same contracts, not a bundled release. | PASS |
| II | Reporting Correctness & Traceability | `domain/metrics` is pure, presentation-free, and defined by explicit per-metric contracts (population/date-basis/numerator/denominator/missing-value/dedup/units/drill-down) mirroring the spec's Metric Definitions section; every metric result type carries a `contributingTaskGids` list for drill-down. No composite/ranking score is introduced without exposing its inputs. | PASS |
| III | Test-First & Mandatory Automation | Testing stack (Vitest, RTL, MSW, Playwright) is fixture/mock-only — no live token or workspace required anywhere, satisfying NFR-005. Red/Green/Refactor is a process requirement enforced at task-execution time (`/speckit-tasks`, `/speckit-implement`), not a plan artefact; CI gate composition is captured in research.md. | PASS |
| IV | Local-First Privacy & Credential Safety | No backend service exists; IndexedDB is the only store. Token encryption (Web Crypto AES-GCM, non-extractable key) implemented in `data/crypto`, isolated from UI and network code so it can be unit-tested without exposing plaintext. Docker image serves static assets only — it cannot log, proxy, or retain tokens. | PASS |
| V | Data Integrity & Resilient Synchronisation | `data/db` repositories upsert by `gid` only; refresh writes go through a staging→commit pattern (Data Model: Refresh Session) so a failed/partial refresh never overwrites the last good cache. Dexie schema versions are explicit migration steps. | PASS |
| VI | Simplicity & Explicit Architecture | Single frontend project, no server DB, no plugin framework. `domain/` has zero React/browser/network imports, enforced by an ESLint boundary rule (see research.md), keeping metric logic testable in isolation and swappable independent of the chart library. | PASS |
| VII | Accessible, Honest, Responsive UX | Recharts chosen specifically for pairing every chart with an accessible data-table alternative; required UI states (loading/empty/first-run/no-results/stale/offline/invalid-token/insufficient-permission/rate-limited/partial-data) are enumerated as a shared `AsyncState`/`ViewState` contract in data-model.md so no state is accidentally skipped. Performance budgets (SC-002/003/004) are carried as explicit Technical Context goals to be verified against a generated 25k-task fixture. | PASS |
| VIII | Reproducibility & Operational Readiness | quickstart.md documents clone → install → dev server → tests → build → Docker run using only committed, versioned tooling; no undocumented manual steps. README updates remain deferred to the implementation phase that establishes the repository foundation (consistent with the constitution's own Sync Impact Report). | PASS |

No violations identified; Complexity Tracking is not required for this plan.

**Post-Phase-1 re-check**: research.md and data-model.md/contracts/
were reviewed against the table above after Phase 1 design — no new
dependency, backend component, or architectural deviation was introduced
(all chosen libraries are documented with rationale in research.md; no
server-side store, no plugin framework, no telemetry). All rows remain
PASS.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── app/                   # app shell, routing, layout, top-level providers
├── features/               # UI feature slices (React components + hooks only)
│   ├── credentials/         # token entry, test-token, storage-mode switch, confirmation
│   ├── refresh/              # refresh trigger, progress, outcome, freshness banner
│   ├── tasks/                 # task table, filters, drill-down detail
│   ├── metrics/                 # P1 charts (work-added-vs-completed, backlog) + P2 views
│   ├── team-mapping/             # reporting-team override management (US6)
│   └── person-groups/             # ad-hoc + named Person Group management
├── domain/                 # pure business/metric logic — no React, DOM, or network imports
│   ├── metrics/              # one calculator module per Metric Definition in spec.md
│   ├── filtering/              # composable filter/grouping predicates
│   ├── dedup/                    # gid-based dedup helpers shared by all aggregates
│   └── datetime/                   # timezone/week-start/date-bucket helpers (FR-029..034)
├── data/
│   ├── asana/                # read-only Asana API client, pagination, rate-limit/backoff
│   ├── db/                     # Dexie schema + versioned migrations + gid-upsert repositories
│   └── crypto/                   # Web Crypto AES-GCM token encrypt/decrypt (non-extractable key)
├── shared/                  # design-system components, formatting, a11y helpers
└── main.tsx

tests/
├── unit/                    # domain/metrics, domain/dedup, domain/datetime
├── contract/                  # Asana-client response-shape tests, Dexie schema/migration tests
├── integration/                 # feature-level flows (credential, refresh, filter+drilldown) via RTL + MSW
└── e2e/                            # Playwright: offline mode, PWA install, first-run → dashboard

fixtures/
├── asana/                    # deterministic MSW fixture datasets (small + 25k-task scale)
└── generators/                  # scripted generation of the large-scale fixture

docker/
├── Dockerfile                # multi-stage: Node build → static file server (e.g. nginx)
└── nginx.conf
```

**Structure Decision**: Single frontend project (Option 1 adapted for a
browser-only PWA — Option 2's frontend/backend split does not apply because
there is no backend service; Asana is called directly from the browser and
Docker only serves the static build). The `domain/` boundary is the
architectural device required by Constitution Principle VI/II: metric and
filtering logic must be testable against fixtures with zero dependency on
React, the DOM, or a live network call, so it is physically separated from
`features/` (presentation) and `data/` (acquisition/persistence).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
