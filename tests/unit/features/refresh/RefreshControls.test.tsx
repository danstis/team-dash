import { StrictMode, type ReactElement, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialsProvider,
  useCredentialTokenAccessor,
  useCredentials,
  type CredentialsContextValue,
} from "../../../../src/app/credentials-context";
import {
  WorkspaceProvider,
  useWorkspace,
  type SelectedWorkspace,
  type WorkspaceContextValue,
} from "../../../../src/app/workspace-context";
import { db } from "../../../../src/data/db/schema";
import {
  OutcomeBanner,
  ProgressIndicator,
  RefreshButton,
  RefreshControls,
} from "../../../../src/features/refresh/RefreshControls";
import type {
  RefreshFailureReason,
  RefreshOrchestrator,
  RefreshOutcome,
} from "../../../../src/data/refresh";
import { smallDatasetWorkspaceGid } from "../../../../fixtures/asana/small-dataset/data";
import { server } from "../../../setup";

// jsdom defaults `navigator.onLine` to `false` in some configurations.
// The production `useOffline()` hook reads that value at mount time and
// surfaces the FR-087 offline explanation with the refresh button
// disabled when it is `false`. The dedicated offline-gating test below
// exercises that path via the `forceOffline` prop seam; every other test
// assumes the browser is online so we set `navigator.onLine = true`
// once at module evaluation before any test runs.
Object.defineProperty(globalThis.navigator, "onLine", {
  configurable: true,
  value: true,
  writable: true,
});

const FIXTURE_TOKEN = "fixture-refresh-unit-token-1234567890";

const SAMPLE_WORKSPACE: SelectedWorkspace = {
  gid: smallDatasetWorkspaceGid,
  name: "Team Dash Workspace",
  selectedAt:
    "2026-08-02T06:25:00.000Z" as unknown as SelectedWorkspace["selectedAt"],
};

interface CapturedHandles {
  credentials: CredentialsContextValue | null;
  workspace: WorkspaceContextValue | null;
}

type HandlesRef = { current: CapturedHandles | null };

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

async function driveProvidersToReady(handlesRef: HandlesRef): Promise<void> {
  await waitFor(() => {
    expect(handlesRef.current?.credentials).not.toBeNull();
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

function renderRefreshControls(
  props: Readonly<{
    readonly orchestrator?: RefreshOrchestrator;
    readonly forceOffline?: boolean;
  }> = {},
): HandlesRef {
  const handlesRef: HandlesRef = { current: null };

  render(
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <RefreshProbe handlesRef={handlesRef} />
          <RefreshControls
            {...(props.orchestrator !== undefined
              ? { orchestrator: props.orchestrator }
              : {})}
            {...(props.forceOffline !== undefined
              ? { forceOffline: props.forceOffline }
              : {})}
          />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>,
  );

  return handlesRef;
}

/* -------------------------------------------------------------------------- */
/* Scripted orchestrator fakes                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build a `RefreshOrchestrator` whose `runRefresh` returns the
 * supplied outcome verbatim. The fake does NOT touch Dexie, MSW,
 * or `navigator.onLine` — it exists so the unit suite can pin the
 * component's outcome-rendering surface deterministically.
 */
function scriptOrchestrator(outcome: RefreshOutcome): RefreshOrchestrator {
  return {
    runRefresh: vi.fn(async () => outcome),
  };
}

/**
 * Like `scriptOrchestrator`, but invokes the supplied callback in
 * addition to returning the outcome. Lets cancellation tests assert
 * that the `AbortSignal` the component constructed was forwarded
 * to the orchestrator (FR-021 widening).
 */
function scriptOrchestratorWithProbe(args: {
  readonly outcome: RefreshOutcome;
  readonly probe: (signal: AbortSignal | undefined) => void;
}): RefreshOrchestrator {
  return {
    runRefresh: vi.fn(async (runArgs: {
      readonly signal?: AbortSignal;
    }) => {
      args.probe(runArgs.signal);
      return args.outcome;
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("RefreshControls", () => {
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

  it("renders the exported leaf components with their documented states", () => {
    const clickSpy = () => undefined;

    const { rerender } = render(
      <div>
        <RefreshButton
          onClick={clickSpy}
          disabled={false}
          busy={false}
          offline={false}
        />
        <ProgressIndicator />
        <OutcomeBanner
          kind="success"
          completedAt="2026-08-02T06:30:00.000Z"
          errorDetail={null}
          failureReason={null}
        />
      </div>,
    );

    expect(screen.getByTestId("refresh-button")).toHaveTextContent("Refresh");
    expect(screen.getByTestId("refresh-button")).toHaveAttribute(
      "data-offline",
      "false",
    );
    expect(screen.getByTestId("progress-indicator")).toHaveTextContent(
      "Refreshing your workspace…",
    );
    expect(screen.getByTestId("outcome-banner")).toHaveAttribute(
      "data-outcome",
      "success",
    );
    expect(screen.getByTestId("outcome-banner")).toHaveAttribute(
      "data-completed-at",
      "2026-08-02T06:30:00.000Z",
    );

    rerender(
      <div>
        <RefreshButton
          onClick={clickSpy}
          disabled={true}
          busy={true}
          offline={false}
        />
        <OutcomeBanner
          kind="partial_failure"
          completedAt={null}
          errorDetail="Partial refresh failed"
          failureReason="network_error"
        />
      </div>,
    );

    expect(screen.getByTestId("refresh-button")).toHaveTextContent(
      "Refreshing…",
    );
    expect(screen.getByTestId("refresh-button")).toBeDisabled();
    expect(screen.getByTestId("outcome-banner")).toHaveAttribute(
      "data-outcome",
      "partial_failure",
    );
    expect(screen.getByTestId("outcome-banner")).toHaveAttribute(
      "data-failure-reason",
      "network_error",
    );
  });

  it("keeps the refresh action disabled until both token and workspace are ready", async () => {
    renderRefreshControls({
      orchestrator: scriptOrchestrator({
        kind: "success",
        sessionId: "session-test",
        completedAt: "2026-08-02T06:30:00.000Z",
        itemsRetrieved: 1,
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });

    expect(screen.getByTestId("refresh-button")).toBeDisabled();
    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(screen.queryByTestId("outcome-banner")).toBeNull();
  });

  it("calls the orchestrator on click and surfaces a success outcome", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "success",
      sessionId: "session-success-1",
      completedAt: "2026-08-02T06:30:00.000Z",
      itemsRetrieved: 12,
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "success");
      return node;
    });

    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(banner).toHaveAttribute("data-completed-at", "2026-08-02T06:30:00.000Z");
    expect(orchestrator.runRefresh).toHaveBeenCalledTimes(1);
    const args = (orchestrator.runRefresh as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      readonly workspaceGid: string;
      readonly signal: AbortSignal | undefined;
    };
    expect(args.workspaceGid).toBe(smallDatasetWorkspaceGid);
    expect(args.signal).toBeDefined();
  });

  it("forwards an AbortSignal to the orchestrator so mid-flight cancel surfaces as cancelled", async () => {
    let observedSignal: AbortSignal | undefined;
    const orchestrator = scriptOrchestratorWithProbe({
      outcome: {
        kind: "cancelled",
        sessionId: "session-cancelled-1",
      },
      probe: (signal) => {
        observedSignal = signal;
      },
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "cancelled");
      return node;
    });

    expect(banner).toHaveAttribute("data-completed-at", "");
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(false);
    expect(banner).toHaveTextContent("Refresh was cancelled.");
  });

  it("disables the refresh action and shows the offline explanation when offline (FR-087)", () => {
    renderRefreshControls({ forceOffline: true });

    const button = screen.getByTestId("refresh-button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-offline", "true");
    expect(screen.getByTestId("offline-explanation")).toHaveAttribute(
      "data-offline",
      "true",
    );
    expect(screen.getByTestId("offline-state")).toHaveAttribute(
      "data-view-state",
      "offline",
    );
  });

  it("renders the cancelled outcome with reason-specific copy", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "cancelled",
      sessionId: "session-cancelled-2",
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "cancelled");
      return node;
    });
    expect(banner).toHaveTextContent("Refresh cancelled");
    expect(banner).toHaveAttribute("role", "status");
  });

  it("renders the auth_failure outcome with reason-specific copy", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "partial_failure",
      sessionId: "session-auth-1",
      reason: "auth_failure",
      message: "Authentication failed: the token was rejected by Asana.",
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "auth_failure");
      return node;
    });
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Authentication failed");
    expect(banner).toHaveTextContent(
      "Authentication failed: the token was rejected by Asana.",
    );
  });

  it("renders the permission_failure outcome with reason-specific copy", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "partial_failure",
      sessionId: "session-permission-1",
      reason: "permission_failure",
      message: "Permission denied while accessing /projects/1234.",
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "permission_failure");
      return node;
    });
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Permission denied");
    expect(banner).toHaveTextContent(
      "Permission denied while accessing /projects/1234.",
    );
  });

  it("renders the rate_limited outcome with reason-specific copy", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "partial_failure",
      sessionId: "session-rl-1",
      reason: "rate_limited",
      message: "Rate limited by Asana; retry after 30000ms.",
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "rate_limited");
      return node;
    });
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner).toHaveTextContent("Rate limited by Asana");
    expect(banner).toHaveTextContent(
      "Rate limited by Asana; retry after 30000ms.",
    );
  });

  it("renders the partial_failure outcome with the network_error sub-reason", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "partial_failure",
      sessionId: "session-net-1",
      reason: "network_error",
      message: "Network error: fetch failed",
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "partial_failure");
      return node;
    });
    expect(banner).toHaveAttribute(
      "data-failure-reason",
      "network_error",
    );
    expect(banner).toHaveTextContent("Partial refresh result");
    expect(banner).toHaveTextContent("Network error: fetch failed");
  });

  it("renders the partial_failure outcome with the validation_error sub-reason", async () => {
    const orchestrator = scriptOrchestrator({
      kind: "partial_failure",
      sessionId: "session-val-1",
      reason: "validation_error",
      message:
        "Asana response failed schema validation at data.0.name: Required",
    });
    const handlesRef = renderRefreshControls({ orchestrator });
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "partial_failure");
      return node;
    });
    expect(banner).toHaveAttribute(
      "data-failure-reason",
      "validation_error",
    );
    expect(banner).toHaveTextContent(
      "Asana response failed schema validation at data.0.name: Required",
    );
  });

  it("runs the success path against MSW and persists a succeeded session", async () => {
    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "success");
      return node;
    });

    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(banner.getAttribute("data-completed-at")).not.toBe("");

    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toMatch(/^session-/);
    expect(sessions[0]?.status).toBe("succeeded");
    expect(sessions[0]?.finishedAt).toBe(
      banner.getAttribute("data-completed-at"),
    );

    expect(await db.projects.count()).toBeGreaterThan(0);
    expect(await db.tasks.count()).toBeGreaterThan(0);
  });

  it("keeps the live cache untouched when the orchestrator reports permission_failure on MSW", async () => {
    server.use(
      http.get(
        "https://app.asana.com/api/1.0/projects/:projectGid/tasks",
        () => HttpResponse.json({ errors: [{ message: "Forbidden" }] }, { status: 403 }),
      ),
    );

    const handlesRef = renderRefreshControls();
    await driveProvidersToReady(handlesRef);

    fireEvent.click(screen.getByTestId("refresh-button"));

    const banner = await waitFor(() => {
      const node = screen.getByTestId("outcome-banner");
      expect(node).toHaveAttribute("data-outcome", "permission_failure");
      return node;
    });

    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(banner).toHaveTextContent("Permission denied");

    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("permission_failure");
    expect(sessions[0]?.finishedAt).not.toBeNull();
    // FR-022: cache stays untouched on every failure path.
    expect(await db.projects.toArray()).toEqual([]);
    expect(await db.tasks.toArray()).toEqual([]);
  });

  it("isolates the failureReason type union to the documented values", () => {
    const exhaustive: Record<RefreshFailureReason, true> = {
      auth_failure: true,
      permission_failure: true,
      rate_limited: true,
      network_error: true,
      validation_error: true,
    };
    expect(Object.keys(exhaustive)).toHaveLength(5);
  });
});
