import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { testTokenMock, useCredentialsMock } = vi.hoisted(() => ({
  testTokenMock: vi.fn(),
  useCredentialsMock: vi.fn(),
}));

vi.mock("../../../../src/app/credentials-context", () => ({
  useCredentials: useCredentialsMock,
}));

vi.mock("../../../../src/data/asana/client", () => ({
  testToken: testTokenMock,
}));

import { SettingsCredentialsPanel } from "../../../../src/features/credentials/SettingsCredentialsPanel";

type CredentialsState = {
  state: "loading" | "first_run" | "ready";
  mode: "session" | "persistent" | null;
  maskedIdentifier: string;
  setSessionToken: ReturnType<typeof vi.fn>;
  setPersistentToken: ReturnType<typeof vi.fn>;
  clearToSessionOnly: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
};

const SESSION_TOKEN = "fixture-session-token-aaaaaaaa";
const REPLACEMENT_TOKEN = "fixture-replacement-token-bbbbbbbb";

function createCredentialsState(
  overrides: Partial<CredentialsState> = {},
): CredentialsState {
  const state: CredentialsState = {
    state: "ready",
    mode: null,
    maskedIdentifier: "",
    setSessionToken: vi.fn(async (_token: string, maskedIdentifier: string) => {
      state.state = "ready";
      state.mode = "session";
      state.maskedIdentifier = maskedIdentifier;
    }),
    setPersistentToken: vi.fn(
      async (_token: string, maskedIdentifier: string) => {
        state.state = "ready";
        state.mode = "persistent";
        state.maskedIdentifier = maskedIdentifier;
      },
    ),
    clearToSessionOnly: vi.fn(async () => {
      state.state = "ready";
      state.mode = "session";
      state.maskedIdentifier = "";
    }),
    clearAll: vi.fn(async () => {
      state.state = "first_run";
      state.mode = null;
      state.maskedIdentifier = "";
    }),
    ...overrides,
  };
  return state;
}

describe("SettingsCredentialsPanel", () => {
  let credentialsState: CredentialsState;

  beforeEach(() => {
    credentialsState = createCredentialsState();
    useCredentialsMock.mockImplementation(() => credentialsState);
    testTokenMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the current storage mode and masked identifier without exposing the full token", () => {
    credentialsState = createCredentialsState({
      mode: "session",
      maskedIdentifier: "aaaa",
    });
    useCredentialsMock.mockImplementation(() => credentialsState);

    const { container } = render(<SettingsCredentialsPanel />);

    expect(screen.getByText("session")).toBeInTheDocument();
    expect(screen.getByText("…aaaa")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /switch to persistent/i }),
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(SESSION_TOKEN);
  });

  it("sets a trimmed session token, clears the input, and suppresses empty submissions", async () => {
    render(<SettingsCredentialsPanel />);

    const tokenInput = screen.getByLabelText(/^token$/i);
    fireEvent.change(tokenInput, {
      target: { value: `  ${SESSION_TOKEN}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: /set token/i }));

    await waitFor(() =>
      expect(credentialsState.setSessionToken).toHaveBeenCalledWith(
        SESSION_TOKEN,
        "aaaa",
      ),
    );
    expect(tokenInput).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /set token/i }));
    expect(credentialsState.setSessionToken).toHaveBeenCalledTimes(1);
  });

  it("maps each retest outcome to the documented user-facing status message", async () => {
    const cases = [
      {
        name: "ok",
        result: { outcome: "ok", data: { name: "Alex Kim" } },
        expected: /token valid\. authenticated as alex kim\./i,
      },
      {
        name: "auth_failure",
        result: { outcome: "auth_failure" },
        expected: /invalid token/i,
      },
      {
        name: "permission_failure",
        result: { outcome: "permission_failure" },
        expected: /insufficient permission/i,
      },
      {
        name: "rate_limited",
        result: { outcome: "rate_limited", retryAfterMs: 2400 },
        expected: /retry after 2s\./i,
      },
      {
        name: "network_error",
        result: { outcome: "network_error", message: "socket closed" },
        expected: /network error: socket closed/i,
      },
      {
        name: "validation_error",
        result: { outcome: "validation_error" },
        expected: /unexpected response from asana/i,
      },
    ];

    for (const testCase of cases) {
      testTokenMock.mockResolvedValueOnce(testCase.result);
      const { unmount } = render(<SettingsCredentialsPanel />);

      fireEvent.change(screen.getByLabelText(/^token$/i), {
        target: { value: SESSION_TOKEN },
      });
      fireEvent.click(screen.getByRole("button", { name: /set token/i }));
      await waitFor(() =>
        expect(credentialsState.setSessionToken).toHaveBeenCalledTimes(1),
      );

      fireEvent.click(screen.getByRole("button", { name: /retest/i }));

      await waitFor(() =>
        expect(screen.getByTestId("retest-outcome")).toHaveTextContent(
          testCase.expected,
        ),
      );

      expect(
        screen.getByTestId("retest-outcome").textContent ?? "",
      ).not.toContain(SESSION_TOKEN);

      unmount();
      credentialsState = createCredentialsState();
      useCredentialsMock.mockImplementation(() => credentialsState);
    }
  });

  it("replaces the token in session mode and clears the replacement input", async () => {
    render(<SettingsCredentialsPanel />);

    const replacementInput = screen.getByLabelText(/replacement credential/i);
    fireEvent.change(replacementInput, {
      target: { value: `  ${REPLACEMENT_TOKEN}  ` },
    });
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));

    await waitFor(() =>
      expect(credentialsState.setSessionToken).toHaveBeenCalledWith(
        REPLACEMENT_TOKEN,
        "bbbb",
      ),
    );
    expect(replacementInput).toHaveValue("");
  });

  it("opens and declines persistent storage confirmation without writing", async () => {
    credentialsState = createCredentialsState({
      mode: "session",
      maskedIdentifier: "aaaa",
    });
    useCredentialsMock.mockImplementation(() => credentialsState);

    render(<SettingsCredentialsPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: /switch to persistent/i }),
    );
    expect(screen.getByTestId("persistent-confirmation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("persistent-confirmation"),
      ).not.toBeInTheDocument(),
    );
    expect(credentialsState.setPersistentToken).not.toHaveBeenCalled();
  });

  it("confirms persistent storage with the current token and closes the dialog", async () => {
    credentialsState = createCredentialsState({
      mode: "session",
      maskedIdentifier: "aaaa",
    });
    useCredentialsMock.mockImplementation(() => credentialsState);

    render(<SettingsCredentialsPanel />);

    fireEvent.change(screen.getByLabelText(/^token$/i), {
      target: { value: SESSION_TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /set token/i }));
    await waitFor(() =>
      expect(credentialsState.setSessionToken).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /switch to persistent/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() =>
      expect(credentialsState.setPersistentToken).toHaveBeenCalledWith(
        SESSION_TOKEN,
        "aaaa",
      ),
    );
    expect(
      screen.queryByTestId("persistent-confirmation"),
    ).not.toBeInTheDocument();
  });

  it("defensively closes the persistent dialog when no current token exists", async () => {
    credentialsState = createCredentialsState({
      mode: "session",
      maskedIdentifier: "aaaa",
    });
    useCredentialsMock.mockImplementation(() => credentialsState);

    render(<SettingsCredentialsPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: /switch to persistent/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("persistent-confirmation"),
      ).not.toBeInTheDocument(),
    );
    expect(credentialsState.setPersistentToken).not.toHaveBeenCalled();
  });

  it("switches from persistent back to session-only and clears the active token from local state", async () => {
    credentialsState = createCredentialsState({
      mode: "session",
      maskedIdentifier: "aaaa",
    });
    useCredentialsMock.mockImplementation(() => credentialsState);
    testTokenMock.mockResolvedValue({ outcome: "auth_failure" });

    const view = render(<SettingsCredentialsPanel />);

    fireEvent.change(screen.getByLabelText(/^token$/i), {
      target: { value: SESSION_TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /set token/i }));
    await waitFor(() =>
      expect(credentialsState.setSessionToken).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: /retest/i }));
    await screen.findByTestId("retest-outcome");

    credentialsState.mode = "persistent";
    view.rerender(<SettingsCredentialsPanel />);

    fireEvent.click(
      screen.getByRole("button", { name: /switch to session-only/i }),
    );

    await waitFor(() =>
      expect(credentialsState.clearToSessionOnly).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByTestId("retest-outcome")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retest/i }));
    expect(testTokenMock).toHaveBeenCalledTimes(1);
  });

  it("opens, cancels, and confirms the clear-all dialog while clearing local inputs and outcome", async () => {
    testTokenMock.mockResolvedValue({ outcome: "auth_failure" });
    render(<SettingsCredentialsPanel />);

    const tokenInput = screen.getByLabelText(/^token$/i);
    const replacementInput = screen.getByLabelText(/replacement credential/i);

    fireEvent.change(tokenInput, {
      target: { value: SESSION_TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /set token/i }));
    await waitFor(() =>
      expect(credentialsState.setSessionToken).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(replacementInput, {
      target: { value: REPLACEMENT_TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: /retest/i }));
    await screen.findByTestId("retest-outcome");

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(screen.getByTestId("clear-all-confirmation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("clear-all-confirmation"),
      ).not.toBeInTheDocument(),
    );
    expect(credentialsState.clearAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm clear all/i }));

    await waitFor(() =>
      expect(credentialsState.clearAll).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.queryByTestId("clear-all-confirmation"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("retest-outcome")).not.toBeInTheDocument();
    expect(tokenInput).toHaveValue("");
    expect(replacementInput).toHaveValue("");
  });
});
