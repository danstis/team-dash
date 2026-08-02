/**
 * T04 — `<Dashboard />` (S01 dashboard route composition).
 *
 * The composition the S01 dashboard route renders when the gate is
 * open (both providers report `'ready'`). The component orchestrates
 * three new S01 surfaces around the existing `<RefreshControls />`:
 *
 *   1. `<RefreshControls />` — the US2 refresh button + offline
 *      gating (T03). Always rendered because the user must be able
 *      to press Refresh in every state.
 *   2. Either `<EmptyDashboard />` (no succeeded session exists) OR
 *      `<FreshnessBanner />` + `<DataQualitySummary />` (a succeeded
 *      session exists; the dashboard shows the cached data).
 *   3. A "Settings" link (BSOD-351) — the BSOD-351 anchor the
 *      Playwright e2e specs pin via `data-testid="nav-settings"`.
 *      Removing this link would regress the e2e coverage of the
 *      SettingsCredentialsPanel; the dashboard route inherits the
 *      placeholder's link so the route swap does not break that
 *      surface.
 *
 * The component subscribes to the cache via `useLiveQuery` from
 * `dexie-react-hooks`. The three queries are:
 *
 *   - `db.refreshSessions.toArray()` — drives the
 *     `<EmptyDashboard />` vs `<FreshnessBanner />` decision.
 *   - `db.tasks.toArray()` — feeds `deriveDataQualityFlags()` for
 *     the FR-084 summary.
 *   - `db.priorityFields.toArray()` — completes the
 *     `malformed_priority` derivation (project-level field status).
 *
 * Until `useLiveQuery` resolves the first read the three values are
 * `undefined`; the dashboard renders the `<LoadingState />` shape
 * during that window so a fast refresh between two renders does not
 * flash an empty-data view (per Principle VII "no flicker on
 * reload"). The flag derivation runs only after the cache is
 * populated so a missing first-paint snapshot cannot produce an
 * empty-but-already-rendered state.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the feature boundary documented in
 * the plan. The component imports from `src/data/db/schema`,
 * `dexie-react-hooks`, and the three sibling feature components;
 * it does NOT import from `src/data/asana/**` (the orchestrator is
 * the boundary) and does NOT import `src/app/**` (the shell
 * composes the route, not the other way around).
 */
import { type ReactElement } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "../../data/db/schema";
import type { PriorityField, RefreshSession, Task } from "../../data/db/schema";

import { RefreshControls } from "./RefreshControls";
import { EmptyDashboard } from "./EmptyDashboard";
import { FreshnessBanner } from "./FreshnessBanner";
import {
  DataQualitySummary,
  deriveDataQualityFlags,
} from "./DataQualitySummary";

/**
 * The S01 freshness boundary: a session whose `finishedAt` is more
 * than this many milliseconds in the past is rendered as cached. The
 * `<FreshnessBanner />` component carries its own threshold; this
 * mirror is here so the dashboard's "show banner now or wait for
 * running session" decision stays in one place.
 */
const SAME_SESSION_BANNER_WINDOW_MS = 30_000;

/**
 * Resolve the freshest "succeeded" session. Returns `null` when no
 * terminal succeeded session exists yet (the `<EmptyDashboard />`
 * case) or when the `useLiveQuery` array is still `undefined`. The
 * helper is exported so a unit test can pin the ordering against a
 * fixed Dexie seed.
 */
export function pickMostRecentSucceededSession(
  rows: readonly RefreshSession[] | undefined,
): RefreshSession | null {
  if (rows === undefined) {
    return null;
  }
  let best: RefreshSession | null = null;
  for (const row of rows) {
    if (row.status !== "succeeded" || row.finishedAt === null) {
      continue;
    }
    if (best === null) {
      best = row;
      continue;
    }
    // Re-narrow `best.finishedAt` to a non-null `string` so the
    // lexicographic comparison type-checks. The narrowing does NOT
    // carry across loop iterations because TS does not analyse
    // the loop's prior write — so we guard with an explicit null
    // check (defence in depth: `pickMostRecentSucceededSession`
    // only ever assigns rows with non-null `finishedAt`, so the
    // fallback `best = row` is unreachable in practice).
    const bestFinishedAt = best.finishedAt;
    if (bestFinishedAt === null) {
      best = row;
      continue;
    }
    if (row.finishedAt > bestFinishedAt) {
      best = row;
    }
  }
  return best;
}

/**
 * Test seam only. Production callers omit this prop; unit tests
 * inject a deterministic `now` so the "fresh vs cached" derivation
 * is stable across runs. The seam mirrors the
 * `<RefreshControls forceOffline={true} />` design from T03.
 *
 * @internal
 */
export interface DashboardTestSeamProps {
  readonly now?: () => Date;
  readonly tasks?: readonly Task[];
  readonly priorityFields?: readonly PriorityField[];
  readonly sessions?: readonly RefreshSession[];
}

/**
 * The S01 dashboard route body.
 *
 * The component is intentionally split into "guard-render"
 * (gate-closed / loading / offline banner / etc.) and "default-
 * render" (the actual dashboard composition). The split keeps the
 * per-state branches auditable from the top of the render tree
 * rather than scattered through nested ternaries.
 */
export function Dashboard(
  props: Readonly<DashboardTestSeamProps> = {},
): ReactElement {
  const liveSessions = useLiveQuery<readonly RefreshSession[]>(
    () => db.refreshSessions.toArray(),
    [],
  );
  const liveTasks = useLiveQuery<readonly Task[]>(
    () => db.tasks.toArray(),
    [],
  );
  const livePriorityFields = useLiveQuery<readonly PriorityField[]>(
    () => db.priorityFields.toArray(),
    [],
  );

  const now = props.now ?? ((): Date => new Date());
  const sessions: readonly RefreshSession[] | undefined =
    props.sessions ?? liveSessions;
  const tasks: readonly Task[] = props.tasks ?? liveTasks ?? [];
  const priorityFields: readonly PriorityField[] =
    props.priorityFields ?? livePriorityFields ?? [];

  // Resolve the most-recent terminal succeeded session. A `null`
  // means "no cache has been populated yet", so the dashboard
  // shows the EmptyDashboard surface.
  const mostRecent = pickMostRecentSucceededSession(sessions);

  return (
    <main
      className="td-dashboard"
      data-testid="dashboard"
      data-last-refreshed-at={mostRecent?.finishedAt ?? ""}
      aria-label="Dashboard"
      lang="en-AU"
    >
      <header className="td-dashboard-header">
        <h1>Team Dash</h1>
        <p>
          <Link to="/settings" data-testid="nav-settings">
            Settings
          </Link>
        </p>
      </header>
      <RefreshControls />
      {mostRecent !== null ? (
        <>
          <FreshnessBanner
            lastRefreshedAt={mostRecent.finishedAt ?? ""}
            now={now}
            thresholdMs={SAME_SESSION_BANNER_WINDOW_MS}
          />
          <DataQualitySummary
            flags={deriveDataQualityFlags(tasks, priorityFields)}
          />
        </>
      ) : (
        <EmptyDashboard />
      )}
    </main>
  );
}

export default Dashboard;
