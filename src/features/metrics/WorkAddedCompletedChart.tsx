/**
 * BSOD-319 (T076) / BSOD-783 (T-UI2) — `WorkAddedCompletedChart`, the
 * P1 "work added vs work completed" chart (US4).
 *
 * Spec / contract references
 * --------------------------
 * - FR-056 / FR-057 (spec.md): the tasks *created* inside the selected
 *   range and the tasks *completed* inside it are two independent
 *   populations, so a task can be counted in both.
 * - FR-058 (spec.md): the effort sums leave out the tasks that carry no
 *   estimate, and the exclusion is disclosed rather than hidden.
 * - FR-059 (spec.md): the created and the completed measure are charted
 *   over the time buckets of the selected range. The requirement is
 *   that the measures are charted over the buckets — it does not
 *   mandate a chart form, so this module's form is a presentation
 *   choice, not a contract change.
 * - FR-060 (spec.md): the metric can be split by group — team member,
 *   team, project, portfolio, priority.
 * - FR-061 (spec.md): the item-count view and the estimated-effort view
 *   are two separate views of the same bucket, never one blended
 *   number.
 * - FR-062 (spec.md): every created/completed figure is drillable to
 *   its exact contributing task list.
 * - FR-088 (spec.md): the visualisation carries a programmatic label, is
 *   operable from the keyboard, and is paired with a tabular
 *   alternative.
 *
 * The two chart forms
 * -------------------
 * - **The workspace-level view is a mirrored line diagram.** The
 *   added series is drawn above the zero baseline and the completed
 *   series below it, so the two measures read as opposing pressure on
 *   one scale, and a third line — the trend of the net work change
 *   across the period — rides up or down over them. The point of the
 *   figure is one question: are we getting through more work than we
 *   are adding, or is the work always growing?
 * - **The grouped view keeps the grouped bars.** With a grouping
 *   dimension in force there are many series, and a story that defines
 *   how to draw N mirrored pairs legibly has not landed yet. The
 *   grouped view therefore keeps the form it had (BSOD-319) until
 *   that story lands.
 *
 * What this module owns
 * ---------------------
 * The *presentation* of the work-added / work-completed metric: the
 * chart surface, the legend, the summary line, the exclusion
 * disclosure and the data table that stands in for the chart.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The metric. `calculateWorkAddedVsCompleted` (T075 / BSOD-318) owns
 *   the bucketing, the deduplication and the drill-down sets; this
 *   module renders the result it is handed and never counts a task of
 *   its own. A chart that counted by hand could agree with the domain
 *   on one figure and drift on the next.
 * - The trend. The running net of (added − completed) and the straight
 *   line fitted through it are a *view* derivation over the buckets the
 *   metric already returns; `net-work-trend.ts` owns the arithmetic and
 *   the metric's contract is unchanged.
 * - The controls. The count↔effort switch and the group selector live
 *   in `ChartControls` (T080 / BSOD-320); this chart is a *controlled*
 *   surface, so the caller owns the view state and hands it down. See
 *   "The props contract" below.
 * - The drill-down panel. `DrillDownPanel` (T081 / BSOD-321) renders the
 *   task list; this chart emits the request that says which figure the
 *   user drilled into.
 *
 * The props contract
 * ------------------
 * The props are the seam T080 and T081 wire into, so they are stable by
 * design:
 *
 * - `groups` — the metric results to draw: one entry per group when the
 *   metric is grouped, a single workspace-level entry when it is not.
 * - `view` — which of the two figures of a bucket is shown: the item
 *   count or the estimated effort (FR-061). The two are never blended.
 * - `groupBy` — the grouping dimension in force, so the chart can name
 *   the split it is showing (FR-060).
 * - `onDrillDown` — called with the exact figure the user drilled into
 *   (FR-062): the group, the bucket, the measure, the view and the
 *   contributing task gids.
 * - `groupLabels` — the human names of the group keys.
 *
 * Honesty
 * -------
 * - The two views are never combined: the chart shows the count view
 *   or the effort view, and says which one it is showing. The trend is
 *   recomputed in the unit of the active view.
 * - The trend line is the **net work change over the period**, not the
 *   workspace's outstanding work: the running net starts at zero at the
 *   beginning of the window and may go negative. The copy says "net
 *   work change" for that reason; the outstanding-work figure is the
 *   backlog metric (BSOD-322).
 * - The tasks left out of the effort sums are disclosed under the
 *   chart, because a sum that silently drops tasks is a figure the
 *   reader cannot check (FR-058).
 * - The drill-down set behind every figure travels with the figure, so
 *   the panel can show the exact tasks the figure stands for (FR-062).
 *
 * Accessibility
 * -------------
 * - The chart surface carries `role="img"` and a label that names what
 *   it shows, and the data table below it is the tabular alternative
 *   (FR-088).
 * - The table is the keyboard path: every figure carries a drill-down
 *   action, so the drill-down works without a pointer. The points of
 *   the two series are clickable too, as a shortcut for the mouse.
 * - Red and green are a colour-vision pairing, so the two series are
 *   told apart without colour: they sit on opposite sides of the zero
 *   line, they carry different line styles (solid / dashed) and
 *   different marker shapes (circle / square), and the trend line
 *   carries a third style of its own (dotted).
 *
 * Boundary
 * --------
 * `src/features/metrics/**` is the plan-documented home for the
 * metrics React UI. This module imports the domain's metric types, the
 * shared formatters and Recharts. It performs no I/O and makes no
 * network call.
 */
import type { ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarRectangleItem,
  type TooltipValueType,
} from "recharts";

import { diffInDaysInclusive } from "../../domain/datetime";
import {
  NO_ESTIMATE_COMPLETED_REASON,
  NO_ESTIMATE_CREATED_REASON,
  NO_PRIORITY_GROUP_KEY,
  UNASSIGNED_GROUP_KEY,
  type WorkAddedCompletedGroupBy,
  type WorkAddedCompletedSeries,
} from "../../domain/metrics/workAddedCompleted";
import type { ISODate, MetricResult } from "../../domain/types";
import { formatDate, formatDuration } from "../../shared/format";
import {
  computeNetTrend,
  type NetTrend,
  type NetTrendDirection,
} from "./net-work-trend";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which of the two figures of a bucket the chart shows (FR-061): the
 * number of items, or their estimated effort. The two are separate
 * views of the same bucket, never one blended number.
 */
export type WorkAddedCompletedView = "count" | "effort";

/**
 * Which measure a figure belongs to: the tasks added in the bucket, or
 * the tasks completed in it (FR-056 / FR-057).
 */
export type WorkAddedCompletedMeasure = "created" | "completed";

/**
 * One group the chart draws: a metric result and the key it belongs
 * to. The workspace-level (ungrouped) view is a single group with no
 * key.
 */
export interface WorkAddedCompletedChartGroup {
  /**
   * The group this result belongs to — a gid, or the explicit
   * `unassigned` / `no_priority` key. `undefined` for the
   * workspace-level view.
   */
  readonly groupKey: string | undefined;
  /** The metric result for this group. */
  readonly result: MetricResult<WorkAddedCompletedSeries>;
}

/**
 * The figure the user drilled into (FR-062). It names the group, the
 * bucket, the measure and the view, and it carries the exact task list
 * the figure stands for, so the drill-down panel shows the same tasks
 * the figure stands for.
 */
export interface WorkAddedCompletedDrillDownRequest {
  /** The group the figure belongs to — `undefined` for the whole workspace. */
  readonly groupKey: string | undefined;
  /** The measure the figure is: tasks added, or tasks completed. */
  readonly measure: WorkAddedCompletedMeasure;
  /** The view the figure was displayed in. */
  readonly view: WorkAddedCompletedView;
  /** The first calendar date of the bucket (inclusive). */
  readonly bucketStart: ISODate;
  /** The last calendar date of the bucket (inclusive). */
  readonly bucketEnd: ISODate;
  /** The exact contributing task list behind the figure. */
  readonly taskGids: readonly string[];
}

/**
 * The props `<WorkAddedCompletedChart />` consumes. Every field is
 * `readonly` and consumed via `Readonly<Props>` per the project-wide
 * convention.
 */
export interface WorkAddedCompletedChartProps {
  /**
   * The metric results to draw — one entry per group when the metric is
   * grouped, a single workspace-level entry when it is not.
   */
  readonly groups: readonly WorkAddedCompletedChartGroup[];
  /**
   * Which figure the chart shows: the item count or the estimated
   * effort (FR-061).
   */
  readonly view: WorkAddedCompletedView;
  /**
   * The grouping dimension in force, so the chart can name the split it
   * is showing (FR-060). The split itself arrives as `groups`.
   */
  readonly groupBy?: WorkAddedCompletedGroupBy;
  /**
   * Called when the user drills into a created or completed figure
   * (FR-062). Without it the chart draws no drill-down actions, because
   * a drill-down that leads nowhere is a dead end.
   */
  readonly onDrillDown?: (request: WorkAddedCompletedDrillDownRequest) => void;
  /**
   * The human names of the group keys, so a group is shown by name
   * rather than by its gid.
   */
  readonly groupLabels?: Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** The heading of the surface. */
const CHART_HEADING = "Work added and completed";

/** The height of the chart surface, in pixels. */
const CHART_HEIGHT = 320;

/**
 * The size the chart is drawn at before the browser has measured the
 * container. It keeps the first paint from being an empty box, and it
 * is the size the chart keeps in environments that cannot measure
 * layout.
 */
const INITIAL_DIMENSION = { width: 720, height: 320 };

/**
 * The number of categorical colours in the chart palette. The palette
 * is used in its fixed order, so a chart with more groups than the
 * palette holds starts again at the beginning.
 */
const PALETTE_SLOTS = 8;

/** The margin around the plot area of the grouped bars. */
const CHART_MARGIN = { top: 8, right: 8, bottom: 8, left: 8 };

/**
 * The margin around the plot area of the mirrored line diagram. It
 * leaves room above the plot for the value axis' label, which names
 * the unit and says what the two halves mean.
 */
const LINE_CHART_MARGIN = { top: 28, right: 16, bottom: 8, left: 8 };

/** The width of the value axis, in pixels. */
const VALUE_AXIS_WIDTH = 56;

/**
 * The compact date the axis shows. The bucket dates are calendar dates
 * (the metric already resolved them under the active timezone basis),
 * so they are formatted in UTC and never shift with the reader's clock.
 */
const AXIS_DATE_FORMAT = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** The name of the added series, as the legend and the tooltip show it. */
const ADDED_SERIES_NAME = "items added";

/** The name of the completed series, as the legend and the tooltip show it. */
const COMPLETED_SERIES_NAME = "items completed";

/** The name of the trend line, as the legend and the tooltip show it. */
const TREND_SERIES_NAME = "net work change trend";

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** One bucket of the chart's time axis. */
interface ChartBucket {
  /** The first calendar date of the bucket (inclusive). */
  readonly bucketStart: ISODate;
  /** The last calendar date of the bucket (inclusive). */
  readonly bucketEnd: ISODate;
}

/** One bar series: a measure of one group. */
interface ChartSeries {
  /** The key the series' figures live under in the chart's data rows. */
  readonly dataKey: string;
  /** The index of the group the series belongs to. */
  readonly groupIndex: number;
  /** The group the series belongs to — `undefined` for the workspace view. */
  readonly groupKey: string | undefined;
  /** The measure the series shows. */
  readonly measure: WorkAddedCompletedMeasure;
  /** The palette slot the series takes its colour from (1-based). */
  readonly slot: number;
  /** The name of the series, as the legend and the tooltip show it. */
  readonly name: string;
}

/**
 * One row of the chart's data: the figures of every series for one
 * bucket, keyed by the series' data key.
 */
type ChartRow = Record<string, string | number>;

/**
 * One row of the mirrored line diagram: the added figure above the
 * zero line, the completed figure below it (as a negative number) and
 * the fitted trend line at that point of the period.
 */
interface MirroredRow {
  /** The compact label of the bucket, as the time axis shows it. */
  readonly bucket: string;
  /** The first calendar date of the bucket (inclusive). */
  readonly bucketStart: ISODate;
  /** The last calendar date of the bucket (inclusive). */
  readonly bucketEnd: ISODate;
  /** The added figure of the bucket, above the zero line. */
  readonly added: number;
  /** The completed figure of the bucket, below the zero line. */
  readonly completed: number;
  /** The fitted trend line at this point of the period. */
  readonly trend: number;
}

/** A group key and the way it should be shown. */
interface GroupName {
  /** The text to show. */
  readonly text: string;
  /** Whether the text is a raw identifier that should be set in mono. */
  readonly raw: boolean;
}

/**
 * One point of one of the two series of the mirrored diagram, and the
 * drill-down it stands for.
 */
interface SeriesPointProps {
  /** The horizontal position of the point, in pixels. */
  readonly cx: number | undefined;
  /** The vertical position of the point, in pixels. */
  readonly cy: number | undefined;
  /** The row the point stands for. */
  readonly payload: MirroredRow | undefined;
  /** The shape the point is drawn with. */
  readonly shape: "circle" | "square";
  /** The test id the point carries. */
  readonly testId?: string;
  /** Whether the point can be drilled into. */
  readonly drillable: boolean;
  /** The radius of a round point, in pixels. */
  readonly radius?: number;
  /** Called when the point is clicked. */
  readonly onSelect?: (row: MirroredRow) => void;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The measure names the legend and the table use. */
const MEASURE_NAMES: Readonly<Record<WorkAddedCompletedMeasure, string>> = {
  created: "added",
  completed: "completed",
};

/** The column headings of the data table, per view. */
const COLUMN_NAMES: Readonly<
  Record<
    WorkAddedCompletedView,
    { readonly created: string; readonly completed: string }
  >
> = {
  count: { created: "Items added", completed: "Items completed" },
  effort: { created: "Effort added", completed: "Effort completed" },
};

/**
 * The names the two series carry in the legend and the tooltip, per
 * view. They name the unit, so the two views are never read as the
 * same numbers (FR-061).
 */
const SERIES_NAMES: Readonly<
  Record<
    WorkAddedCompletedView,
    { readonly added: string; readonly completed: string }
  >
> = {
  count: { added: ADDED_SERIES_NAME, completed: COMPLETED_SERIES_NAME },
  effort: { added: "effort added", completed: "effort completed" },
};

/**
 * The unit of the active view, as the axis label and the summary name
 * it (FR-061).
 */
const UNIT_NAMES: Readonly<Record<WorkAddedCompletedView, string>> = {
  count: "items",
  effort: "estimated effort",
};

/**
 * What the trend means for the period, in plain words. The capacity
 * reading must not depend on the reader interpreting the geometry, so
 * the summary states it.
 */
const TREND_READINGS: Readonly<Record<NetTrendDirection, string>> = {
  rising:
    "work is accumulating — more is being added than completed, so the net is rising",
  falling: "completed is outpacing added, so the net is falling",
  flat: "added and completed are balancing out, so the net is flat",
};

/**
 * The direction of the trend as one word, for the legend.
 */
const TREND_DIRECTION_WORDS: Readonly<Record<NetTrendDirection, string>> = {
  rising: "rising",
  falling: "falling",
  flat: "flat",
};

/** The human name of each grouping dimension (FR-060). */
const GROUP_BY_NAMES: Readonly<Record<WorkAddedCompletedGroupBy, string>> = {
  assignee: "team member",
  reportingTeam: "team",
  project: "project",
  portfolio: "portfolio",
  priority: "priority",
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The name of a group: the caller's label when it supplied one, the
 * explicit wording for the "unassigned" and "no priority" keys, and
 * the raw key otherwise — a gid is a raw value and is shown as one.
 */
function groupName(
  groupKey: string,
  groupLabels: Readonly<Record<string, string>>,
): GroupName {
  const label = groupLabels[groupKey];
  if (label !== undefined) {
    return { text: label, raw: false };
  }
  if (groupKey === UNASSIGNED_GROUP_KEY) {
    return { text: "Unassigned", raw: false };
  }
  if (groupKey === NO_PRIORITY_GROUP_KEY) {
    return { text: "No priority", raw: false };
  }
  return { text: groupKey, raw: true };
}

/** The compact label the axis shows for a bucket. */
function axisLabel(bucketStart: ISODate): string {
  return AXIS_DATE_FORMAT.format(new Date(`${bucketStart}T00:00:00.000Z`));
}

/**
 * The label the table and the drill-down actions use for a bucket: the
 * day, or the span of days for a wider bucket.
 */
function periodLabel(bucket: ChartBucket): string {
  if (bucket.bucketStart === bucket.bucketEnd) {
    return formatDate(bucket.bucketStart);
  }
  return `${formatDate(bucket.bucketStart)} – ${formatDate(bucket.bucketEnd)}`;
}

/** The figure of one measure of one bucket, in the view on show. */
function figureOf(
  bucket: WorkAddedCompletedSeries["buckets"][number],
  measure: WorkAddedCompletedMeasure,
  view: WorkAddedCompletedView,
): number {
  if (measure === "created") {
    return view === "count" ? bucket.createdCount : bucket.createdEffortMinutes;
  }
  return view === "count"
    ? bucket.completedCount
    : bucket.completedEffortMinutes;
}

/** The figure as the reader sees it: a count, or a duration. */
function formatFigure(view: WorkAddedCompletedView, value: number): string {
  return view === "count" ? String(value) : formatDuration(value);
}

/**
 * A number with its sign, to one decimal place: `+2` / `−0.5`.
 *
 * The minus sign is the typographic one (U+2212), so the figure reads
 * as a number rather than as a hyphen.
 */
function formatSignedNumber(value: number): string {
  const magnitude = Math.abs(value).toLocaleString("en-AU", {
    maximumFractionDigits: 1,
  });
  if (value === 0) {
    return magnitude;
  }
  return `${value < 0 ? "−" : "+"}${magnitude}`;
}

/**
 * A duration with its sign, to one decimal place: `+1 h 30 min` /
 * `−30 min`. The duration format is the app's own (`formatDuration`),
 * so the figure is written the way the rest of the app writes it.
 */
function formatSignedDuration(minutes: number): string {
  const text = formatDuration(minutes, { maximumFractionDigits: 1 });
  const body = text.startsWith("-") ? `−${text.slice(1)}` : text;
  if (minutes === 0) {
    return body;
  }
  return minutes > 0 ? `+${body}` : body;
}

/** A figure with its sign, in the unit of the active view. */
function formatSignedFigure(
  view: WorkAddedCompletedView,
  value: number,
): string {
  if (view === "count") {
    return formatSignedNumber(value);
  }
  return formatSignedDuration(value);
}

/**
 * The unit of a figure, in the item-count view: one item is "item",
 * any other number is "items". The effort view carries its own unit
 * (the duration format), so it needs no word.
 */
function countUnit(value: number, noun: string): string {
  return Math.abs(value) === 1 ? ` ${noun}` : ` ${noun}s`;
}

/**
 * A figure with its sign and its unit, in the unit of the active view:
 * `+3 items` in the item-count view, `−2 h` in the effort view.
 */
function formatTrendFigure(
  view: WorkAddedCompletedView,
  value: number,
): string {
  if (view === "count") {
    return `${formatSignedNumber(value)}${countUnit(value, "item")}`;
  }
  return formatSignedDuration(value);
}

/**
 * The tooltip's value, which Recharts hands over as a number, a string
 * or an array of them.
 */
function toNumber(value: TooltipValueType | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return Array.isArray(value) ? Number(value[0]) : 0;
}

/**
 * The tooltip's figure. The completed series is plotted below the zero
 * line, so its plotted value is negative — the figure the reader sees
 * is its magnitude.
 */
function formatTooltipValue(
  view: WorkAddedCompletedView,
  name: string | number | undefined,
  value: number,
): string {
  if (name === TREND_SERIES_NAME) {
    return formatSignedFigure(view, value);
  }
  return formatFigure(view, Math.abs(value));
}

/**
 * The tasks behind one figure (FR-062). The metric keys its drill-down
 * sets by the measure and the bucket the figure belongs to.
 */
function contributingGids(
  result: MetricResult<WorkAddedCompletedSeries>,
  measure: WorkAddedCompletedMeasure,
  bucketStart: ISODate,
): readonly string[] {
  const contributing = result.contributingTaskGids;
  if (Array.isArray(contributing)) {
    return contributing;
  }
  return contributing[`${measure}:${bucketStart}`] ?? [];
}

/**
 * The buckets of the chart's time axis: every bucket of every group,
 * in order. The groups share one bucket sequence — the metric buckets
 * one range — but the chart does not assume it, so a group that
 * carries a bucket the others do not still gets a column.
 */
function collectBuckets(
  groups: readonly WorkAddedCompletedChartGroup[],
): readonly ChartBucket[] {
  const byStart = new Map<string, ChartBucket>();
  for (const group of groups) {
    for (const bucket of group.result.series.buckets) {
      if (!byStart.has(bucket.bucketStart)) {
        byStart.set(bucket.bucketStart, {
          bucketStart: bucket.bucketStart,
          bucketEnd: bucket.bucketEnd,
        });
      }
    }
  }
  return [...byStart.values()].sort((left, right) =>
    left.bucketStart.localeCompare(right.bucketStart),
  );
}

/**
 * The bar series: a created and a completed series for every group.
 * The palette is used in its fixed order, so the first group's added
 * and completed bars keep the first two colours.
 */
function buildSeries(
  groups: readonly WorkAddedCompletedChartGroup[],
): readonly ChartSeries[] {
  const series: ChartSeries[] = [];
  groups.forEach((group, groupIndex) => {
    (["created", "completed"] as const).forEach((measure, measureIndex) => {
      const slot = groupIndex * 2 + measureIndex + 1;
      const groupKey = group.groupKey;
      series.push({
        dataKey: `series-${groupIndex}-${measure}`,
        groupIndex,
        groupKey,
        measure,
        slot: ((slot - 1) % PALETTE_SLOTS) + 1,
        name:
          groupKey === undefined
            ? MEASURE_NAMES[measure]
            : `${MEASURE_NAMES[measure]} — ${groupKey}`,
      });
    });
  });
  return series;
}

/**
 * The chart's data rows: one row per bucket, holding the figure of
 * every series for that bucket.
 */
function buildRows(
  buckets: readonly ChartBucket[],
  groups: readonly WorkAddedCompletedChartGroup[],
  series: readonly ChartSeries[],
  view: WorkAddedCompletedView,
): readonly ChartRow[] {
  return buckets.map((bucket) => {
    const row: ChartRow = {
      bucket: axisLabel(bucket.bucketStart),
      bucketStart: bucket.bucketStart,
      bucketEnd: bucket.bucketEnd,
    };
    for (const item of series) {
      const group = groups[item.groupIndex];
      const source = group?.result.series.buckets.find(
        (candidate) => candidate.bucketStart === bucket.bucketStart,
      );
      row[item.dataKey] =
        source === undefined ? 0 : figureOf(source, item.measure, view);
    }
    return row;
  });
}

/**
 * The rows of the mirrored line diagram, and the trend behind them.
 *
 * The added figure is drawn as it is (above the zero line) and the
 * completed figure is drawn as a negative number (below the zero
 * line). The trend is the running net of (added − completed) with the
 * least-squares line fitted through it, both in the unit of the active
 * view.
 */
function buildMirroredRows(
  buckets: readonly ChartBucket[],
  result: MetricResult<WorkAddedCompletedSeries>,
  view: WorkAddedCompletedView,
): { readonly rows: readonly MirroredRow[]; readonly trend: NetTrend } {
  const bucketOf = (bucket: ChartBucket) =>
    result.series.buckets.find(
      (candidate) => candidate.bucketStart === bucket.bucketStart,
    );

  const diffs = buckets.map((bucket) => {
    const source = bucketOf(bucket);
    if (source === undefined) {
      return 0;
    }
    return (
      figureOf(source, "created", view) - figureOf(source, "completed", view)
    );
  });
  const trend = computeNetTrend(diffs);

  const rows = buckets.map((bucket, index): MirroredRow => {
    const source = bucketOf(bucket);
    const added = source === undefined ? 0 : figureOf(source, "created", view);
    const completed =
      source === undefined ? 0 : figureOf(source, "completed", view);
    return {
      bucket: axisLabel(bucket.bucketStart),
      bucketStart: bucket.bucketStart,
      bucketEnd: bucket.bucketEnd,
      added,
      completed: -completed,
      trend: trend.fitted[index] ?? 0,
    };
  });

  return { rows, trend };
}

/**
 * The range of the value axis: the same distance above the zero line
 * as below it, so the two halves of the diagram read as one scale.
 * The trend line shares the axis, so its figures are inside the range
 * too and nothing is clipped.
 *
 * The range is a whole number of ticks either side of the zero line
 * (two steps out, one step per tick), so the axis reads −4, −2, 0, 2,
 * 4 rather than a set of fractions.
 */
function mirroredDomain(
  rows: readonly MirroredRow[],
  view: WorkAddedCompletedView,
): [number, number] {
  const reach = rows.reduce(
    (widest, row) =>
      Math.max(widest, Math.abs(row.added), Math.abs(row.completed), row.trend),
    0,
  );
  const step = axisStep(view, Math.max(1, reach / 2));
  const bound = step * 2;
  return [-bound, bound];
}

/**
 * The step between two value-axis ticks, in the unit of the active
 * view: a whole number of items, or a whole number of minutes.
 */
function axisStep(view: WorkAddedCompletedView, threshold: number): number {
  if (view === "count") {
    return niceCountStep(threshold);
  }
  return niceMinuteStep(threshold);
}

/**
 * The smallest round number of items at or above the threshold: 1, 2
 * or 5 times a power of ten.
 */
function niceCountStep(threshold: number): number {
  if (threshold <= 1) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(threshold));
  for (const factor of [1, 2, 5]) {
    const candidate = factor * magnitude;
    if (candidate >= threshold) {
      return candidate;
    }
  }
  return 10 * magnitude;
}

/**
 * The smallest round number of minutes at or above the threshold. The
 * steps are the ones a reader counts time in — a quarter of an hour,
 * half an hour, an hour, two hours — so the axis reads in hours and
 * minutes rather than in odd numbers of minutes.
 */
const MINUTE_STEPS: readonly number[] = [
  1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440, 2880,
];

function niceMinuteStep(threshold: number): number {
  const step = MINUTE_STEPS.find((candidate) => candidate >= threshold);
  if (step !== undefined) {
    return step;
  }
  return Math.ceil(threshold / 1440) * 1440;
}

/**
 * The denominator of the trend's rate: the length of one bucket, in
 * the reader's words. Daily buckets are "per day", weekly buckets are
 * "per week", and anything else is "per period" — the copy never
 * claims a unit the buckets do not have.
 */
function bucketStepName(buckets: readonly ChartBucket[]): string {
  if (buckets.length === 0) {
    return "period";
  }
  const days = buckets.reduce(
    (widest, bucket) =>
      Math.max(
        widest,
        diffInDaysInclusive(bucket.bucketStart, bucket.bucketEnd),
      ),
    0,
  );
  if (days === 1) {
    return "day";
  }
  if (days === 7) {
    return "week";
  }
  return "period";
}

/**
 * The name of a series as the legend shows it: the measure, and the
 * group it belongs to when the chart is split.
 */
function seriesLabel(
  item: ChartSeries,
  groupLabels: Readonly<Record<string, string>>,
): {
  readonly measure: string;
  readonly group: GroupName | null;
} {
  const measure = MEASURE_NAMES[item.measure];
  const groupKey = item.groupKey;
  if (groupKey === undefined) {
    return { measure, group: null };
  }
  return { measure, group: groupName(groupKey, groupLabels) };
}

/**
 * The wording of the drill-down action of one figure. The action names
 * the figure it belongs to, so the reader never has to guess which bar
 * the list belongs to.
 */
function drillDownLabel(
  view: WorkAddedCompletedView,
  measure: WorkAddedCompletedMeasure,
  value: number,
): string {
  const measureName = MEASURE_NAMES[measure];
  if (view === "count") {
    return `Show the ${value} ${value === 1 ? "task" : "tasks"} ${measureName}`;
  }
  return `Show the tasks behind the ${formatDuration(value)} ${measureName}`;
}

/**
 * The disclosure of the tasks left out of the effort sums (FR-058). It
 * reads the metric's own exclusion channel (`population.excluded`),
 * so the numbers cannot drift from the ones the sums were built with.
 */
function exclusionNote(
  result: MetricResult<WorkAddedCompletedSeries>,
): string | null {
  const excluded = result.population.excluded ?? [];
  const countFor = (reason: string): number =>
    excluded
      .filter((entry) => entry.reason === reason)
      .reduce((total, entry) => total + entry.count, 0);

  const added = countFor(NO_ESTIMATE_CREATED_REASON);
  const completed = countFor(NO_ESTIMATE_COMPLETED_REASON);
  const other = excluded
    .filter(
      (entry) =>
        entry.reason !== NO_ESTIMATE_CREATED_REASON &&
        entry.reason !== NO_ESTIMATE_COMPLETED_REASON,
    )
    .reduce((total, entry) => total + entry.count, 0);

  const sentences: string[] = [];
  const clauses: string[] = [];
  if (added > 0) {
    clauses.push(`${added} added ${added === 1 ? "task" : "tasks"}`);
  }
  if (completed > 0) {
    clauses.push(
      `${completed} completed ${completed === 1 ? "task" : "tasks"}`,
    );
  }
  if (clauses.length > 0) {
    const total = added + completed;
    sentences.push(
      `${joinList(clauses)} ${
        total === 1 ? "has" : "have"
      } no estimate: ${total === 1 ? "it is" : "they are"} counted in the item figures and left out of the effort figures.`,
    );
  }
  if (other > 0) {
    sentences.push(
      `${other} other ${other === 1 ? "task is" : "tasks are"} left out of the figures.`,
    );
  }

  return sentences.length === 0 ? null : sentences.join(" ");
}

/**
 * Joins a list of clauses the way a sentence reads: "a", "a and b",
 * "a, b and c".
 */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  const last = items.at(-1) ?? "";
  return `${items.slice(0, -1).join(", ")} and ${last}`;
}

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One point of one of the two series of the mirrored diagram.
 *
 * The marker shape is the series' second, non-colour distinction: the
 * added series is drawn with circles, the completed series with
 * squares. The point is clickable when there is somewhere to drill
 * down to.
 */
function SeriesPoint({
  cx,
  cy,
  payload,
  shape,
  testId,
  drillable,
  radius = 4,
  onSelect,
}: Readonly<SeriesPointProps>): ReactElement | null {
  if (cx === undefined || cy === undefined) {
    return null;
  }
  const handleClick = (): void => {
    if (payload === undefined || onSelect === undefined) {
      return;
    }
    onSelect(payload);
  };
  const className = `td-work-added-completed__point td-work-added-completed__point--${
    shape === "circle" ? "added" : "completed"
  }${drillable ? " td-work-added-completed__point--drillable" : ""}`;
  if (shape === "circle") {
    return (
      <circle
        className={className}
        data-testid={testId}
        cx={cx}
        cy={cy}
        r={radius}
        onClick={handleClick}
      />
    );
  }
  const half = radius;
  return (
    <rect
      className={className}
      data-testid={testId}
      x={cx - half}
      y={cy - half}
      width={half * 2}
      height={half * 2}
      onClick={handleClick}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The work-added / work-completed chart: the mirrored line diagram (or
 * the grouped bars), the legend, the summary, the exclusion disclosure
 * and the data table that stands in for the chart.
 */
export function WorkAddedCompletedChart({
  groups,
  view,
  groupBy,
  onDrillDown,
  groupLabels = {},
}: Readonly<WorkAddedCompletedChartProps>): ReactElement {
  const buckets = collectBuckets(groups);

  /**
   * Whether the chart is split into several series. The mirrored line
   * diagram is the workspace-level figure; the grouped view keeps the
   * grouped bars until a story defines how to draw N mirrored pairs.
   */
  const isGrouped = groupBy !== undefined || groups.length > 1;

  const series = isGrouped ? buildSeries(groups) : [];
  const rows = isGrouped ? buildRows(buckets, groups, series, view) : [];

  const workspace = groups[0];
  const mirrored = isGrouped
    ? null
    : buildMirroredRows(buckets, workspace?.result ?? groups[0].result, view);
  const mirroredRows = mirrored?.rows ?? [];
  const trend = mirrored?.trend ?? null;

  const hasActivity = groups.some((group) =>
    group.result.series.buckets.some(
      (bucket) => bucket.createdCount > 0 || bucket.completedCount > 0,
    ),
  );

  const lastBucket = buckets.at(-1);
  const period =
    lastBucket === undefined
      ? ""
      : `${periodLabel(buckets[0])} – ${periodLabel(lastBucket)}`;

  const split =
    groupBy === undefined || groups.length === 0
      ? ""
      : ` Split by ${GROUP_BY_NAMES[groupBy]}: ${groups
          .map((group) =>
            group.groupKey === undefined
              ? ""
              : groupName(group.groupKey, groupLabels).text,
          )
          .filter((name) => name !== "")
          .join(", ")}.`;

  const during = period === "" ? "" : ` for ${period}`;
  const baseSummary = `${
    view === "count"
      ? "Showing the number of items added and completed"
      : "Showing the estimated effort added and completed"
  }${during}.`;

  /**
   * The reading of the period, in plain words: the capacity answer
   * must not depend on the reader interpreting the geometry.
   */
  const step = bucketStepName(buckets);
  const trendReading =
    trend === null
      ? ""
      : ` Net work change over the period: ${TREND_READINGS[trend.direction]}.` +
        ` Net trend: ${formatTrendFigure(view, trend.slope)} per ${step}.` +
        ` Net work change at the end of the period: ${formatTrendFigure(view, trend.endValue)}.`;

  const summary = `${baseSummary}${trendReading}${split}`;

  const chartLabel =
    isGrouped === false
      ? view === "count"
        ? `Line chart of the number of items added (above the zero line) and completed (below the zero line) per ${step}, with the net work change trend.`
        : `Line chart of the estimated effort added (above the zero line) and completed (below the zero line) per ${step}, with the net work change trend.`
      : view === "count"
        ? "Bar chart of the number of items added and completed per period."
        : "Bar chart of the estimated effort added and completed per period.";

  const tableCaption =
    view === "count"
      ? "Items added and completed"
      : "Estimated effort added and completed";

  /**
   * The drill-down request for one figure — the group, the bucket, the
   * measure, the view and the exact task list behind it (FR-062).
   */
  const drillDownRequest = (
    groupKey: string | undefined,
    measure: WorkAddedCompletedMeasure,
    bucket: ChartBucket,
    result: MetricResult<WorkAddedCompletedSeries>,
  ): WorkAddedCompletedDrillDownRequest => ({
    groupKey,
    measure,
    view,
    bucketStart: bucket.bucketStart,
    bucketEnd: bucket.bucketEnd,
    taskGids: contributingGids(result, measure, bucket.bucketStart),
  });

  /**
   * The drill-down a click on a point of the mirrored diagram emits:
   * the bucket the point stands for, and the measure of the series the
   * point belongs to.
   */
  const drillDownPoint =
    (measure: WorkAddedCompletedMeasure) =>
    (row: MirroredRow): void => {
      if (onDrillDown === undefined) {
        return;
      }
      const result = workspace?.result;
      if (result === undefined) {
        return;
      }
      onDrillDown(
        drillDownRequest(
          undefined,
          measure,
          { bucketStart: row.bucketStart, bucketEnd: row.bucketEnd },
          result,
        ),
      );
    };

  const valueAxisLabel = `${UNIT_NAMES[view]} — added above, completed below`;

  return (
    <section
      className="td-work-added-completed"
      data-testid="work-added-completed-chart"
      aria-label={CHART_HEADING}
    >
      <h2 className="td-work-added-completed__heading">{CHART_HEADING}</h2>
      <p
        className="td-work-added-completed__summary"
        data-testid="work-added-completed-summary"
      >
        {summary}
      </p>

      {hasActivity ? (
        <>
          <div className="td-work-added-completed__figure">
            <ResponsiveContainer
              width="100%"
              height={CHART_HEIGHT}
              initialDimension={INITIAL_DIMENSION}
            >
              {isGrouped ? (
                <BarChart
                  data={rows as readonly ChartRow[]}
                  margin={CHART_MARGIN}
                  accessibilityLayer={false}
                  role="img"
                  aria-label={chartLabel}
                >
                  <CartesianGrid
                    className="td-work-added-completed__grid"
                    vertical={false}
                  />
                  <XAxis
                    className="td-work-added-completed__axis"
                    dataKey="bucket"
                    tickLine={false}
                  />
                  <YAxis
                    className="td-work-added-completed__axis"
                    tickLine={false}
                    width={VALUE_AXIS_WIDTH}
                  />
                  <Tooltip
                    formatter={(value) => formatFigure(view, toNumber(value))}
                  />
                  {series.map((item) => (
                    <Bar
                      key={item.dataKey}
                      dataKey={item.dataKey}
                      name={item.name}
                      className={`td-work-added-completed__series td-work-added-completed__series--slot-${item.slot} td-work-added-completed__measure--${item.measure}`}
                      isAnimationActive={false}
                      onClick={(entry: BarRectangleItem) => {
                        if (onDrillDown === undefined) {
                          return;
                        }
                        const payload = entry.payload as
                          | { bucketStart?: ISODate; bucketEnd?: ISODate }
                          | undefined;
                        const bucketStart = payload?.bucketStart;
                        if (bucketStart === undefined) {
                          return;
                        }
                        const group = groups[item.groupIndex];
                        onDrillDown(
                          drillDownRequest(
                            item.groupKey,
                            item.measure,
                            {
                              bucketStart,
                              bucketEnd: payload?.bucketEnd ?? bucketStart,
                            },
                            group?.result ?? groups[0].result,
                          ),
                        );
                      }}
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart
                  data={mirroredRows}
                  margin={LINE_CHART_MARGIN}
                  accessibilityLayer={false}
                  role="img"
                  aria-label={chartLabel}
                >
                  <CartesianGrid
                    className="td-work-added-completed__grid"
                    vertical={false}
                  />
                  <XAxis
                    className="td-work-added-completed__axis"
                    dataKey="bucket"
                    tickLine={false}
                  />
                  <YAxis
                    className="td-work-added-completed__axis"
                    tickLine={false}
                    width={VALUE_AXIS_WIDTH}
                    domain={mirroredDomain(mirroredRows, view)}
                    tickFormatter={(value: number) =>
                      formatFigure(view, Math.abs(value))
                    }
                    label={{
                      content: () => (
                        <text
                          className="td-work-added-completed__axis-label"
                          x={LINE_CHART_MARGIN.left}
                          y={LINE_CHART_MARGIN.top - 8}
                          textAnchor="start"
                        >
                          {valueAxisLabel}
                        </text>
                      ),
                    }}
                  />
                  <ReferenceLine
                    y={0}
                    className="td-work-added-completed__zero"
                    ifOverflow="extendDomain"
                  />
                  <Tooltip
                    formatter={(value, name) =>
                      formatTooltipValue(view, name, toNumber(value))
                    }
                  />
                  <Line
                    type="linear"
                    dataKey="added"
                    name={SERIES_NAMES[view].added}
                    className="td-work-added-completed__line td-work-added-completed__line--added"
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={(dotProps) => (
                      <SeriesPoint
                        cx={dotProps.cx}
                        cy={dotProps.cy}
                        payload={dotProps.payload as MirroredRow | undefined}
                        shape="circle"
                        testId="work-added-completed-point-added"
                        drillable={onDrillDown !== undefined}
                        onSelect={drillDownPoint("created")}
                      />
                    )}
                    activeDot={(activeProps) => (
                      <SeriesPoint
                        cx={activeProps.cx}
                        cy={activeProps.cy}
                        payload={undefined}
                        shape="circle"
                        drillable={false}
                        radius={5}
                      />
                    )}
                  />
                  <Line
                    type="linear"
                    dataKey="completed"
                    name={SERIES_NAMES[view].completed}
                    className="td-work-added-completed__line td-work-added-completed__line--completed"
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={(dotProps) => (
                      <SeriesPoint
                        cx={dotProps.cx}
                        cy={dotProps.cy}
                        payload={dotProps.payload as MirroredRow | undefined}
                        shape="square"
                        testId="work-added-completed-point-completed"
                        drillable={onDrillDown !== undefined}
                        onSelect={drillDownPoint("completed")}
                      />
                    )}
                    activeDot={(activeProps) => (
                      <SeriesPoint
                        cx={activeProps.cx}
                        cy={activeProps.cy}
                        payload={undefined}
                        shape="square"
                        drillable={false}
                        radius={5}
                      />
                    )}
                  />
                  <Line
                    type="linear"
                    dataKey="trend"
                    name={TREND_SERIES_NAME}
                    className="td-work-added-completed__line td-work-added-completed__line--trend"
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={false}
                    activeDot={false}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {isGrouped ? (
            <ul
              className="td-work-added-completed__legend"
              data-testid="work-added-completed-legend"
            >
              {series.map((item) => {
                const label = seriesLabel(item, groupLabels);
                return (
                  <li
                    key={item.dataKey}
                    className={`td-work-added-completed__legend-item td-work-added-completed__series--slot-${item.slot}`}
                  >
                    <svg
                      className={`td-work-added-completed__swatch td-work-added-completed__swatch--${item.measure}`}
                      viewBox="0 0 16 12"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <rect
                        className="td-work-added-completed__swatch-fill"
                        x="0.5"
                        y="0.5"
                        width="15"
                        height="11"
                        rx="2"
                      />
                    </svg>
                    {label.group === null ? (
                      <span>{label.measure}</span>
                    ) : (
                      <span>
                        {label.measure} —{" "}
                        {label.group.raw ? (
                          <code>{label.group.text}</code>
                        ) : (
                          label.group.text
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul
              className="td-work-added-completed__legend"
              data-testid="work-added-completed-legend"
            >
              <li className="td-work-added-completed__legend-item td-work-added-completed__legend-item--added">
                <svg
                  className="td-work-added-completed__swatch td-work-added-completed__swatch--line"
                  viewBox="0 0 24 12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <line
                    className="td-work-added-completed__swatch-line td-work-added-completed__swatch-line--added"
                    x1="1"
                    y1="6"
                    x2="23"
                    y2="6"
                  />
                  <circle
                    className="td-work-added-completed__swatch-marker td-work-added-completed__swatch-marker--added"
                    cx="12"
                    cy="6"
                    r="3.5"
                  />
                </svg>
                <span>
                  {SERIES_NAMES[view].added} — above the zero line (red)
                </span>
              </li>
              <li className="td-work-added-completed__legend-item td-work-added-completed__legend-item--completed">
                <svg
                  className="td-work-added-completed__swatch td-work-added-completed__swatch--line"
                  viewBox="0 0 24 12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <line
                    className="td-work-added-completed__swatch-line td-work-added-completed__swatch-line--completed"
                    x1="1"
                    y1="6"
                    x2="23"
                    y2="6"
                  />
                  <rect
                    className="td-work-added-completed__swatch-marker td-work-added-completed__swatch-marker--completed"
                    x="8.5"
                    y="2.5"
                    width="7"
                    height="7"
                  />
                </svg>
                <span>
                  {SERIES_NAMES[view].completed} — below the zero line (green)
                </span>
              </li>
              <li className="td-work-added-completed__legend-item td-work-added-completed__legend-item--trend">
                <svg
                  className="td-work-added-completed__swatch td-work-added-completed__swatch--line"
                  viewBox="0 0 24 12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <line
                    className="td-work-added-completed__swatch-line td-work-added-completed__swatch-line--trend"
                    x1="1"
                    y1="6"
                    x2="23"
                    y2="6"
                  />
                </svg>
                <span>
                  {TREND_SERIES_NAME} —{" "}
                  {trend === null
                    ? ""
                    : `${TREND_DIRECTION_WORDS[trend.direction]}, ${formatTrendFigure(view, trend.slope)} per ${step}`}
                </span>
              </li>
            </ul>
          )}
        </>
      ) : (
        <p
          className="td-work-added-completed__empty"
          data-testid="work-added-completed-empty"
        >
          No tasks were added or completed in this period.
        </p>
      )}

      {hasActivity
        ? groups.map((group) => {
            const note = exclusionNote(group.result);
            const name =
              group.groupKey === undefined
                ? null
                : groupName(group.groupKey, groupLabels);
            return (
              <div
                key={group.groupKey ?? "workspace"}
                className="td-work-added-completed__group"
              >
                {note !== null ? (
                  <p
                    className="td-work-added-completed__exclusion"
                    data-testid="work-added-completed-exclusion"
                    data-group-key={group.groupKey}
                  >
                    {note}
                  </p>
                ) : null}

                <table
                  className="td-work-added-completed__table"
                  data-testid="work-added-completed-table"
                  data-group-key={group.groupKey}
                >
                  <caption>
                    {name === null ? (
                      tableCaption
                    ) : (
                      <>
                        {tableCaption} —{" "}
                        {name.raw ? <code>{name.text}</code> : name.text}
                      </>
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Period</th>
                      <th scope="col">{COLUMN_NAMES[view].created}</th>
                      <th scope="col">{COLUMN_NAMES[view].completed}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((bucket) => {
                      const source = group.result.series.buckets.find(
                        (candidate) =>
                          candidate.bucketStart === bucket.bucketStart,
                      );
                      return (
                        <tr
                          key={bucket.bucketStart}
                          data-testid="work-added-completed-row"
                          data-bucket-start={bucket.bucketStart}
                        >
                          <th scope="row">{periodLabel(bucket)}</th>
                          {(["created", "completed"] as const).map(
                            (measure) => {
                              const value =
                                source === undefined
                                  ? 0
                                  : figureOf(source, measure, view);
                              return (
                                <td
                                  key={measure}
                                  data-testid="work-added-completed-figure"
                                  data-measure={measure}
                                >
                                  <span data-testid="work-added-completed-value">
                                    {formatFigure(view, value)}
                                  </span>
                                  {onDrillDown === undefined ? null : (
                                    <button
                                      type="button"
                                      className="td-work-added-completed__drill-down"
                                      data-testid="work-added-completed-drill-down"
                                      onClick={() => {
                                        onDrillDown(
                                          drillDownRequest(
                                            group.groupKey,
                                            measure,
                                            bucket,
                                            group.result,
                                          ),
                                        );
                                      }}
                                    >
                                      {drillDownLabel(view, measure, value)}
                                    </button>
                                  )}
                                </td>
                              );
                            },
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })
        : null}
    </section>
  );
}
