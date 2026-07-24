/**
 * T031 — the app-shell router.
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
 * - The route guard that decides which `ViewState` reaches which
 *   route is owned by T046 (US1) and lives in
 *   `src/app/route-guards.tsx`. T031 just exposes the router; the
 *   guard wiring is added in US1.
 *
 * - Feature components (`features/credentials/*`, `features/tasks/*`,
 *   …) are NOT imported here. The boundary rule in `eslint.config.js`
 *   allows `src/app/**` to import from `src/features/**`, but the
 *   cleaner discipline is "routes import the feature, the shell
 *   imports nothing but the router and the providers". Future
 *   stories extend the `routes` array; this module never grows
 *   beyond the placeholder route.
 */
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  type RouteObject,
} from "react-router";

/**
 * The T031 placeholder. Renders the existing T010 shell markup so
 * the app boots with a recognisable "Team Dash" heading and an
 * honest notice that the rest of the routes are coming in subsequent
 * tasks.
 *
 * The placeholder is registered as the index route so it covers
 * `/` until T046's guard decides what to render for an authenticated
 * vs. first-run user.
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
 * A layout route that simply renders its `<Outlet />`. Exists so
 * future stories that need a shared chrome (the eventual dashboard
 * chrome: settings menu, refresh button, freshness banner) can
 * register nested routes against it without rewriting the router.
 *
 * This route is intentionally minimal for T031 — it renders the
 * placeholder directly under `<Outlet />` so the existing `main` +
 * `h1` markup stays visible. Once the dashboard chrome exists (US2),
 * the placeholder will move into a nested route and the chrome
 * becomes the layout's body.
 */
function ShellLayout(): React.ReactElement {
  return <Outlet />;
}

/**
 * The route table. Downstream user stories extend this list:
 *
 * - US1 (T042–T046) adds `/settings` and the route guard that
 *   switches between the credential entry screen and the reporting
 *   screens.
 * - US3 (T069–T074) adds `/tasks` and `/tasks/:gid`.
 * - US4 (T078–T081) adds `/metrics/work-added-completed`.
 * - US5 (T084–T087) adds `/metrics/backlog`.
 *
 * Each extension is a `RouteObject` push into the `routes` array
 * below; the router is then re-exported through the same symbol so
 * `<App />` keeps mounting `<RouterProvider router={router} />`
 * without a wiring change.
 */
const routes: RouteObject[] = [
  {
    path: "/",
    Component: ShellLayout,
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
 * rendered on first mount. Future tests that want to assert a
 * different initial entry should re-create the router with a
 * different `entries` array — the `App` component will pick up the
 * new router via a module-level re-export when the swap happens.
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
