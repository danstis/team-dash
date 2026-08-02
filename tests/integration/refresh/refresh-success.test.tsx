/**
 * BSOD-303 (T049) → T03 — Refresh success outcome red→green.
 *
 * Spec / contract references
 * --------------------------
 * Spec US2 acceptance scenario 4 (spec.md §"User Story 2"):
 *
 *   "Given the user is viewing the dashboard, When they choose Refresh,
 *    Then the dashboard shows progress, then on completion shows a
 *    success outcome with the last successful refresh timestamp, and
 *    indicates whether the currently displayed data is cached or fresh."
 *
 * FR-020 (explicit manual refresh), FR-021 (progress + outcome +
 * completedAt), FR-022 (atomic refresh integrity — failed refreshes
 * must not corrupt the cache).
 *
 * What this test pins
 * -------------------
 * Starting from a gate-open state (credential + workspace ready),
 * clicking Refresh against the small-dataset MSW handlers must:
 *
 *   1. Render a `<RefreshControls />` composition with a clickable
 *      `data-testid="refresh-button"` (FR-020).
 *   2. Render a `<ProgressIndicator />` while the refresh is in
 *      flight (FR-021 — "During a refresh, the system MUST show
 *      progress").
 *   3. Render an `<OutcomeBanner />` with the success variant and a
 *      `data-completed-at` ISO timestamp (FR-021).
 *   4. Persist a `RefreshSession` row in IndexedDB with
 *      `status: 'succeeded'` and a non-null `finishedAt`.
 *
 * T03 widens the orchestrator-driven `<RefreshControls />` to
 * delegate fetching / staging / committing to
 * `createRefreshOrchestrator({ deps })` from
 * `src/data/refresh/refresh-orchestrator.ts`. The success-path
 * surface is preserved (T049 = MSW small-dataset handler → projects
 * → tasks → commit) but the failure-path text and session
 * transitions now route through the orchestrator's
 * `handleClientFailure` helper instead of the T049 in-component
 * `throw new Error(...)` branch. The integration test's assertion
 * text is updated accordingly (T03): the orchestrator's
 * `describeFailure` returns "Permission denied while accessing…" (or
 * a fallback when the response carries no `resource` hint), and the
 * `RefreshSession.status` now transitions to `permission_failure`
 * (orchestrator's session row-write path) rather than staying
 * `running` (the T049 in-component behaviour).
 *
 * Tests
 * -----
 * `tests/integration/refresh` runs against jsdom + `fake-indexeddb` +
 * MSW per `tests/setup.ts`. No browser, no live Asana workspace, no
 * live token (NFR-005).
 */
import { type ReactElement, StrictMode, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
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
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";
import { server } from "../../setup";
import { RefreshControls } from "../../../src/features/refresh/RefreshControls";

// jsdom defaults `navigator.onLine` to `false` in some configurations.
// The production `useOffline()` hook reads that value at mount time;
// pinning `navigator.onLine = true` once at module evaluation makes
// the online-gated component path deterministic for the success /
// failure-mode integration tests. Offline gating is exercised in
// the dedicated unit test (`tests/unit/features/refresh/...`) via
// the `forceOffline` prop seam.
Object.defineProperty(globalThis.navigator, "onLine", {
  configurable: true,
  value: true,
  writable: true,
});

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                              */
/* -------------------------------------------------------------------------- */

const FIXTURE_TOKEN = "fixture-refresh-success-token-1234567890";

const SAMPLE_WORKSPACE: SelectedWorkspace = {
  gid: smallDatasetWorkspaceGid,
  name: "Team Dash Workspace",
  selectedAt:
    "2026-07-31T09:00:00.000Z" as unknown as SelectedWorkspace["selectedAt"],
};

/* -------------------------------------------------------------------------- */
/* Test handle capture                                                        */
/* -------------------------------------------------------------------------- */

interface CapturedHandles {
  credentials: CredentialsContextValue | null;
  workspace: WorkspaceContextValue | null;
}

type HandlesRef = { current: CapturedHandles | null };

/**
 * The success-path probe. Renders the providers' settled state to the
 * DOM so the test can `waitFor` on it without depending on the
 * captured-handle ref. Also writes the live provider actions into the
 * test-owned `handlesRef` so the test can drive the credentials +
 * workspace to the gate-open state from outside the render tree.
 */
function RefreshProbe({
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
    <div data-testid="refresh-probe">
      <span data-testid="probe-credentials-state">{credentials.state}</span>
      <span data-testid="probe-workspace-state">{workspace.state}</span>
      <span data-testid="probe-has-token">
        {tokenAccessor.getPlaintextToken() === null ? "no" : "yes"}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

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

function renderRefreshControls(): HandlesRef {
  const handlesRef: HandlesRef = { current: null };
  render(
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <RefreshProbe handlesRef={handlesRef} />
          <RefreshControls />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>,
  );
  return handlesRef;
}

/* -------------------------------------------------------------------------- */
/* Refresh success path                                                       */
/* -------------------------------------------------------------------------- */

describe("BSOD-303 (T049) — refresh success outcome", () => {
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

  it("renders the refresh controls surface once the gate is open", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    await waitFor(() => {
      expect(screen.getByTestId("refresh-controls")).toBeInTheDocument();
    });
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });

  it("shows progress then a success outcome with a completion timestamp against MSW", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    // The refresh button MUST be visible before the user can act on
    // it (FR-020). The progress indicator MUST NOT be visible at idle
    // — seeing it before the user clicks means the surface has
    // flipped to a running state for no reason.
    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(screen.queryByTestId("outcome-banner")).toBeNull();

    // Click the refresh button. The orchestrator's `runRefresh`
    // is invoked synchronously after the click; the component's
    // state transitions to `running` so the `<ProgressIndicator />`
    // renders (FR-021).
    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(screen.getByTestId("progress-indicator")).toBeInTheDocument();
    });

    // On completion the component MUST render the `OutcomeBanner`
    // with the success variant and a `data-completed-at` timestamp.
    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node.getAttribute("data-outcome")).toBe("success");
      return node;
    });
    // FR-021 — "the last successful refresh timestamp". The banner
    // surfaces the `finishedAt` ISO string the orchestrator's commit
    // path writes, so a test can assert the value is a parseable ISO
    // instant. The textual rendering is verified through the banner's
    // data attribute rather than the human copy so a future copy
    // change doesn't break this pin.
    const completedAt = banner.getAttribute("data-completed-at");
    expect(completedAt).not.toBeNull();
    expect(typeof completedAt).toBe("string");
    const parsed = Date.parse(completedAt ?? "");
    expect(Number.isFinite(parsed)).toBe(true);
    expect(Math.abs(parsed - Date.now())).toBeLessThan(60_000);

    // Progress indicator MUST be gone once the refresh completes —
    // seeing it linger after the banner appears means the surface
    // has not transitioned out of the running state.
    expect(screen.queryByTestId("progress-indicator")).toBeNull();
  });

  it("persists a succeeded RefreshSession with the same finishedAt timestamp the banner shows", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node.getAttribute("data-outcome")).toBe("success");
      return node;
    });
    const completedAt = banner.getAttribute("data-completed-at") ?? "";

    // The FR-068 atomic commit path MUST leave behind a
    // `RefreshSession` row in the `succeeded` state. The test
    // queries Dexie directly so the assertion is independent of any
    // future UI change. Exactly one session row exists; the
    // `finishedAt` mirrors what the banner surfaces.
    const sessions = await db.refreshSessions.toArray();
    const succeeded = sessions.filter((row) => row.status === "succeeded");
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]?.finishedAt).toBe(completedAt);
  });

  it("routes a project task-fetch failure to permission_failure and keeps the live cache untouched", async () => {
    server.use(
      http.get("https://app.asana.com/api/1.0/projects/:projectGid/tasks", () =>
        HttpResponse.json(
          { errors: [{ message: "Forbidden" }] },
          { status: 403 },
        ),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node.getAttribute("data-outcome")).toBe("permission_failure");
      return node;
    });

    expect(banner.getAttribute("data-completed-at")).toBe("");
    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    // T03 — the orchestrator's `describeFailure` returns the
    // "Permission denied while accessing …" message; the banner
    // surfaces that as the body of the `permission_failure`
    // variant.
    expect(banner).toHaveTextContent("Permission denied");

    // FR-022 — the previous good cache stays byte-identical on
    // every failure path. The orchestrator discards the staging
    // buffer before the commit() call, so `projects` and `tasks`
    // are untouched.
    expect(await db.projects.toArray()).toEqual([]);
    expect(await db.tasks.toArray()).toEqual([]);

    // T03 — the orchestrator's `handleClientFailure` writes the
    // failure-mode-specific `RefreshSession.status` (here:
    // `permission_failure`) and a non-null `finishedAt`. The T049
    // in-component path left the session `running`; the new
    // orchestrator drives a terminal status so the audit trail
    // surfaces the failure mode.
    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("permission_failure");
    expect(sessions[0]?.finishedAt).not.toBeNull();
  });

  it("does not run a second refresh while one is already in flight", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));
    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(screen.getByTestId("outcome-banner")).toBeInTheDocument();
    });

    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
  });
});
