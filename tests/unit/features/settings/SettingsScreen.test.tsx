/**
 * BSOD-360 — unit tests for the Settings screen chrome and its exit
 * control.
 *
 * User story BSOD-360: "As a user, I want a method in the settings UI
 * to exit back to where I was, so I am not stuck in the settings page
 * after opening it."
 *
 * What this file pins
 * -------------------
 * 1. The pure exit policy (`resolveSettingsExitTarget`) — the decision
 *    that separates "pop the history" from "fall back to the app
 *    shell". It is a pure function of the location key, so it is
 *    pinned without a router.
 *
 * 2. The screen chrome — the header, the title, the injected `actions`
 *    slot (the extension point BSOD-359's theme toggle will use), and
 *    the sections the screen renders as children.
 *
 * 3. The exit control's two behaviours, driven through a real React
 *    Router memory router:
 *
 *      - The user arrived from another surface → the exit returns them
 *        to THAT surface (not to the app shell).
 *      - The user landed on `/settings` directly → there is no earlier
 *        entry to pop (a memory router clamps a back navigation from
 *        its initial entry), so the exit falls back to the app shell.
 *
 * The stub router deliberately carries a third route (`/reports`) so
 * "returned to where I came from" and "fell back to the app shell" are
 * distinguishable: the first lands on `/reports`, the second on `/`.
 *
 * The app-level flow (the real router, the route guard, the
 * placeholder's Settings link) is pinned by the integration test at
 * `tests/integration/settings/settings-exit.test.tsx`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsScreen } from "../../../../src/features/settings/SettingsScreen";
import {
  INITIAL_LOCATION_KEY,
  SETTINGS_EXIT_FALLBACK_PATH,
  resolveSettingsExitTarget,
} from "../../../../src/features/settings/useSettingsExit";

/**
 * The stub "app shell" route. Its test id is the anchor the exit
 * assertions use to tell "the user is back on the shell" apart from
 * "the user is still in Settings".
 */
function StubShellRoute(): React.ReactElement {
  return <div data-testid="stub-shell">App shell</div>;
}

/**
 * The stub "reporting surface" the stub router pops back to. It exists
 * so the "returned to where I came from" assertion can distinguish a
 * history pop from the fallback navigation to `/`.
 */
function StubReportsRoute(): React.ReactElement {
  return <div data-testid="stub-reports">Reports</div>;
}

/**
 * The stub Settings route — the real `<SettingsScreen />` chrome with
 * a stand-in section in place of the credential panel (the panel owns
 * its own credential context; the chrome does not).
 */
function StubSettingsRoute(): React.ReactElement {
  return (
    <SettingsScreen>
      <div data-testid="stub-settings-section">Credentials</div>
    </SettingsScreen>
  );
}

/**
 * The stub route table. `/settings` is the screen under test; `/` is
 * the app shell the exit falls back to; `/reports` stands in for the
 * surface a user would have come from.
 */
function createStubRouter(
  initialEntries: string[],
): ReturnType<typeof createMemoryRouter> {
  const routes: RouteObject[] = [
    { path: "/", element: <StubShellRoute /> },
    { path: "/reports", element: <StubReportsRoute /> },
    { path: "/settings", element: <StubSettingsRoute /> },
  ];
  return createMemoryRouter(routes, { initialEntries });
}

/**
 * The exit control's stable anchor (`data-testid`) and its accessible
 * name (the visible "Exit settings" label).
 */
function findExitControl(): HTMLElement {
  return screen.getByTestId("settings-exit");
}

describe("BSOD-360 Settings exit policy", () => {
  it("falls back to the app shell when the location is the router's initial entry", () => {
    // React Router gives a history's initial entry the literal key
    // "default"; every later entry carries a generated key. The
    // initial entry is the "the user landed here directly" case.
    expect(resolveSettingsExitTarget(INITIAL_LOCATION_KEY)).toEqual({
      kind: "fallback",
      path: SETTINGS_EXIT_FALLBACK_PATH,
    });
  });

  it("pops the history when the location was reached from another surface", () => {
    expect(resolveSettingsExitTarget("a-generated-location-key")).toEqual({
      kind: "back",
    });
  });
});

describe("BSOD-360 Settings screen chrome", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the header, the exit control, and the sections it is given", () => {
    render(<RouterProvider router={createStubRouter(["/settings"])} />);

    expect(screen.getByTestId("settings-screen")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /settings/i }),
    ).toBeInTheDocument();

    // The exit control carries both a stable test id and an
    // accessible name — the two anchors the integration test and any
    // future e2e spec use to find it.
    const exitControl = findExitControl();
    expect(exitControl).toBeInTheDocument();
    expect(exitControl).toHaveTextContent(/exit settings/i);
    expect(screen.getByRole("button", { name: /exit settings/i })).toBe(
      exitControl,
    );

    // The sections arrive as children.
    expect(screen.getByTestId("stub-settings-section")).toBeInTheDocument();
  });

  it("renders injected header actions beside the exit control", () => {
    // The `actions` slot is the extension point the BSOD-359 theme
    // toggle will use: it must render next to the exit control
    // without changing the exit control itself.
    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: "/settings",
              element: (
                <SettingsScreen actions={<div data-testid="stub-action" />}>
                  <div data-testid="stub-settings-section">Credentials</div>
                </SettingsScreen>
              ),
            },
          ],
          { initialEntries: ["/settings"] },
        )}
      />,
    );

    expect(screen.getByTestId("stub-action")).toBeInTheDocument();
    expect(findExitControl()).toBeInTheDocument();
  });
});

describe("BSOD-360 Settings exit control", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns the user to the surface they came from", async () => {
    // The user opened Settings from the reporting surface. The exit
    // pops the history and puts them back on `/reports` — NOT on the
    // app shell at `/`, which is what the fallback would do.
    const router = createStubRouter(["/reports"]);
    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("stub-reports")).toBeInTheDocument();

    void router.navigate("/settings");
    expect(await screen.findByTestId("settings-screen")).toBeInTheDocument();

    fireEvent.click(findExitControl());

    expect(await screen.findByTestId("stub-reports")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-shell")).not.toBeInTheDocument();
  });

  it("falls back to the app shell when the user landed on Settings directly", async () => {
    // The user landed on `/settings` with no earlier history entry (a
    // deep link, a reload, a future browser router). A memory
    // router clamps a back navigation from its initial entry, so the
    // exit has to navigate to the app shell instead.
    render(<RouterProvider router={createStubRouter(["/settings"])} />);

    expect(screen.getByTestId("settings-screen")).toBeInTheDocument();

    fireEvent.click(findExitControl());

    expect(await screen.findByTestId("stub-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-screen")).not.toBeInTheDocument();
  });
});
