/**
 * T032 — `'rate_limited'` `ViewState` primitive.
 *
 * Renders an alert region when Asana returns a `429` response. The
 * primitive surfaces the `Retry-After` delay (in human-friendly units)
 * so the user understands when the next refresh is meaningful rather
 * than re-firing immediately and contributing to the rate-limit
 * cascade (Constitution Principle IV, spec FR-021).
 *
 * `retryAfterMs` is optional — when omitted, the primitive falls
 * back to a generic "wait, then try again" message that does not
 * imply a specific delay. The Asana client contract
 * (`contracts/asana-client.md`) is responsible for parsing the
 * `Retry-After` header into milliseconds; this primitive renders the
 * value verbatim rather than re-parsing it.
 *
 * Props are consumed as `Readonly<RateLimitedStateProps>` per the
 * SonarCloud `typescript:S6759` project-wide convention
 * (`src/shared/states/types.ts`).
 */
import type { ReactElement } from "react";

import type { ViewStatePrimitiveProps } from "./types";

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000;

/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60;

/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/**
 * The smallest positive seconds value the formatter surfaces when a
 * sub-second `Retry-After` (or a non-positive one) would otherwise
 * read as "0 seconds". Documented so a reader of the "1 second" branch
 * knows it is a deliberate floor, not an arbitrary literal.
 */
const MIN_RETRY_DISPLAY_SECONDS = 1;

export interface RateLimitedStateProps extends ViewStatePrimitiveProps {
  /**
   * The `Retry-After` delay (milliseconds) the Asana client parsed.
   * The primitive formats it into the most natural unit so the user
   * sees "wait 60 seconds" rather than "wait 60000 ms".
   */
  readonly retryAfterMs?: number;
}

/**
 * Format a millisecond delay as the largest natural unit it crosses
 * (seconds, minutes, or hours). Sub-second delays round up to
 * `MIN_RETRY_DISPLAY_SECONDS` so a 200 ms `Retry-After` does not
 * silently read as "0 seconds".
 */
function formatRetryAfter(milliseconds: number): string {
  if (milliseconds <= 0) {
    return `${MIN_RETRY_DISPLAY_SECONDS} second`;
  }
  const totalSeconds = Math.ceil(milliseconds / MS_PER_SECOND);
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
  }
  const totalMinutes = Math.ceil(totalSeconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }
  const totalHours = Math.ceil(totalMinutes / MINUTES_PER_HOUR);
  return `${totalHours} hour${totalHours === 1 ? "" : "s"}`;
}

export function RateLimitedState({
  className,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  retryAfterMs,
}: Readonly<RateLimitedStateProps>): ReactElement {
  const waitLabel =
    typeof retryAfterMs === "number" ? formatRetryAfter(retryAfterMs) : null;
  return (
    <section
      className={className ?? "td-rate-limited-state"}
      data-testid={dataTestId}
      data-view-state="rate_limited"
      role="alert"
      aria-label={ariaLabel ?? "Asana rate limit reached"}
    >
      <h2>Asana rate limit reached</h2>
      {waitLabel !== null ? (
        <p>
          Wait {waitLabel} and then run a refresh. The previous good cache is
          still intact.
        </p>
      ) : (
        <p>
          Wait a moment and then run a refresh. The previous good cache is still
          intact.
        </p>
      )}
    </section>
  );
}
