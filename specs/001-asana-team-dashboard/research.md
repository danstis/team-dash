# Phase 0 Research: Asana Team Performance & Workload Dashboard

All items below were open technology/approach decisions in the Technical
Context; the spec itself left no functional `NEEDS CLARIFICATION` markers
(all nine clarification questions were already resolved in
`spec.md`'s Clarifications section on 2026-07-20). Each decision is scoped
by Constitution principles, especially IV (local-first/no server DB), V
(sync integrity), VI (simplicity/explicit boundaries), and NFR-005/006.

## 1. UI framework

- **Decision**: React 19.2 with function components and hooks, built with Vite 8.1.
- **Rationale**: Mainstream, strong TypeScript support, largest pool of
  accessible-component and charting libraries (needed for FR-088), fast
  Vite dev/build loop, straightforward `vite-plugin-pwa` integration for
  the PWA/service-worker requirement (FR-087, NFR-006).
- **Alternatives considered**: Svelte/SvelteKit (smaller runtime, but
  weaker ecosystem overlap with mature accessible chart/table libraries
  needed for a data-dense dashboard); Vue (viable, no material advantage
  over React for this team/toolchain); a meta-framework like Next.js
  (rejected — its server-rendering/server-route features are unneeded and
  would blur the "no backend service" boundary required by Principle IV).

## 1a. TypeScript version

- **Decision**: TypeScript 6.0 (the last release on the original
  JavaScript-based compiler), not TypeScript 7.0.
- **Rationale**: TS 7.0 (the from-scratch Go-native compiler) shipped
  2026-07-09 but without a stable programmatic compiler API — that API
  lands in 7.1. `typescript-eslint`'s type-aware rules depend on that
  programmatic API, so its supported range is currently `>=4.8.4 <6.1.0`
  and a TS 7.0 support request was explicitly closed as "not planned" on
  TS 7.0's GA day. Since Constitution Principle III makes strict
  TypeScript checks *and* linting both required CI gates, picking 7.0 today
  would either break type-aware linting or force disabling it — an
  unacceptable trade for a marginal version bump. TS 6.0 is current (the
  actively supported bridge release, not a legacy one) and keeps the full
  lint+typecheck gate intact.
- **Alternatives considered**: TypeScript 7.0 now, with type-aware ESLint
  rules disabled or run via a pinned 6.0 alias in a separate step
  (rejected — adds CI complexity and a temporary correctness gap for a
  compiler speed-up with no feature the app needs); staying on TypeScript
  5.x (rejected — the user asked for current versions, and 6.0 is both
  current and safe, so there is no reason to stay a full major behind).
- **Revisit trigger**: once `typescript-eslint` publishes a release
  supporting TypeScript >=7.1, re-evaluate upgrading to 7.x for the
  compiler speed benefit; track via the repository's Renovate dashboard
  (already configured in `renovate.json`).

## 2. Local persistence layer

- **Decision**: Dexie.js 4.4 as a typed wrapper over IndexedDB, with
  explicit versioned `.version(n).stores(...)` migrations.
- **Rationale**: IndexedDB itself is mandated by the constitution and spec
  (NFR-003, FR-019). Dexie gives typed schemas, a promise-based query API,
  built-in versioned migration support (required by Principle V — "schema
  migrations MUST be versioned, tested, and recoverable"), and
  `dexie-react-hooks`' `useLiveQuery` for reactive UI updates without a
  separate state-management library.
- **Alternatives considered**: Raw `indexedDB` API (rejected — verbose,
  error-prone migration handling, harder to unit-test); `idb-keyval`
  (rejected — too minimal for relational-ish, multi-store data with
  migrations); a WASM SQLite (e.g., `sql.js`/`wa-sqlite`) (rejected —
  materially larger bundle/complexity for no requirement that needs
  relational queries; adds a dependency with a weaker upgrade/security
  posture than Dexie for this use case, violating Principle VI's
  minimal-dependency guidance).

## 3. Charting

- **Decision**: Recharts 3.9 for all chart views, with every chart backed by
  the same aggregated data structure that feeds an adjacent/toggleable
  data table.
- **Rationale**: SVG-based (screen-reader/DOM-inspectable, unlike canvas
  libraries), composable React components, sufficient for the
  bucketed/aggregated series this app renders (chart inputs are per-bucket
  aggregates — tens to low hundreds of points even at 25,000 raw tasks —
  not raw per-task plotting), and mature enough to pair with accessible
  patterns (title/desc, textual summaries) needed for FR-088/SC-009's
  "avoid colour-only distinctions" and "tabular alternative" requirements.
- **Alternatives considered**: Observable Plot (excellent default
  aesthetics but weaker React-idiomatic composition and interaction/drill-
  down hooks); visx (more flexible but requires building far more
  accessibility/interaction scaffolding by hand); Chart.js/canvas-based
  libraries (rejected — canvas output is less accessible by default and
  harder to pair with the mandatory tabular alternative without
  duplicating rendering logic).

## 4. Asana API response validation

- **Decision**: Zod 4.4 schemas at the Asana API client boundary (`data/asana`)
  validating every response shape before it enters the domain/cache layer.
- **Rationale**: FR-081/FR-082/FR-083 require visibly flagging missing or
  malformed expected fields (Priority, Estimated Time, etc.) rather than
  silently defaulting them; a schema-validation boundary is the simplest
  place to detect and surface this deterministically, and Zod schemas
  double as the input fixtures/typing contract for MSW-based tests
  (NFR-005).
- **Alternatives considered**: Manual type guards (rejected — harder to
  keep exhaustive and consistent across ~10 Asana resource types); io-ts
  (comparable capability, less ergonomic TypeScript inference than Zod for
  this team's likely familiarity); trusting the Asana TypeScript SDK's
  types without runtime validation (rejected outright — compile-time types
  cannot catch a live API returning malformed/missing data, which is
  exactly the failure mode FR-081/082/083 require handling).

## 5. Credential encryption

- **Decision**: Web Crypto `SubtleCrypto` AES-GCM with a `generateKey`
  call using `extractable: false`, key persisted as a `CryptoKey` object
  directly in an IndexedDB object store (structured-clone supports storing
  non-extractable `CryptoKey`s), ciphertext + IV stored alongside it.
- **Rationale**: This exact mechanism is specified by FR-002a/FR-002b — no
  alternative was left open by the spec's clarification answers. It is a
  browser-native API, so it adds no dependency.
- **Alternatives considered**: N/A — mechanism is a resolved clarification
  in spec.md, not an open research question; documented here only for
  implementation-readiness (key non-extractability is what prevents a
  copied-profile-directory read from recovering the raw token, per the
  disclosed limitation in FR-002a).

## 6. Testing stack

- **Decision**: Vitest 4.1 (unit + component, via `@testing-library/react`),
  MSW 2.15 (Mock Service Worker) for deterministic Asana API fixtures
  shared between dev and tests, Playwright 1.61 for browser-level smoke
  tests (offline mode, PWA install/service-worker activation, first-run
  flow). Vitest 5.0 is in beta at time of writing — stay on the 4.1
  stable line until 5.0 reaches a stable release.
- **Rationale**: Directly satisfies NFR-005 (no live token/workspace ever
  required) and Principle III's CI gate list (unit, metric/data-contract,
  browser smoke test). Vitest shares Vite's config/transform pipeline,
  minimizing tooling duplication (Principle VI). MSW fixtures are reused
  for local development against a "fake Asana" without needing a second
  mocking mechanism.
- **Alternatives considered**: Jest (rejected — duplicate transform
  config vs. Vite, slower for this stack); Cypress (rejected in favour of
  Playwright for first-class offline/service-worker testing support and
  multi-browser engine coverage); hand-rolled `fetch` stubbing instead of
  MSW (rejected — MSW's network-level interception is a closer analogue to
  real Asana API behaviour, including pagination/rate-limit simulation
  needed to test FR-021/FR-024).

## 7. Domain/presentation boundary enforcement

- **Decision**: `eslint-plugin-boundaries` (or an equivalent
  `import/no-restricted-paths` rule set) configured so `src/domain/**`
  cannot import from `src/features/**`, `react`, or `src/data/asana/**`
  (network), enforced in CI lint under ESLint 10's flat config (the only
  config format ESLint 10 supports — eslintrc was removed entirely).
- **Rationale**: Principle VI/II require metric/business logic to be
  presentation- and network-independent and independently testable; a
  lint rule makes this a verified CI gate rather than a convention that
  can silently erode.
- **Alternatives considered**: Code-review-only enforcement (rejected —
  not verifiable by CI, contradicts Principle III's "quality gate" model);
  a separate package/workspace boundary (rejected as unnecessary
  complexity for a single-project app — a lint rule achieves the same
  guarantee without introducing a monorepo, per Principle VI).

## 8. State management for filters/UI

- **Decision**: React Context + hooks for session-scoped UI state (active
  filters, grouping, timezone toggle), Dexie `useLiveQuery` for
  cache-backed reactive data (tasks, snapshots, mappings, Person Groups).
- **Rationale**: There is no server to synchronise with beyond the local
  cache, so a network-cache library (React Query/SWR) would add
  unjustified complexity (Principle VI); `useLiveQuery` already gives
  reactive, automatically-invalidating reads from Dexie whenever a refresh
  writes new data, which is the only "remote-like" data source in this
  app.
- **Alternatives considered**: Redux/Zustand (rejected — no
  cross-cutting global-state complexity exists that Context+Dexie doesn't
  already cover; would be premature abstraction per Principle VI); React
  Query pointed at IndexedDB reads (rejected — its cache-invalidation
  model is designed for network resources, redundant on top of Dexie's
  own live queries).

## 9. Package manager & CI composition

- **Decision**: Node.js 24 (Active LTS, supported through Apr 2028) as the
  pinned build/CI runtime (`.nvmrc` / `engines.node` = `24.x`), npm (with a
  committed `package-lock.json`) as the package manager, ESLint 10.1
  (flat config only — eslintrc support was removed entirely in v10) for
  linting; GitHub Actions CI running, per Principle III: install → lint
  (ESLint) → format check (Prettier) → typecheck (`tsc --noEmit`, strict,
  TypeScript 6.0) → unit tests (Vitest 4.1) → contract tests (Asana-client
  + Dexie schema, Vitest+MSW) → production build (Vite 8.1) →
  PWA/service-worker validation (Workbox build output check + a
  Playwright install/offline assertion) → Docker build → a Playwright
  browser smoke test against the built container. Secret and dependency
  scanning via GitHub-native tooling (Dependabot — already configured in
  `.github/dependabot.yml` — plus GitHub secret scanning and CodeQL).
- **Rationale**: Node 24 is the current Active LTS line (Node 26 only
  enters LTS in October 2026, so building against it today would mean
  developing against a Current/non-LTS release); npm ships with Node,
  avoiding a second package-manager toolchain dependency for a
  single-package (non-monorepo) repository (Principle VI). The CI stage
  list is a direct translation of the Compliance Checklist's Principle III
  line item.
- **Alternatives considered**: Node 26 (rejected for now — Current-only
  support track until its October 2026 LTS promotion; revisit once it
  becomes Active LTS); pnpm/yarn (both viable; rejected only for not being
  justified by any actual workspace/monorepo need here).

## 10. Docker/self-hosting

- **Decision**: Multi-stage Dockerfile — a `node:24` build stage running
  `npm ci && npm run build`, then an `nginxinc/nginx-unprivileged:1.30-alpine` runtime stage serving
  the static `dist/` output with SPA fallback routing and correct
  service-worker/cache-control headers (service worker file served with
  `Cache-Control: no-cache` so PWA updates propagate; hashed asset files
  served long-cache).
- **Rationale**: Satisfies NFR-006 (local dev server + self-hosted Docker
  container) while keeping the container free of any backend logic,
  database, or credential handling (Principle IV) — it is a static file
  server only. nginx is a well-understood, minimal-configuration static
  host.
- **Alternatives considered**: A Node-based static server (e.g., `serve`)
  (viable, slightly simpler Dockerfile, but nginx has a smaller runtime
  image and more precise cache-header control for the service-worker
  update requirement); Caddy (comparable, no material advantage here).

## 11. Backlog reconstruction algorithm shape

- **Decision**: Backlog-over-time reconstruction (FR-026, FR-064) is
  implemented as a pure `domain/metrics` function that, for each requested
  date `d`, counts an in-scope task as "incomplete at `d`" when
  `createdAt <= d` and (`completedAt` is null or `completedAt > d`), summing
  each such task's *current* cached estimate for the effort series. The
  daily-snapshot cache (FR-026a/b) is a memoised, backfillable projection
  of this same pure function keyed by calendar day, never an independent
  calculation path — eliminating drift between "live" and "cached" backlog
  figures by construction.
- **Rationale**: This directly encodes the spec's Backlog Direction metric
  definition and Assumptions ("reconstruction, not accumulation"; snapshot
  is "a performance optimisation over this reconstruction, not an
  independent source of truth"). Keeping one calculation path (with the
  snapshot as a cache, not a second implementation) is what prevents the
  two figures from silently diverging, satisfying Principle II's
  determinism requirement.
- **Alternatives considered**: Accumulating snapshots day-by-day as the
  sole history source (rejected — explicitly ruled out by the spec's
  resolved clarification: history must be available from the very first
  refresh, not built up over time).
