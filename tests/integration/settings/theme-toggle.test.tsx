/**
 * BSOD-359 — integration test for the Settings theme toggle.
 *
 * What "integration" means here
 * -----------------------------
 * Drives the real `/settings` route (`src/app/router.tsx`) end to end:
 * the `<ThemeToggle />` the route mounts in `SettingsScreen`'s
 * `actions` slot, next to the real exit control BSOD-360 built that
 * slot for. The unit tests in
 * `tests/unit/features/settings/ThemeToggle.test.tsx` and
 * `tests/unit/app/theme.test.ts` already pin the component and the
 * storage helpers in isolation; this file is the "it's actually wired
 * into the app" check acceptance criteria asks for.
 *
 * The two provider contexts are mocked exactly as
 * `tests/integration/settings/settings-exit.test.tsx` does, to open
 * the route guard deterministically without a real credential/decrypt
 * round-trip.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/app/credentials-context", () => ({
  CredentialsProvider: ({ children }: { children: ReactNode }) => children,
  useCredentials: () => ({
    state: "ready" as const,
    mode: "session" as const,
    maskedIdentifier: "abcd",
    setSessionToken: vi.fn(),
    setPersistentToken: vi.fn(),
    clearToSessionOnly: vi.fn(),
    clearAll: vi.fn(),
  }),
  // BSOD-307 (T053) — the dashboard route mounts the refresh-status
  // surface, which reads the plaintext-token accessor the refresh
  // controls use. The mock reports "no token", so the refresh action
  // renders in its disabled state.
  useCredentialTokenAccessor: () => ({
    getPlaintextToken: () => null,
  }),
}));

vi.mock("../../../src/app/workspace-context", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    state: "ready" as const,
    workspace: {
      gid: "11111111-test-workspace",
      name: "Test Workspace",
      selectedAt: "2026-07-31T00:00:00.000Z",
    },
    selectWorkspace: vi.fn(),
    clearSelection: vi.fn(),
  }),
}));

import { createAppRouter } from "../../../src/app/router";

const STORAGE_KEY = "team-dash:theme-preference";

describe("BSOD-359 Settings theme toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("renders beside the exit control and switches the theme with no reload", async () => {
    render(
      <RouterProvider
        router={createAppRouter({ initialEntries: ["/settings"] })}
      />,
    );

    expect(await screen.findByTestId("settings-screen")).toBeInTheDocument();
    expect(screen.getByTestId("settings-exit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    // The screen is still mounted — no navigation/reload happened.
    expect(screen.getByTestId("settings-screen")).toBeInTheDocument();
  });

  it("persists the choice across a simulated reload (remounting the route)", async () => {
    const router = createAppRouter({ initialEntries: ["/settings"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId("settings-screen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");

    cleanup();

    render(
      <RouterProvider
        router={createAppRouter({ initialEntries: ["/settings"] })}
      />,
    );

    expect(await screen.findByRole("radio", { name: "Light" })).toBeChecked();
  });
});
