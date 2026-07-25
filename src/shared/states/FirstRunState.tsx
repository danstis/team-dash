/**
 * T032 — `'first_run'` `ViewState` primitive.
 *
 * Renders the onboarding nudge the user sees when no Asana personal
 * access token is stored (or when a stored token failed to decrypt per
 * FR-002b). The primitive is intentionally informational, not an alert
 * — a clean first-run is not a failure state (Constitution Principle
 * VII, spec FR-085).
 *
 * The body copy points at the credential entry screen (US1 / T042)
 * without rendering the entry form itself: feature components own the
 * chrome (settings menu, layout), and the primitive stays reusable
 * across first-run, post-clear-data, and decrypt-failure flows that
 * all converge on the same landing screen.
 *
 * Props are consumed as `Readonly<ViewStatePrimitiveProps>` per the
 * SonarCloud `typescript:S6759` project-wide convention
 * (`src/shared/states/types.ts`).
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export function FirstRunState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: Readonly<ViewStatePrimitiveProps>): ReactElement {
  return (
    <section
      className={className ?? "td-first-run-state"}
      data-testid={dataTestId}
      data-view-state="first_run"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? "First run"}
    >
      <h2>First-run setup</h2>
      <p>
        To start, enter your Asana personal access token. The token stays on
        this device and is only used to read your Asana workspace.
      </p>
      <p>
        When you have entered your token, choose a workspace and run a refresh
        to load your tasks.
      </p>
    </section>
  );
}
