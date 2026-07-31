/**
 * T043 [US1] — unit tests for `WorkspaceSelector`
 * (BSOD-171).
 *
 * Spec / contract references
 * --------------------------
 * User Story 1 acceptance scenario 5 (spec.md §"User Story 1",
 * FR-011):
 *
 *   "Given a validated token, When the user views the list of accessible
 *    workspaces, Then they can select exactly one workspace to use for
 *    reporting, and that choice is what scopes all subsequent data
 *    retrieval."
 *
 * And FR-008 (URL / log / value safety): the full token is never
 * rendered, logged, or embedded in any URL.
 *
 * What "unit" means here
 * ----------------------
 * The selector is a feature-component leaf under
 * `src/features/credentials/**`. The unit boundary is the
 * `useWorkspace()` context hook — mocked here so the selector's
 * rendered DOM, single-select semantics, and callback surface can be
 * exercised in isolation from the IndexedDB-backed
 * `WorkspaceProvider`. The Dexie round-trip belongs in
 * `tests/integration/credentials/first-run.test.tsx` (T035) — this
 * file stops at the contract the selector publishes to its caller.
 *
 * URL / log safety (FR-008)
 * -------------------------
 * Every assertion that inspects the rendered DOM pins that no token
 * (test or otherwise) appears anywhere in the surface. The selector
 * never receives a token in its props; the prop shape is the canonical
 * boundary that prevents a future contributor from accidentally
 * widening the contract to leak the credential.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import type { asanaWorkspaceSchema } from "../../../../src/data/asana/schemas";

const { useWorkspaceMock, selectWorkspaceMock, clearSelectionMock } =
  vi.hoisted(() => ({
    useWorkspaceMock: vi.fn(),
    selectWorkspaceMock: vi.fn(async () => undefined),
    clearSelectionMock: vi.fn(async () => undefined),
  }));

vi.mock("../../../../src/app/workspace-context", () => ({
  useWorkspace: useWorkspaceMock,
}));

import { WorkspaceSelector } from "../../../../src/features/credentials/WorkspaceSelector";
import type { SelectedWorkspace } from "../../../../src/app/workspace-context";

type WorkspaceFixture = z.infer<typeof asanaWorkspaceSchema>;

const WORKSPACE_A: WorkspaceFixture = {
  gid: "1200000000000001",
  name: "Acme Production",
  resource_type: "workspace" as const,
  is_organization: true,
};

const WORKSPACE_B: WorkspaceFixture = {
  gid: "1200000000000002",
  name: "Acme Sandbox",
  resource_type: "workspace" as const,
  is_organization: false,
};

const WORKSPACE_C: WorkspaceFixture = {
  gid: "1200000000000003",
  name: "Personal Side Project",
  resource_type: "workspace" as const,
};

const WORKSPACES: readonly WorkspaceFixture[] = [
  WORKSPACE_A,
  WORKSPACE_B,
  WORKSPACE_C,
];

describe("T043 [US1] WorkspaceSelector — single-select contract (FR-011)", () => {
  beforeEach(() => {
    selectWorkspaceMock.mockClear();
    clearSelectionMock.mockClear();
    useWorkspaceMock.mockReturnValue({
      state: "ready",
      workspace: null,
      selectWorkspace: selectWorkspaceMock,
      clearSelection: clearSelectionMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders one option per accessible workspace in a single-select control", () => {
    render(<WorkspaceSelector workspaces={WORKSPACES} />);

    // FR-011 / US1 scenario 5 — every workspace the validated token
    // can access is reachable from the rendered control. A selector
    // that drops or filters the list silently would let the user
    // miss a workspace; this assertion pins that the contract is
    // "show all, let the user pick one". A placeholder option (the
    // disabled "Select a workspace…" hint) is allowed in addition
    // to the actual workspace options; the assertion below filters
    // the placeholder out so the test stays robust against the UX
    // nicety without weakening the workspace-coverage check.
    const combobox = screen.getByRole("combobox", {
      name: /workspace/i,
    });
    expect(combobox).toBeInTheDocument();
    expect(combobox).toBeInstanceOf(HTMLSelectElement);

    const options = within(combobox).getAllByRole("option");
    const workspaceOptions = options.filter(
      (option) => (option as HTMLOptionElement).value !== "",
    );
    expect(workspaceOptions).toHaveLength(WORKSPACES.length);
    expect(workspaceOptions[0]).toHaveTextContent(WORKSPACE_A.name);
    expect(workspaceOptions[1]).toHaveTextContent(WORKSPACE_B.name);
    expect(workspaceOptions[2]).toHaveTextContent(WORKSPACE_C.name);
  });

  it("uses a single-select semantics — multiple options are never reachable simultaneously", () => {
    const { container } = render(<WorkspaceSelector workspaces={WORKSPACES} />);
    const select = container.querySelector("select");

    expect(select).not.toBeNull();
    expect(select?.multiple).toBe(false);

    // No checkboxes / radios — the rendered surface only ever allows
    // a single value through the native `<select multiple>` semantic.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not commit a selection until the user confirms with the explicit action", () => {
    render(<WorkspaceSelector workspaces={WORKSPACES} />);

    const select = screen.getByRole("combobox", { name: /workspace/i });

    // Choosing an option only sets the local state — no Dexie write
    // happens until the explicit "Select workspace" action fires.
    // A selector that auto-commits on change would fail the FR-011
    // "user picks" rule by racing ahead of the user.
    fireEvent.change(select, { target: { value: WORKSPACE_A.gid } });
    expect(selectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("calls selectWorkspace with the chosen workspace when the user confirms", async () => {
    const onSelected = vi.fn();
    render(
      <WorkspaceSelector workspaces={WORKSPACES} onSelected={onSelected} />,
    );

    const select = screen.getByRole("combobox", { name: /workspace/i });
    fireEvent.change(select, { target: { value: WORKSPACE_B.gid } });
    fireEvent.click(screen.getByRole("button", { name: /select workspace/i }));

    await waitFor(() => {
      expect(selectWorkspaceMock).toHaveBeenCalledTimes(1);
    });
    const firstCall = selectWorkspaceMock.mock.calls[0] as unknown as
      [SelectedWorkspace] | undefined;
    const arg = firstCall?.[0];
    expect(arg).toBeDefined();
    expect(arg?.gid).toBe(WORKSPACE_B.gid);
    expect(arg?.name).toBe(WORKSPACE_B.name);
    expect(typeof arg?.selectedAt).toBe("string");

    expect(onSelected).toHaveBeenCalledWith(WORKSPACE_B);
  });

  it("disables the confirm button until a workspace is chosen", () => {
    render(<WorkspaceSelector workspaces={WORKSPACES} />);

    const confirmButton = screen.getByRole("button", {
      name: /select workspace/i,
    });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: /workspace/i }), {
      target: { value: WORKSPACE_A.gid },
    });

    expect(confirmButton).toBeEnabled();
  });

  it("renders an explicit empty-state message when the token has no accessible workspaces", () => {
    // Spec clarification: "A workspace the token can access has zero
    // projects, or the token has zero accessible workspaces: the app
    // must state this rather than showing an empty table with no
    // explanation." A selector that silently renders an empty
    // <select> would mislead the user into thinking the request
    // failed rather than that the token has no workspaces.
    render(<WorkspaceSelector workspaces={[]} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /no accessible workspaces/i,
    );
    expect(selectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("exposes no token-shaped prop surface (FR-008 contract)", () => {
    // The selector's prop signature is the canonical boundary that
    // prevents a future contributor from accidentally widening the
    // contract to accept a token. A selector that exposes a `token`
    // prop would fail `tsc` because the component type does not
    // declare one. The rendered DOM is the second half of the
    // assertion — no token-like content ever appears in the surface
    // even though the selector never receives a token.
    render(
      <WorkspaceSelector
        // @ts-expect-error — `token` is intentionally absent from
        // the public prop type; this cast documents the FR-008
        // invariant at the type level for a future contributor.
        token="fixture-token-should-not-be-rendered"
        workspaces={WORKSPACES}
      />,
    );

    const surface = document.body.textContent ?? "";
    expect(surface).not.toContain("fixture-token-should-not-be-rendered");
    expect(surface).not.toMatch(/bearer /i);
  });

  it("renders the current workspace as the initially-selected option when one is set in context", () => {
    // The Settings "switch workspace" flow re-mounts the selector with
    // an already-selected workspace in the context; the rendered
    // control MUST pre-select that option so the user can either
    // confirm the existing selection or change it. A selector that
    // always starts unselected would force an unnecessary second
    // click on the "switch workspace" path.
    const selectedAt = "2026-07-25T10:00:00.000Z";
    useWorkspaceMock.mockReturnValue({
      state: "ready",
      workspace: {
        gid: WORKSPACE_C.gid,
        name: WORKSPACE_C.name,
        selectedAt: selectedAt as never,
      },
      selectWorkspace: selectWorkspaceMock,
      clearSelection: clearSelectionMock,
    });

    render(<WorkspaceSelector workspaces={WORKSPACES} />);

    const select = screen.getByRole("combobox", {
      name: /workspace/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe(WORKSPACE_C.gid);
  });
});
