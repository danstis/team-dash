/**
 * T032 — `'empty'` `ViewState` primitive.
 *
 * Renders the empty-cache nudge the user sees after a successful
 * credential + workspace selection but before any refresh has
 * completed (Constitution Principle VII, spec FR-085). The body copy
 * directs the user to run a refresh — a blank dashboard would be
 * misleading; an empty cache means "we haven't loaded anything yet",
 * not "your workspace has no tasks".
 *
 * Props are consumed as `Readonly<ViewStatePrimitiveProps>` per the
 * SonarCloud `typescript:S6759` project-wide convention
 * (`src/shared/states/types.ts`).
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export function EmptyState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: Readonly<ViewStatePrimitiveProps>): ReactElement {
  return (
    <section
      className={className ?? "td-empty-state"}
      data-testid={dataTestId}
      data-view-state="empty"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? "Empty dashboard"}
    >
      <h2>Nothing here yet</h2>
      <p>
        The dashboard has not loaded any tasks. Run a refresh to retrieve your
        Asana projects and tasks.
      </p>
    </section>
  );
}
