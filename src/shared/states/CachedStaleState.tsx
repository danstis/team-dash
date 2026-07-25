/**
 * T032 — `'cached_stale'` `ViewState` primitive.
 *
 * Renders the honest "showing cached data" banner required by FR-085
 * and the FreshnessBanner (T061). The primitive MUST surface the
 * timestamp verbatim — the spec's Principle VII rule is that cached
 * information MUST NEVER be presented as current when the application
 * cannot refresh it, so a generic "old data" wording would mask the
 * very fact the user needs to know.
 *
 * `lastRefreshedAt` is a free-form string so a future feature can
 * localise it (Australian English default) or pass an already-
 * formatted label without re-introducing a date-formatting
 * dependency in this primitive.
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export interface CachedStaleStateProps extends ViewStatePrimitiveProps {
  /**
   * The label the UI will display next to "Last refreshed". The
   * dispatcher (T046 / T060 / T061) supplies this from the latest
   * successful RefreshSession. A free-form string keeps the primitive
   * independent of any date-formatting library.
   */
  lastRefreshedAt: string;
}

export function CachedStaleState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  lastRefreshedAt,
}: CachedStaleStateProps): ReactElement {
  return (
    <section
      className={className ?? "td-cached-stale-state"}
      data-testid={dataTestId}
      data-view-state="cached_stale"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? "Showing cached data"}
    >
      <h2>Showing cached data</h2>
      <p>
        Last refreshed at <span>{lastRefreshedAt}</span>. This data may not
        reflect recent changes — run a refresh to update it.
      </p>
    </section>
  );
}
