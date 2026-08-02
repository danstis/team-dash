/**
 * T031 — `src/app/App.tsx` + `src/app/router.tsx` unit/component tests.
 *
 * The app shell's job (Constitution Principle I "remain runnable after
 * every completed delivery task"; spec FR-085 "deliberately designed
 * and tested UI states"; plan.md Project Structure) is to mount the
 * provider tree, hand it to a router, and let the rest of the app
 * hang off that contract. These tests are the boundary every
 * downstream feature imports across, so the assertions below are the
 * public shell surface for the rest of the repository:
 *
 * - `<App />` renders without throwing and mounts the router-derived
 *   output into the DOM. A shell that throws on mount is the worst
 *   possible regression — the entire P1 vertical slice is unreachable.
 *
 * - `<App />` mounts both `CredentialsProvider` and `WorkspaceProvider`
 *   around the router. The route guard T046 depends on the two
 *   contexts being present in the tree; a shell that drops one fails
 *   US1.
 *
 * - The router exports a `RouterProvider`-compatible `router` object
 *   that React Router can hand to `<RouterProvider>`. The shell
 *   composition MUST NOT reach into React Router internals — the
 *   router is a plain object the shell mounts.
 *
 * - The router is "dumb": it renders a placeholder for any unmatched
 *   route and exposes a route configuration object that downstream
 *   features (US1, US3, US4, …) will extend. It MUST NOT import
 *   `src/features/**` directly — that's a `src/app/**` boundary
 *   discipline test, exercised indirectly: the rendered placeholder
 *   contains a stable "Team Dash" string, not business logic.
 *
 * - The router survives `npm run build` (Vitest's `vite build` runs
 *   are deferred to a separate Playwright test; what the shell test
 *   asserts here is that the router uses no JSX-only feature that
 *   would crash at runtime, e.g. a malformed `path` value).
 *
 * - The BSOD-351 sub-issue added the `/settings` route and the
 *   `nav-settings` link from the placeholder. These are exercised by
 *   the new Playwright e2e spec, but e2e coverage is not fed into
 *   SonarCloud (`sonar.javascript.lcov.reportPaths` is the unit +
 *   contract lcov reports only — `.github/workflows/ci.yml:358`).
 *   The two BSOD-351 unit-test cases below exercise the new router
 *   code at the unit layer so the SonarCloud `new_coverage` quality
 *   gate clears 60% on the new lines without depending on the e2e
 *   layer's coverage to count.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  // T04 — Dashboard now mounts `<RefreshControls />`, which calls
  // `useCredentialTokenAccessor()`. The T031 stub did not export
  // this hook, so the new route surfaced as an unhandled render
  // throw. Expose a stub here so the gates-open path renders the
  // full dashboard without crashing.
  useCredentialTokenAccessor: () => ({
    getPlaintextToken: () => "stub-app-test-token-1234567890",
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

import { App } from "../../../src/app/App";
import { router } from "../../../src/app/router";

describe("T031 <App /> (provider tree + router composition)", () => {
  afterEach(() => {
    cleanup();
    // The router is a singleton (`createMemoryRouter` lives at module
    // scope in `src/app/router.tsx`); any `Link` click in a previous
    // test leaves the singleton at the navigated URL. Reset to `/`
    // before the next test so the placeholder assertions are not
    // polluted by leftover navigation state from a peer test.
    void router.navigate("/");
  });

  it("renders without throwing (Constitution Principle I: app must boot)", () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it("renders an Australian-English <main> shell region (existing convention)", () => {
    const { container } = render(<App />);
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("lang")).toBe("en-AU");
  });

  it("renders the router's fallback for an unmatched initial URL when the gate is open", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /team dash/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/team dash/i)).toBeInTheDocument();
  });

  it("mounts under StrictMode (Principle I + dev safety)", () => {
    expect(() =>
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("renders the `nav-settings` link from the post-first-run placeholder (BSOD-351)", () => {
    render(<App />);

    // The gate is open under the mocked contexts, so the placeholder
    // is the rendered surface. The placeholder includes the
    // `data-testid="nav-settings"` <Link> BSOD-351 adds so the
    // Playwright spec can click through to `/settings`. A regression
    // that drops the link breaks the e2e flow AND removes the
    // canonical in-app entry point future dashboard chrome will
    // reuse — both fail this assertion.
    const link = screen.getByTestId("nav-settings");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("navigates to `/settings` from the `nav-settings` link and mounts the SettingsCredentialsPanel (BSOD-351)", async () => {
    render(<App />);

    // Click the nav-settings link the placeholder renders. The
    // React Router `<Link>` component handles the navigation
    // synchronously through the singleton `router`; the click
    // advances the memory router from `/` to `/settings` and the
    // `<SettingsRoute />` component mounts the T045
    // `SettingsCredentialsPanel`.
    fireEvent.click(screen.getByTestId("nav-settings"));

    // The panel's stable `data-testid` is the same anchor the e2e
    // spec uses, so the unit and e2e layers are pinned to the same
    // surface.
    expect(await screen.findByTestId("settings-panel")).toBeInTheDocument();

    // The four US1 lifecycle actions (FR-004 / FR-005 / FR-006 /
    // FR-007) are the documented surface every downstream feature
    // imports across. Asserting their presence at the unit layer
    // pins the BSOD-351 route's surface even when the e2e layer is
    // not run. The `Switch to …` button toggles between
    // session-only → persistent and persistent → session-only per
    // the current mode; the assertion accepts either so the test
    // is robust to the mocked `mode: "persistent"` above.
    expect(
      screen.getByRole("button", { name: /set token/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^retest$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^replace$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /switch to (persistent|session)/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear all/i }),
    ).toBeInTheDocument();
  });
});

describe("T031 router (dumb route configuration)", () => {
  afterEach(() => {
    cleanup();
    void router.navigate("/");
  });

  it("exports a non-null `router` object consumable by RouterProvider", () => {
    expect(router).toBeDefined();
    expect(Array.isArray(router.routes)).toBe(true);
    expect(typeof router.subscribe).toBe("function");
  });

  it("registers at least one route (the T031 placeholder)", () => {
    expect(router.routes.length).toBeGreaterThan(0);
  });

  it("registers the `/settings` child route (BSOD-351)", () => {
    // The router exposes the route table the shell mounts. After
    // the BSOD-351 sub-issue the table MUST include the
    // `/settings` child route so a real user (and the Playwright
    // e2e spec) can navigate to the credentials panel. A
    // regression that drops the child fails this assertion before
    // the e2e spec even runs.
    const settingsRoute = router.routes[0]?.children?.find(
      (child) => "path" in child && child.path === "settings",
    );
    expect(settingsRoute).toBeDefined();
  });
});
