/**
 * T032 — `'loading'` `ViewState` primitive.
 *
 * Renders a polite status region announcing that work is in progress.
 * Used during credential resolution (T031), refresh (T059), and any
 * other transient async operation the UI cannot yet render a result
 * for (Constitution Principle VII, spec FR-085).
 *
 * The component deliberately avoids coupling to a spinner library:
 * a CSS-only spinner can be added by the consuming feature without
 * the primitive carrying a styling dependency. The copy is
 * self-sufficient — a screen-reader user hears the same announcement
 * whether or not the spinner is visible, so the visual decoration is
 * non-essential.
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

/**
 * Render the `'loading'` primitive.
 *
 * @param props Optional `className`, `data-testid`, and `aria-label`
 *   overrides; the primitive supplies sensible defaults for the
 *   `role`/`aria-live`/`aria-busy`/`data-view-state` attributes.
 */
export function LoadingState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: ViewStatePrimitiveProps): ReactElement {
  return (
    <section
      className={className ?? "td-loading-state"}
      data-testid={dataTestId}
      data-view-state="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={ariaLabel ?? "Loading"}
    >
      <h2>Loading</h2>
      <p>Please wait while the dashboard prepares your data.</p>
    </section>
  );
}
