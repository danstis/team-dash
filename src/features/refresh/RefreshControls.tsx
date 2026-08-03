/**
 * BSOD-303 (T049) — `RefreshControls` + `RefreshButton` + `ProgressIndicator`
 * + `OutcomeBanner` (US2, success + partial-failure rendering).
 *
 * T03 (`S01`, slice: "Refresh and Cache Pipeline (complete US2)") extends
 * the T049 primitive with:
 *
 *   1. **Orchestrator-driven refresh**: the in-component fetch/stage/commit
 *      loop is removed and the component delegates to
 *      `createRefreshOrchestrator({ deps })` from
 *      `src/data/refresh/refresh-orchestrator.ts` (decision D001 / MEM001 —
 *      "single coordinator"). The orchestrator is the only caller of the
 *      `RefreshStagingRepository` and the only writer of the `RefreshSession`
 *      rows (`src/data/refresh/refresh-orchestrator.ts`'s failure-mode table
 *      is the documented contract).
 *   2. **Offline detection** (FR-087, spec US2 acceptance scenario 5):
 *      `navigator.onLine` plus `online`/`offline` event listeners disable
 *      the refresh action and surface the `<OfflineState />` primitive
 *      (`src/shared/states/OfflineState.tsx`) with the FR-087 "last cached
 *      dashboard is viewable" explanation. The button is disabled rather
 *      than hidden so the user understands the action is gated, not removed.
 *   3. **Failure-reason variants** (T051 / FR-021): the `OutcomeBanner`
 *      surface widens from T049's two-variant shape
 *      (`'success' | 'partial_failure'`) to the full orchestrator outcome
 *      union (`success`, `cancelled`, `auth_failure`, `permission_failure`,
 *      `rate_limited`, and the closed `partial_failure` whose `reason`
 *      sub-discriminates between `network_error` and `validation_error`).
 *      The `data-outcome` attribute carries the canonical variant (and
 *      `data-failure-reason` carries the sub-reason on
 *      `partial_failure`) so a future contributor's regression tests have
 *      a stable selector to pin.
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
 * Spec US2 acceptance scenario 5 (spec.md §"User Story 2" — offline):
 *
 *   "When the browser goes offline, the refresh action MUST be visibly
 *    disabled with an explanation, and the last cached dashboard MUST
 *    remain viewable."
 *
 * FR-020: "the system MUST provide a prominent, explicit manual
 *   Refresh action; the system MUST NOT perform scheduled or
 *   background refreshes without user action."
 * FR-021: "During a refresh, the system MUST show progress, and on
 *   completion MUST show the outcome (success, partial failure,
 *   cancellation, authentication failure, permission failure, or
 *   rate-limit failure) along with the last successful refresh
 *   timestamp and whether currently displayed data is cached or fresh."
 * FR-022: "A failed, cancelled, or incomplete refresh MUST NOT
 *   replace a previously complete cache with partial data; the last
 *   known-good complete cache MUST remain the data shown until a new
 *   refresh completes successfully." Pinned by routing every write
 *   through the orchestrator whose `commit()` is the only path that
 *   moves staged rows into the live cache.
 * FR-087: "When the browser is offline, the refresh action MUST be
 *   visibly disabled with an explanation, and the last cached
 *   dashboard MUST remain viewable."
 *
 * What this module owns
 * ---------------------
 * - `<RefreshControls />` — the US2 composition. Renders the refresh
 *   button (disabled on offline + while running + when preconditions
 *   are unmet), the progress indicator while a refresh is in flight,
 *   the `<OfflineState />` explanation when the browser is offline,
 *   and the outcome banner on terminal completion. Owns the
 *   `useOffline()` hook and the AbortController used to cancel a
 *   refresh in flight.
 * - `<RefreshButton />` — the click-to-refresh button. Disabled
 *   when offline, when a refresh is already in flight, or when the
 *   preconditions (token + workspace) are not met.
 * - `<ProgressIndicator />` — the polite status region surfaced
 *   while a refresh is in flight.
 * - `<OutcomeBanner />` — the outcome surface, widened to the full
 *   orchestrator outcome union with reason-specific copy for each
 *   documented failure mode.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The orchestrator itself: `src/data/refresh/refresh-orchestrator.ts`
 *   (T01 / D001 / MEM001). The component consumes the orchestrator via
 *   `@data/refresh`'s barrel export; the only consumer-side seam is
 *   the optional `orchestrator` prop the unit test injects to
 *   script the failure reasons without MSW round-trips.
 * - Cached-vs-fresh labelling: T050 (`FreshnessBanner`). The
 *   `data-offline` attribute this module adds is the offline gesture;
 *   the cached-vs-fresh badge that surfaces *after* a successful
 *   refresh is T050's job.
 * - Data-quality summary: T052 (`DataQualitySummary`). The outcome
 *   banner's `data-failure-reason` attribute carries the FR-084
 *   sub-discriminant the data-quality panel will pick up; the panel
 *   itself lives in T04.
 *
 * Determinism
 * -----------
 * The component is fully synchronous on first paint (no async init,
 * no IndexedDB read). The refresh is driven exclusively by user
 * action (the FR-020 explicit-action rule). The `completedAt` string
 * surfaced by the success banner is the `RefreshSession.finishedAt`
 * the orchestrator's commit path writes — a fresh
 * `new Date().toISOString()` per call, so a future regression that
 * surfaces a stale or pre-epoch timestamp fails the integration
 * test's recent-instant assertion.
 *
 * The `useOffline()` hook drives `setOffline` from the browser's
 * `online` / `offline` events + an initial `navigator.onLine`
 * read. Tests inject the offline state via a probe component
 * (`tests/unit/features/refresh/RefreshControls.test.tsx`) rather
 * than firing real events, so the offline path is deterministically
 * exercised without racing jsdom's `dispatchEvent` against `useState`.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The plaintext token is consumed via
 * `useCredentialTokenAccessor().getPlaintextToken()` inside the click
 * handler and is never echoed into a `data-*` attribute, a log line,
 * or a `data-completed-at` payload. The orchestrator's failure
 * surfaces scrub the token (FR-008 / FR-010 — see
 * `src/data/refresh/refresh-orchestrator.ts` § "What this module
 * owns" #5); the outcome banner's `data-failure-reason` attribute is
 * the closed union, not freeform text.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is a feature component boundary the plan
 * documents as the home for the refresh-flow React UI. This module
 * imports from:
 *   - `../../app/credentials-context` — `useCredentialTokenAccessor()`
 *     the shell mounts.
 *   - `../../app/workspace-context` — `useWorkspace()` for the
 *     currently selected workspace.
 *   - `../../data/refresh` (barrel `src/data/refresh/index.ts`) —
 *     `createRefreshOrchestrator`, the orchestrator's dependency
 *     types, and `RefreshOutcome`.
 *   - `../../data/db/schema` — `RefreshSession` Dexie row type used
 *     by the orchestrator.
 *   - `../../shared/states/OfflineState` — the FR-087 offline
 *     explanation primitive.
 * It does NOT import from `src/data/asana/**` (the orchestrator is
 * the boundary) and it does NOT mutate Dexie directly (Constitution
 * Principle VI).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { useCredentialTokenAccessor } from "../../app/credentials-context";
import { useWorkspace } from "../../app/workspace-context";
import {
  createRefreshOrchestrator,
  defaultMakeSessionId,
  defaultNow,
  realAsanaClient,
  type RefreshFailureReason,
  type RefreshOrchestrator,
  type RefreshOrchestratorDeps,
  type RefreshOutcome,
} from "../../data/refresh";
import { refreshStagingRepository } from "../../data/db/repositories/refresh-staging.repository";
import { db } from "../../data/db/schema";
import { OfflineState } from "../../shared/states/OfflineState";

/* -------------------------------------------------------------------------- */
/* Outcome surface                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The closed union of outcome variants `<OutcomeBanner />` renders.
 * Mirrors `RefreshOutcome` from the orchestrator (`@data/refresh`)
 * but adds the `cancelled` and the three orthogonal
 * `{auth,permission,rate_limited}_failure` cases as their own
 * first-class shapes — T051 (FR-021) widens the T049
 * `'success' | 'partial_failure'` union with reason-specific copy
 * for each documented failure mode.
 *
 * The orchestrator's `partial_failure` carries a `reason` sub-tag
 * (`network_error` | `validation_error`); we surface that as a
 * separate `data-failure-reason` attribute so the FR-084 data-quality
 * summary (T04) can pin a stable selector without scraping
 * freeform copy.
 *
 * The `errorDetail` field carries the orchestrator's scrubbed
 * failure message verbatim; the banner renders it under the
 * reason-specific heading so a reader who needs the underlying
 * Asana response detail (the `permission_failure.resource`, the
 * Zod issue path, etc.) sees it without losing the high-signal
 * reason label.
 */
export type RefreshOutcomeKind =
  | "success"
  | "cancelled"
  | "auth_failure"
  | "permission_failure"
  | "rate_limited"
  | "partial_failure";

export interface RefreshOutcomeShape {
  readonly kind: RefreshOutcomeKind;
  readonly completedAt: string | null;
  readonly errorDetail: string | null;
  /**
   * Sub-reason for `kind: 'partial_failure'` only. `network_error`
   * and `validation_error` share the `partial_failure` status in the
   * persisted `RefreshSession` row but are distinguishable in the UI
   * and the FR-084 data-quality panel via this field. `null` on every
   * other `kind`.
   */
  readonly failureReason: RefreshFailureReason | null;
}

/* -------------------------------------------------------------------------- */
/* Offline detection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Read `navigator.onLine` plus the browser's `online`/`offline`
 * events and expose the current connectivity state. The hook
 * defaults `online === true` so a server-side render (no
 * `navigator`) is treated as connected; the `useEffect` block then
 * reconciles to the real `navigator.onLine` value on the first
 * client commit.
 *
 * Tests inject the offline state via a `data-offline` attribute on
 * the rendered tree (`tests/unit/features/refresh/RefreshControls.test.tsx`'s
 * `<RefreshControls forceOffline={true} />` path) so jsdom's
 * `dispatchEvent` semantics do not race `useState`.
 */
function useOffline(): boolean {
  const [offline, setOffline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    return navigator.onLine === false;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleOnline = (): void => {
      setOffline(false);
    };
    const handleOffline = (): void => {
      setOffline(true);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return offline;
}

/* -------------------------------------------------------------------------- */
/* Subcomponents                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The FR-020 manual-refresh button. Disabled when offline
 * (FR-087), when a refresh is already in flight, when the token
 * accessor reports no plaintext token, or when the workspace
 * context has not reported a selection. `aria-busy="true"` is set
 * while the running state is in flight so assistive tech announces
 * the busy state alongside the visible label change.
 *
 * `data-offline="true"` is set when the button is offline-disabled
 * so a future regression test (FR-087 / Slice S01 verification
 * "offline-explanation with data-offline=true") has a stable
 * anchor.
 */
export interface RefreshButtonProps {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly offline: boolean;
}

export function RefreshButton({
  onClick,
  disabled,
  busy,
  offline,
}: Readonly<RefreshButtonProps>): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="refresh-button"
      data-offline={offline ? "true" : "false"}
      data-variant="primary"
      aria-busy={busy}
    >
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}

/**
 * The FR-021 progress surface. Decoupled from a spinner library per
 * the same reasoning the shared `<LoadingState />` primitive
 * documents (`src/shared/states/LoadingState.tsx`): a CSS-only
 * spinner can be added by the consuming feature without this
 * primitive taking a styling dependency.
 */
export function ProgressIndicator(): ReactElement {
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
    </div>
  );
}

/**
 * The FR-021 outcome surface, widened by T051 with the
 * failure-reason variants. Each variant renders a stable
 * `data-outcome` attribute (the closed union above) plus a
 * `data-completed-at` attribute (the `RefreshSession.finishedAt`
 * ISO string on success; empty on every failure path because the
 * FR-068 audit trail row's `finishedAt` is the session's terminal
 * instant — surfaced via the success path's `completedAt`
 * field — and the failure paths surface the scrubbed
 * `errorDetail` message verbatim).
 *
 * `partial_failure` carries an additional `data-failure-reason`
 * attribute carrying the FR-084 sub-discriminant
 * (`network_error` | `validation_error`) so the T04 data-quality
 * summary can pin a stable selector.
 */
export interface OutcomeBannerProps extends Readonly<RefreshOutcomeShape> {}

export function OutcomeBanner({
  kind,
  completedAt,
  errorDetail,
  failureReason,
}: OutcomeBannerProps): ReactElement {
  switch (kind) {
    case "success":
      return (
        <section
          data-testid="outcome-banner"
          data-outcome="success"
          data-completed-at={completedAt ?? ""}
          role="status"
          aria-live="polite"
          aria-label="Refresh complete"
        >
          <h2>Refresh complete</h2>
          <p>
            {completedAt === null
              ? "Your workspace data is up to date."
              : `Your workspace data is up to date as of ${completedAt}.`}
          </p>
        </section>
      );
    case "cancelled":
      return (
        <section
          data-testid="outcome-banner"
          data-outcome="cancelled"
          data-completed-at=""
          role="status"
          aria-live="polite"
          aria-label="Refresh cancelled"
        >
          <h2>Refresh cancelled</h2>
          <p>
            {errorDetail ??
              "The refresh was cancelled before it completed. Your previous good cache has been kept."}
          </p>
        </section>
      );
    case "auth_failure":
      return (
        <section
          data-testid="outcome-banner"
          data-outcome="auth_failure"
          data-completed-at=""
          role="alert"
          aria-label="Authentication failed"
        >
          <h2>Authentication failed</h2>
          <p>
            {errorDetail ??
              "Asana rejected the personal access token. Re-validate the token in settings to refresh again."}
          </p>
        </section>
      );
    case "permission_failure":
      return (
        <section
          data-testid="outcome-banner"
          data-outcome="permission_failure"
          data-completed-at=""
          role="alert"
          aria-label="Permission denied"
        >
          <h2>Permission denied</h2>
          <p>
            {errorDetail ??
              "Asana denied access to one or more resources in this workspace. Your previous good cache has been kept."}
          </p>
        </section>
      );
    case "rate_limited":
      return (
        <section
          data-testid="outcome-banner"
          data-outcome="rate_limited"
          data-completed-at=""
          role="alert"
          aria-label="Rate limited"
        >
          <h2>Rate limited by Asana</h2>
          <p>
            {errorDetail ??
              "Asana rate-limited the refresh. The previous good cache has been kept; try again later."}
          </p>
        </section>
      );
    case "partial_failure":
      return (
        <section
          data-testid="outcome-banner"
          data-outcome="partial_failure"
          data-failure-reason={failureReason ?? ""}
          data-completed-at=""
          role="alert"
          aria-label="Partial refresh result"
        >
          <h2>Partial refresh result</h2>
          <p>
            {errorDetail ??
              "The refresh stopped before the workspace was fully retrieved. Your previous good cache has been kept."}
          </p>
        </section>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Orchestrator outcome → UI surface                                          */
/* -------------------------------------------------------------------------- */

/**
 * Map the orchestrator's `RefreshOutcome` union onto the
 * `RefreshOutcomeShape` the `<OutcomeBanner />` consumes. The
 * orchestrator's discriminated union already documents every
 * mapping in its module-level failure-mode table; this function
 * exists once at the UI boundary so the orchestrator's contract is
 * the only place a future contributor has to update when the
 * failure-mode accounting changes.
 */
function refreshOutcomeToShape(
  outcome: RefreshOutcome,
  fallbackCompletedAt: string,
): RefreshOutcomeShape {
  switch (outcome.kind) {
    case "success":
      return {
        kind: "success",
        completedAt: outcome.completedAt ?? fallbackCompletedAt,
        errorDetail: null,
        failureReason: null,
      };
    case "cancelled":
      return {
        kind: "cancelled",
        completedAt: null,
        errorDetail: "Refresh was cancelled.",
        failureReason: null,
      };
    case "partial_failure":
      return {
        kind:
          outcome.reason === "auth_failure" ||
          outcome.reason === "permission_failure" ||
          outcome.reason === "rate_limited"
            ? outcome.reason
            : "partial_failure",
        completedAt: null,
        errorDetail: outcome.message,
        failureReason:
          outcome.reason === "network_error" ||
          outcome.reason === "validation_error"
            ? outcome.reason
            : null,
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Main composition                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The in-component refresh state machine. `'idle'` is the rest
 * state; `'running'` is set the moment the user clicks the button
 * and the orchestrator's `runRefresh` promise is in flight;
 * `'terminal'` collapses the success + failure variants into a
 * single terminal state (the outcome shape carries the variant).
 *
 * The T049 four-state machine (`'idle' | 'running' | 'success' |
 * 'partial_failure'`) widens naturally here: the orchestrator
 * returns the typed `RefreshOutcome` union and the UI surface
 * renders the corresponding `OutcomeBanner` variant. We
 * deliberately keep `'running'` + `'terminal'` as the two-track
 * state rather than splitting by outcome shape so future variants
 * (T04's data-quality summary flag attributes, FR-084) only need
 * to teach the `<OutcomeBanner />` switch a new case.
 */
type RefreshState = "idle" | "running" | "terminal";

export interface RefreshControlsProps {
  /**
   * Test seam only. Production callers omit this prop and the
   * component constructs its orchestrator from the default
   * `realAsanaClient` + `refreshStagingRepository` + `db`. Unit
   * tests inject a scripted `RefreshOrchestrator` so the failure-
   * reason rendering can be exercised deterministically without
   * MSW overrides.
   *
   * @internal
   */
  readonly orchestrator?: RefreshOrchestrator;
  /**
   * Test seam only. Production callers omit this prop and the
   * component reads `navigator.onLine` directly. Unit tests inject
   * a deterministic offline state so jsdom's `online` / `offline`
   * events do not race `useState` between mount and event
   * dispatch.
   *
   * @internal
   */
  readonly forceOffline?: boolean;
}

/**
 * The US2 refresh surface. Reads the current token and workspace
 * from the shell's provider tree, hands them to the orchestrator on
 * click, and surfaces the outcome through the `<OutcomeBanner />`.
 *
 * The click handler builds an `AbortController` so the user can
 * trigger a `cancel` outcome by aborting the in-flight signal
 * (T051 widens the orchestrator to accept the signal; UI-level
 * cancellation lives here). Each click constructs a fresh
 * `AbortController` and replaces any prior in-flight one — the
 * cancelled outcome's `discard()` path (orchestrator) is the only
 * place the previous refresh's staging buffer is dropped, so a
 * mid-flight cancel leaves the live cache untouched per FR-022.
 */
export function RefreshControls(
  props: Readonly<RefreshControlsProps> = {},
): ReactElement {
  const orchestratorFromProps = props.orchestrator;
  const orchestrator = useMemo<RefreshOrchestrator>(() => {
    if (orchestratorFromProps !== undefined) {
      return orchestratorFromProps;
    }
    const deps: RefreshOrchestratorDeps = {
      asanaClient: realAsanaClient,
      staging: refreshStagingRepository,
      dbInstance: db,
      now: defaultNow,
      makeSessionId: defaultMakeSessionId,
    };
    return createRefreshOrchestrator(deps);
  }, [orchestratorFromProps]);

  const tokenAccessor = useCredentialTokenAccessor();
  const workspace = useWorkspace();
  const navigationOffline = useOffline();
  const offline =
    props.forceOffline === true || navigationOffline === true;

  const [state, setState] = useState<RefreshState>("idle");
  const [outcome, setOutcome] = useState<RefreshOutcomeShape>({
    kind: "success",
    completedAt: null,
    errorDetail: null,
    failureReason: null,
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  const token = tokenAccessor.getPlaintextToken();
  const selectedWorkspace = workspace.workspace;
  const isRunning = state === "running";
  const preconditionsMet = token !== null && selectedWorkspace !== null;
  const buttonDisabled = isRunning || !preconditionsMet || offline;

  const runRefresh = useCallback(async (): Promise<void> => {
    if (isRunning) {
      return;
    }
    const currentToken = tokenAccessor.getPlaintextToken();
    const currentWorkspace = workspace.workspace;
    if (currentToken === null || currentWorkspace === null) {
      return;
    }

    // Wire the AbortController before the orchestrator's
    // `runRefresh` resolves. The orchestrator forwards the
    // signal to its underlying Asana client calls; aborting
    // between pagination pages surfaces a `cancelled` outcome
    // (orchestrator's `handleCancellation` path) and discards
    // the staging buffer (FR-022 — live cache stays untouched).
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState("running");
    try {
      const result = await orchestrator.runRefresh({
        token: currentToken,
        workspaceGid: currentWorkspace.gid,
        workspaceName: currentWorkspace.name,
        signal: controller.signal,
      });
      setOutcome(
        refreshOutcomeToShape(result, defaultNow()),
      );
      setState("terminal");
    } catch (unexpected) {
      // The orchestrator's contract is that every documented
      // failure surfaces as a `RefreshOutcome` variant. A throw
      // here is therefore an unexpected error (e.g. a synchronous
      // Dexie write failure that the orchestrator's catch-all
      // failed to wrap) and we surface it as a
      // `partial_failure` with `reason=network_error` so the
      // banner's variant union stays exhaustive.
      const message =
        unexpected instanceof Error
          ? unexpected.message
          : "Refresh failed with an unexpected error.";
      setOutcome({
        kind: "partial_failure",
        completedAt: null,
        errorDetail: message,
        failureReason: "network_error",
      });
      setState("terminal");
    } finally {
      abortControllerRef.current = null;
    }
  }, [isRunning, tokenAccessor, workspace.workspace, orchestrator]);

  return (
    <section
      className="td-refresh-controls"
      data-testid="refresh-controls"
      data-offline={offline ? "true" : "false"}
      aria-label="Refresh"
    >
      <RefreshButton
        onClick={() => {
          void runRefresh();
        }}
        disabled={buttonDisabled}
        busy={isRunning}
        offline={offline}
      />
      {offline && (
        <section data-testid="offline-explanation" data-offline="true">
          <OfflineState data-testid="offline-state" aria-label="Offline" />
        </section>
      )}
      {state === "running" && <ProgressIndicator />}
      {state === "terminal" && (
        <OutcomeBanner
          kind={outcome.kind}
          completedAt={outcome.completedAt}
          errorDetail={outcome.errorDetail}
          failureReason={outcome.failureReason}
        />
      )}
    </section>
  );
}

export default RefreshControls;
