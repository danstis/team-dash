/**
 * Unit tests for `src/features/metrics/net-work-trend.ts` — the net
 * work change trend behind the mirrored work-added / work-completed
 * chart (BSOD-783, T-UI2).
 *
 * The suite pins the derivation the chart draws:
 *
 * 1. The **running net** — the points accumulate across the period, so
 *    a point that completes more than it adds pulls the running total
 *    down and a point that adds more than it completes pushes it up.
 *
 * 2. The **fitted line** — a least-squares straight line through the
 *    running net, whose slope is the rate of change per period step.
 *
 * 3. The **direction** — rising, falling or flat — and the rate that
 *    the summary and the legend report.
 *
 * The worked examples are written out by hand rather than computed by
 * the module, so a change in the fit shows up as a failing number
 * rather than as a silently different number.
 *
 * Boundary: pure arithmetic — no network, no IndexedDB, no clock.
 */
import { describe, expect, it } from "vitest";

import {
  computeNetTrend,
  trendDirection,
  type NetTrend,
} from "../../../../src/features/metrics/net-work-trend";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** The trend of a period, for the assertions below. */
function trend(diffs: readonly number[]): NetTrend {
  return computeNetTrend(diffs);
}

/* -------------------------------------------------------------------------- */
/* The running net                                                             */
/* -------------------------------------------------------------------------- */

describe("the net work change trend", () => {
  it("accumulates the net change of every point of the period", () => {
    // The worked example of the story: +2, −1, +3 → +2, +1, +4.
    const result = trend([2, -1, 3]);

    expect(result.running).toEqual([2, 1, 4]);
  });

  it("reports the running net at the end of the period", () => {
    expect(trend([2, -1, 3]).endValue).toBe(4);
    expect(trend([2, -1, 3]).endValue).toBe(
      trend([2, -1, 3]).running[trend([2, -1, 3]).running.length - 1],
    );
  });

  it("pulls the running net down when a point completes more than it adds", () => {
    expect(trend([5, -3]).running).toEqual([5, 2]);
  });

  it("reports no trend for a period without points", () => {
    const result = trend([]);

    expect(result.running).toEqual([]);
    expect(result.fitted).toEqual([]);
    expect(result.slope).toBe(0);
    expect(result.endValue).toBe(0);
    expect(result.direction).toBe("flat");
  });

  it("reports a single point as a flat trend", () => {
    // One point cannot show a direction: there is no line to fit.
    const result = trend([4]);

    expect(result.running).toEqual([4]);
    expect(result.fitted).toEqual([4]);
    expect(result.slope).toBe(0);
    expect(result.endValue).toBe(4);
    expect(result.direction).toBe("flat");
  });
});

/* -------------------------------------------------------------------------- */
/* The fitted line                                                             */
/* -------------------------------------------------------------------------- */

describe("the fitted trend line", () => {
  it("fits a falling line through a falling running net", () => {
    // +1, −2, +1 → the running net goes 1, −1, 0, which the least
    // squares line follows downwards: a slope of −0.5 per period step.
    const result = trend([1, -2, 1]);

    expect(result.slope).toBeCloseTo(-0.5, 10);
    expect(result.direction).toBe("falling");
    expect(result.fitted[0]).toBeCloseTo(0.5, 10);
    expect(result.fitted[1]).toBeCloseTo(0, 10);
    expect(result.fitted[2]).toBeCloseTo(-0.5, 10);
  });

  it("fits a rising line through a rising running net", () => {
    // +1, +2, +3 → the running net goes 1, 3, 6, which the least
    // squares line follows upwards: a slope of +2.5 per period step.
    const result = trend([1, 2, 3]);

    expect(result.slope).toBeCloseTo(2.5, 10);
    expect(result.direction).toBe("rising");
  });

  it("fits a flat line through a balanced running net", () => {
    // +2, 0 → the running net holds at 2: the net neither grows nor
    // shrinks.
    const result = trend([2, 0]);

    expect(result.running).toEqual([2, 2]);
    expect(result.slope).toBe(0);
    expect(result.direction).toBe("flat");
  });

  it("draws the fitted line across the whole period", () => {
    const result = trend([2, -1, 3]);

    // One fitted value per point of the period, and the line spans it
    // from the first point to the last.
    expect(result.fitted).toHaveLength(result.running.length);
    expect(result.fitted[0]).toBeLessThan(result.fitted[2]);
  });

  it("states the rate that the summary reports", () => {
    // The slope is the change of the running net per period step: the
    // story's worked example rises by one item per step, because the
    // running net ends higher (+4) than it started (+2).
    const result = trend([2, -1, 3]);

    expect(result.slope).toBeCloseTo(1, 10);
    expect(result.direction).toBe("rising");
  });
});

/* -------------------------------------------------------------------------- */
/* The direction                                                               */
/* -------------------------------------------------------------------------- */

describe("the direction of the trend", () => {
  it("calls a rate that rounds to zero flat", () => {
    // The rate is reported to one decimal place, so a rate under half
    // of that last place would be reported as 0 — it must not be
    // called "rising" while the summary says 0.0.
    expect(trendDirection(0.04)).toBe("flat");
    expect(trendDirection(-0.04)).toBe("flat");
    expect(trendDirection(0)).toBe("flat");
  });

  it("calls a rate above the rounding boundary rising or falling", () => {
    expect(trendDirection(0.5)).toBe("rising");
    expect(trendDirection(-0.5)).toBe("falling");
  });
});
