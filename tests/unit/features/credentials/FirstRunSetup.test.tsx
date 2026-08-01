import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  useCredentialsMock,
  useWorkspaceMock,
  tokenEntryFormMock,
  storageModeSelectorMock,
  workspaceSelectorMock,
} = vi.hoisted(() => ({
  useCredentialsMock: vi.fn(),
  useWorkspaceMock: vi.fn(),
  tokenEntryFormMock: vi.fn(),
  storageModeSelectorMock: vi.fn(),
  workspaceSelectorMock: vi.fn(),
}));

vi.mock("../../../../src/app/credentials-context", () => ({
  useCredentials: useCredentialsMock,
}));

vi.mock("../../../../src/app/workspace-context", () => ({
  useWorkspace: useWorkspaceMock,
}));

vi.mock("../../../../src/features/credentials/TokenEntry", () => ({
  TokenEntryForm: tokenEntryFormMock,
}));

vi.mock("../../../../src/features/credentials/StorageModeSelector", () => ({
  StorageModeSelector: storageModeSelectorMock,
}));

vi.mock("../../../../src/features/credentials/WorkspaceSelector", () => ({
  WorkspaceSelector: workspaceSelectorMock,
}));

import { FirstRunSetup } from "../../../../src/features/credentials/FirstRunSetup";

const VALIDATED_TOKEN = {
  token: "fixture-first-run-token-123456",
  maskedIdentifier: "3456",
  workspaces: [
    {
      gid: "workspace-1",
      name: "Acme Workspace",
      resource_type: "workspace" as const,
    },
  ],
} as const;

describe("FirstRunSetup", () => {
  const credentialsValue = {
    state: "first_run" as const,
    mode: null,
    maskedIdentifier: "",
    setSessionToken: vi.fn(async () => undefined),
    setPersistentToken: vi.fn(async () => undefined),
    clearToSessionOnly: vi.fn(async () => undefined),
    clearAll: vi.fn(async () => undefined),
  };

  const workspaceValue = {
    state: "first_run" as const,
    workspace: null as null | {
      gid: string;
      name: string;
      selectedAt: string;
    },
    selectWorkspace: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    credentialsValue.maskedIdentifier = "";
    workspaceValue.workspace = null;

    useCredentialsMock.mockReturnValue(credentialsValue);
    useWorkspaceMock.mockReturnValue(workspaceValue);

    tokenEntryFormMock.mockImplementation(
      ({
        onValidated,
      }: {
        onValidated?: (validated: typeof VALIDATED_TOKEN) => void;
      }) => (
        <button
          type="button"
          data-testid="token-entry-form"
          onClick={() => onValidated?.(VALIDATED_TOKEN)}
        >
          Validate token
        </button>
      ),
    );

    storageModeSelectorMock.mockImplementation(
      ({
        onModeSelected,
      }: {
        onModeSelected?: (mode: "session" | "persistent") => void;
      }) => (
        <button
          type="button"
          data-testid="storage-mode-selector"
          onClick={() => onModeSelected?.("session")}
        >
          Select mode
        </button>
      ),
    );

    workspaceSelectorMock.mockImplementation(
      ({ workspaces }: { workspaces: typeof VALIDATED_TOKEN.workspaces }) => (
        <div data-testid="workspace-selector">
          {workspaces.map((workspace) => (
            <span key={workspace.gid}>{workspace.name}</span>
          ))}
        </div>
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the first-run state, the empty status panel, and the token entry phase by default", () => {
    render(<FirstRunSetup />);

    expect(
      document.querySelector('[data-view-state="first_run"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: /first-run setup/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/current credential:/i)).toHaveTextContent(
      /not set/i,
    );
    expect(screen.getByText(/current workspace:/i)).toHaveTextContent(
      /not selected/i,
    );
    expect(screen.getByTestId("token-entry-form")).toBeInTheDocument();
    expect(
      screen.queryByTestId("storage-mode-selector"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-selector")).not.toBeInTheDocument();
  });

  it("advances through token, mode, and workspace phases while passing the validated payload downstream", () => {
    const view = render(<FirstRunSetup />);

    fireEvent.click(screen.getByTestId("token-entry-form"));

    expect(tokenEntryFormMock).toHaveBeenCalled();
    expect(screen.queryByTestId("token-entry-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("storage-mode-selector")).toBeInTheDocument();
    expect(storageModeSelectorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        token: VALIDATED_TOKEN.token,
        maskedIdentifier: VALIDATED_TOKEN.maskedIdentifier,
      }),
      undefined,
    );

    credentialsValue.maskedIdentifier = VALIDATED_TOKEN.maskedIdentifier;
    view.rerender(<FirstRunSetup />);

    expect(screen.getByTestId("masked-token")).toHaveTextContent("…3456");
    expect(screen.getByText(/current workspace:/i)).toHaveTextContent(
      /not selected/i,
    );

    fireEvent.click(screen.getByTestId("storage-mode-selector"));

    expect(
      screen.queryByTestId("storage-mode-selector"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-selector")).toBeInTheDocument();
    expect(workspaceSelectorMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaces: VALIDATED_TOKEN.workspaces,
      }),
      undefined,
    );

    workspaceValue.workspace = {
      gid: VALIDATED_TOKEN.workspaces[0].gid,
      name: VALIDATED_TOKEN.workspaces[0].name,
      selectedAt: "2026-08-01T13:55:00.000Z",
    };
    view.rerender(<FirstRunSetup />);

    expect(
      screen.getByLabelText(/current credential and workspace/i),
    ).toHaveTextContent(/current workspace:\s*acme workspace/i);
  });
});
