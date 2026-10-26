/**
 * BSOD-310 (T062) — `EmptyDashboard`, the refresh family's first-run /
 * empty surface (US2).
 *
 * Spec / contract references
 * --------------------------
 * Spec US2 acceptance scenario 5 (spec.md §"User Story 2"):
 *
 *   "Given the app has never completed a refresh, When the user views
 *    the dashboard, Then they see a clear first-run/empty state directing
 *    them to run a refresh, not a blank or misleading report."
 *
 * And the FR-085 contract that requires it:
 *
 *   "FR-085: The system MUST provide deliberately designed loading,
 *    empty, first-run, no-results, stale-cache, offline,
 *    invalid-token, insufficient-permission, rate-limited, and
 *    partial-data states, each with a clear explanation and, where
 *    applicable, a next action."
 *
 * FR-020 ("the system MUST provide a prominent, explicit manual
 * Refresh action") is what the "next action" of this state resolves
 * to: the empty dashboard is where the very first Refresh happens, so
 * the action is present, enabled, and labelled — the copy alone would
 * not satisfy FR-020's "prominent, explicit manual Refresh action".
 *
 * The `ViewState` union in data-model.md lists `'first_run'` and
 * `'empty'` as two distinct cases, so the surface renders both and
 * publishes the active case in `data-view-state`.
 *
 * What this module owns
 * ---------------------
 * - `<EmptyDashboard />` — the "there is no data yet" surface with the
 *   explanation (no dashboard data exists) and the next action (run a
 *   refresh). The Refresh button is a real control wired to the
 *   caller's `onRefresh` callback, and it refuses to fire while a
 *   refresh is in flight or while the caller has disabled it.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The refresh itself. The surface owns the *instruction* and the
 *   *action*; the orchestration (staging, commit, failure reasons)
 *   belongs to `src/data/refresh/refresh-orchestrator.ts` (T051) and
 *   the outcome banner to `RefreshControls.tsx` (T049). This module
 *   imports React only — no `src/data/**`, no `src/domain/**`, no
 *   Asana call, no Dexie read — so it stays a pure presentation
 *   surface the dashboard chrome can mount anywhere.
 * - The no-results state (T068 / BSOD-317,
 *   `src/features/tasks/NoResultsState.tsx`). That surface fires when
 *   a filter combination matches zero tasks against data that already
 *   exists, and its next action is "widen the filters". This surface
 *   fires when no data has been loaded at all, and its next action is
 *   "run a refresh". Keeping them apart is what stops the dashboard
 *   from telling a user with no data to go and adjust filters that
 *   were never applied — the "misleading report" US2 scenario 5
 *   forbids.
 * - The shared `<EmptyState />` primitive (`src/shared/states/`).
 *   That primitive covers the `'empty'` view state alone, publishes a
 *   fixed `data-view-state="empty"`, and offers no action; this
 *   surface has to cover the `'first_run'` case too and to carry the
 *   Refresh control, so it renders its own markup rather than nesting
 *   a second status region inside its own.
 * - The offline-disabled Refresh surface (T050 / BSOD-304,
 *   `OfflineRefreshState`) — a peer surface owned by that row. The
 *   caller decides whether the Refresh action is available offline and
 *   passes `disabled` accordingly.
 *
 * Determinism
 * -----------
 * The surface is fully synchronous on first paint: no async init, no
 * IndexedDB read, no network. Everything it renders is derived from
 * its props, so the integration test can assert the whole contract
 * without a live workspace (Principle III, NFR-005).
 *
 * Accessibility
 * -------------
 * The surface is a polite status region (`role="status"`,
 * `aria-live="polite"`): an empty dashboard is an informational state,
 * not a failure, so it must not be announced as an alert. The heading
 * is an `<h2>` because the surface renders *inside* the dashboard,
 * whose own `<h1>` ("Team Dash") owns the top level — an `<h1>` here
 * would produce two top-level headings in one document (WCAG 1.3.1).
 * The Refresh control is a real `<button>` with a visible text label,
 * so it is reachable by keyboard and announced by its accessible name
 * ("Refresh" / "Refreshing…").
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The component renders no credential, no workspace name, and no
 * cached record; it has no access to any of them. The only value it
 * surfaces is the caller's `onRefresh` callback, so a caller that
 * wires it to a network call cannot leak a token through this surface.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the plan-documented home for the
 * refresh-flow React UI. This module imports React only — no
 * `src/data/**` or `src/domain/**` dependencies.
 */
import type { ReactElement } from "react";

/* -------------------------------------------------------------------------- */
/* View state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The two `ViewState` cases this surface renders.
 *
 * These are the `'first_run'` and `'empty'` literals of the domain's
 * `ViewState` union (data-model.md §"ViewState"), narrowed to the
 * cases the refresh family owns:
 *
 * - `'first_run'` — no refresh has ever completed for this workspace;
 *   there is nothing cached at all.
 * - `'empty'` — a refresh has completed but produced no reportable
 *   data; the dashboard still has nothing to show.
 *
 * The union is declared locally (rather than imported from
 * `src/domain/types.ts`) to keep the feature layer free of a domain
 * dependency, matching the convention the other feature modules in
 * this family follow. The literal values are the domain's, so the
 * `data-view-state` attribute this surface publishes is a valid
 * `ViewState` literal.
 */
export type EmptyDashboardState = "first_run" | "empty";

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The props `<EmptyDashboard />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the SonarCloud
 * `typescript:S6759` project-wide convention.
 */
export interface EmptyDashboardProps {
  /**
   * Which of the two "no data yet" cases this surface represents.
   * The value is published verbatim in the `data-view-state`
   * attribute so a test — or the dashboard chrome that decides which
   * state to show — can identify the active case without coupling to
   * the inner copy.
   */
  readonly state: EmptyDashboardState;
  /**
   * The action the Refresh control triggers. The caller wires this to
   * the refresh orchestrator (T051) — this surface owns the
   * instruction and the control, not the refresh itself.
   */
  readonly onRefresh: () => void;
  /**
   * `true` when the Refresh action is unavailable to the user for a
   * reason outside this surface (e.g. the browser is offline per
   * FR-087, or the workspace/token preconditions are not met). The
   * control is rendered disabled and refuses to fire.
   */
  readonly disabled?: boolean;
  /**
   * `true` while a refresh is in flight. The control is rendered
   * disabled, labelled "Refreshing…", and marked `aria-busy` so a
   * screen-reader user is told the action is already running.
   */
  readonly busy?: boolean;
}

/**
 * The FR-085 first-run / empty surface with the FR-020 Refresh action.
 *
 * The copy is Australian English (Constitution §"Documentation") and
 * honest about the situation (Principle VII): it says plainly that
 * there is no dashboard data, so the user never reads an empty
 * report as "you have no work" — and it never borrows the
 * no-results framing, which would point at filters that were never
 * applied.
 */
export function EmptyDashboard({
  state,
  onRefresh,
  disabled = false,
  busy = false,
}: Readonly<EmptyDashboardProps>): ReactElement {
  const isActionAvailable = !disabled && !busy;

  const handleClick = (): void => {
    // The native `disabled` attribute already stops a real click, but
    // `fireEvent.click` dispatches the synthetic event regardless. The
    // component guards here so a caller that wires `onRefresh` to a
    // network call cannot fire it twice — or fire it at all while the
    // action is unavailable.
    if (!isActionAvailable) {
      return;
    }
    onRefresh();
  };

  const heading =
    state === "first_run" ? "Welcome to Team Dash" : "No dashboard data yet";

  const explanation =
    state === "first_run"
      ? "No refresh has run yet, so there is no dashboard data to show. Run a refresh to retrieve your Asana projects and tasks."
      : "There is no dashboard data to show yet. Run a refresh to retrieve your Asana projects and tasks.";

  return (
    <section
      className="td-empty-dashboard"
      data-testid="empty-dashboard"
      data-view-state={state}
      role="status"
      aria-live="polite"
      aria-label="Dashboard empty"
    >
      <h2>{heading}</h2>
      <p data-testid="empty-dashboard-explanation">{explanation}</p>
      <button
        type="button"
        className="td-empty-dashboard-refresh-button"
        data-testid="empty-dashboard-refresh-button"
        disabled={!isActionAvailable}
        aria-disabled={!isActionAvailable}
        aria-busy={busy}
        onClick={handleClick}
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </section>
  );
}
