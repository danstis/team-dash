/**
 * BSOD-304 (T050) — `FreshnessBanner` + offline-disabled Refresh state.
 *
 * Spec / contract references
 * --------------------------
 * Spec FR-021 ("on completion MUST show the outcome … along with the
 * last successful refresh timestamp and whether currently displayed
 * data is cached or fresh") and FR-087 ("the cached dashboard and
 * locally stored snapshot history MUST be viewable while offline, and
 * the system MUST clearly state that refresh is unavailable
 * offline"). T050 ships the React components the dashboard chrome
 * composes around US2's reporting surface; the PWA service-worker
 * wiring that turns the offline branch into a real cache-served
 * surface is T053 (BSOD-307, `vite.config.ts`).
 *
 * What this module owns
 * ---------------------
 * - `<FreshnessBanner />` — the FR-021 cached-vs-fresh label with the
 *   `lastRefreshedAt` timestamp surfaced verbatim. The two variants
 *   are discriminated by the `isCached` prop; the DOM carries a
 *   `data-freshness` attribute that mirrors the value so an
 *   integration test (or an in-page inspection) can identify the
 *   variant without coupling to the inner copy.
 * - `<OfflineRefreshState />` — the FR-087 offline-disabled Refresh
 *   surface. Renders a Refresh button that is visibly disabled
 *   (`disabled` + `aria-disabled="true"`) while the browser is
 *   offline and exposes a clear explanation that refresh is
 *   unavailable offline. The component subscribes to
 *   `window.online` / `window.offline` events so the disabled state
 *   tracks the live `navigator.onLine` value across the component's
 *   lifetime (a reload, a network reconnection, a tab refocus).
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The PWA / service-worker offline cache: T053
 *   (`vite-plugin-pwa` in `vite.config.ts`). The component reads
 *   `navigator.onLine`; the actual cached HTML / asset response
 *   is the service worker's responsibility.
 * - The full refresh orchestrator: T051 (`src/data/refresh/
 *   refresh-orchestrator.ts`). The offline-disabled Refresh button
 *   here is the FR-087 entry point; the T051 orchestrator's manual
 *   refresh button is a peer surface the controls render in
 *   addition to this banner.
 * - The `RefreshButton` / `ProgressIndicator` / `OutcomeBanner`
 *   composition T049 (BSOD-303) ships in `RefreshControls.tsx`.
 *   The offline button is a deliberate sibling — the controls own
 *   the success/failure path, the banner owns the cached-vs-fresh
 *   and offline-disabled paths, and a future dashboard chrome
 *   mounts both in the appropriate region of the layout.
 *
 * Determinism
 * -----------
 * The components are fully synchronous on first paint (no async
 * init, no IndexedDB read, no network). The `OfflineRefreshState`
 * initial online state is read from `navigator.onLine` at mount
 * time and is updated by `window` events thereafter, so the test
 * (which overrides `navigator.onLine` and fires `online` / `offline`
 * events) can drive the state without a live network.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * Neither component logs, stores, or echoes the credential or
 * any other plaintext secret. The `lastRefreshedAt` prop is a
 * pre-formatted string the dashboard chrome composes from
 * `RefreshSession.finishedAt`; the component never parses the
 * value, so a future contributor who widens the prop signature
 * with a `Date` object cannot accidentally surface a token-bearing
 * ISO string through the banner.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the plan-documented home for the
 * refresh-flow React UI. This module imports from React only —
 * no `src/data/**` or `src/domain/**` dependencies, no Dexie
 * reads, no Asana calls. The `OfflineRefreshState` reads
 * `navigator.onLine` and `window` events directly; the eventual
 * PWA integration in T053 will mount the same component
 * unchanged.
 */
import { useEffect, useState, type ReactElement } from "react";

/* -------------------------------------------------------------------------- */
/* FreshnessBanner                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Props for the cached-vs-fresh banner. `lastRefreshedAt` is the
 * pre-formatted timestamp the banner surfaces verbatim (per FR-021:
 * "the last successful refresh timestamp"); `isCached` distinguishes
 * the cached variant from the fresh variant.
 */
export interface FreshnessBannerProps {
  /**
   * The pre-formatted `lastRefreshedAt` label. Surfaced verbatim
   * (and exposed via the `data-last-refreshed-at` attribute) so the
   * test / dashboard chrome can compare the surfaced value against
   * the `RefreshSession.finishedAt` ISO string without re-parsing.
   */
  readonly lastRefreshedAt: string;
  /**
   * `true` when the dashboard is rendering previously cached data
   * (i.e. the most recent refresh has not yet completed on this
   * surface); `false` when the dashboard is rendering the
   * most-recent successful refresh.
   */
  readonly isCached: boolean;
}

/**
 * The FR-021 cached-vs-fresh banner. Renders a polite status
 * region with the cached-or-fresh label and the last-refreshed
 * timestamp; copy follows Australian English conventions
 * (Constitution Principle VIII) and the "honest UX" rule
 * (Principle VII — never present cached data as current).
 *
 * The `data-freshness` attribute mirrors the `isCached` prop value
 * so an integration test (or an in-page inspection) can identify
 * the variant without coupling to the inner copy; a future
 * contributor who re-skins the surface without the `data-*`
 * attributes breaks the contract.
 */
export function FreshnessBanner({
  lastRefreshedAt,
  isCached,
}: Readonly<FreshnessBannerProps>): ReactElement {
  return (
    <section
      className="td-freshness-banner"
      data-testid="freshness-banner"
      data-freshness={isCached ? "cached" : "fresh"}
      data-last-refreshed-at={lastRefreshedAt}
      role="status"
      aria-live="polite"
      aria-label={isCached ? "Showing cached data" : "Showing fresh data"}
    >
      <h2>{isCached ? "Showing cached data" : "Showing fresh data"}</h2>
      <p>
        Last refreshed at{" "}
        <span data-testid="freshness-last-refreshed-at">{lastRefreshedAt}</span>
        .{" "}
        {isCached
          ? "This data may not reflect recent changes — run a refresh to update it."
          : "The dashboard is up to date with the latest refresh."}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* OfflineRefreshState                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Read the current online / offline state from the browser. The
 * helper exists so the test can override the value via
 * `Object.defineProperty(window.navigator, "onLine", …)` and the
 * `OfflineRefreshState` reads the same source the test
 * overrides — the offline branch's "is the browser offline?"
 * question is delegated to the platform, not to a synthetic
 * prop, so a reload or a network reconnection is reflected
 * without a state lift.
 */
function readNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine !== false;
}

/**
 * Props for the offline-disabled Refresh state. `onRefresh` is
 * the action the button triggers when the browser is online; the
 * component refuses to invoke it while offline (a `disabled`
 * button is the native guard, but the component layers a JS
 * guard so `fireEvent.click` cannot smuggle through).
 */
export interface OfflineRefreshStateProps {
  /**
   * The action the Refresh button triggers when online. The
   * component MUST NOT invoke this callback while the browser
   * is offline — a future caller that wires `onRefresh` to a
   * network call must not have the click leak through.
   */
  readonly onRefresh: () => void;
}

/**
 * The FR-087 offline-disabled Refresh state. Renders a Refresh
 * button that is visibly disabled while the browser is offline
 * (per FR-087: "the system MUST clearly state that refresh is
 * unavailable offline") and exposes the cached-dashboard-remains-
 * visible message so the user does not assume the surface is
 * broken.
 *
 * The component subscribes to `window.online` and `window.offline`
 * events so the disabled state tracks the live browser state
 * across the component's lifetime. The initial state is read
 * from `navigator.onLine` at mount; a reload is the test
 * harness's job, not the component's.
 */
export function OfflineRefreshState({
  onRefresh,
}: Readonly<OfflineRefreshStateProps>): ReactElement {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    readNavigatorOnline(),
  );

  useEffect(() => {
    const handleOnline = (): void => {
      setIsOnline(true);
    };
    const handleOffline = (): void => {
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleClick = (): void => {
    if (!isOnline) {
      return;
    }
    onRefresh();
  };

  return (
    <section
      className="td-offline-refresh-state"
      data-testid="offline-refresh-state"
      data-online={isOnline ? "true" : "false"}
      role="status"
      aria-live="polite"
      aria-label="Refresh"
    >
      <button
        type="button"
        data-testid="offline-refresh-button"
        className="td-offline-refresh-button"
        disabled={!isOnline}
        aria-disabled={!isOnline}
        onClick={handleClick}
      >
        Refresh
      </button>
      {!isOnline && (
        <p
          className="td-offline-refresh-explanation"
          data-testid="offline-explanation"
        >
          Refresh is unavailable while you&apos;re offline. Your last cached
          dashboard remains available below.
        </p>
      )}
    </section>
  );
}
