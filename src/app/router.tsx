/**
 * T031 + T046 — the app-shell router.
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
 *   and lets feature-level tests (T035, T046, T049) import just the
 *   router without dragging the provider tree.
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
 *   …) are NOT imported here. By architectural convention the shell
 *   mounts providers and a router; features mount under the router.
 *   The `eslint-plugin-boundaries` configuration in `eslint.config.js`
 *   constrains `src/domain/**` only (Constitution Principle VI's
 *   lint-enforced half of the boundary); the "shell does not import
 *   features" rule is enforced by convention and code review, not by
 *   lint. Future stories extend the `routes` array; this module never
 *   grows beyond the placeholder route.
 *
 * - The first-run surface itself is composed of presentation-only
 *   primitives the shared layer owns (`<FirstRunState />`,
 *   `<MaskedToken />`). The actual credential entry, storage-mode,
 *   and workspace-selection flows are feature components the user
 *   reaches through Settings / a dedicated credential route that
 *   downstream stories register. The route guard's job is the gate:
 *   hide the reporting surface until the shell providers report
 *   `'ready'`, and surface the first-run primitive otherwise.
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
 * is satisfied by the single boolean `gateClosed`.
 *
 * ## FR-008 invariant in the first-run surface
 *
 * The first-run surface renders the current credential's masked
 * identifier via the shared `<MaskedToken />` component
 * (`src/shared/components/MaskedToken.tsx`, T044 / BSOD-172) so the
 * user can confirm "the credential currently loaded is the one I
 * think it is" without ever exposing the plaintext. The component
 * takes the already-computed masked identifier via its prop surface
 * — it does NOT derive one from a plaintext token, and its prop
 * signature cannot be widened to accept one (FR-008 invariant).
 *
 * The surface also surfaces the currently selected workspace
 * (gid + name) so the gate keeps an honest, accessible status
 * panel: a user who has persisted a credential but never finished
 * workspace selection sees "Current credential: …abcd" and an empty
 * workspace line; a user who selected a workspace but lost their
 * session-only credential (e.g. after a reload) sees the workspace
 * name and an empty credential line.
 *
 * Determinism
 * -----------
 * The router renders synchronously on first paint (no async init,
 * no IndexedDB read); the IndexedDB lookup the providers run on
 * mount resolves the state to `'first_run'` or `'ready'` on the
 * next render. The gate is therefore a small, deterministic
 * derived boolean — no `useEffect`, no `useState`, no async
 * coupling.
 */
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  type RouteObject,
} from "react-router";

import { useCredentials } from "./credentials-context";
import { MaskedToken } from "../shared/components/MaskedToken";
import { FirstRunState } from "../shared/states/FirstRunState";
import { useWorkspace } from "./workspace-context";

/**
 * The T031 placeholder. Renders the existing T010 shell markup so
 * the app boots with a recognisable "Team Dash" heading and an
 * honest notice that the rest of the routes are coming in subsequent
 * tasks.
 *
 * The placeholder is registered as the index route so it covers
 * `/` once the gate lifts. While the gate is closed, the gate
 * component above it renders `<FirstRunRoute />` instead, so the
 * placeholder is never reachable — and therefore never appears in
 * the rendered DOM — until both providers report `'ready'`.
 */
function PlaceholderRoute(): React.ReactElement {
  return (
    <main className="team-dash-shell" lang="en-AU">
      <h1>Team Dash</h1>
      <p>
        The application shell is bootstrapping. The credential entry screen will
        be implemented in Phase 3 (US1).
      </p>
      <hr />
      <p>
        The router and provider tree are wired. Subsequent user stories register
        their routes against this router.
      </p>
    </main>
  );
}

/**
 * The T046 first-run surface — rendered by the route guard while the
 * gate is closed.
 *
 * The surface is intentionally presentation-only: it composes the
 * shared `<FirstRunState />` primitive and the shared `<MaskedToken />`
 * component over the two provider state machines, and it never
 * imports from `src/features/**` (the architectural rule the
 * `src/app/**` shell boundary enforces by convention). The actual
 * credential entry, storage-mode, and workspace-selection flows are
 * feature components the user reaches through Settings (a dedicated
 * route downstream stories register) or a future dedicated
 * `/credentials` route.
 *
 * The surface mirrors the T035 test's expectations: the
 * `data-view-state="first_run"` attribute the `<FirstRunState />`
 * primitive publishes is the gate's sentinel, so a test (or an
 * in-page inspection) can identify the gate-closed state without
 * coupling to the inner copy. The masked identifier rendering uses
 * `<MaskedToken />` so the credential status panel honours the
 * FR-008 "token never rendered" invariant — the masked identifier
 * the panel surfaces is the same string the credentials provider
 * already computed and stored, never a derivation from a plaintext
 * token.
 *
 * The shell boundary rule (`src/app/**` MUST NOT import from
 * `src/features/**`) is what keeps this surface narrow: a future
 * contributor who tries to drop a feature component here fails the
 * architectural review rather than slipping a feature dependency
 * into the shell.
 */
function FirstRunRoute(): React.ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  const hasMaskedIdentifier = credentials.maskedIdentifier.length > 0;
  const hasWorkspace = workspace.workspace !== null;
  return (
    <main className="team-dash-shell team-dash-shell--first-run" lang="en-AU">
      <FirstRunState />
      <section
        className="td-first-run-credential-status"
        aria-label="Current credential and workspace"
      >
        <p>
          Current credential:{" "}
          {hasMaskedIdentifier ? (
            <MaskedToken maskedIdentifier={credentials.maskedIdentifier} />
          ) : (
            <em>not set</em>
          )}
        </p>
        <p>
          Current workspace:{" "}
          {hasWorkspace ? (
            <code>{workspace.workspace?.name}</code>
          ) : (
            <em>not selected</em>
          )}
        </p>
      </section>
    </main>
  );
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
    children: [{ index: true, Component: PlaceholderRoute }],
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
