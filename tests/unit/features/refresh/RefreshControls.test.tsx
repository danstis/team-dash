import { StrictMode, type ReactElement, useEffect } from "react";
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
import { smallDatasetWorkspaceGid } from "../../../../fixtures/asana/small-dataset/data";
import { server } from "../../../setup";

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
        <RefreshButton onClick={clickSpy} disabled={false} busy={false} />
        <ProgressIndicator />
        <OutcomeBanner
          kind="success"
          completedAt="2026-08-02T06:30:00.000Z"
          errorDetail={null}
        />
      </div>,
    );

    expect(screen.getByTestId("refresh-button")).toHaveTextContent("Refresh");
    expect(screen.getByTestId("progress-indicator")).toHaveTextContent(
      "Refreshing your workspace…",
    );
    expect(screen.getByTestId("outcome-banner")).toHaveAttribute(
      "data-outcome",
      "success",
    );

    rerender(
      <div>
        <RefreshButton onClick={clickSpy} disabled={true} busy={true} />
        <OutcomeBanner
          kind="partial_failure"
          completedAt={null}
          errorDetail={null}
        />
      </div>,
    );

    expect(screen.getByTestId("refresh-button")).toHaveTextContent(
      "Refreshing…",
    );
    expect(screen.getByTestId("refresh-button")).toBeDisabled();
    expect(screen.getByTestId("outcome-banner")).toHaveTextContent(
      "The refresh stopped before the workspace was fully retrieved. Your previous good cache has been kept.",
    );
  });

  it("keeps the refresh action disabled until both token and workspace are ready", async () => {
    renderRefreshControls();

    await waitFor(() => {
      expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    });

    expect(screen.getByTestId("refresh-button")).toBeDisabled();
    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(screen.queryByTestId("outcome-banner")).toBeNull();
  });

  it("runs the success path and persists a succeeded session with a generated session id", async () => {
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

  it("routes a task-fetch permission failure to partial_failure without flushing staged data", async () => {
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
      expect(node).toHaveAttribute("data-outcome", "partial_failure");
      return node;
    });

    expect(screen.queryByTestId("progress-indicator")).toBeNull();
    expect(banner).toHaveTextContent(
      "Failed to fetch tasks for project 1200000000000100: permission_failure",
    );
    expect(await db.projects.toArray()).toEqual([]);
    expect(await db.tasks.toArray()).toEqual([]);

    const sessions = await db.refreshSessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("running");
    expect(sessions[0]?.finishedAt).toBeNull();
  });

  it("renders the supplied partial-failure detail when one exists", () => {
    render(
      <OutcomeBanner
        kind="partial_failure"
        completedAt={null}
        errorDetail="Failed to fetch projects: network_error"
      />,
    );

    expect(screen.getByTestId("outcome-banner")).toHaveTextContent(
      "Failed to fetch projects: network_error",
    );
  });
});
