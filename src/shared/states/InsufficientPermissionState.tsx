/**
 * T032 — `'insufficient_permission'` `ViewState` primitive.
 *
 * Renders an alert region when the Asana client reports a permission
 * failure — the token is valid, but it lacks the scope needed for one
 * of the dashboard's read-only endpoints (Constitution Principle IV,
 * spec FR-004, FR-009). The body copy explains that this is a token
 * scope problem (not an authentication problem) so the user knows to
 * look at the Asana token's permissions rather than re-entering the
 * token value.
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export function InsufficientPermissionState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: ViewStatePrimitiveProps): ReactElement {
  return (
    <section
      className={className ?? "td-insufficient-permission-state"}
      data-testid={dataTestId}
      data-view-state="insufficient_permission"
      role="alert"
      aria-label={ariaLabel ?? "Insufficient permission"}
    >
      <h2>Asana permission required</h2>
      <p>
        Your personal access token does not have access to this resource. The
        dashboard only requests read access — check the token&apos;s scopes in
        Asana, then test the token again.
      </p>
    </section>
  );
}
