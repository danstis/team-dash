import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useCredentialsMock } = vi.hoisted(() => ({
  useCredentialsMock: vi.fn(),
}));

vi.mock("../../../../src/app/credentials-context", () => ({
  useCredentials: useCredentialsMock,
}));

import { StorageModeSelector } from "../../../../src/features/credentials/StorageModeSelector";

const TOKEN = "fixture-storage-token-wxyz";

describe("StorageModeSelector", () => {
  const setSessionToken = vi.fn(async () => undefined);
  const setPersistentToken = vi.fn(async () => undefined);

  beforeEach(() => {
    setSessionToken.mockClear();
    setPersistentToken.mockClear();
    useCredentialsMock.mockReturnValue({
      state: "first_run",
      mode: null,
      maskedIdentifier: "",
      setSessionToken,
      setPersistentToken,
      clearToSessionOnly: vi.fn(async () => undefined),
      clearAll: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders both modes and only the last four token characters", () => {
    const { container } = render(
      <StorageModeSelector token={TOKEN} maskedIdentifier={TOKEN} />,
    );

    expect(
      screen.getByRole("radio", { name: /session[- ]only/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /persistent/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("…wxyz")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it("requires confirmation after showing the persistent-storage risk disclosure", () => {
    render(<StorageModeSelector token={TOKEN} />);

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(/sensitive/i);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/aes-gcm/i);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      /browser profile/i,
    );
    expect(
      screen.getByRole("button", { name: /confirm persistent storage/i }),
    ).toHaveFocus();
    expect(setPersistentToken).not.toHaveBeenCalled();
    expect(setSessionToken).not.toHaveBeenCalled();
  });

  it("persists only after explicit acceptance", async () => {
    const onModeSelected = vi.fn();
    render(
      <StorageModeSelector token={TOKEN} onModeSelected={onModeSelected} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /confirm persistent storage/i }),
    );

    await waitFor(() =>
      expect(setPersistentToken).toHaveBeenCalledWith(TOKEN, "wxyz"),
    );
    expect(setSessionToken).not.toHaveBeenCalled();
    expect(onModeSelected).toHaveBeenCalledWith("persistent");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("falls back to session-only when persistent storage is declined", async () => {
    const onModeSelected = vi.fn();
    render(
      <StorageModeSelector token={TOKEN} onModeSelected={onModeSelected} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));

    await waitFor(() =>
      expect(setSessionToken).toHaveBeenCalledWith(TOKEN, "wxyz"),
    );
    expect(setPersistentToken).not.toHaveBeenCalled();
    expect(onModeSelected).toHaveBeenCalledWith("session");
    expect(
      screen.getByRole("radio", { name: /session[- ]only/i }),
    ).toBeChecked();
  });

  it("stores the token in session memory when session-only is selected", async () => {
    const onModeSelected = vi.fn();
    render(
      <StorageModeSelector token={TOKEN} onModeSelected={onModeSelected} />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /session[- ]only/i }));

    await waitFor(() =>
      expect(setSessionToken).toHaveBeenCalledWith(TOKEN, "wxyz"),
    );
    expect(setPersistentToken).not.toHaveBeenCalled();
    expect(onModeSelected).toHaveBeenCalledWith("session");
  });
});
