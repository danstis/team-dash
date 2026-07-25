/**
 * T032 — `'no_results'` `ViewState` primitive.
 *
 * Renders a status region explaining that a filter combination
 * matched zero tasks (Constitution Principle VII, spec FR-085). The
 * body copy nudges the user toward the clear-all-filters affordance
 * (FR-048) rather than presenting a blank table with no explanation.
 *
 * Uses `role="status"` rather than `role="alert"` — a zero-match
 * filter combination is a normal user outcome, not a failure, and
 * announcing it as an alert would be misleading.
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export function NoResultsState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: ViewStatePrimitiveProps): ReactElement {
  return (
    <section
      className={className ?? "td-no-results-state"}
      data-testid={dataTestId}
      data-view-state="no_results"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? "No results"}
    >
      <h2>No results</h2>
      <p>
        No tasks matched the current filters. Try widening the date range or
        clearing one or more filters to see more tasks.
      </p>
    </section>
  );
}
