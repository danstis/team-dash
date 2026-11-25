/**
 * BSOD-783 (T-UI2) — the net work change trend behind the mirrored
 * work-added / work-completed chart (US4).
 *
 * What this module owns
 * ---------------------
 * The derivation of the chart's third line: the **net work change**
 * over the displayed period and the straight line fitted through it.
 *
 * The derivation, in three steps
 * ------------------------------
 * 1. **The net change of one point** — the difference between the work
 *    added in a bucket and the work completed in it, in the unit of the
 *    active view (items, or estimated effort).
 * 2. **The running net** — the points accumulate across the period:
 *    `running(k) = diff₁ + diff₂ + … + diffₖ`. A bucket that completes
 *    more than it adds pulls the running total down; one that adds
 *    more than it completes pushes it up.
 * 3. **The fitted trend** — a least-squares straight line through the
 *    running net, with the point's position in the period as the
 *    independent variable. Its slope is the rate of change per period
 *    step: negative means the net is shrinking (completed work is
 *    outpacing added work), positive means it is growing, and a slope
 *    of zero means the two balance out.
 *
 * What the trend is NOT
 * ---------------------
 * The running net is the **net change inside the window**, not the
 * workspace's outstanding work: it starts at zero at the beginning of
 * the period and may go negative, which means more was completed
 * inside the period than was added inside it. The outstanding-work
 * figure is the backlog metric (`calculateBacklogCurrent`, BSOD-322),
 * and the copy of this chart says "net work change" for that reason.
 *
 * Why this lives in the view layer
 * --------------------------------
 * The metric (`calculateWorkAddedVsCompleted`, BSOD-318) already
 * returns the per-bucket created/completed figures this derivation
 * reads. The running net and its fit are a *presentation* of those
 * buckets, not a new domain output, so they are computed here rather
 * than added to the metric's contract.
 *
 * Determinism
 * -----------
 * The fit is arithmetic over the buckets it is given: no clock, no
 * randomness, no hidden state. The same buckets always produce the
 * same running net, the same slope and the same direction.
 *
 * Boundary
 * --------
 * `src/features/metrics/**` is the plan-documented home for the metrics
 * React UI. This module is presentation-free arithmetic: it imports
 * nothing, performs no I/O and makes no network call.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which way the net work change is travelling over the period:
 * `rising` (work is accumulating), `falling` (completed work is
 * outpacing added work) or `flat` (the two balance out).
 */
export type NetTrendDirection = "rising" | "falling" | "flat";

/**
 * The trend behind one period: the running net of (added − completed),
 * the straight line fitted through it, and the figures the summary and
 * the legend report.
 */
export interface NetTrend {
  /**
   * The accumulated net change after each point of the period, in the
   * order of the points. The first entry is the first point's own net
   * change.
   */
  readonly running: readonly number[];
  /**
   * The fitted straight line, one value per point — the trend line the
   * chart draws across the period.
   */
  readonly fitted: readonly number[];
  /**
   * The slope of the fitted line: the change of the running net per
   * period step. Negative means the net is shrinking.
   */
  readonly slope: number;
  /**
   * The running net at the last point of the period — the net work
   * change across the window as a whole.
   */
  readonly endValue: number;
  /** Which way the fitted line travels. */
  readonly direction: NetTrendDirection;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The rate below which the trend counts as flat.
 *
 * The rate is reported to one decimal place, so a rate whose absolute
 * value is under half of that last place would be reported as `0` —
 * calling such a rate "rising" while the summary says `0.0` would
 * contradict itself. The threshold is therefore the rounding
 * boundary of the reported figure, in the unit of the active view
 * (items, or minutes of estimated effort).
 */
export const FLAT_RATE_EPSILON = 0.05;

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Computes the net work change trend over a period.
 *
 * @param diffs - The net change of each point of the period, in the
 * order of the points: added minus completed, in the unit of the
 * active view.
 *
 * @returns The running net, the line fitted through it, the slope per
 * period step, the running net at the end of the period and the
 * direction of the trend.
 */
export function computeNetTrend(diffs: readonly number[]): NetTrend {
  const running: number[] = [];
  let total = 0;
  for (const diff of diffs) {
    total += diff;
    running.push(total);
  }

  const count = running.length;
  if (count === 0) {
    return {
      running: [],
      fitted: [],
      slope: 0,
      endValue: 0,
      direction: "flat",
    };
  }
  if (count === 1) {
    // One point cannot show a direction: there is nothing to fit a
    // line through, so the trend is the point itself and flat.
    return {
      running,
      fitted: [running[0]],
      slope: 0,
      endValue: running[0],
      direction: "flat",
    };
  }

  // Least squares: x is the point's position in the period (1-based),
  // y is the running net at that point.
  const meanX = (count + 1) / 2;
  const meanY = running.reduce((sum, value) => sum + value, 0) / count;
  let covariance = 0;
  let variance = 0;
  running.forEach((value, index) => {
    const dx = index + 1 - meanX;
    covariance += dx * (value - meanY);
    variance += dx * dx;
  });

  const slope = variance === 0 ? 0 : covariance / variance;
  const intercept = meanY - slope * meanX;
  const fitted = running.map((_, index) => intercept + slope * (index + 1));

  return {
    running,
    fitted,
    slope,
    endValue: running[count - 1],
    direction: trendDirection(slope),
  };
}

/**
 * The direction of a rate: which way the net work change travels.
 *
 * @param slope - The change of the running net per period step.
 */
export function trendDirection(slope: number): NetTrendDirection {
  if (Math.abs(slope) < FLAT_RATE_EPSILON) {
    return "flat";
  }
  return slope > 0 ? "rising" : "falling";
}
