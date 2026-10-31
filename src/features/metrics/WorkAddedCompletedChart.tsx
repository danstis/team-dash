/**
 * BSOD-319 (T076) — `WorkAddedCompletedChart`, the P1 "work added vs
 * work completed" chart (US4).
 *
 * Spec / contract references
 * --------------------------
 * - FR-056 / FR-057 (spec.md): the tasks *created* inside the selected
 *   range and the tasks *completed* inside it are two independent
 *   populations, so a task can be counted in both.
 * - FR-058 (spec.md): the effort sums leave out the tasks that carry no
 *   estimate, and the exclusion is disclosed rather than hidden.
 * - FR-059 (spec.md): the created and the completed measure are charted
 *   over the time buckets of the selected range.
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
 * What this module owns
 * ---------------------
 * The *presentation* of the work-added / work-completed metric: the
 * bars, the legend, the summary line, the exclusion disclosure and the
 * data table that stands in for the chart.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The metric. `calculateWorkAddedVsCompleted` (T075 / BSOD-318) owns
 *   the bucketing, the deduplication and the drill-down sets; this
 *   module renders the result it is handed and never counts a task of
 *   its own. A chart that counted by hand could agree with the domain
 *   on one figure and drift on the next.
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
 *   or the effort view, and says which one it is showing.
 * - The tasks left out of the effort sums are disclosed under the
 *   chart, because a sum that silently drops tasks is a figure the
 *   reader cannot check (FR-058).
 * - The drill-down set behind every figure travels with the figure, so
 *   the panel can show the exact tasks the bar stands for (FR-062).
 *
 * Accessibility
 * -------------
 * - The chart surface carries `role="img"` and a label that names what
 *   it shows, and the data table below it is the tabular alternative
 *   (FR-088).
 * - The table is the keyboard path: every figure carries a drill-down
 *   action, so the drill-down works without a pointer. The bars are
 *   clickable too, as a shortcut for the mouse.
 * - The two measures are told apart by their outline as well as by
 *   their colour, so the chart is readable without colour (FR-088).
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarRectangleItem,
  type TooltipValueType,
} from "recharts";

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
 * the bar stands for.
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

/** The margin around the plot area. */
const CHART_MARGIN = { top: 8, right: 8, bottom: 8, left: 8 };

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

/** A group key and the way it should be shown. */
interface GroupName {
  /** The text to show. */
  readonly text: string;
  /** Whether the text is a raw identifier that should be set in mono. */
  readonly raw: boolean;
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
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")} and ${last}`;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The work-added / work-completed chart: the bars, the legend, the
 * summary, the exclusion disclosure and the data table that stands in
 * for the chart.
 */
export function WorkAddedCompletedChart({
  groups,
  view,
  groupBy,
  onDrillDown,
  groupLabels = {},
}: Readonly<WorkAddedCompletedChartProps>): ReactElement {
  const buckets = collectBuckets(groups);
  const series = buildSeries(groups);
  const rows = buildRows(buckets, groups, series, view);

  const hasActivity = groups.some((group) =>
    group.result.series.buckets.some(
      (bucket) => bucket.createdCount > 0 || bucket.completedCount > 0,
    ),
  );

  const period =
    buckets.length === 0
      ? ""
      : `${periodLabel(buckets[0])} – ${periodLabel(buckets[buckets.length - 1])}`;

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
  const summary = `${
    view === "count"
      ? "Showing the number of items added and completed"
      : "Showing the estimated effort added and completed"
  }${during}.`;

  const chartLabel =
    view === "count"
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
        {split}
      </p>

      {hasActivity ? (
        <>
          <div className="td-work-added-completed__figure">
            <ResponsiveContainer
              width="100%"
              height={CHART_HEIGHT}
              initialDimension={INITIAL_DIMENSION}
            >
              <BarChart
                data={rows}
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
            </ResponsiveContainer>
          </div>

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
