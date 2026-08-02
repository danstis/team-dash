import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FRESH_BANNER_WINDOW_MS,
  FreshnessBanner,
  deriveFreshness,
} from "../../../../src/features/refresh/FreshnessBanner";

// jsdom supplies `crypto` indirectly; the banner does not touch
// `Date.now()` directly (it goes through the optional `now` prop).
// The deterministic clocks below pin every test's "now" so the
// fresh-vs-cached math is reproducible.

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
  it("renders data-freshness='cached' when the last refresh finished beyond the threshold", () => {
    const lastRefreshedAt = isoRelativeToFixedNow(15 * 60 * 1000); // 15 min ago.

    render(
      <FreshnessBanner
        lastRefreshedAt={lastRefreshedAt}
        now={fixedNow}
      />,
    );

    const banner = screen.getByTestId("freshness-banner");
    expect(banner).toHaveAttribute("data-freshness", "cached");
    expect(banner).toHaveAttribute("data-last-refreshed-at", lastRefreshedAt);
    expect(banner).toHaveTextContent("Showing cached data.");
  });

  it("renders data-freshness='fresh' when the last refresh finished within the threshold", () => {
    const lastRefreshedAt = isoRelativeToFixedNow(5_000); // 5 s ago.

    render(
      <FreshnessBanner
        lastRefreshedAt={lastRefreshedAt}
        now={fixedNow}
      />,
    );

    const banner = screen.getByTestId("freshness-banner");
    expect(banner).toHaveAttribute("data-freshness", "fresh");
    expect(banner).toHaveTextContent("Showing fresh data.");
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
    expect(screen.getByTestId("freshness-banner-label")).toHaveTextContent(
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
