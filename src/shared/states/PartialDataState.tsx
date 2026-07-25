/**
 * T032 — `'partial_data'` `ViewState` primitive.
 *
 * Renders an alert region when a refresh partially completes
 * (Constitution Principle V, spec FR-022, FR-068). The body copy
 * makes two facts explicit:
 *
 * 1. The incomplete result is NOT the new cache — the previous
 *    known-good cache remains in use (Principle V refresh atomicity
 *    rule, FR-022).
 * 2. The user can see how much of the workspace was retrieved before
 *    the partial failure (`itemsRetrieved` of `totalExpected`) so
 *    the disclosure is concrete rather than abstract.
 *
 * `errorDetail` is rendered verbatim. The spec's Principle IV rule
 * (the token never appears in logs/UI) is honoured by the Asana
 * client contract — `errorDetail` arrives here already scrubbed of
 * any token value.
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

export interface PartialDataStateProps extends ViewStatePrimitiveProps {
  /**
   * A short, already-scrubbed description of the failure that caused
   * the partial outcome (e.g. "Asana returned a 5xx on the second of
   * three pages"). The Asana client contract guarantees this string
   * does not contain the personal access token.
   */
  errorDetail: string;
  /** How many items the refresh retrieved before the partial failure. */
  itemsRetrieved: number;
  /** The total number of items the refresh attempted to retrieve. */
  totalExpected: number;
}

export function PartialDataState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  errorDetail,
  itemsRetrieved,
  totalExpected,
}: PartialDataStateProps): ReactElement {
  return (
    <section
      className={className ?? "td-partial-data-state"}
      data-testid={dataTestId}
      data-view-state="partial_data"
      role="alert"
      aria-label={ariaLabel ?? "Partial refresh"}
    >
      <h2>Partial refresh result</h2>
      <p>
        Retrieved {itemsRetrieved} of {totalExpected} items before the refresh
        stopped. Your previous good cache has been kept.
      </p>
      <p>Reason: {errorDetail}</p>
    </section>
  );
}
