/**
 * T032 — Shared prop types for `ViewState` primitives.
 *
 * Every primitive accepts an optional `className`, `data-testid`, and
 * the relevant contextual props (e.g. `lastRefreshedAt` for the
 * `'cached_stale'` primitive). The full set of native HTML attributes
 * is forwarded through `data-*` and `aria-*` so a feature component
 * can decorate the primitive without each primitive knowing about its
 * caller.
 *
 * ## Read-only props (SonarCloud `typescript:S6759`)
 *
 * Every field on `ViewStatePrimitiveProps` is declared `readonly` and
 * every primitive consumes its props via `Readonly<Props>` in its
 * function signature. SonarCloud rule `typescript:S6759` flags any
 * React component whose props parameter is mutable; the read-only
 * convention here is the project-wide baseline (Constitution
 * Principle VI's "readable, conventional code MUST be preferred over
 * cleverness") and is mirrored in every primitive's function
 * signature, not just in this shared interface.
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
  readonly className?: string;
  readonly "data-testid"?: string;
  readonly "aria-label"?: string;
}

/**
 * The context the dispatcher `<ViewStateView>` forwards to every
 * primitive so the `data-view-state` hook is always present on the
 * rendered root.
 */
export interface ViewStateDispatchContext {
  readonly state: ViewState;
}
