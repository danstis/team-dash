# Quickstart: Asana Team Performance & Workload Dashboard

Validates that the P1 vertical slice (User Stories 1–5) runs end-to-end
using deterministic fixtures — no real Asana workspace or personal access
token is required at any step (NFR-005).

## Prerequisites

- Node.js 24 (Active LTS) and npm.
- Docker (only needed to validate the self-hosted deployment path,
  NFR-006).
- No Asana account needed for any step below.

## 1. Install and run the dev server

```bash
npm ci
npm run dev
```

Open the printed local URL. The dev server runs against the MSW-mocked
Asana API by default (`fixtures/asana/small-dataset`), so the app behaves
exactly as it would with a real workspace, deterministically.

**Expected**: First-run credential entry screen (FR-001), no reporting
screen reachable yet.

## 2. Walk the P1 path (US1–US4) manually

1. Enter any non-empty token string, click "Test token" → success result
   listing the fixture's mock workspaces (US1, Scenario 2).
2. Choose "Session only" → select the fixture workspace (US1, Scenarios
   1, 5).
3. Land on the empty/first-run dashboard (US1 Independent Test).
4. Click **Refresh** → observe progress feedback, then a success state
   with a completion timestamp (US2, Scenario 1).
5. Reload the page → cached data loads immediately, labelled "cached"
   with the last refresh time (US2, Scenario 2).
6. Open the task table, apply a date-range + assignee filter together →
   row count changes, active filters remain listed (US3, Scenarios 1–2).
7. Open a task belonging to 2+ fixture projects → its detail shows every
   project membership (US3, Scenario 4) and an "Open in Asana" link with
   no token present in the URL (US3, Scenario 5; inspect via browser
   devtools network/address bar).
8. Open the work-added-vs-completed chart, select "last 30 days" → verify
   counts against `fixtures/asana/small-dataset/expected-metrics.json`
   (hand-computed reference values), then switch to the effort view and
   confirm the numbers differ from the count view and are separately
   labelled (US4, Scenarios 1–2).
9. Group the same chart by team member → confirm an explicit
   "Unassigned" series appears, then drill into one chart point → the
   listed tasks' count matches the chart figure exactly (US4, Scenarios
   3–4).

## 3. Walk the backlog path (US5)

1. Open the Backlog view (still on the single completed refresh from
   step 2.4 — no second day's refresh required, per FR-026).
2. Confirm current incomplete count/effort matches
   `expected-metrics.json`.
3. Confirm the trend line renders historical points reconstructed purely
   from that one refresh's task dates.
4. Filter to a single fixture project → confirm the unestimated-backlog
   count is shown as its own figure, separate from the estimated total
   (US5, Scenario 5).

## 4. Verify refresh-integrity behaviour (US2, Scenario 3; Principle V)

Use the fixture's network-failure toggle:

```bash
# In the dev server's mock control panel (or fixture query param), enable
# `?mockFailure=network-mid-refresh` and click Refresh again.
```

**Expected**: the app reports the specific failure reason, and the
dashboard still shows the step-2 data unchanged — never a smaller or
partial dataset (SC-006).

## 5. Automated verification (what CI runs)

```bash
npm run lint            # ESLint incl. domain/-boundary rule
npm run format:check    # Prettier
npm run typecheck       # tsc --noEmit, strict
npm run test:unit       # Vitest — domain/metrics, dedup, datetime
npm run test:contract   # Vitest+MSW — asana-client, db-schema, refresh-staging
npm run build           # production Vite build + PWA/service-worker output
npm run test:e2e        # Playwright — offline mode, PWA install, first-run flow
```

Every command above MUST pass without network access to a real Asana
workspace (NFR-005). `npm run test:unit -- domain/metrics` alone is
sufficient to reproduce SC-005 ("100% of P1 metric figures match expected
values in a controlled fixture").

## 6. Self-hosted Docker validation (NFR-006)

```bash
docker build -f docker/Dockerfile -t team-dash .
docker run --rm -p 8080:80 team-dash
```

Open `http://localhost:8080` — the same first-run → refresh → dashboard
path from steps 1–3 above MUST work identically (the container serves
only the static build; no server-side behaviour differs from the dev
server other than the mock API needing the app's own runtime Asana calls,
which will simply fail without a real token — expected, since this is a
production build, not a fixture-backed dev build).

## 7. Offline check (FR-087, SC-007)

With step 3's data cached, use browser devtools to go offline, then
reload. **Expected**: the last cached dashboard (including backlog trend
history) renders fully, and the Refresh action is visibly disabled with an
explanation.

## Done-when

- [ ] Steps 1–4 complete with the stated expected outcomes.
- [ ] `npm run test:unit`, `test:contract`, and `test:e2e` all pass
      locally.
- [ ] Docker image builds and serves the identical first-run flow.
- [ ] Offline reload in step 7 shows cached data with refresh disabled.
