/**
 * BSOD-360 — integration test for the Settings exit affordance.
 *
 * User story BSOD-360: "As a user, I want a method in the settings UI
 * to exit back to where I was, so I am not stuck in the settings page
 * after opening it."
 *
 * What "integration" means here
 * -----------------------------
 * The exit is a navigation behaviour, so the boundary under test is
 * the *app's own router* (`src/app/router.tsx`) driving the real
 * Settings chrome: the placeholder's Settings link → the `/settings`
 * route → the exit control → back out of Settings. The route guard
 * (T046) is in the path, so the test also proves the exit does not
 * break the gate contract.
 *
 * The two provider contexts are mocked to report `'ready'` (the same
 * technique `tests/unit/app/app.test.tsx` uses) so the gate is open
 * deterministically. The exit behaviour under test is orthogonal to
 * how the credentials and the workspace got there — the credential
 * lifecycle is pinned by
 * `tests/integration/credentials/settings-panel.test.tsx` (BSOD-165 /
 * T037), which this file does not duplicate.
 *
 * The two flows pinned
 * --------------------
 * 1. The user opens Settings from the app shell and exits → the user
 *    is back on the app shell, not stuck in Settings.
 * 2. The user lands on `/settings` directly (no earlier history entry
 *    to pop — a memory router clamps a back navigation from its
 *    initial entry) and exits → the exit falls back to the app shell
 *    at `/`. Without the fallback the user would be stranded on the
 *    Settings screen, which is the exact failure BSOD-360 names.
 *
 * Boundary
 * --------
 * jsdom + React Testing Library, no browser and no live Asana. The
 * browser-level equivalent is covered by the existing
 * `tests/e2e/landing-credentials.spec.ts` flow, which drives the same
 * `/settings` route through the production Docker build.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/**
 * The placeholder reporting surface's heading — the canonical anchor
 * for "the user is back on the app shell" (the same anchor the e2e
 * spec uses).
 */
const APP_SHELL_HEADING = /team dash/i;

/**
 * The placeholder's Settings link — the canonical in-app entry point
 * for the `/settings` route.
 */
const SETTINGS_NAV_TEST_ID = "nav-settings";

/**
 * The exit control's stable anchor.
 */
const SETTINGS_EXIT_TEST_ID = "settings-exit";

describe("BSOD-360 Settings exit affordance", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns the user to the app shell after they open Settings from it", async () => {
    render(<RouterProvider router={createAppRouter()} />);

    // The gate is open (both mocked providers report 'ready'), so the
    // placeholder reporting surface is rendered.
    expect(
      await screen.findByRole("heading", { level: 1, name: APP_SHELL_HEADING }),
    ).toBeInTheDocument();

    // Open Settings through the placeholder's link.
    fireEvent.click(screen.getByTestId(SETTINGS_NAV_TEST_ID));

    // The Settings screen chrome renders with the credential panel
    // mounted as its section, plus the exit control.
    expect(await screen.findByTestId("settings-screen")).toBeInTheDocument();
    expect(screen.getByTestId("settings-panel")).toBeInTheDocument();
    const exitControl = screen.getByTestId(SETTINGS_EXIT_TEST_ID);
    expect(exitControl).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exit settings/i })).toBe(
      exitControl,
    );

    // Exit → the user is back on the app shell, not stuck in Settings.
    fireEvent.click(exitControl);

    expect(
      await screen.findByRole("heading", { level: 1, name: APP_SHELL_HEADING }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-panel")).not.toBeInTheDocument();
  });

  it("falls back to the app shell when the user landed on Settings directly", async () => {
    // The "deep link" case: the router starts on `/settings`, so the
    // history has no earlier entry to pop. The exit MUST still leave
    // the Settings screen — this is the case the memory router's
    // clamping back navigation would otherwise strand the user in.
    render(
      <RouterProvider
        router={createAppRouter({ initialEntries: ["/settings"] })}
      />,
    );

    expect(await screen.findByTestId("settings-screen")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(SETTINGS_EXIT_TEST_ID));

    expect(
      await screen.findByRole("heading", { level: 1, name: APP_SHELL_HEADING }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-screen")).not.toBeInTheDocument();
  });
});
