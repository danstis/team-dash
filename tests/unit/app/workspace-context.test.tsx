/**
 * T031 — `src/app/workspace-context.tsx` unit/component tests (Red phase).
 *
 * The WorkspaceProvider owns the "selected Asana workspace" half of
 * the shell: which workspace (gid + name) the user is currently
 * reporting against, and the derived `ViewState` for that selection.
 * It pairs with `CredentialsProvider` so the route guard (T046) can
 * ask a single question — "is the user ready to see reporting screens?"
 * — by composing the two providers' states.
 *
 * The provider's contract (spec FR-011; data-model.md `Workspace`):
 *
 * - It MUST synchronously surface the `'loading'` `ViewState` on mount
 *   while the IndexedDB read for the selected workspace resolves.
 *   The app must boot — children render under the provider while the
 *   read is in flight.
 *
 * - It MUST resolve to `'first_run'` when no workspace is selected.
 *   The exact UX (which screen to land on) is owned by downstream
 *   features (US1's workspace selector T043); the provider only
 *   reports the state.
 *
 * - It MUST resolve to `'ready'` when a workspace is selected and
 *   present in the IndexedDB cache.
 *
 * - It MUST expose the selected workspace via a typed hook
 *   (`useWorkspace`) so consumers can read the gid/name without
 *   re-querying IndexedDB themselves.
 *
 * - `selectWorkspace(workspace)` MUST persist the selection to
 *   IndexedDB so a reload restores it (FR-011: the selection scopes
 *   all subsequent data retrieval). The hook returns a promise so the
 *   caller can await the write.
 *
 * Like the credentials context, the WorkspaceProvider is the contract
 * downstream user stories depend on — its `'loading'` initial state and
 * IndexedDB-bound persistence are part of the public shell surface.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../../src/data/db/schema";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../src/app/workspace-context";

type WorkspaceHookValue = ReturnType<typeof useWorkspace>;

function WorkspaceHarness({ testId }: { testId: string }): React.ReactElement {
  const value = useWorkspace();
  return (
    <div data-testid={testId}>
      <span data-testid={`${testId}-state`}>{value.state}</span>
      <span data-testid={`${testId}-gid`}>{value.workspace?.gid ?? ""}</span>
      <span data-testid={`${testId}-name`}>{value.workspace?.name ?? ""}</span>
    </div>
  );
}

describe("T031 WorkspaceProvider (T031 app shell contract)", () => {
  beforeEach(async () => {
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  it("mounts its children synchronously with the `'loading'` ViewState", () => {
    render(
      <WorkspaceProvider>
        <WorkspaceHarness testId="harness" />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("harness-state").textContent).toBe("loading");
  });

  it("settles on `'first_run'` when no workspace is selected", async () => {
    render(
      <WorkspaceProvider>
        <WorkspaceHarness testId="harness" />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("harness-state").textContent).toBe("first_run");
    });

    expect(screen.getByTestId("harness-gid").textContent).toBe("");
  });

  it("settles on `'ready'` when a workspace is selected and present in IndexedDB", async () => {
    // Dexie's `Workspace.selectedAt` is a plain `string`; the
    // `ISODateTime` brand is owned by the `SelectedWorkspace` contract
    // exposed through `useWorkspace`. The literal ISO-8601 string below
    // satisfies the brand at runtime because the row is read back through
    // the branded-shape cast in the provider.
    await db.workspaces.put({
      gid: "ws-123",
      name: "Acme Engineering",
      selectedAt: "2026-07-20T12:00:00Z",
    });

    render(
      <WorkspaceProvider>
        <WorkspaceHarness testId="harness" />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("harness-state").textContent).toBe("ready");
    });

    expect(screen.getByTestId("harness-gid").textContent).toBe("ws-123");
    expect(screen.getByTestId("harness-name").textContent).toBe(
      "Acme Engineering",
    );
  });

  it("exposes a typed useWorkspace hook", () => {
    function Probe(): null {
      const value: WorkspaceHookValue = useWorkspace();
      expect(value.state).toBeTypeOf("string");
      return null;
    }
    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );
  });

  it("selectWorkspace persists the selection to IndexedDB (FR-011)", async () => {
    function SelectProbe(): React.ReactElement {
      const value = useWorkspace();
      return (
        <div data-testid="probe">
          <span data-testid="probe-state">{value.state}</span>
          <span data-testid="probe-gid">{value.workspace?.gid ?? ""}</span>
          <span data-testid="probe-name">{value.workspace?.name ?? ""}</span>
          <button
            data-testid="probe-select"
            type="button"
            onClick={() => {
              void value.selectWorkspace({
                gid: "ws-pick",
                name: "Picked Workspace",
                // The `ISODateTime` brand is owned by `domain/types`;
                // the literal string here satisfies the brand at
                // runtime and is the test-only equivalent of what a
                // future date helper would produce.
                selectedAt: "2026-07-20T12:00:00Z" as never,
              });
            }}
          >
            select
          </button>
        </div>
      );
    }

    render(
      <WorkspaceProvider>
        <SelectProbe />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-state").textContent).toBe("first_run");
    });

    await act(async () => {
      screen.getByTestId("probe-select").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("probe-state").textContent).toBe("ready");
    });

    expect(screen.getByTestId("probe-gid").textContent).toBe("ws-pick");
    expect(screen.getByTestId("probe-name").textContent).toBe(
      "Picked Workspace",
    );

    const stored = await db.workspaces.get("ws-pick");
    expect(stored).toBeDefined();
    expect(stored?.name).toBe("Picked Workspace");
  });
});
