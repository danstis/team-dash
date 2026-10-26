/**
 * BSOD-303 (T049) + BSOD-305 (T051) — `RefreshControls` + `RefreshButton`
 * + `ProgressIndicator` + `OutcomeBanner` (US2).
 *
 * Spec / contract references
 * --------------------------
 * Spec US2 acceptance scenario 4 (spec.md §"User Story 2"):
 *
 *   "Given the user is viewing the dashboard, When they choose Refresh,
 *    Then the dashboard shows progress, then on completion shows a
 *    success outcome with the last successful refresh timestamp, and
 *    indicates whether the currently displayed data is cached or fresh."
 *
 * And the FR-021 / FR-068 / FR-022 contract that flows from it:
 *
 *   - FR-020: "the system MUST provide a prominent, explicit manual
 *     Refresh action; the system MUST NOT perform scheduled or
 *     background refreshes without user action."
 *   - FR-021: "During a refresh, the system MUST show progress, and on
 *     completion MUST show the outcome (success, partial failure,
 *     cancellation, authentication failure, permission failure, or
 *     rate-limit failure) along with the last successful refresh
 *     timestamp and whether currently displayed data is cached or
 *     fresh."
 *   - FR-022: "A failed, cancelled, or incomplete refresh MUST NOT
 *     replace a previously complete cache with partial data; the last
 *     known-good complete cache MUST remain the data shown until a new
 *     refresh completes successfully." Pinned by routing every write
 *     through the `RefreshStagingRepository` so the orchestrator's
 *     `commit()`/`discard()` pair is the only path that moves staged
 *     rows into the live cache.
 *
 * Row ownership
 * -------------
 * - **T049 (BSOD-303)** owns the success path: the `RefreshButton`,
 *   the `ProgressIndicator`, the success / partial-failure rendering
 *   of `OutcomeBanner`, and the `<RefreshControls />` composition.
 * - **T051 (BSOD-305)** owns the failure-reason rendering: the
 *   per-reason copy for the four documented mid-refresh failure modes
 *   (network / auth / rate-limit / user-cancel) and the extraction of
 *   the refresh fetch/stage/commit logic into
 *   `src/data/refresh/refresh-orchestrator.ts`.
 * - **T050 (BSOD-304)** owns the cached-vs-fresh labelling
 *   (`FreshnessBanner`).
 * - **T058 (BSOD-309)** owns the FR-014 subtask → parent project
 *   inheritance in the task normaliser (which now lives in the
 *   orchestrator module).
 * - **T053 (BSOD-307)** owns the offline branch of the refresh
 *   action: while the browser is offline the control is rendered as
 *   the T050 `OfflineRefreshState` (visibly disabled, with the
 *   reason stated) instead of the plain `RefreshButton`.
 *
 * The two rows share this file, so the banner's prop surface is the
 * union of both families rather than a rename of one into the other:
 *
 * | Family | Props | Emitted attributes |
 * |--------|-------|--------------------|
 * | T049   | `kind`, `completedAt`, `errorDetail` | `data-outcome`, `data-completed-at` |
 * | T051   | `state`, `reason`, `itemsRetrieved`, `message`, `cacheIntact` | `data-outcome-state`, `data-outcome-reason`, `data-outcome-cache-intact` |
 *
 * Both families are optional on the props type; the banner resolves
 * them into one effective outcome (see `resolveOutcomeState` /
 * `resolveOutcomeReason`). A caller may pass either family, both, or
 * neither — the T049 direct-prop usage (`kind="success"`) and the
 * T051 orchestrator usage (`state="failed" reason="auth_failure"`)
 * are both first-class.
 *
 * What this module owns
 * ---------------------
 * - `<RefreshControls />` — the US2 composition. Renders the refresh
 *   button, the progress indicator, and the outcome banner; owns the
 *   in-component state machine (`'idle' | 'running' | 'success' |
 *   'partial_failure' | 'cancelled'`). **Drives the refresh through
 *   the `refreshOrchestrator` singleton** — the fetch / stage /
 *   commit / discard logic lives in
 *   `src/data/refresh/refresh-orchestrator.ts` since T051 (this
 *   module used to duplicate it inline; the duplication is gone).
 * - `<RefreshButton />` — the click-to-refresh button. Disabled while
 *   a refresh is in flight (`aria-busy="true"`) and while the
 *   preconditions (token, workspace) are not met.
 * - `<ProgressIndicator />` — the polite status region surfaced while
 *   a refresh is in flight, with the orchestrator's live
 *   `itemsRetrieved` counter (FR-021).
 * - `<OutcomeBanner />` — the outcome surface. Renders the success
 *   variant with the FR-021 completion timestamp, the per-reason
 *   failure variants, and the cancellation variant.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The refresh's fetch / stage / commit / discard logic, the
 *   pagination walk, the FR-024 incremental/full fallback, the
 *   failure classification, and the `RefreshSession` lifecycle. All
 *   of that lives in `src/data/refresh/refresh-orchestrator.ts`
 *   (T051).
 * - Cached-vs-fresh labelling: T050 (`FreshnessBanner`).
 * - Subtask project-membership resolution: T058 (BSOD-309) extends
 *   the task normaliser (in the orchestrator module) with
 *   parent→subtask project inheritance.
 * - The `WorkspaceProvider` / `CredentialsProvider` / route guard
 *   wiring: pre-existing (T031, T046). The component reads the
 *   current token via `useCredentialTokenAccessor()` and the current
 *   workspace via `useWorkspace()`; it never calls the providers'
 *   write-side actions itself.
 *
 * Determinism
 * -----------
 * The component is fully synchronous on first paint (no async init,
 * no IndexedDB read). The refresh is driven exclusively by user
 * action (the FR-020 explicit-action rule). The `completedAt` string
 * surfaced by `OutcomeBanner` is the `RefreshSession.finishedAt` the
 * orchestrator's atomic commit path wrote, which is a fresh
 * `new Date().toISOString()` per call — not a fixture-stable value —
 * so a future regression that surfaces a stale or pre-epoch
 * timestamp fails the integration test's recent-instant assertion.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The plaintext token is consumed via
 * `useCredentialTokenAccessor().getPlaintextToken()` inside the click
 * handler and is never echoed into a `data-*` attribute, a log line,
 * or a `data-completed-at` payload. Every failure detail the banner
 * renders is produced by the orchestrator, which scrubs the token out
 * of the message before it reaches the DOM or the `RefreshSession`
 * row — this module never renders a raw thrown error message.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is a feature component boundary the plan
 * documents as the home for the refresh-flow React UI. This module
 * imports from:
 *   - `../../app/credentials-context` — `useCredentialTokenAccessor()`
 *     the shell mounts. The component reads the current token via
 *     this accessor on every click rather than subscribing to it
 *     through a state-driven effect, so a token rotation between
 *     mount and click is observed correctly.
 *   - `../../app/workspace-context` — `useWorkspace()` for the
 *     currently selected workspace.
 *   - `../../data/refresh/refresh-orchestrator` — the orchestrator
 *     singleton and the `RefreshOutcome` union it returns.
 * It does NOT import from `src/domain/**` (the ESLint boundary
 * enforced by `eslint.config.js` rejects a domain import here) and
 * it does NOT mutate Dexie directly (Constitution Principle VI:
 * every storage side effect goes through a repository).
 *
 * It DOES import the T050 `OfflineRefreshState` from
 * `./FreshnessBanner` — the offline branch of the refresh action
 * reuses that component's copy instead of restating it, so the
 * disabled state and its explanation cannot drift apart from the
 * component the T050 contract test pins.
 */
import { useCallback, useState, type ReactElement } from "react";

import { useCredentialTokenAccessor } from "../../app/credentials-context";
import { useWorkspace } from "../../app/workspace-context";
import {
  refreshOrchestrator,
  type RefreshFailureReason,
  type RefreshOutcome as RefreshRunOutcome,
} from "../../data/refresh/refresh-orchestrator";
import { useOnlineStatus } from "../../shared/hooks/useOnlineStatus";
import { OfflineRefreshState } from "./FreshnessBanner";

/* -------------------------------------------------------------------------- */
/* Outcome surface                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The closed union of outcome variants `<OutcomeBanner />` renders,
 * as introduced by T049. The success variant and the generic
 * `partial_failure` variant are T049's; T051 widened the
 * *rendering* of the failure variant with per-reason copy and added
 * the `cancelled` variant (see `OutcomeBannerState`).
 */
export type RefreshOutcomeKind = "success" | "partial_failure";

/**
 * The T049 outcome shape `<OutcomeBanner />` consumes. `completedAt`
 * is the ISO string the commit path wrote on the matching
 * `RefreshSession` row; `errorDetail` is a short message the refresh
 * path surfaced for a partial failure.
 */
export interface RefreshOutcome {
  readonly kind: RefreshOutcomeKind;
  readonly completedAt: string | null;
  readonly errorDetail: string | null;
}

/**
 * The T051 outcome state `<OutcomeBanner />` consumes. `succeeded`
 * is the success terminal; `cancelled` is the user-cancel terminal
 * (FR-021 lists "cancellation" as its own outcome, distinct from
 * the failure modes); `failed` is the umbrella for the four
 * documented mid-refresh failure modes, discriminated by the
 * `reason` prop.
 */
export type OutcomeBannerState = "succeeded" | "cancelled" | "failed";

/**
 * The fine-grained failure reason behind a `'failed'` outcome. The
 * vocabulary is the orchestrator's `RefreshFailureReason` — one
 * literal per documented mid-refresh failure mode, so two different
 * failures never render the same reason.
 */
export type OutcomeBannerReason = RefreshFailureReason;

/**
 * The merged `<OutcomeBanner />` prop surface. Every field is
 * optional: the T049 family (`kind` / `completedAt` / `errorDetail`)
 * and the T051 family (`state` / `reason` / `itemsRetrieved` /
 * `message` / `cacheIntact`) describe the same outcome from two
 * angles, and a caller may supply either one.
 *
 * - `kind` — the coarse outcome (T049). Drives `data-outcome`.
 * - `completedAt` — the ISO completion timestamp (T049). Drives
 *   `data-completed-at` and the success copy.
 * - `errorDetail` — the generic failure detail (T049). Rendered
 *   verbatim when no `message` is supplied.
 * - `state` — the fine-grained outcome state (T051). Drives
 *   `data-outcome-state` and the per-reason copy.
 * - `reason` — the fine-grained failure reason (T051). Drives
 *   `data-outcome-reason` and the per-reason copy.
 * - `itemsRetrieved` — the orchestrator's live counter (T051).
 * - `message` — the failure detail (T051). Takes precedence over
 *   `errorDetail` when both are supplied.
 * - `cacheIntact` — whether the previously committed complete cache
 *   is still the data being displayed (T051). Drives
 *   `data-outcome-cache-intact`. Defaults to `true` for every
 *   non-success state (the FR-022 invariant) and `false` for the
 *   success state (the refresh replaced it).
 */
export interface OutcomeBannerProps {
  readonly kind?: RefreshOutcomeKind;
  readonly completedAt?: string | null;
  readonly errorDetail?: string | null;
  readonly state?: OutcomeBannerState;
  readonly reason?: OutcomeBannerReason;
  readonly itemsRetrieved?: number;
  readonly message?: string;
  readonly cacheIntact?: boolean;
  readonly "data-testid"?: string;
  readonly "aria-label"?: string;
  readonly className?: string;
}

/* -------------------------------------------------------------------------- */
/* Banner copy                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The generic partial-failure copy T049 pins. Rendered when the
 * banner has neither a failure detail nor a recognisable failure
 * reason — the user is told the refresh stopped and that their
 * previous good cache survived.
 */
const DEFAULT_PARTIAL_FAILURE_COPY =
  "The refresh stopped before the workspace was fully retrieved. Your previous good cache has been kept.";

/**
 * The per-reason copy for each documented mid-refresh failure mode.
 * Every reason has its OWN heading and body so the user can tell the
 * failure modes apart (FR-021 enumerates them as distinct outcomes)
 * and so the reason is legible without reading a data attribute.
 */
const FAILURE_REASON_COPY: Readonly<
  Record<
    OutcomeBannerReason,
    { readonly heading: string; readonly body: string }
  >
> = {
  network_error: {
    heading: "Refresh interrupted by a network error",
    body: "The connection to Asana failed. Try the refresh again when your network is stable.",
  },
  auth_failure: {
    heading: "Asana rejected the token",
    body: "The Asana token was rejected. Replace or re-enter the token to continue.",
  },
  permission_failure: {
    heading: "Asana permission required",
    body: "The Asana token does not have access to this resource. Check the token's scopes in Asana, then try the refresh again.",
  },
  rate_limited: {
    heading: "Asana rate limit reached",
    body: "Asana is rate-limiting this refresh. Wait a moment and then try the refresh again.",
  },
  validation_error: {
    heading: "Refresh could not be applied",
    body: "Asana returned data that does not match the expected shape. Try the refresh again; if it persists, report the issue with the response payload.",
  },
};

/**
 * The Asana outcome discriminants the orchestrator can report. The
 * banner uses the list to RECOGNISE a reason embedded in a failure
 * detail (the orchestrator's detail format is
 * `"Failed to fetch <scope>: <outcome>"`) so a caller that only
 * supplies the T049 family's `errorDetail` still gets a meaningful
 * `data-outcome-reason` — the two prop families describe the same
 * failure, and the reason must not depend on which one the caller
 * happened to use.
 */
const ASANA_OUTCOME_DISCRIMINANTS: readonly OutcomeBannerReason[] = [
  "network_error",
  "auth_failure",
  "permission_failure",
  "rate_limited",
  "validation_error",
];

/**
 * The reason string the banner reports when neither an explicit
 * `reason` nor a recognisable discriminant is available.
 */
const UNKNOWN_REASON = "unknown";

/* -------------------------------------------------------------------------- */
/* Outcome resolution                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the effective outcome state from the two prop families.
 * The T051 `state` wins when supplied; otherwise the T049 `kind`
 * maps onto it (`"success"` → `"succeeded"`, `"partial_failure"` →
 * `"failed"`).
 */
function resolveOutcomeState(
  kind: RefreshOutcomeKind | undefined,
  state: OutcomeBannerState | undefined,
): OutcomeBannerState {
  if (state !== undefined) {
    return state;
  }
  return kind === "success" ? "succeeded" : "failed";
}

/**
 * Recognise a failure reason embedded in a failure detail. The
 * orchestrator's detail format is
 * `"Failed to fetch <scope>: <outcome>"`; the match is anchored on
 * the trailing discriminant so a scope name that happens to contain
 * a discriminant-like word cannot produce a false positive.
 */
function deriveReasonFromDetail(
  detail: string | null | undefined,
): OutcomeBannerReason | null {
  if (detail === null || detail === undefined) {
    return null;
  }
  for (const discriminant of ASANA_OUTCOME_DISCRIMINANTS) {
    if (detail.endsWith(`: ${discriminant}`)) {
      return discriminant;
    }
  }
  return null;
}

/**
 * Resolve the effective failure reason. The explicit T051 `reason`
 * wins; otherwise the reason is derived from the failure detail; a
 * failure with neither reports `unknown` (the banner then falls back
 * to the generic T049 copy).
 */
function resolveOutcomeReason(
  reason: OutcomeBannerReason | undefined,
  detail: string | null | undefined,
  state: OutcomeBannerState,
): string {
  if (state !== "failed") {
    // The success and cancellation states are their own reason —
    // there is no failure to discriminate.
    return state;
  }
  if (reason !== undefined) {
    return reason;
  }
  return deriveReasonFromDetail(detail) ?? UNKNOWN_REASON;
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The FR-020 manual-refresh button. Disabled when a refresh is
 * already in flight, when the token accessor reports no plaintext
 * token (e.g. the user landed on a placeholder surface before
 * completing the first-run flow), or when the workspace context
 * has not reported a selection. `aria-busy="true"` is set while the
 * running state is in flight so assistive tech announces the busy
 * state alongside the visible label change.
 */
export interface RefreshButtonProps {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly busy: boolean;
}

export function RefreshButton({
  onClick,
  disabled,
  busy,
}: Readonly<RefreshButtonProps>): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="refresh-button"
      data-variant="primary"
      aria-busy={busy}
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

/**
 * How many staged rows pass between visible progress-counter
 * updates. A 25,000-task refresh would otherwise trigger 25,000
 * React renders, which is exactly the "freezing" outcome NFR-002
 * forbids ("continuous, non-freezing progress feedback"). The
 * counter advances in coarse steps during the run and the exact
 * final count is flushed when the refresh settles.
 */
const PROGRESS_UPDATE_EVERY_ITEMS = 25;

/**
 * The FR-021 progress surface. Decoupled from a spinner library per
 * the same reasoning the shared `<LoadingState />` primitive
 * documents (`src/shared/states/LoadingState.tsx`): a CSS-only
 * spinner can be added by the consuming feature without this
 * primitive taking a styling dependency. The copy is
 * self-sufficient — a screen-reader user hears the same
 * announcement whether or not the spinner is visible, so the
 * visual decoration is non-essential.
 *
 * `itemsRetrieved` is the orchestrator's live counter. It renders
 * in its own element (with its own `data-testid`) so the base
 * announcement text stays exactly as T049 pinned it.
 */
export interface ProgressIndicatorProps {
  readonly itemsRetrieved?: number;
}

export function ProgressIndicator({
  itemsRetrieved,
}: Readonly<ProgressIndicatorProps> = {}): ReactElement {
  return (
    <div
      data-testid="progress-indicator"
      data-view-state="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Refreshing"
    >
      Refreshing your workspace…
      {typeof itemsRetrieved === "number" ? (
        <span data-testid="progress-count">
          {itemsRetrieved} items retrieved
        </span>
      ) : null}
    </div>
  );
}

/**
 * The FR-021 outcome surface. The banner emits BOTH attribute
 * families so a test, a debug overlay, and an analytics pipeline can
 * each read the anchor that matches their concern:
 *
 * - `data-outcome` — the coarse outcome (`"success"` /
 *   `"partial_failure"`, T049's contract).
 * - `data-completed-at` — the ISO string the commit path wrote — a
 *   stable contract selector for a future contributor's regression
 *   test (e.g. "the surfaced timestamp is the same as the persisted
 *   `RefreshSession.finishedAt`").
 * - `data-outcome-state` — the fine-grained outcome state
 *   (`"succeeded"` / `"cancelled"` / `"failed"`, T051).
 * - `data-outcome-reason` — the fine-grained failure reason
 *   (T051). Distinct per failure mode, so two different failures
 *   never render the same reason.
 * - `data-outcome-cache-intact` — whether the previously committed
 *   complete cache is still the data being displayed (T051). The
 *   FR-022 invariant, made visible.
 */
export function OutcomeBanner({
  kind,
  completedAt,
  errorDetail,
  state,
  reason,
  itemsRetrieved,
  message,
  cacheIntact,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  className,
}: Readonly<OutcomeBannerProps>): ReactElement {
  const resolvedState = resolveOutcomeState(kind, state);
  const resolvedDetail = message ?? errorDetail ?? null;
  const resolvedReason = resolveOutcomeReason(
    reason,
    resolvedDetail,
    resolvedState,
  );
  const isFailure = resolvedState === "failed";
  const cacheIsIntact = cacheIntact ?? resolvedState !== "succeeded";
  const reasonCopy = failureReasonCopy(resolvedReason);
  const heading = resolveHeading(resolvedState, reasonCopy);
  const body = resolveBody(
    resolvedState,
    reasonCopy,
    resolvedDetail,
    completedAt ?? null,
    itemsRetrieved,
  );

  return (
    <section
      className={className ?? "td-outcome-banner"}
      data-testid={dataTestId ?? "outcome-banner"}
      data-outcome={
        resolvedState === "succeeded" ? "success" : "partial_failure"
      }
      data-completed-at={completedAt ?? ""}
      data-outcome-state={resolvedState}
      data-outcome-reason={resolvedReason}
      data-outcome-cache-intact={String(cacheIsIntact)}
      role={isFailure ? "alert" : "status"}
      aria-live={isFailure ? "assertive" : "polite"}
      aria-label={ariaLabel ?? heading}
    >
      <h2>{heading}</h2>
      {body.map((line, index) => (
        <p key={`${index}-${line}`}>{line}</p>
      ))}
      {cacheIsIntact && resolvedState !== "succeeded" ? (
        <p data-testid="cache-intact-notice">
          The previous good cache is still intact.
        </p>
      ) : null}
    </section>
  );
}

/**
 * The per-reason copy for a failure reason, or `null` when the reason
 * is not one of the documented failure modes (the banner then falls
 * back to the generic copy).
 */
function failureReasonCopy(
  reason: string,
): { readonly heading: string; readonly body: string } | null {
  if (reason in FAILURE_REASON_COPY) {
    return FAILURE_REASON_COPY[reason as OutcomeBannerReason];
  }
  return null;
}

/**
 * The banner's heading for an outcome state. The success and
 * cancellation states have their own headings; a failure uses its
 * reason-specific heading when it has one and the generic
 * "Partial refresh result" heading otherwise.
 */
function resolveHeading(
  state: OutcomeBannerState,
  reasonCopy: { readonly heading: string; readonly body: string } | null,
): string {
  switch (state) {
    case "succeeded":
      return "Refresh complete";
    case "cancelled":
      return "Refresh cancelled";
    case "failed":
      return reasonCopy?.heading ?? "Partial refresh result";
  }
}

/**
 * The banner's body lines for an outcome state, in reading order.
 *
 * - **Success** — the FR-021 completion statement plus the item count
 *   when the orchestrator reported one.
 * - **Cancellation** — what happened, in the user's terms.
 * - **Failure** — the reason-specific explanation (when the reason is
 *   a documented failure mode), the failure detail (when there is
 *   one), and the generic T049 copy when there is neither.
 */
function resolveBody(
  state: OutcomeBannerState,
  reasonCopy: { readonly heading: string; readonly body: string } | null,
  detail: string | null,
  completedAt: string | null,
  itemsRetrieved: number | undefined,
): string[] {
  if (state === "succeeded") {
    const lines = [
      completedAt === null
        ? "Your workspace data is up to date."
        : `Your workspace data is up to date as of ${completedAt}.`,
    ];
    if (typeof itemsRetrieved === "number") {
      lines.push(`${itemsRetrieved} items retrieved.`);
    }
    return lines;
  }

  if (state === "cancelled") {
    return ["The refresh was cancelled before it could complete."];
  }

  const lines: string[] = [];
  if (reasonCopy !== null) {
    lines.push(reasonCopy.body);
  }
  if (detail !== null) {
    lines.push(detail);
  }
  if (lines.length === 0) {
    lines.push(DEFAULT_PARTIAL_FAILURE_COPY);
  }
  return lines;
}

/**
 * Translate an orchestrator outcome into the banner's prop surface.
 * The mapping is the single source of truth for "what the banner
 * shows for this refresh result", so the feature component and the
 * integration tests derive their props the same way.
 */
export function propsFromOutcome(
  outcome: RefreshRunOutcome,
): OutcomeBannerProps {
  switch (outcome.status) {
    case "succeeded":
      return {
        kind: "success",
        state: "succeeded",
        completedAt: outcome.completedAt,
        itemsRetrieved: outcome.itemsRetrieved,
        cacheIntact: false,
      };
    case "cancelled":
      return {
        kind: "partial_failure",
        state: "cancelled",
        completedAt: null,
        message: outcome.message,
        itemsRetrieved: outcome.itemsRetrieved,
        cacheIntact: true,
      };
    case "failed":
      return {
        kind: "partial_failure",
        state: "failed",
        completedAt: null,
        reason: outcome.reason,
        message: outcome.message,
        itemsRetrieved: outcome.itemsRetrieved,
        cacheIntact: true,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Main composition                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The in-component refresh state machine. `'idle'` is the rest
 * state; `'running'` is set the moment the user clicks the button
 * and the Asana round-trips are in flight; `'success'` is set after
 * the orchestrator's atomic commit resolves the `RefreshSession` to
 * `'succeeded'`; `'partial_failure'` and `'cancelled'` are the two
 * non-success terminals the orchestrator reports.
 */
type RefreshState =
  "idle" | "running" | "success" | "partial_failure" | "cancelled";

/**
 * Props for the `<RefreshControls />` composition.
 */
export interface RefreshControlsProps {
  /**
   * Called with the commit timestamp after a refresh completes
   * successfully.
   *
   * BSOD-307 (T053) — the dashboard's refresh-status surface needs to
   * know that the data on screen is now FRESH (the `FreshnessBanner`
   * variant) rather than the cached copy it showed before the
   * refresh. The callback is how that surface learns about the
   * completed refresh without re-reading the session store; it is
   * optional so the existing T049 / T051 callers are unaffected.
   */
  readonly onRefreshCompleted?: (completedAt: string) => void;
}

/**
 * The US2 refresh surface. Reads the current token and workspace
 * from the shell's provider tree, drives a refresh through the
 * `refreshOrchestrator` on click, and surfaces the outcome through
 * the `<OutcomeBanner />`.
 *
 * The component does NOT fetch, stage, commit, or discard anything
 * itself — the orchestrator owns that whole path (T051), including
 * the FR-022 guarantee that a failed / cancelled / incomplete
 * refresh never replaces the live cache. The component's job is to
 * render the orchestrator's verdict honestly.
 */
export function RefreshControls({
  onRefreshCompleted,
}: Readonly<RefreshControlsProps> = {}): ReactElement {
  const tokenAccessor = useCredentialTokenAccessor();
  const workspace = useWorkspace();
  const [state, setState] = useState<RefreshState>("idle");
  const [banner, setBanner] = useState<OutcomeBannerProps | null>(null);
  const [itemsRetrieved, setItemsRetrieved] = useState(0);
  const isOnline = useOnlineStatus();

  const isRunning = state === "running";
  const preconditionsMet =
    tokenAccessor.getPlaintextToken() !== null && workspace.workspace !== null;
  const buttonDisabled = isRunning || !preconditionsMet;

  const handleProgress = useCallback((count: number): void => {
    if (count % PROGRESS_UPDATE_EVERY_ITEMS === 0) {
      setItemsRetrieved(count);
    }
  }, []);

  const runRefresh = useCallback(async (): Promise<void> => {
    if (isRunning) {
      return;
    }
    const currentToken = tokenAccessor.getPlaintextToken();
    const currentWorkspace = workspace.workspace;
    if (currentToken === null || currentWorkspace === null) {
      return;
    }

    setState("running");
    setBanner(null);
    setItemsRetrieved(0);

    try {
      const outcome = await refreshOrchestrator.runRefresh({
        workspaceGid: currentWorkspace.gid,
        token: currentToken,
        onProgress: handleProgress,
      });
      setItemsRetrieved(outcome.itemsRetrieved);
      setBanner(propsFromOutcome(outcome));
      switch (outcome.status) {
        case "succeeded":
          setState("success");
          onRefreshCompleted?.(outcome.completedAt);
          break;
        case "cancelled":
          setState("cancelled");
          break;
        case "failed":
          setState("partial_failure");
          break;
      }
    } catch {
      // The orchestrator converts every documented failure into an
      // outcome rather than throwing, so a throw here is an
      // orchestrator-level defect rather than a refresh failure mode.
      // The raw message is deliberately NOT surfaced: an unexpected
      // message could echo the personal access token (FR-008 /
      // FR-010). The generic copy names the outcome and states the
      // cache-intact invariant.
      setBanner({
        kind: "partial_failure",
        state: "failed",
        completedAt: null,
        reason: "network_error",
        message: DEFAULT_PARTIAL_FAILURE_COPY,
        cacheIntact: true,
      });
      setState("partial_failure");
    }
  }, [
    handleProgress,
    isRunning,
    onRefreshCompleted,
    tokenAccessor,
    workspace.workspace,
  ]);

  return (
    <section
      className="td-refresh-controls"
      data-testid="refresh-controls"
      aria-label="Refresh"
    >
      {isOnline ? (
        <RefreshButton
          onClick={() => {
            void runRefresh();
          }}
          disabled={buttonDisabled}
          busy={isRunning}
        />
      ) : (
        // BSOD-307 (T053) — FR-087: while the browser is offline the
        // refresh action must be visibly disabled and the reason must
        // be stated. The T050 `OfflineRefreshState` owns that copy, so
        // it is composed here rather than re-implemented; only one
        // Refresh control is rendered at a time.
        <OfflineRefreshState
          onRefresh={() => {
            void runRefresh();
          }}
        />
      )}
      {state === "running" && (
        <ProgressIndicator itemsRetrieved={itemsRetrieved} />
      )}
      {banner !== null ? <OutcomeBanner {...banner} /> : null}
    </section>
  );
}
