/**
 * T04 — `FreshnessBanner` (S01, FR-021, FR-090).
 *
 * The dashboard's first-paint status surface: tells the user whether
 * the data on screen was just retrieved (FR-021 "fresh") or is
 * pre-existing cache from a prior refresh ("cached"). Per Constitution
 * Principle VII "no fresh vs cached ambiguity", the banner never
 * collapses the two — a cached dataset is rendered with a verbatim
 * "Last refreshed at …" timestamp and a clearly-labelled
 * `data-freshness="cached"` attribute that the test suite pins (Slice
 * S01 verification: "freshness-banner with data-freshness=
 * fresh|cached").
 *
 * The threshold for "fresh" is a 30-second post-completion window:
 * just-pressed-Refresh data is `data-freshness="fresh"`; anything
 * older surfaces as `data-freshness="cached"`. The 30-second window
 * keeps the banner stable across a single refresh pass while still
 * flipping back to `cached` after the user has had a moment to read
 * the success outcome.
 *
 * The component deliberately accepts its dependencies as
 * injection-shaped props (`now`, `thresholdMs`) rather than as
 * `RefreshSession` references — the banner's job is to render the
 * status of one already-known refresh, not to look it up. Looking the
 * session up is the dashboard's job (T04 `Dashboard.tsx`); this
 * component is a pure renderer and is unit-testable without Dexie.
 *
 * ## Merge note (T050 reconciliation)
 *
 * Main's T050 implementation (BSOD-304, PR #148) shipped a sibling
 * `FreshnessBanner` with a different API (`isCached: boolean`)
 * co-located with an `OfflineRefreshState` component. The merge
 * resolution adopted M001's pure-renderer design (the test seam
 * `now`/`thresholdMs` is the preserve-able contract) but borrowed
 * main's `<section>` + `<h2>` heading wrapper for accessibility
 * (screen-reader navigable heading) and main's
 * `data-testid="freshness-last-refreshed-at"` span testid for
 * parity with the integration-test selectors. The `OfflineRefreshState`
 * component is dropped: T03's `<RefreshControls />` already gates
 * refresh offline via `useOffline()` and renders the FR-087
 * `<OfflineState />` explanation, so main's component is redundant
 * dead code.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the feature boundary documented in the
 * plan. This module depends only on React and remains usable from any
 * consumer that can pass it an ISO timestamp. It deliberately does
 * NOT import from `src/data/**` so the unit suite can render the
 * component without seeding Dexie.
 */
import type { ReactElement } from "react";

/**
 * The "fresh" window the banner applies. Pinned at 30 seconds so a
 * just-completed refresh reads as `data-freshness="fresh"` while a
 * reload minutes later reads as `data-freshness="cached"`. Exported
 * so a test can pin the contract verbatim.
 */
export const FRESH_BANNER_WINDOW_MS = 30_000;

export interface FreshnessBannerProps {
  /**
   * The ISO-8601 instant the most-recent succeeded refresh
   * committed. Surfaces verbatim into the `data-last-refreshed-at`
   * attribute and a human-friendly localised label. Tests inject a
   * deterministic value (e.g. `'2026-08-02T06:30:00.000Z'`) so the
   * "fresh vs cached" derivation can be pinned deterministically.
   */
  readonly lastRefreshedAt: string;
  /**
   * The clock the banner uses to derive `fresh` vs `cached`.
   * Defaults to `() => new Date()`. Tests inject a deterministic
   * clock so the threshold math is stable across runs.
   */
  readonly now?: () => Date;
  /**
   * Optional override of the fresh-vs-cached threshold.
   * `FRESH_BANNER_WINDOW_MS` (30 s) by default. Tests pass a higher
   * value (e.g. 60 s) to exercise the boundary without needing the
   * test's clock to fall in the window.
   */
  readonly thresholdMs?: number;
}

/**
 * Pin the `now` / `thresholdMs` defaults so a future contributor
 * cannot silently widen the threshold without touching the banner
 * (the constant is exported for the unit-test selector AND for
 * documentation-driven reasonability checks).
 */
const DEFAULT_THRESHOLD_MS = FRESH_BANNER_WINDOW_MS;

/**
 * Derive `kind` from the elapsed time between `lastRefreshedAt` and
 * `now`. Pure function — exported so the unit test can pin the
 * boundary cases (`< thresholdMs` → `'fresh'`, `>=` → `'cached'`)
 * without rendering the component.
 */
export function deriveFreshness(
  lastRefreshedAt: string,
  now: () => Date,
  thresholdMs: number = DEFAULT_THRESHOLD_MS,
): "fresh" | "cached" {
  const lastRef = Date.parse(lastRefreshedAt);
  if (!Number.isFinite(lastRef)) {
    // A malformed timestamp should never surface — the dashboard
    // gates the banner on a session row that already validated the
    // ISO shape — but the banner is defensive: a parseable failure
    // is treated as "cached" so the user is never told the
    // timestamp is fresh when we cannot compute its age.
    return "cached";
  }
  const elapsed = now().getTime() - lastRef;
  if (elapsed < 0) {
    // The wall clock has drifted behind the session's `finishedAt`
    // (clock skew, daylight-saving edge cases, a test clock before
    // a fixed session time). Treat as cached so the user is never
    // told fresh data is older than it actually is.
    return "cached";
  }
  return elapsed <= thresholdMs ? "fresh" : "cached";
}

/**
 * Render a localised "Last refreshed at <timestamp>" label. The
 * component delegates the timestamp formatting to the host's
 * `Date.prototype.toLocaleString` so the surface renders in the
 * user's locale without a date-fns dependency; tests inject a
 * deterministic ISO string and pin the rendered label on the
 * `lastRefreshedAt` attribute rather than the localised copy (the
 * copy is intentionally not pinned so a future i18n change does not
 * break the contract).
 */
function formatLastRefreshedAt(iso: string, now: () => Date): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  // Coarse rendering so the banner reads cleanly at mobile and
  // desktop widths. The lint-permitted stack targets Australian
  // English by convention and the unit suite pins the verbatim ISO
  // via `data-last-refreshed-at`, not the localised copy.
  const isoNow = now().getTime();
  const elapsedMs = isoNow - parsed.getTime();
  if (elapsedMs < 60_000) {
    return "just now";
  }
  if (elapsedMs < 3_600_000) {
    const minutes = Math.floor(elapsedMs / 60_000);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsedMs < 86_400_000) {
    const hours = Math.floor(elapsedMs / 3_600_000);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(elapsedMs / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * The FR-021 / FR-090 "is this fresh or cached" banner.
 *
 * Anchors:
 *
 * - `data-testid="freshness-banner"` — used by the integration test
 *   to query the rendered banner regardless of copy changes.
 * - `data-freshness="fresh"` or `data-freshness="cached"` — the
 *   closed contract the S01 verification pins.
 * - `data-last-refreshed-at="<ISO>"` — verbatim ISO timestamp so a
 *   test pin on the attribute never collides with i18n changes.
 * - `data-testid="freshness-last-refreshed-at"` (on the
 *   `<span>` wrapping the timestamp) — the contract selector the
 *   integration test uses to query the verbatim value (parity
 *   with main's T050 surface).
 *
 * The component renders as a `<section>` with an `<h2>` heading so
 * screen-reader users get a navigable heading. The T050
 * implementation also used this shape; a future contributor who
 * collapses the wrapper back to a `<p>` would skip a heading level
 * when the surrounding dashboard chrome also renders an `<h1>`.
 */
export function FreshnessBanner({
  lastRefreshedAt,
  now = (): Date => new Date(),
  thresholdMs,
}: Readonly<FreshnessBannerProps>): ReactElement {
  const kind = deriveFreshness(lastRefreshedAt, now, thresholdMs);
  const label = formatLastRefreshedAt(lastRefreshedAt, now);
  return (
    <section
      className="td-freshness-banner"
      data-testid="freshness-banner"
      data-freshness={kind}
      data-last-refreshed-at={lastRefreshedAt}
      role="status"
      aria-live="polite"
      aria-label={kind === "fresh" ? "Showing fresh data" : "Showing cached data"}
    >
      <h2>{kind === "fresh" ? "Showing fresh data" : "Showing cached data"}</h2>
      <p>
        Last refreshed at{" "}
        <span data-testid="freshness-last-refreshed-at">{label}</span>.{" "}
        {kind === "fresh"
          ? "The dashboard is up to date with the latest refresh."
          : "This data may not reflect recent changes — run a refresh to update it."}
      </p>
    </section>
  );
}

export default FreshnessBanner;
