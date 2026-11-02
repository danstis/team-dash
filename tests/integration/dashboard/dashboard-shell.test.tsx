/**
 * BSOD-781 (T-UI1) — integration test for the live reporting dashboard
 * shell mounted at `/`.
 *
 * Spec / contract references
 * --------------------------
 * - FR-020 / FR-021 / FR-085 (US2): the dashboard states whether the
 *   data on screen is fresh or cached, and offers an explicit manual
 *   Refresh action — including the first-run state, where the empty
 *   dashboard is the surface the first refresh happens on.
 * - FR-031–FR-042 (US3): the task list is filterable and every task
 *   can be opened in its detail drawer.
 * - FR-043–FR-046 (US4): the work-added / work-completed metric is
 *   charted, switchable between the item-count and estimated-effort
 *   views, groupable, and every figure is drillable to the tasks
 *   behind it.
 * - FR-084 (US2): the data-completeness findings of the most recent
 *   refresh are summarised where the data is shown.
 * - Constitution Principle II (user-visible vertical slices): the
 *   components Stages 4–6 shipped must be present and operable in the
 *   live `/` route, not merely in their own component tests.
 * - Constitution Principle V (accessibility): semantic landmarks and
 *   a keyboard-reachable path to every drill-down.
 *
 * What this test pins
 * -------------------
 *
 * 1. The shell contract the earlier rows established is preserved on
 *    `/`: the "Team Dash" heading, the Settings link and the
 *    `RefreshStatusPanel` are all still there.
 *
 * 2. Before any refresh has committed, `/` shows the first-run empty
 *    dashboard — and NOT a populated report (FR-085: a first-run user
 *    must never read an empty report as "you have no work").
 *
 * 3. The empty dashboard's Refresh action really runs a refresh: the
 *    cache is populated and the dashboard moves on to the populated
 *    views without a page reload (FR-020, FR-022).
 *
 * 4. Once a refresh has committed, `/` shows the data-quality summary,
 *    the task list (filter bar, active filters, table) and the
 *    work-added / work-completed section (count↔effort toggle, group
 *    selector, chart) — all at once, all on the live route.
 *
 * 5. The task list's rows open the task detail drawer, and the
 *    chart's figures open the drill-down panel (FR-037, FR-052,
 *    FR-062).
 *
 * 6. The chart's controls are live: the count↔effort switch changes
 *    the view the chart shows, and the group selector splits the
 *    metric (FR-060, FR-061).
 *
 * Test-first discipline
 * ---------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails because `/` still renders the T031
 * placeholder, and the same file goes green once
 * `src/features/dashboard/ReportingDashboard.tsx` is mounted at `/`.
 *
 * Determinism
 * -----------
 * The cached rows are seeded straight into IndexedDB with synthetic
 * gids and dates relative to the test run, so the metric's period
 * ("last 30 days") always contains them. The one test that exercises
 * the real refresh path runs against the small-dataset MSW handlers —
 * no browser, no live Asana workspace, no real personal access token
 * (Principle III, NFR-005).
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` + MSW
 * per `tests/setup.ts`.
 */
import { StrictMode, useEffect, type ReactElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialsProvider,
  useCredentials,
  type CredentialsContextValue,
} from "../../../src/app/credentials-context";
import { createAppRouter } from "../../../src/app/router";
import {
  WorkspaceProvider,
  useWorkspace,
  type SelectedWorkspace,
  type WorkspaceContextValue,
} from "../../../src/app/workspace-context";
import { db } from "../../../src/data/db/schema";
import { refreshOrchestrator } from "../../../src/data/refresh/refresh-orchestrator";
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The synthetic PAT the tests drive the providers with. */
const FIXTURE_TOKEN = "fixture-dashboard-shell-token-1234567890";

/** The fixture workspace the tests report against. */
const SAMPLE_WORKSPACE: SelectedWorkspace = {
  gid: smallDatasetWorkspaceGid,
  name: "Team Dash Workspace",
  selectedAt:
    "2026-07-25T10:00:00.000Z" as unknown as SelectedWorkspace["selectedAt"],
};

/** The seeded project's gid. */
const PROJECT_GID = "1200000000000100";

/** The seeded portfolio's gid. */
const PORTFOLIO_GID = "1200000000000030";

/** The seeded person's gid. */
const USER_GID = "1200000000000020";

/** The seeded Asana team's gid (the project's default reporting team). */
const TEAM_GID = "1200000000000010";

/** The seeded task's gid — assigned, estimated, still open. */
const TASK_ALPHA_GID = "task-alpha";

/** The seeded task's gid — unassigned, unestimated, completed. */
const TASK_BETA_GID = "task-beta";

/** An ISO instant `days` days before the test run. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Provider handles                                                           */
/* -------------------------------------------------------------------------- */

interface CapturedHandles {
  credentials: CredentialsContextValue | null;
  workspace: WorkspaceContextValue | null;
}

type HandlesRef = { current: CapturedHandles | null };

/**
 * Publishes the providers' live actions to the test so the gate can be
 * lifted the way the first-run flow lifts it — through the providers,
 * not by writing to IndexedDB behind their backs.
 */
function DashboardProbe({
  handlesRef,
}: {
  handlesRef: HandlesRef;
}): ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  useEffect(() => {
    handlesRef.current = { credentials, workspace };
  });
  return (
    <div data-testid="dashboard-probe">
      <span data-testid="probe-credentials-state">{credentials.state}</span>
      <span data-testid="probe-workspace-state">{workspace.state}</span>
    </div>
  );
}

/**
 * Renders the live `/` route under the real provider tree, exactly as
 * the production shell mounts it.
 */
function renderDashboard(): HandlesRef {
  const handlesRef: HandlesRef = { current: null };
  render(
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <RouterProvider router={createAppRouter()} />
          <DashboardProbe handlesRef={handlesRef} />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>,
  );
  return handlesRef;
}

/**
 * Drives both providers to `'ready'` so the T046 route guard lifts and
 * the reporting surface becomes reachable.
 */
async function openTheGate(handlesRef: HandlesRef): Promise<void> {
  await waitFor(() => {
    expect(handlesRef.current?.credentials).not.toBeNull();
  });
  await waitFor(() => {
    expect(handlesRef.current?.workspace).not.toBeNull();
  });

  await handlesRef.current?.credentials?.setSessionToken(
    FIXTURE_TOKEN,
    "…7890",
  );
  await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);

  await waitFor(() => {
    expect(handlesRef.current?.credentials?.state).toBe("ready");
    expect(handlesRef.current?.workspace?.state).toBe("ready");
  });
}

/* -------------------------------------------------------------------------- */
/* Cache seeding                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Seeds a workspace's cache as a completed refresh would have left it:
 * the lookup rows, two in-scope tasks dated inside the dashboard's
 * reporting period, and the committed refresh session that says the
 * data on screen came from a successful refresh.
 */
async function seedCommittedRefresh(): Promise<void> {
  await db.projects.put({
    gid: PROJECT_GID,
    name: "Web App",
    workspaceGid: smallDatasetWorkspaceGid,
    asanaTeamGid: TEAM_GID,
    portfolioGids: [PORTFOLIO_GID],
    archived: false,
  });
  await db.portfolios.put({
    gid: PORTFOLIO_GID,
    name: "Customer Platform",
    workspaceGid: smallDatasetWorkspaceGid,
    projectGids: [PROJECT_GID],
  });
  await db.users.put({
    gid: USER_GID,
    name: "Alex Kim",
    email: null,
    workspaceGid: smallDatasetWorkspaceGid,
  });
  await db.tasks.bulkPut([
    {
      gid: TASK_ALPHA_GID,
      name: "Wire the reporting dashboard",
      assigneeGid: USER_GID,
      projectGids: [PROJECT_GID],
      parentTaskGid: null,
      resourceSubtype: "default_task",
      createdAt: daysAgo(3),
      modifiedAt: daysAgo(3),
      completedAt: null,
      dueAt: null,
      priorityOptionId: "1200000000000300",
      estimatedMinutes: 60,
      actualMinutes: null,
      dependsOnTaskGids: [],
      lastSeenInScopeAt: daysAgo(2),
      outOfScopeReason: null,
    },
    {
      gid: TASK_BETA_GID,
      name: "Review the backlog",
      assigneeGid: null,
      projectGids: [PROJECT_GID],
      parentTaskGid: null,
      resourceSubtype: "default_task",
      createdAt: daysAgo(5),
      modifiedAt: daysAgo(1),
      completedAt: daysAgo(1),
      dueAt: null,
      priorityOptionId: null,
      estimatedMinutes: null,
      actualMinutes: "unavailable",
      dependsOnTaskGids: [],
      lastSeenInScopeAt: daysAgo(2),
      outOfScopeReason: null,
    },
  ]);
  await db.refreshSessions.put({
    id: "dashboard-shell-session",
    workspaceGid: smallDatasetWorkspaceGid,
    startedAt: daysAgo(2),
    finishedAt: daysAgo(2),
    status: "succeeded",
    itemsRetrieved: 2,
    errorDetail: null,
    syncMode: "full",
  });
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("BSOD-781 (T-UI1) — the live reporting dashboard on `/`", () => {
  beforeEach(async () => {
    await db.credentials.clear();
    await db.workspaces.clear();
    await db.refreshSessions.clear();
    await db.projects.clear();
    await db.portfolios.clear();
    await db.users.clear();
    await db.tasks.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the shell contract and shows the first-run empty dashboard before any refresh has committed", async () => {
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    // The shell contract the earlier rows established is preserved.
    expect(
      screen.getByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("nav-settings")).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.getByTestId("refresh-status")).toBeInTheDocument();

    // FR-085: the first-run state is the empty dashboard, not a
    // populated report that happens to be empty.
    const empty = await screen.findByTestId("empty-dashboard");
    expect(empty).toHaveAttribute("data-view-state", "first_run");
    expect(screen.getByTestId("empty-dashboard-refresh-button")).toBeEnabled();

    // Nothing that would read as "you have no work" is on screen.
    expect(screen.queryByTestId("data-quality-summary")).toBeNull();
    expect(screen.queryByTestId("task-table")).toBeNull();
    expect(screen.queryByTestId("work-added-completed-chart")).toBeNull();
  });

  it("shows the data-quality summary, the task list and the work-added section once a refresh has committed", async () => {
    await seedCommittedRefresh();
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    // FR-084 — the completeness summary of the most recent refresh.
    expect(
      await screen.findByTestId("data-quality-summary"),
    ).toBeInTheDocument();

    // US3 — the filterable task list and its table.
    expect(await screen.findByTestId("filter-bar")).toBeInTheDocument();
    expect(screen.getByTestId("active-filters-list")).toBeInTheDocument();
    const table = await screen.findByTestId("task-table");
    expect(table).toBeInTheDocument();
    expect(screen.getAllByTestId("task-row")).toHaveLength(2);

    // US4 — the metric section and its two controls.
    expect(screen.getByTestId("count-effort-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("group-by-selector")).toBeInTheDocument();
    expect(
      screen.getByTestId("work-added-completed-chart"),
    ).toBeInTheDocument();

    // The first-run surface is gone — the dashboard has data now.
    expect(screen.queryByTestId("empty-dashboard")).toBeNull();
  });

  it("opens the task detail drawer when a task row is activated", async () => {
    await seedCommittedRefresh();
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    const rows = await screen.findAllByTestId("task-row");
    const row = rows[0] as HTMLElement;
    const select = row.querySelector<HTMLButtonElement>(
      "[data-testid='task-row-select']",
    );
    expect(select).not.toBeNull();

    fireEvent.click(select as HTMLButtonElement);

    const drawer = await screen.findByTestId("task-detail-drawer");
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-name")).toHaveTextContent(
      "Wire the reporting dashboard",
    );
  });

  it("opens the drill-down panel when a chart figure is activated", async () => {
    await seedCommittedRefresh();
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    const drillDowns = await screen.findAllByTestId(
      "work-added-completed-drill-down",
    );
    expect(drillDowns.length).toBeGreaterThan(0);

    fireEvent.click(drillDowns[0]);

    const panel = await screen.findByTestId("drill-down-panel");
    expect(panel).toBeInTheDocument();
    expect(
      screen.getByTestId("drill-down-panel-title"),
    ).not.toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByTestId("drill-down-panel")).not.toBeInTheDocument();

    fireEvent.click(drillDowns[0]);
    expect(await screen.findByTestId("drill-down-panel")).toBeInTheDocument();
  });

  it("opens the data-quality drill-down when a flag is selected", async () => {
    await seedCommittedRefresh();
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    const flag = await screen.findByRole("button", {
      name: /Missing assignee: 1 task/i,
    });
    fireEvent.click(flag);

    expect(await screen.findByTestId("drill-down-panel")).toBeInTheDocument();
    expect(screen.getByTestId("drill-down-panel-title")).toHaveTextContent(
      "Data completeness — 1 task",
    );
  });

  it("re-renders the metric when the count/effort switch and the group selector change", async () => {
    await seedCommittedRefresh();
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    await screen.findByTestId("work-added-completed-chart");
    expect(
      screen.getByTestId("work-added-completed-summary"),
    ).toHaveTextContent(/number of items added and completed/i);

    // FR-061 — the effort view is a separate view of the same bucket.
    fireEvent.click(screen.getByRole("radio", { name: /estimated effort/i }));
    await waitFor(() => {
      expect(
        screen.getByTestId("work-added-completed-summary"),
      ).toHaveTextContent(/estimated effort added and completed/i);
    });

    // FR-060 — the metric can be split by a grouping dimension.
    fireEvent.change(screen.getByTestId("group-by-selector"), {
      target: { value: "project" },
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("work-added-completed-summary"),
      ).toHaveTextContent(/split by project/i);
    });
  });

  it("runs a refresh from the empty dashboard and moves on to the populated views", async () => {
    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);

    const button = await screen.findByTestId("empty-dashboard-refresh-button");
    fireEvent.click(button);

    // The refresh lands in the cache; the dashboard reads the cache
    // live, so it moves on without a page reload.
    expect(await screen.findByTestId("task-table")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-dashboard")).toBeNull();
    expect(screen.getByTestId("data-quality-summary")).toBeInTheDocument();

    const outcome = await screen.findByTestId("outcome-banner");
    expect(outcome).toHaveAttribute("data-outcome-state", "succeeded");
    const committedSession = await db.refreshSessions
      .where("workspaceGid")
      .equals(smallDatasetWorkspaceGid)
      .filter((session) => session.status === "succeeded")
      .first();
    expect(committedSession?.finishedAt).toBeTruthy();
    expect(outcome).toHaveAttribute(
      "data-completed-at",
      committedSession?.finishedAt,
    );
    await waitFor(() => {
      expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
        "data-last-refreshed-at",
        committedSession?.finishedAt,
      );
      expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
        "data-freshness",
        "fresh",
      );
    });
  });

  it("shows a failed refresh outcome from the post-refresh empty state", async () => {
    await db.refreshSessions.put({
      id: "empty-session",
      workspaceGid: smallDatasetWorkspaceGid,
      startedAt: daysAgo(2),
      finishedAt: daysAgo(2),
      status: "succeeded",
      itemsRetrieved: 0,
      errorDetail: null,
      syncMode: "full",
    });
    vi.spyOn(refreshOrchestrator, "runRefresh").mockResolvedValue({
      status: "failed",
      sessionId: "failed-session",
      itemsRetrieved: 0,
      reason: "network_error",
      message: "The refresh did not finish.",
    });

    const handlesRef = renderDashboard();
    await openTheGate(handlesRef);
    const empty = await screen.findByTestId("empty-dashboard");
    expect(empty).toHaveAttribute("data-view-state", "empty");
    fireEvent.click(screen.getByTestId("empty-dashboard-refresh-button"));

    const outcome = await screen.findByTestId("outcome-banner");
    expect(outcome).toHaveAttribute("data-outcome-state", "failed");
    expect(outcome).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("empty-dashboard")).toHaveAttribute(
      "data-view-state",
      "empty",
    );
  });
});
