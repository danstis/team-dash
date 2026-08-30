/**
 * T051 — Refresh feature components (US2, BSOD-305).
 *
 * Houses `OutcomeBanner`, the failure-reason rendering the T051 row
 * specifically owns. The file is shared with T049
 * (`Refresh success outcome red→green`, BSOD-303) — T049 will add
 * the success / partial-failure rendering of `OutcomeBanner` here
 * alongside the failure-reason rendering this row ships.
 *
 * What T051 ships
 * ---------------
 * - `OutcomeBanner` — the failure-reason surface for the four
 *   mid-refresh failure modes the spec enumerates (network failure /
 *   auth failure / rate-limit / user-cancel). Each failure mode
 *   surfaces a DISTINCT reason string the UI and the integration
 *   test can pin:
 *
 *     | OutcomeBanner state | data-outcome-state | data-outcome-reason |
 *     |---------------------|--------------------|---------------------|
 *     | succeeded           | "succeeded"        | "succeeded"         |
 *     | cancelled (user)    | "cancelled"        | "cancelled"         |
 *     | failed (network)    | "failed"           | "network_error"     |
 *     | failed (auth)       | "failed"           | "auth_failure"      |
 *     | failed (permission) | "failed"           | "permission_failure"|
 *     | failed (rate-limit) | "failed"           | "rate_limited"      |
 *
 *   The `data-outcome-state` and `data-outcome-reason` attributes are
 *   the stable, contract-anchored hooks every consumer (the
 *   integration test, future analytics, a debug overlay) reads. They
 *   mirror the `data-view-state` pattern the `src/shared/states/**`
 *   primitives publish (T032).
 *
 *   Every failure state carries a perceptible user-facing message
 *   AND the `data-outcome-cache-intact="true"` attribute — the spec's
 *   FR-022 invariant ("a failed, cancelled, or incomplete refresh
 *   MUST NOT replace a previously complete cache") is part of the
 *   visible UI so the user understands they are still looking at the
 *   last known-good data, not at partial data from the aborted
 *   refresh.
 *
 * What T051 deliberately does NOT ship
 * -------------------------------------
 * - The `RefreshButton` (T049 owns it).
 * - The `ProgressIndicator` (T049 owns it).
 * - The success-state rendering of `OutcomeBanner` (T049 owns it —
 *   it includes the partial-failure rendering too).
 *
 *   The T051 `OutcomeBanner` accepts a `succeeded` state via its
 *   `state` prop for shape-completeness (the discriminated union
 *   closes over every documented outcome), but the success-state
 *   render itself renders a minimal placeholder heading — T049
 *   replaces it with the full "last refreshed at <timestamp>" /
 *   partial-failure rendering in its own PR.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the presentation layer for refresh
 * outcomes. It imports from `src/data/refresh/**` (the orchestrator's
 * outcome type), `src/shared/**` (no — the banner is its own
 * component, not a `ViewState` primitive because the failure-reason
 * vocabulary is finer-grained than `ViewState`'s union), and
 * `src/domain/**` (not used). It MUST NOT import Dexie, the Asana
 * client, or anything else from `src/data/db/**` — the
 * orchestrator's `RefreshOutcome` is the boundary the UI crosses.
 */

/* -------------------------------------------------------------------------- */
/* Imports                                                                    */
/* -------------------------------------------------------------------------- */

import type { ReactElement } from "react";

import type {
  RefreshFailureReason,
  RefreshOutcome,
} from "../../data/refresh/refresh-orchestrator";

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The visible state of the refresh outcome the banner surfaces. This
 * is the literal union `OutcomeBanner` renders; it is constructed
 * from a `RefreshOutcome` via the `propsFromOutcome` helper below
 * (kept as a separate prop shape so the banner is decoupled from the
 * orchestrator's full `RefreshOutcome` — a test can supply any
 * combination of `state` / `reason` / `itemsRetrieved` / `message`
 * without going through the orchestrator).
 */
export type OutcomeBannerState = "succeeded" | "cancelled" | "failed";

/**
 * The orchestrator's `RefreshFailureReason` vocabulary, narrowed to
 * the values `OutcomeBanner` knows how to render. Re-exported under
 * the banner's own type alias so a consumer does not need to import
 * the orchestrator module just to type the prop.
 */
export type OutcomeBannerReason = RefreshFailureReason;

/**
 * The `OutcomeBanner` props. The shape is the union of every input
 * the failure-reason rendering needs:
 *
 * - `state` — the banner's coarse state (`'succeeded'` /
 *   `'cancelled'` / `'failed'`); drives the heading and the
 *   `data-outcome-state` attribute.
 * - `reason` — the fine-grained failure reason when `state ===
 *   'failed'`; drives the heading copy and the `data-outcome-reason`
 *   attribute. `'succeeded'` and `'cancelled'` states ignore this
 *   prop (they have no reason to surface).
 * - `itemsRetrieved` — the running count from the orchestrator's
 *   live progress counter (FR-021); shown on the success-state
 *   banner only. T049 will replace the success-state render with
 *   the full "X tasks refreshed" copy.
 * - `message` — an optional non-credential-bearing human-readable
 *   detail (e.g. the scrubbed `network_error.message`). Rendered
 *   only on the `'failed'` state with `'network_error'` reason; the
 *   other reasons render their own fixed copy verbatim because
 *   either they do not carry a message (`auth_failure`,
 *   `permission_failure`, `rate_limited`, `validation_error`) or
 *   surfacing Asana's raw error text would risk leaking token /
 *   workspace identifiers (FR-008 / FR-010).
 * - `cacheIntact` — explicit override for the
 *   `data-outcome-cache-intact` attribute; defaults to `true`
 *   because every failure-mode path in the orchestrator preserves
 *   the cache. The prop is exposed so a future contributor wiring a
 *   partial-failure state (T049) can set it to `'false'` from the
 *   success-with-partial-failure path without touching this row's
 *   defaults.
 */
export interface OutcomeBannerProps {
  readonly state: OutcomeBannerState;
  readonly reason?: OutcomeBannerReason;
  readonly itemsRetrieved?: number;
  readonly message?: string;
  readonly cacheIntact?: boolean;
  readonly "data-testid"?: string;
  readonly "aria-label"?: string;
  readonly className?: string;
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Render the refresh outcome. The component is the single source of
 * truth for the failure-reason copy the spec requires; the
 * `data-outcome-state` and `data-outcome-reason` attributes are the
 * stable hooks every test / debug overlay / analytics pipeline
 * reads.
 *
 * The banner is role-aware: success / cancelled states use
 * `role="status"` (informational), failed states use `role="alert"`
 * (urgent, per Principle VII accessibility floor — matching the
 * shared `InvalidTokenState` / `RateLimitedState` convention).
 */
export function OutcomeBanner({
  state,
  reason,
  itemsRetrieved,
  message,
  cacheIntact,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  className,
}: Readonly<OutcomeBannerProps>): ReactElement {
  const resolvedClassName = className ?? "td-outcome-banner";
  const isFailed = state === "failed";
  const resolvedCacheIntact = cacheIntact ?? /* default */ true;

  // The `data-outcome-state` / `data-outcome-reason` pair is the
  // contract anchor. `state` is the banner's coarse state;
  // `reason` mirrors it for `'succeeded'` (so the test assertion can
  // use the same attribute pair across every outcome) and carries
  // the fine-grained failure vocabulary on `'failed'` / is fixed to
  // `'cancelled'` on the cancel path. The values are explicit
  // string literals — the test reads them via `getAttribute` and
  // they MUST match the spec's documented failure-mode names.
  const dataOutcomeState = state;
  const dataOutcomeReason = state === "failed" ? (reason ?? "unknown") : state;

  const heading = pickHeading(state, reason);
  const body = pickBody(state, reason, itemsRetrieved, message);

  return (
    <section
      className={resolvedClassName}
      data-testid={dataTestId}
      data-outcome-state={dataOutcomeState}
      data-outcome-reason={dataOutcomeReason}
      data-outcome-cache-intact={String(resolvedCacheIntact)}
      role={isFailed ? "alert" : "status"}
      aria-live={isFailed ? "assertive" : "polite"}
      aria-label={ariaLabel ?? defaultAriaLabel(state, reason)}
    >
      <h2>{heading}</h2>
      <p>{body}</p>
      {resolvedCacheIntact && state !== "succeeded" ? (
        <p data-testid="cache-intact-notice">
          The previous good cache is still intact.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Translate a `RefreshOutcome` into `OutcomeBannerProps`. The helper
 * is exported so a feature component that has the orchestrator's
 * result can construct the banner's props without re-implementing
 * the discriminated-union switch.
 */
export function propsFromOutcome(
  outcome: RefreshOutcome,
  options?: Readonly<{ cacheIntact?: boolean }>,
): OutcomeBannerProps {
  const cacheIntact = options?.cacheIntact ?? true;
  switch (outcome.status) {
    case "succeeded":
      return {
        state: "succeeded",
        itemsRetrieved: outcome.itemsRetrieved,
        cacheIntact: false,
      };
    case "cancelled":
      return {
        state: "cancelled",
        cacheIntact,
      };
    case "failed":
      return {
        state: "failed",
        reason: outcome.reason,
        cacheIntact,
        ...(outcome.message !== undefined ? { message: outcome.message } : {}),
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers (internal)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The heading copy for each (state, reason) pair. Each heading is a
 * short, distinct, Australian-English phrase the user can scan; the
 * integration test reads the heading text indirectly through the
 * `data-outcome-reason` attribute rather than the string content so
 * an i18n sweep that changes the copy does not break the test.
 */
function pickHeading(
  state: OutcomeBannerState,
  reason: OutcomeBannerReason | undefined,
): string {
  if (state === "succeeded") {
    return "Refresh complete";
  }
  if (state === "cancelled") {
    return "Refresh cancelled";
  }
  switch (reason) {
    case "network_error":
      return "Refresh interrupted by a network error";
    case "auth_failure":
      return "Asana rejected the token";
    case "permission_failure":
      return "Asana permission required";
    case "rate_limited":
      return "Asana rate limit reached";
    case "validation_error":
      return "Refresh could not be applied";
    case undefined:
      return "Refresh failed";
  }
}

/**
 * The body copy for each (state, reason) pair. The body explains
 * what happened and (on failure / cancellation) what the user
 * should do next, with a separate copy path for the network-error
 * `message` (the only failure reason that carries a scrubbed,
 * non-credential-bearing detail).
 */
function pickBody(
  state: OutcomeBannerState,
  reason: OutcomeBannerReason | undefined,
  itemsRetrieved: number | undefined,
  message: string | undefined,
): string {
  if (state === "succeeded") {
    const count =
      typeof itemsRetrieved === "number" ? `${itemsRetrieved} items` : "items";
    return `Refresh succeeded — ${count} retrieved.`;
  }
  if (state === "cancelled") {
    return "The refresh was cancelled before it could complete.";
  }
  switch (reason) {
    case "network_error":
      return typeof message === "string" && message.length > 0
        ? `The connection to Asana failed (${message}). Try the refresh again when your network is stable.`
        : "The connection to Asana failed. Try the refresh again when your network is stable.";
    case "auth_failure":
      return "The Asana token was rejected. Replace or re-enter the token to continue.";
    case "permission_failure":
      return "The Asana token does not have access to this resource. Check the token's scopes in Asana, then try the refresh again.";
    case "rate_limited":
      return "Asana is rate-limiting this refresh. Wait a moment and then try the refresh again.";
    case "validation_error":
      return "Asana returned data that does not match the expected shape. Try the refresh again; if it persists, report the issue with the response payload.";
    case undefined:
      return "The refresh failed for an unknown reason.";
  }
}

/**
 * Default `aria-label` per (state, reason) pair. The labels are
 * terse so assistive tech announces the headline outcome first
 * without burying the user in sentence fragments.
 */
function defaultAriaLabel(
  state: OutcomeBannerState,
  reason: OutcomeBannerReason | undefined,
): string {
  if (state === "succeeded") {
    return "Refresh complete";
  }
  if (state === "cancelled") {
    return "Refresh cancelled";
  }
  switch (reason) {
    case "network_error":
      return "Refresh failed: network error";
    case "auth_failure":
      return "Refresh failed: token rejected";
    case "permission_failure":
      return "Refresh failed: insufficient permission";
    case "rate_limited":
      return "Refresh failed: rate limited";
    case "validation_error":
      return "Refresh failed: validation error";
    case undefined:
      return "Refresh failed";
  }
}
