/**
 * T032 — `'invalid_token'` `ViewState` primitive.
 *
 * Renders an alert region when the Asana client reports an
 * authentication failure (Constitution Principle IV + VII, spec
 * FR-004, FR-005). The body copy points at the replace-token path
 * rather than a generic "try again" — the spec's explicit rule is
 * that the user can replace the stored/session token at any time.
 *
 * Uses `role="alert"` so assistive tech announces the failure
 * immediately. The dispatcher may also surface this primitive after
 * FR-002b's decrypt-failure fallback (T031 routes both flows to the
 * same UI so a corrupt-key recovery does not introduce a dedicated
 * error state).
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export function InvalidTokenState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
}: ViewStatePrimitiveProps): ReactElement {
  return (
    <section
      className={className ?? "td-invalid-token-state"}
      data-testid={dataTestId}
      data-view-state="invalid_token"
      role="alert"
      aria-label={ariaLabel ?? "Invalid token"}
    >
      <h2>Token rejected by Asana</h2>
      <p>
        Your personal access token is no longer valid, or the Asana API rejected
        the request. Replace or re-enter your token to continue.
      </p>
    </section>
  );
}
