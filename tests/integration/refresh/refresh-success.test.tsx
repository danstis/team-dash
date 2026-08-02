/**
 * BSOD-303 (T049) — Refresh success outcome red→green.
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
 * And FR-020 ("the system MUST provide a prominent, explicit manual
 * Refresh action; the system MUST NOT perform scheduled or background
 * refreshes without user action") + FR-021 ("on completion MUST show
 * the outcome … along with the last successful refresh timestamp and
 * whether currently displayed data is cached or fresh"). The
 * cached-vs-fresh label is T050 (BSOD-304); the failure-reason
 * rendering for the `partial_failure` branch of the outcome is T051
 * (BSOD-305). This row ships the success path plus the
 * `partial_failure` OutcomeBanner shape that T051 will fill in.
 *
 * What this test pins
 * -------------------
 * The pre-fix surface is the T031 placeholder ("Team Dash is
 * bootstrapping…"). The post-fix surface adds a `<RefreshControls />`
 * composition (US2, `src/features/refresh/RefreshControls.tsx`) that
 * exposes a manual refresh action and renders a progress → success
 * outcome. This integration test is the end-to-end pin: starting from
 * a gate-open state (credential + workspace ready), clicking Refresh
 * against the small-dataset MSW handlers must:
 *
 *   1. Render a `RefreshButton` that the user can click.
 *   2. After the click, render a `ProgressIndicator` while the
 *      refresh is in flight (FR-021 — "During a refresh, the system
 *      MUST show progress").
 *   3. On completion, render an `OutcomeBanner` with the success
 *      variant and a `completedAt` timestamp (FR-021 — "on completion
 *      MUST show the outcome … along with the last successful refresh
 *      timestamp").
 *   4. Persist a `RefreshSession` row in IndexedDB with
 *      `status: 'succeeded'` and a non-null `finishedAt` — the row
 *      the FR-068 atomic commit path leaves behind.
 *
 * The test deliberately drives the providers via their captured
 * handles (`setSessionToken` / `selectWorkspace`) rather than the
 * first-run UI flow: T046's gate is upstream of this row, and the
 * per-context state-machine contract it pins is exercised by
 * `tests/integration/credentials/first-run.test.tsx`. The T049
 * surface is the gate-open "any reporting surface" — once the gate
 * lifts, this component is what the user sees and what they can act
 * on.
 *
 * Out of scope (other rows, NOT exercised here)
 * ---------------------------------------------
 * - `partial_failure` outcome rendering: T051 (BSOD-305) extends
 *   `OutcomeBanner` with the failure-reason branch. T049 ships the
 *   primitive shape so the red→green row's red test (`describe
 *   BSOD-303 (T049) — refresh success outcome red→green`) does not
 *   depend on T051's later extension; the test file imports only
 *   the success outcome it actually pins.
 * - Cached-vs-fresh label / `FreshnessBanner`: T050 (BSOD-304).
 * - Subtask project-membership resolution: T058 (BSOD-309).
 * - The full orchestrator (`src/data/refresh/refresh-orchestrator.ts`):
 *   T051 owns the per-outcome accounting the Asana client's
 *   discriminated union is mapped onto. T049 ships a minimal
 *   in-component refresh that exercises the success path through
 *   the existing `RefreshStagingRepository` so the red→green slice
 *   is testable without a T051 dependency.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` + MSW
 * per `tests/setup.ts`. No browser, no live Asana workspace, no live
 * token (NFR-005). The fixture PAT is synthetic and the small-dataset
 * MSW handlers authorise any `Authorization: Bearer …` request.
 */
import { type ReactElement, StrictMode, useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { RefreshControls } from "../../../src/features/refresh/RefreshControls";

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
 * The T049 probe. Renders the providers' settled state to the DOM so
 * an integration test can `waitFor` on it without depending on the
 * captured-handle ref. Also writes the live provider actions into the
 * test-owned `handlesRef` so the test can drive the credentials +
 * workspace to the gate-open state from outside the render tree.
 *
 * The `useEffect` publish is intentional: a ref write during render
 * would warn under StrictMode's double-invoke; the post-commit
 * `useEffect` write is the canonical place to publish derived data
 * from a render tree to a test harness.
 */
function RefreshProbe({ handlesRef }: { handlesRef: HandlesRef }): ReactElement {
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

async function driveProvidersToReady(
  handlesRef: HandlesRef,
): Promise<void> {
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
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the refresh controls surface once the gate is open", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    // The new `<RefreshControls />` composition carries
    // `data-testid="refresh-controls"` on its root, with a `Refresh`
    // button (`data-testid="refresh-button"`) the user can click. Both
    // anchors are stable so a future contributor who re-skins the
    // surface cannot silently drop the action.
    await waitFor(() => {
      expect(screen.getByTestId("refresh-controls")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("refresh-button"),
    ).toBeInTheDocument();
  });

  it("shows progress then a success outcome with a completion timestamp against MSW", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    // The refresh button MUST be visible before the user can act on
    // it (FR-020). The progress indicator MUST NOT be visible at idle
    // — seeing it before the user clicks means the surface has flipped
    // to a running state for no reason.
    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(screen.queryByTestId("outcome-banner")).toBeNull();

    // Click the refresh button. The component MUST immediately enter
    // the running state and render the `ProgressIndicator` (FR-021).
    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      expect(screen.getByTestId("progress-indicator")).toBeInTheDocument();
    });

    // On completion the component MUST render the `OutcomeBanner` with
    // the success variant and a `completedAt` timestamp. The contract
    // pins "success, partial failure, cancellation, authentication
    // failure, permission failure, or rate-limit failure" as the
    // outcome kinds; T049 ships the success branch and the
    // partial-failure shape (T051 will fill the latter with the
    // reason-specific copy). The success anchor's `data-outcome="success"`
    // attribute is the stable contract selector.
    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node.getAttribute("data-outcome")).toBe("success");
      return node;
    });
    // FR-021 — "the last successful refresh timestamp". The banner
    // surfaces the `finishedAt` ISO string the `RefreshStagingRepository`
    // commit path writes, so a test can assert the value is a
    // parseable ISO instant. The textual rendering is verified through
    // the banner's data attribute rather than the human copy so a
    // future copy change doesn't break this pin.
    const completedAt = banner.getAttribute("data-completed-at");
    expect(completedAt).not.toBeNull();
    expect(typeof completedAt).toBe("string");
    const parsed = Date.parse(completedAt ?? "");
    expect(Number.isFinite(parsed)).toBe(true);
    // And the parsed instant is recent — within a minute of `now` —
    // so a future regression that surfaces a stale or pre-epoch
    // timestamp fails this assertion.
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
});
