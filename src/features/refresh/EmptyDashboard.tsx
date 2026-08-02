/**
 * T04 — `EmptyDashboard` (S01, FR-085 "empty" state).
 *
 * The first-run surface the dashboard renders when the gate is open
 * (credential + workspace ready) but the cache has never been
 * populated. Rather than rendering a blank pane — which a user could
 * plausibly mistake for "your workspace has no tasks" — the surface
 * directs the user to press Refresh, the only action that can populate
 * the cache from this state.
 *
 * The component deliberately does NOT embed its own refresh button.
 * The Refresh button lives in `<RefreshControls />` so the surface
 * composition (the dashboard's responsibility) controls the layout
 * and avoids splitting the refresh state machine across two
 * components. The dashboard renders `<EmptyDashboard />` immediately
 * above `<RefreshControls />` so the "Press the Refresh button below"
 * copy points at a visible button.
 *
 * Spec / contract references
 * --------------------------
 * Spec US2 acceptance scenario 4 (extension): the dashboard first-
 * render must direct a first-run user to press Refresh rather than
 * show an empty pane. FR-085 ("The dashboard MUST be honest about
 * empty caches by directing the user to run a refresh, never by
 * silently rendering a blank pane") is the requirement that drives
 * this surface; FR-022 ("a failed/cancelled/partial refresh MUST NOT
 * replace a previously complete cache") ensures the empty state
 * only appears when there is genuinely no usable prior refresh.
 *
 * Anchors
 * -------
 * - `data-testid="empty-dashboard"` — pinned by the S01 verification
 *   table.
 * - `data-view-state="empty"` — consistent with the shared
 *   `ViewState` primitives (`src/shared/states/EmptyState.tsx`); a
 *   future migration to dispatch through `<ViewStateView />` is
 *   straightforward because the data attribute contract matches.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the feature boundary documented in the
 * plan. The component has no `src/data/**` dependency so the unit
 * suite can render it without seeding Dexie.
 */
import type { ReactElement } from "react";

/**
 * The first-run dashboard surface. Returns a `data-testid="empty-
 * dashboard"` `<section>` whose copy points at the Refresh button
 * that lives in `<RefreshControls />` below it. The component is a
 * pure renderer: it has no props, no internal state, no Dexie read.
 *
 * Implementation note: `EmptyDashboard` is intentionally distinct
 * from `<EmptyState />` (`src/shared/states/EmptyState.tsx`). The
 * shared primitive renders the same freshness-promise wording and is
 * the right fit for a `useViewState()` dispatch; this component is
 * the dashboard-specific version that wires copy to the Refresh
 * button below it. They render the same `data-view-state="empty"`
 * hook so a future viewer can dispatch on either interchangeably.
 */
export function EmptyDashboard(): ReactElement {
  return (
    <section
      className="td-empty-dashboard"
      data-testid="empty-dashboard"
      data-view-state="empty"
      role="status"
      aria-live="polite"
      aria-label="No data yet"
    >
      <h2>No data yet</h2>
      <p>
        Your workspace has been selected, but the dashboard has not loaded any
        data yet.
      </p>
      <p>
        Press the <strong>Refresh</strong> button below to load your Asana
        projects and tasks.
      </p>
    </section>
  );
}

export default EmptyDashboard;
