/**
 * T031 + T046 + BSOD-347 — the app-shell router.
 *
 * The shell's job (Constitution Principle I "remain runnable after every
 * completed delivery task", plan.md Project Structure) is to mount a
 * provider tree and hand it to a router. The router itself MUST be
 * dumb: no business logic, no data fetching, no Asana calls. The
 * router just maps URL paths to route components; downstream
 * features (US1, US3, US4, …) extend the route table by importing
 * the existing routes from this module and adding their own.
 *
 * ## Why a separate router module
 *
 * - `<App />` mounts `<RouterProvider router={router} />`. Splitting
 *   the router out keeps the App component a thin composition layer
 *   and lets feature-level tests (T035, T046, BSOD-347, T049) import
 *   just the router without dragging the provider tree.
 *
 * - React Router 8's data router APIs (`createBrowserRouter`,
 *   `createMemoryRouter`) return a single object the provider
 *   mounts. A test environment (jsdom) cannot drive a `BrowserRouter`
 *   with a real URL, so the shell uses a memory router with a
 *   deterministic initial entry. The same router module is usable
 *   from the production browser build (a future task will swap to
 *   `createBrowserRouter`) without changing the route list.
 *
 * ## What the router deliberately does not own
 *
 * - Feature components (`features/credentials/*`, `features/tasks/*`,
 *   …) are NOT directly imported here. By architectural convention
 *   the shell mounts providers and a router; features mount under
 *   the router. The `eslint-plugin-boundaries` configuration in
 *   `eslint.config.js` constrains `src/domain/**` only (Constitution
 *   Principle VI's lint-enforced half of the boundary); the "shell
 *   does not compose features" rule is enforced by convention and
 *   code review, not by lint. Future stories extend the `routes`
 *   array; this module never grows beyond the placeholder route.
 *
 * - The first-run surface itself is composed by the
 *   `<FirstRunSetup />` feature component (`BSOD-347`,
 *   `src/features/credentials/FirstRunSetup.tsx`), which orchestrates
 *   the three existing Phase 3 components (`TokenEntryForm`,
 *   `StorageModeSelector`, `WorkspaceSelector`) over a local phase
 *   machine. The shell mounts the composition as an opaque surface;
 *   it does not know about its internal phases or its credential
 *   lifecycle.
 *
 * ## The T046 route guard
 *
 * T046 (US1, BSOD-174) wires the gate that satisfies FR-001 ("The
 * system MUST require a user-supplied Asana personal access token
 * before any reporting screen is accessible") and US1 acceptance
 * scenario 1 ("the app shows a first-run credential entry screen
 * and blocks access to reporting screens until a valid token and
 * workspace are set").
 *
 * The gate composes the two provider state machines
 * (`useCredentials().state` and `useWorkspace().state`) into a
 * single decision: the reporting surface renders only when BOTH
 * contexts report `'ready'`. Any other state — `'loading'` on first
 * mount, `'first_run'` when nothing is stored, or the asymmetric
 * cases where one context is ready and the other is not — keeps the
 * gate closed.
 *
 * The gate is intentionally coarse: it doesn't try to disambiguate
 * `'loading'` from `'first_run'` from a stale `'ready'` because
 * the providers themselves guarantee the documented state-machine
 * invariants the test suite pins. The T035 integration test
 * (`tests/integration/credentials/first-run.test.tsx`) is the
 * source of truth for the gate's behaviour, and the T046 contract
 * is satisfied by the single boolean `gateClosed`. BSOD-347's
 * integration test
 * (`tests/integration/credentials/first-run-setup.test.tsx`) walks
 * the user-facing flow through the gate.
 *
 * ## Determinism
 *
 * The router renders synchronously on first paint (no async init,
 * no IndexedDB read); the IndexedDB lookup the providers run on
 * mount resolves the state to `'first_run'` or `'ready'` on the
 * next render. The gate is therefore a small, deterministic
 * derived boolean — no `useEffect`, no `useState`, no async
 * coupling.
 */
import {
  createMemoryRouter,
  Link,
  Outlet,
  RouterProvider,
  type RouteObject,
} from "react-router";

import { useCredentials } from "./credentials-context";
import { useWorkspace } from "./workspace-context";
import { FirstRunSetup } from "../features/credentials/FirstRunSetup";
import { SettingsCredentialsPanel } from "../features/credentials/SettingsCredentialsPanel";

/**
 * The T031 placeholder. Renders the existing T010 shell markup so
 * the app boots with a recognisable "Team Dash" heading and an
 * honest notice that the rest of the routes are coming in subsequent
 * tasks.
 *
 * The placeholder is registered as the index route so it covers
 * `/` once the gate lifts. While the gate is closed, the gate
 * component above it renders `<FirstRunRoute />` instead, so the
 * placeholder is never reachable — and therefore never appears in the
 * rendered DOM — until both providers report `'ready'`.
 *
 * Once the gate is open, the placeholder also surfaces a stable
 * "Settings" link (BSOD-351 / T131) so the user can navigate to the
 * credentials panel. The link is the canonical in-app entry point
 * for the `/settings` route; the `data-testid="nav-settings"`
 * attribute is the stable anchor the Playwright e2e spec uses.
 */
function PlaceholderRoute(): React.ReactElement {
  return (
    <main className="team-dash-shell" lang="en-AU">
      <h1>Team Dash</h1>
      <p>
        The application shell is bootstrapping. The reporting dashboard will be
        implemented in a subsequent user story.
      </p>
      <hr />
      <p>
        The router and provider tree are wired. Subsequent user stories register
        their routes against this router.
      </p>
      <p>
        <Link to="/settings" data-testid="nav-settings">
          Settings
        </Link>
      </p>
    </main>
  );
}

/**
 * The first-run surface — rendered by the route guard while the gate
 * is closed.
 *
 * BSOD-347 wired the existing Phase 3 components (`TokenEntryForm`,
 * `StorageModeSelector`, `WorkspaceSelector`) into the live `/`
 * first-run route so a real user can enter a token, choose a storage
 * mode, and pick an Asana workspace on first run. The composition
 * lives in `<FirstRunSetup />` so the shell can mount it as an
 * opaque surface without knowing about its three internal phases.
 *
 * The composition keeps the T035 contract alive: the
 * `data-view-state="first_run"` sentinel the shared `<FirstRunState />`
 * primitive publishes is still rendered, the route guard's gate
 * still derives the same `gateClosed` boolean from the two
 * providers' state machines, and the existing T035 integration
 * tests continue to pass without modification. The new
 * `tests/integration/credentials/first-run-setup.test.tsx`
 * (BSOD-347) walks the user-facing flow end-to-end on top of this
 * surface.
 */
function FirstRunRoute(): React.ReactElement {
  return <FirstRunSetup />;
}

/**
 * The Settings credentials surface (BSOD-351 / T131) — the panel the
 * user reaches after first-run completes by following the "Settings"
 * link from the placeholder. The T045 `SettingsCredentialsPanel` is
 * the Settings-screen embodiment of the four US1 credential
 * lifecycle actions (Retest, Replace, Switch-mode, Clear-all); the
 * T044 `MaskedToken` it composes shows the FR-008 last-four-
 * characters identifier.
 *
 * The route is mounted as a child of the `RouteGuard` layout so the
 * gate contract stays intact — until both providers report `'ready'`,
 * the gate redirects to `<FirstRunRoute />` and this component is not
 * reachable.
 */
function SettingsRoute(): React.ReactElement {
  return <SettingsCredentialsPanel />;
}

/**
 * The T046 gate — wraps the route children. While either provider is
 * not `'ready'`, the gate renders `<FirstRunRoute />` instead of
 * `<Outlet />`, so the reporting surface is unreachable. Once both
 * providers report `'ready'`, the gate renders `<Outlet />` and the
 * URL-driven routing takes over.
 *
 * The gate MUST be mounted above the route children (rather than as
 * a route itself) so the rendering decision is route-independent —
 * the URL is irrelevant to whether the user is on the first-run
 * surface; only the provider state machines are.
 *
 * The boolean derivation is deliberately strict (`=== "ready"` for
 * both) so a future contributor who widens the providers' state
 * union (e.g. adds an `'awaiting_unlock'` state per a future
 * security story) fails this file's `tsc` rather than accidentally
 * opening the gate. The T035 test pins every documented gate-closed
 * case (no credential, no workspace, only credential, only workspace,
 * post-clear) and the gate-open case (both ready).
 */
function RouteGuard(): React.ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  const gateClosed =
    credentials.state !== "ready" || workspace.state !== "ready";
  if (gateClosed) {
    return <FirstRunRoute />;
  }
  return <Outlet />;
}

/**
 * A layout route that simply renders its `<Outlet />`. Exists so
 * future stories that need a shared chrome (the eventual dashboard
 * chrome: settings menu, refresh button, freshness banner) can
 * register nested routes against it without rewriting the router.
 *
 * The route guard T046 owns is now mounted as the layout
 * (`Component: RouteGuard`) rather than as a separate wrapper
 * component, so the gate's "render `<Outlet />`" decision happens
 * exactly once per URL match rather than once per child route.
 * Once the dashboard chrome exists (US2), the placeholder will
 * move into a nested route and the chrome becomes the layout's
 * body.
 */
const routes: RouteObject[] = [
  {
    path: "/",
    Component: RouteGuard,
    children: [
      { index: true, Component: PlaceholderRoute },
      { path: "settings", Component: SettingsRoute },
    ],
  },
];

/**
 * The shell router. Created with `createMemoryRouter` so tests can
 * drive the router from jsdom without a real `window.location`. The
 * production browser build (a future task) will swap this for
 * `createBrowserRouter`; the route table is shared.
 *
 * The initial `entries` parameter is `["/"]` so the placeholder is
 * rendered on first mount when the gate is open. While the gate is
 * closed the placeholder is replaced by `<FirstRunRoute />`, so the
 * initial entry matters only for the gate-open branch.
 */
export const router = createMemoryRouter(routes, {
  initialEntries: ["/"],
});

/**
 * Re-export of `<RouterProvider>` for tests and downstream code that
 * want to mount the router directly without going through `<App />`
 * (the eventual Playwright smoke test for the route guard is the
 * first known consumer; see `tests/e2e/first-run-flow.spec.ts`,
 * which is registered in T124, not T031).
 */
export { RouterProvider };
