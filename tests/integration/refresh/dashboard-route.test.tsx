/**
 * T04 — `<Dashboard />` integration test (S01 dashboard route).
 *
 * Exercises the full Dexie-backed composition end-to-end: seeds the
 * cache, mounts the dashboard within the providers, observes the
 * freshness banner flip from `cached` (mid-window) to `fresh` (just
 * committed) to `empty` (cache cleared) and back. Verifies the
 * FR-084 data-quality surface reports the cache's actual flag set
 * and that the BSOD-351 Settings nav anchor is reachable.
 *
 * The test deliberately drives the orchestrator via MSW (the
 * small-dataset handler) rather than the scripted-fake seam from
 * `tests/unit/.../RefreshControls.test.tsx` — the dashboard's
 * contract is "post-refresh state surfaces in the dashboard
 * composition", and an MSW round-trip is the only way to validate
 * the Dexie-write-then-liveQuery-rerender boundary.
 *
 * Spec / contract references
 * --------------------------
 * - Spec US2 acceptance scenario 4 (post-refresh dashboard
 *   surfacing the last refreshed timestamp and the cached/fresh
 *   indicator).
 * - FR-021 (progress + outcome + completedAt + cached-or-fresh).
 * - FR-022 (atomic refresh integrity).
 * - FR-084 (drillable data-quality summary).
 * - FR-085 (empty state directs the user to Refresh).
 * - FR-090 (freshness label on metric surfaces).
 */
import { type ReactElement, StrictMode, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialsProvider,
  useCredentialTokenAccessor,
  useCredentials,
  type CredentialsContextValue,
} from "../../../src/app/credentials-context";
import {
  WorkspaceProvider,
  useWorkspace,
  type SelectedWorkspace,
  type WorkspaceContextValue,
} from "../../../src/app/workspace-context";
import { db } from "../../../src/data/db/schema";
import { Dashboard } from "../../../src/features/refresh/Dashboard";
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";

// jsdom's `navigator.onLine` defaults can vary by configuration; pin
// it once at module evaluation so the RefreshControls' offline hook
// does not mis-trigger during the test.
Object.defineProperty(globalThis.navigator, "onLine", {
  configurable: true,
  value: true,
  writable: true,
});

const FIXTURE_TOKEN = "fixture-dashboard-route-token-1234567890";

const SAMPLE_WORKSPACE: SelectedWorkspace = {
  gid: smallDatasetWorkspaceGid,
  name: "Team Dash Workspace",
  selectedAt:
    "2026-07-31T09:00:00.000Z" as unknown as SelectedWorkspace["selectedAt"],
};

interface CapturedHandles {
  credentials: CredentialsContextValue | null;
  workspace: WorkspaceContextValue | null;
}

type HandlesRef = { current: CapturedHandles | null };

function DashboardProbe({
  handlesRef,
}: {
  handlesRef: HandlesRef;
}): ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  const tokenAccessor = useCredentialTokenAccessor();
  useEffect(() => {
    handlesRef.current = { credentials, workspace };
  });
  return (
    <div data-testid="dashboard-probe">
      <span data-testid="probe-credentials-state">{credentials.state}</span>
      <span data-testid="probe-workspace-state">{workspace.state}</span>
      <span data-testid="probe-has-token">
        {tokenAccessor.getPlaintextToken() === null ? "no" : "yes"}
      </span>
    </div>
  );
}

async function driveProvidersToReady(handlesRef: HandlesRef): Promise<void> {
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

function renderDashboard(): HandlesRef {
  const handlesRef: HandlesRef = { current: null };
  // The dashboard's `data-testid="nav-settings"` link is a
  // `react-router` `<Link>` element, which requires a router
  // context. The integration test renders the dashboard through a
  // minimal memory router so the link has the context it needs
  // without dragging the production `<RouteGuard>` (which redirects
  // to `<FirstRunSetup />` until the gate opens — the test manages
  // its own gating via `driveProvidersToReady`).
  const testRouter = createMemoryRouter(
    [{ path: "/", Component: Dashboard }],
    { initialEntries: ["/"] },
  );
  render(
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <DashboardProbe handlesRef={handlesRef} />
          <RouterProvider router={testRouter} />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>,
  );
  return handlesRef;
}

beforeEach(async () => {
  await db.credentials.clear();
  await db.workspaces.clear();
  await db.refreshSessions.clear();
  await db.projects.clear();
  await db.tasks.clear();
  await db.dependencies.clear();
  await db.priorityFields.clear();
  await db.asanaTeams.clear();
  await db.snapshots.clear();
});

afterEach(() => {
  cleanup();
});

describe("Dashboard route composition", () => {
  it("renders the dashboard surface (role=main) and BSOD-351 Settings link", async () => {
    const handlesRef = renderDashboard();
    await driveProvidersToReady(handlesRef);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
    // BSOD-351: the Settings nav anchor MUST be reachable from the
    // dashboard. The Playwright e2e spec pins the same data-testid.
    expect(screen.getByTestId("nav-settings")).toBeInTheDocument();
  });

  it("renders the EmptyDashboard prompt when no succeeded RefreshSession exists", async () => {
    const handlesRef = renderDashboard();
    await driveProvidersToReady(handlesRef);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
    expect(screen.getByTestId("empty-dashboard")).toBeInTheDocument();
    // The refresh button MUST be available so the user can act on
    // the empty-state prompt.
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    // No succeeded session yet → no freshness banner and no
    // data-quality summary yet (the summary still mounts, the
    // cache is empty so it shows the empty path).
    expect(screen.queryByTestId("freshness-banner")).toBeNull();
  });

  it("flips EmptyDashboard → FreshnessBanner after a successful MSW refresh (data-freshness='fresh')", async () => {
    const handlesRef = renderDashboard();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    // First the empty-dashboard goes away, then the banner appears
    // with data-freshness='fresh' (committed within the 30 s window)
    // and the FR-021 completedAt timestamp flows through.
    await waitFor(() => {
      expect(screen.queryByTestId("empty-dashboard")).toBeNull();
    });
    const banner = await waitFor(() => {
      const node = screen.getByTestId("freshness-banner");
      expect(node).toHaveAttribute("data-freshness", "fresh");
      return node;
    });
    const completedAt = banner.getAttribute("data-last-refreshed-at");
    expect(completedAt).not.toBeNull();
    expect(typeof completedAt).toBe("string");
    expect(Number.isFinite(Date.parse(completedAt ?? ""))).toBe(true);
  });

  it("renders the data-quality summary with the small-dataset's flag mix", async () => {
    const handlesRef = renderDashboard();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("empty-dashboard")).toBeNull();
    });
    // The small-dataset MSW fixture includes one task with a
    // missing assignee, one with missing + estimated + due, etc.
    // After the orchestrator's commit() runs, the dashboard's
    // `deriveDataQualityFlags()` scans the Task rows and surfaces
    // a mix of kinds; pin at least the `missing_assignee` flag at
    // count=1 (task gid 1200000000000202 has assignee=null).
    const summary = await waitFor(() => {
      const node = screen.getByTestId("data-quality-summary");
      expect(node).toHaveAttribute("data-quality-empty", "false");
      return node;
    });
    expect(summary).toHaveAttribute(
      "data-quality-flag-missing_assignee",
      "1",
    );
    // The session-based freshness banner remains.
    expect(screen.getByTestId("freshness-banner")).toBeInTheDocument();
  });

  it("drops the freshness banner when the cache is cleared and reverts to EmptyDashboard", async () => {
    const handlesRef = renderDashboard();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));
    await waitFor(() => {
      expect(screen.queryByTestId("empty-dashboard")).toBeNull();
    });

    // Simulate a "clear cache" — the user clears their IndexedDB.
    // The dashboard's `useLiveQuery` re-emits and the failed-to-
    // resolve session set collapses the banner.
    await db.refreshSessions.clear();

    await waitFor(() => {
      expect(screen.getByTestId("empty-dashboard")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("freshness-banner")).toBeNull();
  });

  it("preserves the FR-087 offline gating on the dashboard", async () => {
    // Flip navigator.onLine to false so the RefreshControls hook
    // sees offline at mount. The dashboard's RefreshControls
    // disable Refresh and surface the offline explanation.
    Object.defineProperty(globalThis.navigator, "onLine", {
      configurable: true,
      value: false,
      writable: true,
    });
    try {
      const handlesRef = renderDashboard();
      await driveProvidersToReady(handlesRef);

      await waitFor(() => {
        expect(screen.getByTestId("dashboard")).toBeInTheDocument();
      });
      expect(screen.getByTestId("offline-explanation")).toHaveAttribute(
        "data-offline",
        "true",
      );
      expect(screen.getByTestId("refresh-button")).toBeDisabled();
    } finally {
      Object.defineProperty(globalThis.navigator, "onLine", {
        configurable: true,
        value: true,
        writable: true,
      });
    }
  });
});
