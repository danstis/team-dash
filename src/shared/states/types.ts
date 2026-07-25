/**
 * T032 — Shared prop types for `ViewState` primitives.
 *
 * Every primitive accepts an optional `className`, `data-testid`, and
 * the relevant contextual props (e.g. `lastRefreshedAt` for the
 * `'cached_stale'` primitive). The full set of native HTML attributes
 * is forwarded through `data-*` and `aria-*` so a feature component
 * can decorate the primitive without each primitive knowing about its
 * caller.
 */
import type { ViewState } from "../../domain/types";

/**
 * Common props every primitive accepts. Decoupled from
 * `HTMLAttributes<HTMLDivElement>` to keep the public surface narrow:
 * primitives forward `data-*` and `aria-*` selectively rather than
 * silently accepting every HTML attribute (which would let a caller
 * accidentally override the primitive's `role` or `data-view-state`).
 */
export interface ViewStatePrimitiveProps {
  className?: string;
  "data-testid"?: string;
  "aria-label"?: string;
}

/**
 * The context the dispatcher `<ViewStateView>` forwards to every
 * primitive so the `data-view-state` hook is always present on the
 * rendered root.
 */
export interface ViewStateDispatchContext {
  state: ViewState;
}
