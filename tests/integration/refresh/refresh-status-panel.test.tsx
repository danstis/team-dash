/**
 * BSOD-307 (T053) — integration test for the dashboard's refresh-status
 * surface.
 *
 * The surface is what turns FR-021 ("whether currently displayed data
 * is cached or fresh, along with the last successful refresh
 * timestamp") and FR-087 ("the system MUST clearly state that refresh
 * is unavailable offline") into the DOM the user actually sees:
 *
 * 1. **Cached vs fresh.** The data on screen is CACHED when the
 *    browser is offline, when no refresh has completed yet, or when
 *    the last successful refresh belongs to an earlier page session.
 *    It is FRESH only when a refresh completed during this session and
 *    the browser is still online. Cached data must never be presented
 *    as current (Constitution Principle VII).
 *
 * 2. **The last refresh timestamp.** The value comes from the
 *    committed `RefreshSession` row, read through the refresh-session
 *    repository (mocked here — the repository's own contract is pinned
 *    by `tests/contract/refresh-session.repository.test.ts`).
 *
 * 3. **The offline refresh state.** While the browser is offline the
 *    refresh action is visibly disabled and the reason is stated.
 *
 * Sister file to `tests/integration/refresh/cached-reload.test.tsx`
 * (BSOD-304 / T050), which pins the banner's own copy. This file pins
 * the decision the dashboard chrome makes about WHEN that copy is
 * shown.
 */
import { StrictMode, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getLastSuccessful } = vi.hoisted(() => ({
  getLastSuccessful: vi.fn(
    async (): Promise<{ finishedAt: string } | null> => null,
  ),
}));

vi.mock("../../../src/data/db/repositories/refresh-session.repository", () => ({
  refreshSessionRepository: { getLastSuccessful },
}));

vi.mock("../../../src/app/credentials-context", () => ({
  CredentialsProvider: ({ children }: { children: ReactNode }) => children,
  useCredentials: () => ({
    state: "ready" as const,
    mode: "persistent" as const,
    maskedIdentifier: "abcd",
    setSessionToken: vi.fn(),
    setPersistentToken: vi.fn(),
    clearToSessionOnly: vi.fn(),
    clearAll: vi.fn(),
  }),
  useCredentialTokenAccessor: () => ({
    getPlaintextToken: () => null,
  }),
}));

vi.mock("../../../src/app/workspace-context", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useWorkspace: () => ({
    state: "ready" as const,
    workspace: {
      gid: "ws-1",
      name: "Team Dash Workspace",
      selectedAt: "2026-07-31T00:00:00.000Z",
    },
    selectWorkspace: vi.fn(),
    clearSelection: vi.fn(),
  }),
}));

import { RefreshStatusPanel } from "../../../src/features/refresh/RefreshStatusPanel";

const WORKSPACE_GID = "ws-1";
const REFRESHED_AT = "2026-07-31T09:30:00.000Z";

/**
 * Override the browser's connection state and restore it afterwards.
 */
function setNavigatorOnline(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    "onLine",
  );
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor === undefined) {
      delete (window.navigator as { onLine?: boolean }).onLine;
      return;
    }
    Object.defineProperty(window.navigator, "onLine", descriptor);
  };
}

describe("BSOD-307 (T053) dashboard refresh-status surface", () => {
  let restoreNavigator: () => void;

  beforeEach(() => {
    getLastSuccessful.mockReset();
    getLastSuccessful.mockResolvedValue(null);
    restoreNavigator = setNavigatorOnline(true);
  });

  afterEach(() => {
    cleanup();
    restoreNavigator();
  });

  it("shows no freshness banner when the workspace has never refreshed", async () => {
    render(
      <StrictMode>
        <RefreshStatusPanel />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(getLastSuccessful).toHaveBeenCalledWith(WORKSPACE_GID);
    });
    expect(screen.queryByTestId("freshness-banner")).not.toBeInTheDocument();
  });

  it("labels the displayed data as cached while the browser is offline", async () => {
    restoreNavigator();
    restoreNavigator = setNavigatorOnline(false);
    getLastSuccessful.mockResolvedValue({ finishedAt: REFRESHED_AT });

    render(
      <StrictMode>
        <RefreshStatusPanel />
      </StrictMode>,
    );

    const banner = await screen.findByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("cached");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(REFRESHED_AT);
  });

  it("disables the refresh action and explains why while offline", async () => {
    restoreNavigator();
    restoreNavigator = setNavigatorOnline(false);
    getLastSuccessful.mockResolvedValue({ finishedAt: REFRESHED_AT });

    render(
      <StrictMode>
        <RefreshStatusPanel />
      </StrictMode>,
    );

    const button = await screen.findByTestId("offline-refresh-button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("offline-explanation")).toHaveTextContent(
      /offline/i,
    );
  });

  it("keeps the cached label for a refresh that belongs to an earlier session", async () => {
    // The last successful refresh finished before this page session
    // started, so the data on screen is the cached copy of it.
    getLastSuccessful.mockResolvedValue({
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    render(
      <StrictMode>
        <RefreshStatusPanel />
      </StrictMode>,
    );

    const banner = await screen.findByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("cached");
  });
});
