/**
 * T032 — `'offline'` `ViewState` primitive.
 *
 * Renders the offline banner that explains why the dashboard is
 * showing cached data and why the Refresh action is disabled
 * (Constitution Principle VII, spec FR-087). The body copy explicitly
 * tells the user that the last cached dashboard is still usable — the
 * spec's offline rule is "the last cached dashboard is viewable, and
 * the Refresh action is visibly disabled", not "the dashboard is
 * inaccessible offline".
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export function OfflineState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: ViewStatePrimitiveProps): ReactElement {
  return (
    <section
      className={className ?? "td-offline-state"}
      data-testid={dataTestId}
      data-view-state="offline"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? "Offline"}
    >
      <h2>You&apos;re offline</h2>
      <p>
        Your last cached dashboard is still available below. A refresh cannot be
        run until your connection is restored.
      </p>
    </section>
  );
}
