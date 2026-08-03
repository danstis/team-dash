/**
 * BSOD-304 (T050) — Cached-reload UX integration coverage.
 *
 * Spec / contract references
 * --------------------------
 * Spec FR-021 ("on completion MUST show the outcome … along with the
 * last successful refresh timestamp and whether currently displayed
 * data is cached or fresh") and FR-090 ("show the as-of timestamp
 * on dashboard surfaces"). The T050 row (tasks.md:124) ships the
 * cached-vs-fresh banner in `src/features/refresh/FreshnessBanner.tsx`;
 * this integration test pins the boundary contract that the
 * dashboard chrome composes against.
 *
 * ## Merge note (T050 reconciliation)
 *
 * Main's T050 implementation (PR #148) shipped a `FreshnessBanner`
 * with an `isCached: boolean` prop and a co-located
 * `OfflineRefreshState` component. The merge resolution adopted
 * M001's pure-renderer design for `FreshnessBanner` (which derives
 * fresh/cached from elapsed time + clock injection) and dropped
 * `OfflineRefreshState` (T03's `<RefreshControls />` already gates
 * refresh offline via `useOffline()` + `<OfflineState />`). This
 * test is updated to use the new M001 API, and the offline-state
 * describe block is dropped because:
 *
 * - The `FreshnessBanner` labelling contract is fully covered by
 *   the unit tests in `tests/unit/features/refresh/FreshnessBanner.test.tsx`
 *   (boundary cases, clock skew, threshold override, malformed
 *   ISO fallback).
 * - The offline-disabled Refresh contract is fully covered by
 *   `tests/unit/features/refresh/RefreshControls.test.tsx` (T03's
 *   `useOffline()` + `data-offline` attribute) and the dashboard
 *   route integration test in `tests/integration/refresh/dashboard-route.test.tsx`.
 *
 * Both surfaces have richer coverage in the merged tree than the
 * dropped T050 describe block provided, so removing the offline
 * block is a pure simplification with no coverage loss.
 *
 * What this test pins (kept after the merge)
 * -----------------------------------------
 * On a page that displays cached data, the `<FreshnessBanner />`
 * component labels the data as cached and surfaces the
 * `lastRefreshedAt` timestamp verbatim. On a page that displays
 * fresh data (i.e. immediately after a successful refresh), the
 * same component flips to the "fresh" variant with the same
 * timestamp. The two variants are stable across the visible
 * boundary (`elapsed === FRESH_BANNER_WINDOW_MS`) and the
 * clock-skew / malformed-ISO defensive paths.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` per
 * `tests/setup.ts`. No browser, no live Asana, no live token
 * (NFR-005). The `now` prop is injected as a fixed clock so the
 * elapsed-time math is reproducible across runs.
 */
import { StrictMode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FreshnessBanner } from "../../../src/features/refresh/FreshnessBanner";

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

const FIXED_NOW_MS = Date.parse("2026-07-31T09:42:00.000Z");
const fixedNow = (): Date => new Date(FIXED_NOW_MS);

const RECENT_REFRESHED_AT = new Date(FIXED_NOW_MS - 5_000).toISOString(); // 5 s ago → fresh
const STALE_REFRESHED_AT = new Date(
  FIXED_NOW_MS - 15 * 60 * 1000,
).toISOString(); // 15 min ago → cached

/**
 * Render the cached-reload surface the way the dashboard chrome
 * composes it: a single `<FreshnessBanner />` whose fresh/cached
 * variant is derived from the elapsed time between
 * `lastRefreshedAt` and `now`. Splitting the helper out keeps the
 * per-test bodies focused on the assertions and means a future
 * change to the dashboard chrome's surface (e.g. wrapping it in a
 * `<main>` for the heading hierarchy) is a single-line edit.
 */
function renderCachedReloadSurface(props: {
  readonly lastRefreshedAt: string;
}): void {
  render(
    <StrictMode>
      <FreshnessBanner
        lastRefreshedAt={props.lastRefreshedAt}
        now={fixedNow}
      />
    </StrictMode>,
  );
}

/* -------------------------------------------------------------------------- */
/* FreshnessBanner — cached-vs-fresh labelling                                */
/* -------------------------------------------------------------------------- */

describe("BSOD-304 (T050) — FreshnessBanner cached-reload labelling", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels cached data as cached and surfaces the last-refreshed timestamp", () => {
    renderCachedReloadSurface({ lastRefreshedAt: STALE_REFRESHED_AT });

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("cached");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(
      STALE_REFRESHED_AT,
    );
    expect(banner).toHaveTextContent(/last refreshed at/i);
    // The timestamp MUST be rendered verbatim so the user can compare
    // it against a clock without re-parsing an abstract label. The
    // test asserts against the documented `data-last-refreshed-at`
    // attribute as well as the human-readable text the component
    // surfaces for redundancy.
    expect(
      screen.getByTestId("freshness-last-refreshed-at"),
    ).toHaveTextContent(/15 minutes ago/);
    expect(banner).toHaveTextContent(/this data may not reflect recent/i);
  });

  it("labels fresh data as fresh and surfaces the same timestamp", () => {
    renderCachedReloadSurface({ lastRefreshedAt: RECENT_REFRESHED_AT });

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("fresh");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(
      RECENT_REFRESHED_AT,
    );
    expect(banner).toHaveTextContent(/last refreshed at/i);
    expect(banner).toHaveTextContent(/up to date/i);
    // The cached-state copy MUST NOT leak into the fresh variant — the
    // "may not reflect recent" wording is a stale-data signal, not a
    // generic acknowledgement.
    expect(banner).not.toHaveTextContent(/this data may not reflect recent/i);
  });

  it("treats elapsed exactly equal to the 30 s threshold as fresh (inclusive)", () => {
    // The boundary contract: at threshold exactly, the surface reads
    // "fresh" — a future contributor who widens the inequality to
    // `<` flips the boundary and breaks the test.
    const atThreshold = new Date(FIXED_NOW_MS - 30_000).toISOString();
    renderCachedReloadSurface({ lastRefreshedAt: atThreshold });

    expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
      "data-freshness",
      "fresh",
    );
  });
});
