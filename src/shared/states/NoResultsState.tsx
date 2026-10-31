/** Shared no-results surface. Its message is the only live content; callers
 * may place contextual controls after it without making them announcements. */
import type { ReactElement, ReactNode } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export interface NoResultsStateProps extends ViewStatePrimitiveProps {
  readonly children?: ReactNode;
}

export function NoResultsState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  children,
}: Readonly<NoResultsStateProps>): ReactElement {
  return (
    <section
      className={className ?? "td-no-results-state"}
      data-testid={dataTestId}
      data-view-state="no_results"
      aria-label={ariaLabel ?? "No results"}
    >
      <div role="status" aria-live="polite">
        <h2>No tasks match these filters</h2>
        <p data-testid="no-results-explanation">
          No tasks match the filters you've applied. Clear all filters to see
          more tasks.
        </p>
      </div>
      {children}
    </section>
  );
}
