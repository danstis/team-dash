import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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

  it.each(["a", "ab", "abc", "abcd"])(
    "does not reveal the full token when the token length is %s",
    (shortToken) => {
      render(<StorageModeSelector token={shortToken} />);

      const identifier = screen.getByText("••••");
      expect(identifier).toBeInTheDocument();
      expect(identifier).not.toHaveTextContent(shortToken);
    },
  );

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

  it("traps focus inside the confirmation dialog and declines on Escape", async () => {
    render(<StorageModeSelector token={TOKEN} />);

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));

    const dialog = screen.getByRole("alertdialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: /confirm persistent storage/i,
    });
    const declineButton = within(dialog).getByRole("button", {
      name: /decline/i,
    });

    expect(confirmButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(declineButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(confirmButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() =>
      expect(setSessionToken).toHaveBeenCalledWith(TOKEN, "wxyz"),
    );
    expect(setPersistentToken).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /persistent/i })).toHaveFocus(),
    );
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

  it("syncs the checked radio with credential mode updates from context", () => {
    const { rerender } = render(<StorageModeSelector token={TOKEN} />);

    expect(
      screen.getByRole("radio", { name: /session[- ]only/i }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: /persistent/i }),
    ).not.toBeChecked();

    useCredentialsMock.mockReturnValue({
      state: "ready",
      mode: "persistent",
      maskedIdentifier: "wxyz",
      setSessionToken,
      setPersistentToken,
      clearToSessionOnly: vi.fn(async () => undefined),
      clearAll: vi.fn(async () => undefined),
    });

    rerender(<StorageModeSelector token={TOKEN} />);

    expect(screen.getByRole("radio", { name: /persistent/i })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /session[- ]only/i }),
    ).not.toBeChecked();
  });

  it("closes an open confirmation when credential mode changes externally", () => {
    const { rerender } = render(<StorageModeSelector token={TOKEN} />);

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    useCredentialsMock.mockReturnValue({
      state: "ready",
      mode: "session",
      maskedIdentifier: "wxyz",
      setSessionToken,
      setPersistentToken,
      clearToSessionOnly: vi.fn(async () => undefined),
      clearAll: vi.fn(async () => undefined),
    });

    rerender(<StorageModeSelector token={TOKEN} />);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /session[- ]only/i }),
    ).toBeChecked();
  });
});
