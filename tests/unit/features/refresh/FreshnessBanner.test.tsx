/**
 * Unit tests for `src/features/refresh/FreshnessBanner.tsx`.
 *
 * The integration test `tests/integration/refresh/dashboard-route.test.tsx`
 * exercises the cached-vs-fresh banner end-to-end through the
 * providers (CredentialsProvider / WorkspaceProvider) and a real
 * Dexie / fake-indexeddb round-trip. This unit suite covers the
 * leaf-component contract in isolation — the 30 s threshold
 * boundary, the clock-skew / malformed-ISO defensive paths, the
 * threshold-override seam, and the rendered data-attribute shape.
 *
 * ## Merge note (T050 reconciliation)
 *
 * Main's T050 implementation (PR #148) shipped a different
 * `FreshnessBanner` API (`isCached: boolean`) plus an
 * `OfflineRefreshState` component. The merge resolution adopted
 * M001's pure-renderer design (clock injection via `now` +
 * `thresholdMs` props) and borrowed main's
 * `<section>` + `<h2>` wrapper + `data-testid="freshness-last-
 * refreshed-at"` span testid. The orphaned main tests for the
 * `isCached` shape are dropped here; the `OfflineRefreshState`
 * surface is covered by the existing `RefreshControls.test.tsx`
 * offline gating tests.
 *
 * Determinism
 * -----------
 * The unit tests are fully deterministic. The `now` prop is
 * injected as a fixed clock so the elapsed-time math is
 * reproducible across runs (no `vi.useFakeTimers`).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FRESH_BANNER_WINDOW_MS,
  FreshnessBanner,
  deriveFreshness,
} from "../../../../src/features/refresh/FreshnessBanner";

const FIXED_NOW_MS = Date.parse("2026-08-02T06:30:00.000Z");
const fixedNow = (): Date => new Date(FIXED_NOW_MS);

function isoRelativeToFixedNow(deltaMs: number): string {
  return new Date(FIXED_NOW_MS - deltaMs).toISOString();
}

afterEach(() => {
  cleanup();
});

describe("FRESH_BANNER_WINDOW_MS", () => {
  it("is pinned at 30 seconds so a just-completed refresh reads fresh", () => {
    expect(FRESH_BANNER_WINDOW_MS).toBe(30_000);
  });
});

describe("FreshnessBanner", () => {
  it("renders the cached variant with the documented data attributes and copy", () => {
    const lastRefreshedAt = isoRelativeToFixedNow(15 * 60 * 1000); // 15 min ago.

    render(
      <FreshnessBanner
        lastRefreshedAt={lastRefreshedAt}
        now={fixedNow}
      />,
    );

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.tagName).toBe("SECTION");
    expect(banner).toHaveAttribute("data-freshness", "cached");
    expect(banner).toHaveAttribute("data-last-refreshed-at", lastRefreshedAt);
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-label", "Showing cached data");
    expect(banner).toHaveTextContent(/Showing cached data/i);
    expect(banner).toHaveTextContent(/last refreshed at/i);
    expect(banner).toHaveTextContent(/this data may not reflect recent/i);
    expect(
      screen.getByTestId("freshness-last-refreshed-at"),
    ).toHaveTextContent(/15 minutes ago/);
  });

  it("renders the fresh variant with the documented data attributes and copy", () => {
    const lastRefreshedAt = isoRelativeToFixedNow(5_000); // 5 s ago.

    render(
      <FreshnessBanner
        lastRefreshedAt={lastRefreshedAt}
        now={fixedNow}
      />,
    );

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.tagName).toBe("SECTION");
    expect(banner).toHaveAttribute("data-freshness", "fresh");
    expect(banner).toHaveAttribute("data-last-refreshed-at", lastRefreshedAt);
    expect(banner).toHaveAttribute("aria-label", "Showing fresh data");
    expect(banner).toHaveTextContent(/Showing fresh data/i);
    expect(banner).toHaveTextContent(/up to date/i);
    // The cached-state copy MUST NOT leak into the fresh variant.
    expect(banner).not.toHaveTextContent(/this data may not reflect recent/i);
  });

  it("renders the heading as <h2> so the surrounding chrome can own the document <h1>", () => {
    // The cached-reload surface is composed INSIDE a larger dashboard
    // chrome that owns the document's <h1>. The component MUST
    // therefore render its title as <h2> — a future contributor who
    // widens it to <h1> would skip a heading level (WCAG 1.3.1)
    // when the chrome also renders an <h1>.
    render(
      <FreshnessBanner
        lastRefreshedAt={isoRelativeToFixedNow(15 * 60 * 1000)}
        now={fixedNow}
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Showing cached data");
  });

  it("flips fresh→cached at the 30 s boundary (inclusive of the threshold)", () => {
    // At threshold exactly (`elapsed <= thresholdMs`) → fresh.
    const atThreshold = isoRelativeToFixedNow(FRESH_BANNER_WINDOW_MS);
    const { rerender } = render(
      <FreshnessBanner
        lastRefreshedAt={atThreshold}
        now={fixedNow}
      />,
    );
    expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
      "data-freshness",
      "fresh",
    );

    // One millisecond past the threshold → cached.
    rerender(
      <FreshnessBanner
        lastRefreshedAt={isoRelativeToFixedNow(FRESH_BANNER_WINDOW_MS + 1)}
        now={fixedNow}
      />,
    );
    expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
      "data-freshness",
      "cached",
    );
  });

  it("renders the elapsed-time label relative to the injected clock", () => {
    const lastRefreshedAt = isoRelativeToFixedNow(7 * 60 * 1000); // 7 min ago.
    render(
      <FreshnessBanner
        lastRefreshedAt={lastRefreshedAt}
        now={fixedNow}
      />,
    );
    expect(screen.getByTestId("freshness-last-refreshed-at")).toHaveTextContent(
      "7 minutes ago",
    );
  });

  it("exposes role='status' and aria-live='polite' for assistive tech", () => {
    render(
      <FreshnessBanner
        lastRefreshedAt={isoRelativeToFixedNow(15 * 60 * 1000)}
        now={fixedNow}
      />,
    );
    const banner = screen.getByTestId("freshness-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("renders the verbatim ISO timestamp in the data-last-refreshed-at attribute", () => {
    const lastRefreshedAt = "2026-08-02T06:25:00.000Z";
    render(
      <FreshnessBanner
        lastRefreshedAt={lastRefreshedAt}
        now={fixedNow}
      />,
    );
    expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
      "data-last-refreshed-at",
      lastRefreshedAt,
    );
  });

  it("accepts a custom thresholdMs for the comparison", () => {
    // 10 s past the default threshold with a 60 s custom threshold → still fresh.
    render(
      <FreshnessBanner
        lastRefreshedAt={isoRelativeToFixedNow(10_000)}
        now={fixedNow}
        thresholdMs={60_000}
      />,
    );
    expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
      "data-freshness",
      "fresh",
    );
  });

  it("surfaces a non-ISO verbatim timestamp without re-parsing it", () => {
    // The component's contract is "render lastRefreshedAt verbatim"
    // (via the data-last-refreshed-at attribute) — a future
    // contributor who introduces a `new Date(...)` parse risks
    // dropping timezone info (the spec runs in the user's local
    // timezone by default per FR-029). The verbatim-render
    // invariant is pinned here by passing a non-ISO, non-DST-safe
    // timestamp that would round-trip incorrectly through Date.parse.
    const customTimestamp = "Last refresh: today, 9:42 AM";
    render(
      <FreshnessBanner
        lastRefreshedAt={customTimestamp}
        now={fixedNow}
      />,
    );
    expect(screen.getByTestId("freshness-banner")).toHaveAttribute(
      "data-last-refreshed-at",
      customTimestamp,
    );
  });
});

describe("deriveFreshness", () => {
  it("returns 'cached' for negative elapsed time (clock skew / DST edge)", () => {
    // Session `finishedAt` is 5 minutes in the future relative to `now`
    // — treat as cached rather than `fresh` so the user is never told
    // newer-than-true data is fresh.
    const futureTime = new Date(FIXED_NOW_MS + 5 * 60 * 1000).toISOString();
    expect(deriveFreshness(futureTime, fixedNow)).toBe("cached");
  });

  it("returns 'cached' for a malformed ISO timestamp", () => {
    expect(deriveFreshness("not-a-date", fixedNow)).toBe("cached");
  });

  it("returns 'cached' for an empty string", () => {
    expect(deriveFreshness("", fixedNow)).toBe("cached");
  });

  it("treats elapsed === thresholdMs as fresh (inclusive boundary)", () => {
    const at = isoRelativeToFixedNow(FRESH_BANNER_WINDOW_MS);
    expect(deriveFreshness(at, fixedNow)).toBe("fresh");
  });

  it("treats elapsed === thresholdMs + 1 ms as cached", () => {
    const past = isoRelativeToFixedNow(FRESH_BANNER_WINDOW_MS + 1);
    expect(deriveFreshness(past, fixedNow)).toBe("cached");
  });
});
