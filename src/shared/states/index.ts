/**
 * T032 — Shared `ViewState`-driven UI primitives.
 *
 * Public surface for the shared states module. Every feature
 * component imports the matching primitive (or the dispatcher) from
 * here so the loading/empty/first-run/no-results/stale/offline/invalid-
 * token/insufficient-permission/rate-limited/partial-data states are
 * "deliberately designed and tested rather than treated as incidental
 * errors" (Constitution Principle VII, spec FR-085, FR-087).
 *
 * Each primitive:
 *
 * - Carries a stable `data-view-state` attribute on its root element so
 *   a feature test or an in-page inspection can query the live state
 *   without coupling to the inner copy.
 *
 * - Uses an honest ARIA role: `'role="status"'` for informational
 *   states, `'role="alert"'` for failure/recovery states.
 *
 * - Renders Australian-English copy consistent with the project
 *   documentation convention (constitution §"Documentation").
 *
 * The dispatcher `<ViewStateView>` accepts a `ViewState` literal and
 * renders the matching primitive; for the `'ready'` state it renders
 * the supplied `children` slot so feature components do not need to
 * wrap their real UI in a placeholder.
 *
 * ## Boundary
 *
 * This module lives under `src/shared/**`. It is allowed to import
 * React and `src/domain/**` types only — no `src/features/**`,
 * `src/data/**`, or `src/app/**` dependencies, so it remains usable
 * from every layer that needs a shared UI primitive.
 */
export { CachedStaleState } from "./CachedStaleState";
export { EmptyState } from "./EmptyState";
export { FirstRunState } from "./FirstRunState";
export { InsufficientPermissionState } from "./InsufficientPermissionState";
export { InvalidTokenState } from "./InvalidTokenState";
export { LoadingState } from "./LoadingState";
export { NoResultsState } from "./NoResultsState";
export { OfflineState } from "./OfflineState";
export { PartialDataState } from "./PartialDataState";
export { RateLimitedState } from "./RateLimitedState";
export { ViewStateView } from "./ViewStateView";
export type { ViewStatePrimitiveProps } from "./types";
