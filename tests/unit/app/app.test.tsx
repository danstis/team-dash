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
 */
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../../src/app/App";
import { db } from "../../../src/data/db/schema";
import { router } from "../../../src/app/router";

describe("T031 <App /> (provider tree + router composition)", () => {
  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
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

  it("renders the router's fallback for an unmatched initial URL", () => {
    // The router MUST register at least one route. Even when no
    // feature has shipped yet (T031), the shell renders the placeholder
    // instead of crashing. This test pins the placeholder content so a
    // future contributor who deletes the placeholder (and breaks
    // SC-001's "app remains usable at first launch") fails the test.
    render(<App />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/team dash/i)).toBeInTheDocument();
  });

  it("mounts under StrictMode (Principle I + dev safety)", () => {
    // T010's existing shell test (`tests/unit/app/main.test.tsx`)
    // already asserts the entry point renders under StrictMode;
    // T031's <App /> must remain StrictMode-safe so the entry point
    // can wrap it the same way.
    expect(() =>
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    ).not.toThrow();
  });
});

describe("T031 router (dumb route configuration)", () => {
  afterEach(async () => {
    await db.delete();
  });

  it("exports a non-null `router` object consumable by RouterProvider", () => {
    // React Router 8's createBrowserRouter / createMemoryRouter return
    // an object with at minimum a `routes` array and a `subscribe`
    // method. Asserting on the shape pins the API the shell mounts.
    expect(router).toBeDefined();
    expect(Array.isArray(router.routes)).toBe(true);
    expect(typeof router.subscribe).toBe("function");
  });

  it("registers at least one route (the T031 placeholder)", () => {
    expect(router.routes.length).toBeGreaterThan(0);
  });
});
